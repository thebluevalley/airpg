import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const DEMO_USER_ID = 'demo-user-001';

export async function POST(req: Request) {
  try {
    // 不需要接收 action 参数了，AI 自己决定
    
    // 1. 获取玩家全量数据
    const { data: player } = await supabase.from('players').select('*').eq('user_id', DEMO_USER_ID).single();
    if (!player) return NextResponse.json({ error: 'Player not found' }, { status: 404 });

    // 如果玩家死了，重置游戏
    if (player.hp <= 0) {
        await supabase.from('players').update({ 
            hp: 100, level: 1, exp: 0, inventory: [], attributes: {"str":5,"dex":5,"int":5}, location: '废土重生点' 
        }).eq('id', player.id);
        return NextResponse.json({ 
            narrative: "生命信号消失... 正在克隆新的素体... 游戏重置。", 
            action_taken: "系统重置",
            state: { hp: 100, location: '废土重生点' } 
        });
    }

    // 2. AI 大脑核心 (DeepSeek)
    // 这是一个"自律智能体" Prompt
    const logicPrompt = `
      [模拟目标: 全自动生存]
      你是一个拥有完全自由意志的废土幸存者。请根据当前状态，自主决定下一步最有意义的行动。
      
      [当前状态]
      HP:${player.hp} | LV:${player.level} | 属性:${JSON.stringify(player.attributes)}
      时间:${player.time_of_day} | 地点:${player.location}
      背包:${JSON.stringify(player.inventory)}
      
      [决策逻辑优先级]
      1. **生存**: HP < 30 时，必须寻找食物或休息。
      2. **制作**: 检查背包。如果有木头+石头，必须合成"石斧"；有草药，必须合成"绷带"。
      3. **成长**: 只有状态良好时才去战斗或探索危险区域。
      4. **清理**: 背包满了(>5个物品)则丢弃无用杂物。

      请严格以JSON格式输出你的决策与结果:
      {
        "thought_process": "我的一句话内心独白(为什么做这个决定)",
        "action_name": "具体的动作名称(如: 制作石斧)",
        "narrative_outcome": "动作的物理结果描述",
        "hp_change": number,   // 战斗扣血，休息加血
        "exp_gain": number,    // 只有有意义的行动才加经验
        "new_location": string, // 仅在移动时改变
        "inventory_updates": { "add": ["物品名"], "remove": ["物品名"] },
        "attribute_growth": { "str": 0, "dex": 0 } // 成功行动微量提升属性
      }
    `;
    
    const logicRes = await fetch('https://ark.cn-beijing.volces.com/api/v3/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.VOLC_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.VOLC_MODEL_ID, 
        messages: [{ role: "user", content: logicPrompt }],
        temperature: 0.3, // 稍微提高一点创造力
        response_format: { type: "json_object" }
      })
    });

    const logicJson = await logicRes.json();
    const outcome = JSON.parse(logicJson.choices[0].message.content);

    // 3. 剧情渲染 (Qwen)
    const storyPrompt = `
      [风格: 黑暗、电影感、第三人称]
      幸存者决定: ${outcome.action_name}
      内心想法: ${outcome.thought_process}
      物理结果: ${outcome.narrative_outcome}
      
      请生成一段 60 字以内的实时日志。
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

    // 4. 数据库更新 (执行 AI 的决定)
    // 处理背包
    let newInventory = [...(player.inventory || [])];
    outcome.inventory_updates?.remove?.forEach((item: string) => {
        const idx = newInventory.findIndex(i => item.includes(i) || i.includes(item)); 
        if (idx > -1) newInventory.splice(idx, 1);
    });
    outcome.inventory_updates?.add?.forEach((item: string) => newInventory.push(item));

    // 处理属性成长
    let newAttr = { ...player.attributes };
    if (outcome.attribute_growth) {
        newAttr.str += outcome.attribute_growth.str || 0;
        newAttr.dex += outcome.attribute_growth.dex || 0;
    }
    
    // 升级逻辑
    let newLevel = player.level;
    let newExp = player.exp + (outcome.exp_gain || 0);
    if (newExp >= newLevel * 100) {
        newLevel++;
        newExp = 0;
        // 升级回血
        outcome.hp_change += 20; 
    }

    const newHp = Math.min(100, Math.max(0, player.hp + (outcome.hp_change || 0)));

    // 时间流逝逻辑 (简单模拟)
    const times = ['清晨', '正午', '黄昏', '深夜'];
    let currentTime = player.time_of_day || '清晨';
    if (Math.random() > 0.6) {
        const idx = times.indexOf(currentTime);
        currentTime = times[(idx + 1) % 4];
    }

    await supabase.from('players').update({
        hp: newHp,
        exp: newExp,
        level: newLevel,
        attributes: newAttr,
        inventory: newInventory,
        location: outcome.new_location || player.location,
        time_of_day: currentTime
    }).eq('id', player.id);

    await supabase.from('game_logs').insert({
        player_id: player.id,
        action: `[AI] ${outcome.action_name}`, // 标记这是 AI 自动做的
        narrative: narrative
    });

    return NextResponse.json({ 
        narrative, 
        action_name: outcome.action_name,
        thought: outcome.thought_process, // 返回 AI 的思考过程
        state: { 
            hp: newHp, 
            level: newLevel, 
            exp: newExp, 
            attributes: newAttr, 
            location: outcome.new_location || player.location,
            time_of_day: currentTime,
            inventory: newInventory
        }
    });

  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}