import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// 初始化 Supabase
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const DEMO_USER_ID = 'demo-user-001';

export async function POST(req: Request) {
  try {
    const { action } = await req.json();
    console.log("收到玩家动作:", action);

    // 检查环境变量是否存在 (关键调试步骤)
    if (!process.env.VOLC_API_KEY) throw new Error("缺少 VOLC_API_KEY");
    if (!process.env.SILICON_KEY_INTERACTIVE) throw new Error("缺少 SILICON_KEY_INTERACTIVE");

    // 1. 获取玩家状态
    const { data: player, error: dbError } = await supabase
      .from('players')
      .select('*')
      .eq('user_id', DEMO_USER_ID)
      .single();

    if (dbError || !player) {
        console.error("数据库错误:", dbError);
        // 如果找不到玩家，尝试创建一个新玩家 (自动修复)
        const { data: newPlayer, error: createError } = await supabase
            .from('players')
            .insert({ user_id: DEMO_USER_ID })
            .select()
            .single();
        
        if (createError) throw new Error("无法创建新玩家: " + createError.message);
        return NextResponse.json({ 
            narrative: "你从荒野中醒来... (新存档已建立)", 
            state: newPlayer 
        });
    }

    // 2. 左脑: 火山引擎 (DeepSeek)
    console.log("正在呼叫火山引擎...");
    const logicPrompt = `
      [状态: HP=${player.hp}, 地点=${player.location}]
      [玩家行为: "${action}"]
      请根据逻辑判断结果，严格以JSON格式输出:
      { "success": boolean, "hp_change": number, "new_location": string, "reason": "简短原因" }
    `;
    
    const logicRes = await fetch('https://ark.cn-beijing.volces.com/api/v3/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.VOLC_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.VOLC_MODEL_ID || "deepseek-v3-241226", // 记得确保这个ID是对的
        messages: [{ role: "user", content: logicPrompt }],
        temperature: 0.1
      })
    });

    if (!logicRes.ok) {
        const errText = await logicRes.text();
        throw new Error(`火山引擎报错: ${logicRes.status} - ${errText}`);
    }

    const logicJson = await logicRes.json();
    // 增加解析容错
    const content = logicJson.choices[0].message.content.replace(/```json/g, '').replace(/```/g, '');
    const outcome = JSON.parse(content);
    console.log("逻辑判定完成:", outcome);

    // 3. 右脑: 硅基流动 (Qwen)
    console.log("正在呼叫硅基流动...");
    const storyPrompt = `基于结果"${outcome.reason}"，写一段50字以内的第二人称沉浸式微小说。`;

    const storyRes = await fetch('https://api.siliconflow.cn/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.SILICON_KEY_INTERACTIVE}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: "Qwen/Qwen2.5-7B-Instruct",
        messages: [{ role: "user", content: storyPrompt }]
      })
    });
    
    if (!storyRes.ok) {
         throw new Error(`硅基流动报错: ${storyRes.status}`);
    }

    const storyData = await storyRes.json();
    const narrative = storyData.choices[0].message.content;

    // 4. 更新数据库
    const newHp = Math.max(0, player.hp + (outcome.hp_change || 0));
    await supabase.from('players').update({
        hp: newHp,
        location: outcome.new_location || player.location
    }).eq('id', player.id);
    
    await supabase.from('game_logs').insert({
        player_id: player.id,
        action: action,
        narrative: narrative
    });

    return NextResponse.json({ narrative, state: { hp: newHp, location: outcome.new_location || player.location } });

  } catch (e: any) {
    console.error("API 严重错误:", e.message);
    // 把错误返回给前端，方便你在网页上看到原因
    return NextResponse.json({ narrative: `系统故障: ${e.message}`, state: {} }, { status: 200 });
  }
}