import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const DEMO_USER_ID = 'demo-user-001';

export async function POST(req: Request) {
  try {
    // 1. 获取玩家数据
    const { data: player } = await supabase.from('players').select('*').eq('user_id', DEMO_USER_ID).single();
    
    // 死亡重置逻辑
    if (!player || player.hp <= 0) {
       const resetState = { 
           hp: 100, level: 1, exp: 0, 
           inventory: [], 
           equipment: { weapon: null, armor: null, accessory: null },
           location: '新手村重生点' 
       };
       await supabase.from('players').update(resetState).eq('id', player?.id);
       return NextResponse.json({ narrative: "你已死亡。女神将你复活在新手村...", state: resetState });
    }

    // 2. AI 大脑 (DeepSeek) - RPG 2.0 引擎
    const logicPrompt = `
      [角色] LV:${player.level} HP:${player.hp}
      [属性] STR:${player.attributes.str} DEX:${player.attributes.dex} INT:${player.attributes.int}
      [装备] ${JSON.stringify(player.equipment)}
      [背包] ${JSON.stringify(player.inventory)}
      [位置] ${player.location}
      
      作为全自动 RPG 引擎，请基于当前状态决策下一步。
      
      [规则库]
      1. **探索与战斗**: 
         - 如果在野外，随机遭遇敌人 (哥布林/野狼/甚至巨龙)。
         - 战斗公式: 伤害 = STR * 2 + 武器攻击力。
         - 战斗胜利: 获得 EXP 和 随机物品 (Loot)。
      2. **物品生成 (Loot System)**:
         - 物品必须是对象结构: { "name": "物品名", "type": "weapon/armor/material", "stats": { "atk": 5 }, "rarity": "common/rare/epic" }
         - 名字要丰富，如 "破碎的哥布林骨头", "锋利的精铁长剑"。
      3. **自动装备 (Auto-Equip)**:
         - 如果背包里有比当前装备更强的装备，必须立即装备上，并将旧装备放入背包。
      4. **制作 (Crafting)**:
         - 检查背包材料。如: 3个"铁矿" -> 制作 "铁剑"。

      请严格以 JSON 输出:
      {
        "thought": "简短决策理由",
        "action_type": "combat/explore/craft/rest",
        "narrative": "战斗或探索的详细描述(30字)",
        "state_update": {
            "hp_change": -10,
            "exp_gain": 50,
            "new_location": "当前或新坐标名",
            "map_node_data": { "name": "森林深处", "type": "forest", "x": 1, "y": 2 }, // 仅在移动时生成
            "inventory_add": [], // 新获得的物品对象列表
            "inventory_remove_indices": [], // 消耗物品的索引
            "equipment_update": { "weapon": { ... } } // 如果更换了装备
        }
      }
    `;
    
    const logicRes = await fetch('https://ark.cn-beijing.volces.com/api/v3/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.VOLC_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.VOLC_MODEL_ID, 
        messages: [{ role: "user", content: logicPrompt }],
        temperature: 0.4, // 增加随机性以生成多样装备
        response_format: { type: "json_object" }
      })
    });

    const logicJson = await logicRes.json();
    const outcome = JSON.parse(logicJson.choices[0].message.content);

    // 3. 数据处理 (复杂的背包与装备逻辑)
    let newInventory = [...(player.inventory || [])];
    let newEquipment = { ...player.equipment };
    
    // 处理移除 (倒序移除防止索引错位)
    if (outcome.state_update.inventory_remove_indices) {
        outcome.state_update.inventory_remove_indices.sort((a:number, b:number) => b - a).forEach((idx:number) => {
            if (idx < newInventory.length) newInventory.splice(idx, 1);
        });
    }
    
    // 处理换装 (如果有新装备，把旧的脱下来放回背包)
    if (outcome.state_update.equipment_update) {
        Object.entries(outcome.state_update.equipment_update).forEach(([slot, newItem]: [string, any]) => {
            if (newEquipment[slot]) newInventory.push(newEquipment[slot]); // 旧装备回包
            newEquipment[slot] = newItem; // 穿新装备
        });
    }

    // 处理新增物品
    if (outcome.state_update.inventory_add) {
        newInventory.push(...outcome.state_update.inventory_add);
    }
    
    // 处理升级
    let newLevel = player.level;
    let newExp = player.exp + (outcome.state_update.exp_gain || 0);
    let newAttr = { ...player.attributes };
    if (newExp >= newLevel * 100) {
        newLevel++;
        newExp = 0;
        newAttr.str += 2; newAttr.dex += 1; // 升级属性成长
        outcome.state_update.hp_change += 50; // 升级回血
    }
    
    const newHp = Math.min(100 + (newLevel * 10), Math.max(0, player.hp + (outcome.state_update.hp_change || 0)));

    // 4. 数据库写入
    // 4.1 更新玩家
    await supabase.from('players').update({
        hp: newHp, exp: newExp, level: newLevel,
        attributes: newAttr,
        inventory: newInventory,
        equipment: newEquipment,
        location: outcome.state_update.new_location || player.location
    }).eq('id', player.id);

    // 4.2 记录日志
    await supabase.from('game_logs').insert({
        player_id: player.id,
        action: `[${outcome.action_type}]`, 
        narrative: outcome.narrative
    });

    // 4.3 如果探索了新地点，记录到地图表
    if (outcome.state_update.map_node_data) {
        const node = outcome.state_update.map_node_data;
        // 简单去重逻辑：如果坐标不存在则插入
        const { data: exist } = await supabase.from('map_nodes').select('id')
            .match({ player_id: player.id, name: node.name }).single();
        
        if (!exist) {
            await supabase.from('map_nodes').insert({
                player_id: player.id,
                name: node.name,
                type: node.type,
                coordinate_x: node.x,
                coordinate_y: node.y
            });
        }
    }

    return NextResponse.json({ 
        narrative: outcome.narrative, 
        thought: outcome.thought,
        state: { hp: newHp, level: newLevel, exp: newExp, inventory: newInventory, equipment: newEquipment }
    });

  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}