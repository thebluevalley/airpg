import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const DEMO_USER_ID = 'demo-user-001';

// 简单的时间流转逻辑
const nextTimePhase = (current: string) => {
  const phases = ['清晨', '正午', '黄昏', '深夜'];
  const idx = phases.indexOf(current);
  return phases[(idx + 1) % 4];
};

export async function POST(req: Request) {
  try {
    const { action, autoMode } = await req.json();

    // 1. 获取玩家全量数据
    const { data: player } = await supabase
      .from('players')
      .select('*')
      .eq('user_id', DEMO_USER_ID)
      .single();

    if (!player) return NextResponse.json({ error: 'Player not found' }, { status: 404 });

    // --- 自动决策升级：基于状态的智能 ---
    let playerAction = action;
    if (autoMode) {
        // AI 简单的生存本能
        if (player.hp < 30) playerAction = "寻找食物和草药";
        else if (player.buffs?.includes("cold")) playerAction = "寻找避风处生火";
        else if (player.time_of_day === '深夜') playerAction = "建立营地休息";
        else playerAction = "探索周围并收集有用的资源";
    }
    
    // 计算新时间（每 3 次行动过一个时段，模拟时间流逝）
    // 这里简化处理：每次行动都有概率让时间流逝
    let newTime = player.time_of_day;
    const timePasses = Math.random() > 0.7; // 30% 概率时间流逝
    if (timePasses) newTime = nextTimePhase(player.time_of_day);

    // 2. 左脑 (DeepSeek) - 注入 RPG 规则
    // 我们把 Prompt 变得非常详细，教会 AI 游戏规则
    const logicPrompt = `
      [RPG 规则引擎启动]
      当前环境: { 地点: "${player.location}", 时间: "${newTime}", 玩家状态: ${JSON.stringify(player.buffs)} }
      玩家属性: { HP: ${player.hp}, 技能熟练度: ${JSON.stringify(player.skills)} }
      背包: ${JSON.stringify(player.inventory)}
      玩家行为: "${playerAction}"

      请作为硬核生存游戏 GM 进行判定：
      1. **环境影响**: 深夜探索极其危险；雨天难以生火。
      2. **熟练度**: 如果玩家多次进行某动作，提升对应技能等级（0-10）。
      3. **Buff系统**: 
         - 受伤 -> 获得 "bleeding" (持续扣血)
         - 淋雨 -> 获得 "wet" (体温下降)
         - 睡觉 -> 清除负面状态
      
      输出严格 JSON:
      { 
        "success": boolean, 
        "hp_change": number, 
        "new_location": string, 
        "inventory_updates": { "add": [], "remove": [] },
        "skill_updates": { "skill_name": "mining", "level_up": 1 },  // 如果有技能提升
        "buff_updates": { "add": ["wet"], "remove": ["hungry"] },    // 状态变更
        "reason": "简短判定理由",
        "suggested_actions": ["动作1", "动作2", "动作3"] 
      }
    `;
    
    const logicRes = await fetch('https://ark.cn-beijing.volces.com/api/v3/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.VOLC_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.VOLC_MODEL_ID, 
        messages: [{ role: "user", content: logicPrompt }],
        temperature: 0.1,
      })
    });

    const logicJson = await logicRes.json();
    const content = logicJson.choices[0].message.content.replace(/```json|```/g, '');
    const outcome = JSON.parse(content);

    // 3. 右脑 (Qwen) - 增加环境描写
    const storyPrompt = `
      时间：${newTime}。地点：${outcome.new_location || player.location}。
      玩家执行：${playerAction}。结果：${outcome.reason}。
      当前状态：${JSON.stringify(outcome.buff_updates?.add)}。
      
      写一段微小说。要求：
      - 强调光影变化（如深夜的恐怖、清晨的希望）。
      - 强调身体感受（如伤口的剧痛、篝火的温暖）。
      - 50字左右。
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

    // 4. 数据更新 (处理复杂的 Buff 和 技能)
    let newSkills = { ...player.skills };
    if (outcome.skill_updates?.skill_name) {
        const sName = outcome.skill_updates.skill_name;
        newSkills[sName] = (newSkills[sName] || 0) + outcome.skill_updates.level_up;
    }

    let newBuffs = new Set(player.buffs || []);
    outcome.buff_updates?.add?.forEach((b: string) => newBuffs.add(b));
    outcome.buff_updates?.remove?.forEach((b: string) => newBuffs.delete(b));

    // 处理背包
    let newInventory = [...(player.inventory || [])];
    outcome.inventory_updates?.remove?.forEach((item: string) => {
        const idx = newInventory.indexOf(item);
        if (idx > -1) newInventory.splice(idx, 1);
    });
    outcome.inventory_updates?.add?.forEach((item: string) => newInventory.push(item));

    const newHp = Math.max(0, Math.min(100, player.hp + (outcome.hp_change || 0)));

    await supabase.from('players').update({
        hp: newHp,
        location: outcome.new_location || player.location,
        time_of_day: newTime,
        skills: newSkills,
        buffs: Array.from(newBuffs),
        inventory: newInventory
    }).eq('id', player.id);
    
    await supabase.from('game_logs').insert({
        player_id: player.id,
        action: playerAction,
        narrative: narrative
    });

    return NextResponse.json({ 
        narrative, 
        state: { 
            hp: newHp, 
            location: outcome.new_location || player.location,
            time_of_day: newTime,
            buffs: Array.from(newBuffs)
        },
        suggestions: outcome.suggested_actions || []
    });

  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ narrative: `系统故障: ${e.message}`, state: {} }, { status: 500 });
  }
}