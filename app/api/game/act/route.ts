import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const DEMO_USER_ID = 'demo-user-001';

export async function POST(req: Request) {
  try {
    // 接收参数：choice (玩家选择的文本), type (动作类型: 'explore'|'craft'|'rest'|'combat')
    const { choice, type } = await req.json(); 

    // 1. 获取玩家数据
    const { data: player } = await supabase.from('players').select('*').eq('user_id', DEMO_USER_ID).single();
    if (!player) return NextResponse.json({ error: 'Player not found' }, { status: 404 });

    // 2. 左脑 (DeepSeek) - RPG 游戏引擎核心
    // 这个 Prompt 非常关键，它定义了游戏的所有规则
    const logicPrompt = `
      [角色数据]
      LV:${player.level} EXP:${player.exp}/${player.level * 100}
      HP:${player.hp} 属性:${JSON.stringify(player.attributes)}
      装备:${JSON.stringify(player.equipment)}
      技能:${JSON.stringify(player.skills)}
      背包:${JSON.stringify(player.inventory)}
      位置:${player.location} (时间:${player.time_of_day})
      
      [玩家指令]
      类型: ${type}
      内容: "${choice}"

      [作为硬核RPG游戏引擎执行以下逻辑]
      1. **判定机制**: 基于属性(str/dex/int)和技能判定成功率。例如: 砍树用str, 潜行用dex。
      2. **成长机制**: 成功行动获得 10-20 EXP。EXP满时 Level+1 并提升属性。
      3. **物品系统**: 
         - 采集: 获得基础资源(木头/石头/草药)。
         - 制作: 检查背包资源。例: 3木头+2石头=石斧(攻击+3)。
      4. **地图机制**: 如果是探索，生成新地名。
      
      请严格以JSON格式输出结果:
      {
        "narrative_outcome": "简述发生了什么(物理层面)",
        "hp_change": -5,
        "exp_gain": 15,
        "level_up": false,
        "new_location": "当前或新地点",
        "inventory_changes": { "add": ["木头 x2"], "remove": [] },
        "attribute_changes": { "str": 0 }, 
        "next_options": [
           { "label": "继续探索森林深处", "type": "explore", "risk": "high" },
           { "label": "检查背包并制作", "type": "craft", "risk": "none" },
           { "label": "原地休息恢复体力", "type": "rest", "risk": "low" }
        ]
      }
    `;
    
    // 调用火山引擎
    const logicRes = await fetch('https://ark.cn-beijing.volces.com/api/v3/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.VOLC_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.VOLC_MODEL_ID, 
        messages: [{ role: "user", content: logicPrompt }],
        temperature: 0.1,
        response_format: { type: "json_object" } // 强制 JSON
      })
    });

    const logicJson = await logicRes.json();
    const outcome = JSON.parse(logicJson.choices[0].message.content);

    // 3. 右脑 (Qwen) - 史诗感润色
    // 让 AI 根据结果写出更有代入感的剧情
    const storyPrompt = `
      [暗黑生存风格]
      玩家行为: ${choice}
      物理结果: ${outcome.narrative_outcome}
      当前状态: HP ${player.hp + outcome.hp_change}, ${player.time_of_day}
      
      请写一段 60 字以内的剧情描述。如果是战斗或受伤，描写要惨烈；如果是制作，描写工艺细节。
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

    // 4. 更新数据库 (包含复杂的 RPG 数据)
    let newInventory = [...(player.inventory || [])];
    outcome.inventory_changes?.remove?.forEach((item: string) => {
        // 简单的删除逻辑，实际可能需要更严谨的数量判断
        const idx = newInventory.findIndex(i => item.includes(i.split(' ')[0])); 
        if (idx > -1) newInventory.splice(idx, 1);
    });
    outcome.inventory_changes?.add?.forEach((item: string) => newInventory.push(item));

    // 属性升级逻辑
    let newAttr = { ...player.attributes };
    if (outcome.level_up) {
        newAttr.str += 1; newAttr.dex += 1; newAttr.con += 1; // 升级全属性+1
    }

    const newHp = Math.min(100, Math.max(0, player.hp + outcome.hp_change));
    const newExp = player.exp + outcome.exp_gain;
    const newLevel = outcome.level_up ? player.level + 1 : player.level;

    await supabase.from('players').update({
        hp: newHp,
        exp: newExp,
        level: newLevel,
        attributes: newAttr,
        inventory: newInventory,
        location: outcome.new_location || player.location
    }).eq('id', player.id);

    await supabase.from('game_logs').insert({
        player_id: player.id,
        action: choice,
        narrative: narrative
    });

    return NextResponse.json({ 
        narrative, 
        state: { hp: newHp, level: newLevel, exp: newExp, attributes: newAttr, location: outcome.new_location },
        options: outcome.next_options // 将 AI 生成的选项传给前端
    });

  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}