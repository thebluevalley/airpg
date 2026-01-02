import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const DEMO_USER_ID = 'demo-user-001';

export async function POST(req: Request) {
  try {
    const { action, autoMode } = await req.json(); // 接收 autoMode 参数

    // 1. 获取玩家状态
    const { data: player } = await supabase
      .from('players')
      .select('*')
      .eq('user_id', DEMO_USER_ID)
      .single();

    if (!player) return NextResponse.json({ error: 'Player not found' }, { status: 404 });

    // --- 核心升级：如果是自动模式，让 AI 自己决定动作 ---
    let playerAction = action;
    if (autoMode) {
        // 这里只是简单的自动逻辑，更高级的可以用 AI 决策
        if (player.hp < 30) playerAction = "寻找食物和水源";
        else if (player.stamina < 30) playerAction = "原地休息睡觉";
        else playerAction = "探索周围未知的区域";
    }
    
    // 2. 左脑: 火山引擎 (DeepSeek) - 增加 suggested_actions
    const logicPrompt = `
      [状态: HP=${player.hp}, 体力=${player.stamina}, 地点=${player.location}]
      [玩家行为: "${playerAction}"]
      
      任务：
      1. 判定行为结果。
      2. 基于当前新处境，推荐 3 个玩家接下来可能想做的动作(简短，不超过5个字)。
      
      请严格以JSON格式输出:
      { 
        "success": boolean, 
        "hp_change": number, 
        "new_location": string, 
        "reason": "简短原因",
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
        // 强制 JSON 模式（如果模型支持），或者依靠 Prompt 约束
      })
    });

    const logicJson = await logicRes.json();
    // 容错解析
    const content = logicJson.choices[0].message.content.replace(/```json|```/g, '');
    const outcome = JSON.parse(content);

    // 3. 右脑: 硅基流动 (Qwen)
    const storyPrompt = `
      玩家执行: "${playerAction}"。
      结果: ${outcome.reason}。
      请写一段30-50字的第二人称沉浸式描写。风格：冷峻、写实。
    `;

    const storyRes = await fetch('https://api.siliconflow.cn/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.SILICON_KEY_INTERACTIVE}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: "Qwen/Qwen2.5-7B-Instruct",
        messages: [{ role: "user", content: storyPrompt }]
      })
    });
    
    const storyData = await storyRes.json();
    const narrative = storyData.choices[0].message.content;

    // 4. 更新数据库
    const newHp = Math.max(0, Math.min(100, player.hp + (outcome.hp_change || 0)));
    await supabase.from('players').update({
        hp: newHp,
        location: outcome.new_location || player.location
    }).eq('id', player.id);
    
    await supabase.from('game_logs').insert({
        player_id: player.id,
        action: playerAction, // 记录实际执行的动作
        narrative: narrative
    });

    return NextResponse.json({ 
        narrative, 
        state: { hp: newHp, location: outcome.new_location || player.location },
        suggestions: outcome.suggested_actions || ["继续探索", "检查背包", "休息"] // 返回给前端
    });

  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ narrative: `系统故障: ${e.message}`, state: {} }, { status: 500 });
  }
}