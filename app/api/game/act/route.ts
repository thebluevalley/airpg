import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { GameEngine, RECIPES } from '@/lib/game/engine'; // 引入刚才写的引擎

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const DEMO_USER_ID = 'demo-user-001';

export async function POST(req: Request) {
  try {
    // 1. 获取玩家与任务数据
    const { data: player } = await supabase.from('players').select('*').eq('user_id', DEMO_USER_ID).single();
    
    if (!player || player.hp <= 0) {
        // 自动复活逻辑
        const resetState = { hp: 100, level: 1, inventory: [], location: '基地', coordinate_x: 0, coordinate_y: 0 };
        await supabase.from('players').update(resetState).eq('id', player?.id);
        return NextResponse.json({ narrative: "生命体征恢复。系统重置完成。", state: resetState });
    }

    // 确保坐标存在
    const pX = player.coordinate_x || 0;
    const pY = player.coordinate_y || 0;

    // --- 层级一：DeepSeek (决策层 Intent Layer) ---
    // AI 只负责决定"做什么"，不负责"结果是什么"
    const logicPrompt = `
      [状态] HP:${player.hp} | Loc: (${pX}, ${pY}) ${player.location}
      [背包] ${JSON.stringify(player.inventory)}
      [可用配方] ${Object.keys(RECIPES).join(', ')}
      
      作为生存AI，请决策下一步行动。
      - 如果HP低，优先RAFT绷带或REST。
      - 如果资源满，CRAFT工具。
      - 否则 MOVE 探索 (方向 N/S/W/E)。
      
      请严格返回 JSON:
      {
        "intent": "MOVE" | "CRAFT" | "REST",
        "params": "N" (如果是移动) 或 "绷带" (如果是制作),
        "reason": "简短理由"
      }
    `;
    
    const intentRes = await fetch('https://ark.cn-beijing.volces.com/api/v3/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.VOLC_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.VOLC_MODEL_ID, 
        messages: [{ role: "user", content: logicPrompt }],
        temperature: 0.1, // 低温，保证逻辑稳定
        response_format: { type: "json_object" }
      })
    });
    const intentJson = await intentRes.json();
    const decision = JSON.parse(intentJson.choices[0].message.content);

    // --- 层级二：GameEngine (模拟层 Simulation Layer) ---
    // 这里是"硬规则"，AI 无法作弊
    let engineResult: any = { success: true, log: "" };
    let newState = { ...player };
    let mapNodeData = null;

    // A. 移动/探索逻辑
    if (decision.intent === 'MOVE') {
        const dir = decision.params;
        const newX = pX + (dir === 'E' ? 1 : dir === 'W' ? -1 : 0);
        const newY = pY + (dir === 'N' ? 1 : dir === 'S' ? -1 : 0);
        
        // 1. 计算新地形
        const exploreResult = GameEngine.explore(newX, newY);
        newState.coordinate_x = newX;
        newState.coordinate_y = newY;
        newState.location = exploreResult.biomeName;
        
        // 2. 记录地图节点
        mapNodeData = { x: newX, y: newY, name: exploreResult.biomeName, type: exploreResult.biomeKey };

        // 3. 处理遭遇
        if (exploreResult.type === 'COMBAT') {
            const combat = GameEngine.resolveCombat(player, exploreResult.enemy);
            newState.hp = combat.hp_remaining;
            if (combat.win) {
                newState.exp += combat.exp_gain;
                engineResult.log = `遭遇${exploreResult.enemy}！战斗胜利，HP剩余${combat.hp_remaining}。`;
                if (combat.loot) {
                    newState.inventory = [...(newState.inventory || []), { name: combat.loot, type: "material", rarity: "common" }];
                    engineResult.log += ` 获得: ${combat.loot}`;
                }
            } else {
                engineResult.log = `遭遇${exploreResult.enemy}，你不敌逃跑了。`;
            }
        } else if (exploreResult.type === 'GATHER') {
            newState.inventory = [...(newState.inventory || []), { name: exploreResult.item, type: "material", rarity: "common" }];
            engineResult.log = `你到达了${exploreResult.biomeName}，发现了一些${exploreResult.item}。`;
        } else {
            engineResult.log = `你来到了${exploreResult.biomeName}，这里一片荒芜。`;
        }
    } 
    
    // B. 制作逻辑
    else if (decision.intent === 'CRAFT') {
        const craftRes = GameEngine.tryCraft(player.inventory, decision.params);
        if (craftRes.success) {
            // 移除材料
            // 这是一个简单的移除逻辑，实际可能需要更严谨的 ID 匹配
            let tempInv = [...(newState.inventory || [])];
            // 倒序移除
            craftRes.indicesToRemove?.sort((a,b) => b-a).forEach(idx => tempInv.splice(idx, 1));
            // 添加成品
            tempInv.push(craftRes.item);
            newState.inventory = tempInv;
            engineResult.log = `成功制作了 ${decision.params}！`;
            
            // 如果是绷带，直接使用 (简化逻辑)
            if (decision.params === '绷带') {
                newState.hp = Math.min(100, newState.hp + 30);
                // 消耗掉刚做好的绷带
                newState.inventory.pop();
                engineResult.log += " 并立即使用恢复了 30 HP。";
            }
        } else {
            engineResult.success = false;
            engineResult.log = `制作失败: ${craftRes.reason}`;
        }
    }

    // C. 休息逻辑
    else if (decision.intent === 'REST') {
        newState.hp = Math.min(100, newState.hp + 10);
        engineResult.log = "你原地休息了一会儿，体力有所恢复。";
    }

    // --- 层级三：Qwen (叙事层 Narrative Layer) ---
    // 让 AI 润色引擎生硬的 log
    const storyPrompt = `
      [动作] ${decision.intent} -> ${decision.params}
      [结果] ${engineResult.log}
      [状态] HP ${newState.hp}, 地点 ${newState.location}
      
      请把上面的[结果]扩写成一段沉浸式的微小说（50字左右）。
      风格：末日生存、冷峻。
    `;

    const storyRes = await fetch('https://api.siliconflow.cn/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.SILICON_KEY_INTERACTIVE}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: "Qwen/Qwen2.5-7B-Instruct",
        messages: [{ role: "user", content: storyPrompt }]
      })
    });
    const narrativeData = await storyRes.json();
    const narrative = narrativeData.choices[0].message.content;

    // --- 4. 数据库更新 ---
    
    // 升级检查
    if (newState.exp >= newState.level * 100) {
        newState.level++;
        newState.exp = 0;
        newState.attributes.str++; // 简单成长
        newState.hp = 100; // 升级回满
    }

    // 更新玩家
    await supabase.from('players').update({
        hp: newState.hp,
        exp: newState.exp,
        level: newState.level,
        inventory: newState.inventory,
        location: newState.location,
        coordinate_x: newState.coordinate_x,
        coordinate_y: newState.coordinate_y,
        attributes: newState.attributes
    }).eq('id', player.id);

    // 记录日志
    await supabase.from('game_logs').insert({
        player_id: player.id,
        action: `[AI] ${decision.intent} ${decision.params || ''}`,
        narrative: narrative
    });

    // 记录地图节点
    if (mapNodeData) {
        const { data: exist } = await supabase.from('map_nodes').select('id')
            .match({ player_id: player.id, coordinate_x: mapNodeData.x, coordinate_y: mapNodeData.y }).single();
        if (!exist) {
            await supabase.from('map_nodes').insert({
                player_id: player.id,
                ...mapNodeData
            });
        }
    }

    return NextResponse.json({ 
        narrative, 
        thought: `${decision.reason} (${engineResult.log})`, 
        state: newState 
    });

  } catch (e: any) {
    console.error("Game Error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}