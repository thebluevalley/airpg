import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

export async function POST(req: Request) {
  // 1. 安全校验 (防止恶意调用)
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  // 2. 获取所有"存活"且"正在挂机"的玩家
  // 假设 player 表里有个字段 is_afk = true
  const { data: activePlayers } = await supabase.from('players').select('*').gt('hp', 0);

  if (!activePlayers || activePlayers.length === 0) return NextResponse.json({ message: 'No players' });

  // 3. 批量处理逻辑 (为了演示简单，这里只展示处理一个玩家，实际应用可以用 Promise.all 分批处理)
  const updates = await Promise.all(activePlayers.map(async (player) => {
    
    // --- 潜意识 (硅基流动 Key B) ---
    // 专门处理挂机演化：伤口感染恶化、食物腐烂、体力恢复
    const worldPrompt = `
      [后台模拟]
      玩家状态: HP=${player.hp}, 地点=${player.location}, 物品=${JSON.stringify(player.inventory)}
      时间流逝: 1小时。
      环境: 古代旷野，寒冷。
      
      请计算这1小时内发生的自然变化。
      返回JSON: { "hp_delta": number, "log": "简短的一句话日志" }
    `;

    try {
      const res = await fetch('https://api.siliconflow.cn/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.SILICON_KEY_BACKGROUND}`, 'Content-Type': 'application/json' }, // <--- Key B (专用)
        body: JSON.stringify({
          model: "deepseek-ai/DeepSeek-V3", // 后台也用 DeepSeek 保证逻辑，但用的是硅基的配额
          messages: [{ role: "user", content: worldPrompt }],
          temperature: 0.2
        })
      });
      
      const data = await res.json();
      const result = JSON.parse(data.choices[0].message.content.replace(/```json|```/g, ''));

      // 写入日志表，这样玩家上线就能看到离线发生了什么
      await supabase.from('game_logs').insert({
        player_id: player.id,
        action: '离线挂机',
        narrative: `[${new Date().getHours()}:00] ${result.log}`,
        metadata: { type: 'cron_tick' }
      });

      // 返回更新数据
      return { 
        id: player.id, 
        hp: Math.max(0, player.hp + result.hp_delta) 
      };

    } catch (e) {
      console.error(`Tick failed for player ${player.id}`, e);
      return null;
    }
  }));

  // 4. 批量更新数据库 (Supabase 支持 upsert)
  const validUpdates = updates.filter(u => u !== null);
  if (validUpdates.length > 0) {
    await supabase.from('players').upsert(validUpdates);
  }

  return NextResponse.json({ success: true, processed: validUpdates.length });
}