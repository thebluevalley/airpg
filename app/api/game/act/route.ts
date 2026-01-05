import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { GameEngine } from '@/lib/game/engine';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const DEMO_USER_ID = 'demo-user-001';

export async function POST(req: Request) {
  try {
    const { data: player } = await supabase.from('players').select('*').eq('user_id', DEMO_USER_ID).single();
    
    // 死亡复活
    if (!player || player.hp <= 0) {
        const resetState = { hp: 100, level: 1, inventory: [], location: '营地', coordinate_x: 0, coordinate_y: 0 };
        await supabase.from('players').update(resetState).eq('id', player?.id);
        return NextResponse.json({ narrative: "视线模糊... 你在营地的篝火旁醒来，失去了所有战利品。", state: resetState });
    }

    const pX = player.coordinate_x || 0;
    const pY = player.coordinate_y || 0;

    // --- 1. AI 决策层 ---
    // 告诉 AI 现在的装备情况和地牢的存在
    const logicPrompt = `
      [状态] HP:${player.hp} LV:${player.level} Loc:(${pX},${pY}) ${player.location}
      [装备] 武器:${player.equipment?.weapon?.name || '无'} 防具:${player.equipment?.armor?.name || '无'}
      [感知] 坐标被10整除的地方(如 10,0 或 0,10)是【远古地牢】，那里掉落史诗装备，但非常危险。
      
      作为硬核玩家AI，决策逻辑：
      1. 生存优先：HP < 40% 必须 REST。
      2. 发育：如果装备太差(无装备或普通)，去野外打怪升级 (MOVE)。
      3. 挑战：如果状态好且装备不错，尝试寻找并进入【远古地牢】刷神装。
      4. 整理：如果背包有比身上更强的装备，EQUIP。

      请返回 JSON:
      {
        "intent": "MOVE" | "REST" | "EQUIP",
        "params": "N/S/E/W" (移动方向) 或 物品索引(装备),
        "reason": "简短理由，例如: '前往(10,0)挑战地牢BOSS'"
      }
    `;
    
    const intentRes = await fetch('https://ark.cn-beijing.volces.com/api/v3/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.VOLC_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.VOLC_MODEL_ID, 
        messages: [{ role: "user", content: logicPrompt }],
        temperature: 0.2, 
        response_format: { type: "json_object" }
      })
    });
    const decision = JSON.parse((await intentRes.json()).choices[0].message.content);

    // --- 2. 游戏引擎执行层 ---
    let engineResult: any = { success: true, log: "" };
    let newState = { ...player };
    let mapNodeData = null;

    // A. 移动与战斗
    if (decision.intent === 'MOVE') {
        const dir = decision.params;
        const newX = pX + (dir === 'E' ? 1 : dir === 'W' ? -1 : dir === 'N' ? 0 : 0); // 简单处理，如果是 N/S 逻辑一样
        // AI 可能会输出复杂的 N/S/E/W，这里简化坐标逻辑：
        // 实际应用中需要严格解析 dir
        let dx = 0, dy = 0;
        if (dir.includes('E')) dx = 1; else if (dir.includes('W')) dx = -1;
        if (dir.includes('N')) dy = 1; else if (dir.includes('S')) dy = -1;
        // 如果 AI 没给方向，随机走
        if (dx === 0 && dy === 0) dx = 1;

        newState.coordinate_x += dx;
        newState.coordinate_y += dy;

        const exploreRes = GameEngine.explore(newState.coordinate_x, newState.coordinate_y);
        newState.location = exploreRes.biomeName;
        mapNodeData = { x: newState.coordinate_x, y: newState.coordinate_y, name: exploreRes.biomeName, type: exploreRes.biomeKey };

        if (exploreRes.type === 'COMBAT') {
            // ! 断言 enemy 存在
            const combat = GameEngine.resolveCombat(player, exploreRes.enemy!);
            newState.hp = combat.hp_remaining;
            
            // 构建战斗日志
            let combatLog = `遭遇到 Lv.${Math.floor(newState.level)} ${exploreRes.enemy}！`;
            if (combat.win) {
                newState.exp += combat.exp_gain;
                combatLog += ` 激战获胜！获得 ${combat.exp_gain} EXP。`;
                if (combat.loot) {
                    newState.inventory = [...(newState.inventory || []), combat.loot];
                    combatLog += ` 掉落: [${combat.loot.rarity === 'epic' ? '史诗!' : combat.loot.rarity === 'rare' ? '稀有' : '普通'} ${combat.loot.name}]`;
                }
            } else {
                combatLog += " 你不敌对手，狼狈逃窜...";
            }
            engineResult.log = combatLog;
        } else {
            engineResult.log = `你来到了${exploreRes.biomeName}，四周寂静无声。`;
        }
    }

    // B. 自动换装
    else if (decision.intent === 'EQUIP') {
        // AI 觉得要换装，我们扫描背包找最强的
        let bestWeapon = newState.equipment?.weapon;
        let bestArmor = newState.equipment?.armor;
        let changed = false;

        const inventory = [...(newState.inventory || [])];
        const keepIndices: number[] = [];

        inventory.forEach((item: any, idx: number) => {
            let keep = true;
            if (item.type === 'weapon') {
                if (!bestWeapon || (item.stats.atk > (bestWeapon.stats.atk || 0))) {
                    if (bestWeapon) inventory.push(bestWeapon); // 旧的放回去 (这里简化逻辑，实际要避免无限循环)
                    bestWeapon = item;
                    keep = false; // 从背包移除
                    changed = true;
                }
            } else if (item.type === 'armor') {
                if (!bestArmor || (item.stats.def > (bestArmor.stats.def || 0))) {
                    if (bestArmor) inventory.push(bestArmor);
                    bestArmor = item;
                    keep = false;
                    changed = true;
                }
            }
            if (keep) keepIndices.push(idx);
        });

        if (changed) {
            newState.equipment = { ...newState.equipment, weapon: bestWeapon, armor: bestArmor };
            newState.inventory = keepIndices.map(i => inventory[i]); // 重建背包
            engineResult.log = `整理装备：换上了更强的 ${bestWeapon?.name} / ${bestArmor?.name}`;
        } else {
            engineResult.log = "检查了背包，没有发现更好的装备。";
        }
    }

    else if (decision.intent === 'REST') {
        newState.hp = Math.min(100 + (newState.level * 10), newState.hp + 30);
        engineResult.log = "你找了个隐蔽的角落包扎伤口，生命值恢复了。";
    }

    // --- 3. 叙事层 ---
    const storyPrompt = `
      [事件] ${engineResult.log}
      [装备] 手持${newState.equipment?.weapon?.name || '空手'}
      
      请根据事件写一段极短的战斗/探险描写(40字内)。
      如果是获得了【史诗】或【稀有】装备，请着重描写装备的光芒。
    `;

    const storyRes = await fetch('https://api.siliconflow.cn/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.SILICON_KEY_INTERACTIVE}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: "Qwen/Qwen2.5-7B-Instruct",
        messages: [{ role: "user", content: storyPrompt }]
      })
    });
    const narrative = (await storyRes.json()).choices[0].message.content;

    // --- 4. 更新数据库 ---
    // 升级逻辑
    const maxExp = newState.level * 100;
    if (newState.exp >= maxExp) {
        newState.level++;
        newState.exp -= maxExp;
        newState.hp = 100 + (newState.level * 10);
        newState.attributes.str += 2;
        newState.attributes.dex += 2;
        engineResult.log += " (升级了！属性提升)";
    }

    await supabase.from('players').update({
        hp: newState.hp,
        exp: newState.exp,
        level: newState.level,
        attributes: newState.attributes,
        inventory: newState.inventory,
        equipment: newState.equipment,
        location: newState.location,
        coordinate_x: newState.coordinate_x,
        coordinate_y: newState.coordinate_y
    }).eq('id', player.id);

    await supabase.from('game_logs').insert({
        player_id: player.id,
        action: `[AI] ${decision.intent}`,
        narrative: narrative
    });
    
    // 更新地图节点
    if (mapNodeData) {
        // ... (地图更新逻辑同前) ...
    }

    return NextResponse.json({ narrative, thought: decision.reason, state: newState });

  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}