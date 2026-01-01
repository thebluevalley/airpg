import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// 初始化
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
const DEMO_USER_ID = 'demo-user-001';

export async function POST(req: Request) {
  try {
    const { action } = await req.json();

    // 1. 获取状态
    const { data: player } = await supabase.from('players').select('*').eq('user_id', DEMO_USER_ID).single();

    // ----------------------------------------------------------------
    // 步骤 1: 左脑 (火山引擎) - 物理判定
    // ----------------------------------------------------------------
    const logicPrompt = `
      [世界:写实古代] [状态:HP${player.hp}/体力${player.stamina}] [背包:${JSON.stringify(player.inventory)}]
      [行为:"${action}"]
      请以JSON格式输出物理判定结果(success, hp_change, item_updates, reason)。
    `;
    
    // 调用火山引擎 (DeepSeek)
    const logicRes = await fetch('https://ark.cn-beijing.volces.com/api/v3/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.VOLC_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.VOLC_MODEL_ID, 
        messages: [{ role: "user", content: logicPrompt }],
        temperature: 0.1
      })
    });
    const logicJson = await logicRes.json();
    const outcome = JSON.parse(logicJson.choices[0].message.content.replace(/```json|```/g, ''));

    // ----------------------------------------------------------------
    // 步骤 2: 右脑 (硅基流动 Key A) - 剧情渲染
    // ----------------------------------------------------------------
    const storyPrompt = `根据判定结果"${outcome.reason}"，写一段50字以内的第二人称沉浸式微小说。`;

    // 调用硅基流动 (Key A)
    const storyRes = await fetch('https://api.siliconflow.cn/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.SILICON_KEY_INTERACTIVE}`, 'Content-Type': 'application/json' }, // <--- Key A
      body: JSON.stringify({
        model: "Qwen/Qwen2.5-7B-Instruct",
        messages: [{ role: "user", content: storyPrompt }]
      })
    });
    const storyData = await storyRes.json();

    // 更新数据库 (略，同之前代码)...
    
    return NextResponse.json({ narrative: storyData.choices[0].message.content, state: outcome });
  } catch (e) {
    return NextResponse.json({ error: 'System Error' }, { status: 500 });
  }
}