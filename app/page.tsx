'use client';

import { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Map, Backpack, User, Activity, Play, Pause, BrainCircuit, Terminal } from 'lucide-react';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const DEMO_USER_ID = 'demo-user-001';

export default function GamePage() {
  const [isRunning, setIsRunning] = useState(false); // 控制自动运行
  const [aiThought, setAiThought] = useState("AI 正在分析环境..."); // 显示 AI 的思考
  const [logs, setLogs] = useState<any[]>([]);
  const [player, setPlayer] = useState<any>(null);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // 初始化
  useEffect(() => {
    const init = async () => {
      const { data: p } = await supabase.from('players').select('*').eq('user_id', DEMO_USER_ID).single();
      if (p) setPlayer(p);
      const { data: l } = await supabase.from('game_logs').select('*').eq('player_id', p?.id).order('created_at', { ascending: true }).limit(50);
      if (l) setLogs(l);
    };
    init();
    
    return () => stopGame(); // 清理定时器
  }, []);

  // 自动滚动
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [logs, aiThought]);

  // 核心循环：自动游戏逻辑
  const runGameStep = async () => {
    if (!player || player.hp <= 0) return;

    // 1. 乐观更新思考状态
    setAiThought("AI 正在决策下一步行动...");

    try {
      const res = await fetch('/api/game/act', {
        method: 'POST', 
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({}) // 空包，无需参数
      });
      const data = await res.json();

      // 2. 更新数据
      setPlayer((prev: any) => ({ ...prev, ...data.state }));
      setAiThought(`决策完成: ${data.thought}`); // 显示 AI 的决策理由
      
      const newLog = { 
        id: Date.now(), 
        action: data.action_name, 
        narrative: data.narrative,
        time: new Date().toLocaleTimeString()
      };
      setLogs((prev) => [...prev, newLog]);

    } catch (e) {
      console.error("Connection lost");
      setIsRunning(false); // 出错暂停
    }
  };

  // 定时器控制
  useEffect(() => {
    if (isRunning) {
      // 立即执行一次
      runGameStep();
      // 然后每 5 秒执行一次 (留给玩家阅读时间)
      timerRef.current = setInterval(runGameStep, 5000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isRunning]);

  const toggleGame = () => setIsRunning(!isRunning);
  const stopGame = () => { setIsRunning(false); if (timerRef.current) clearInterval(timerRef.current); };

  if (!player) return <div className="bg-slate-950 h-screen w-full flex items-center justify-center text-slate-500 font-mono">Loading Neural Link...</div>;

  return (
    <div className="flex flex-col h-[100dvh] w-full max-w-md mx-auto bg-slate-950 text-slate-200 font-sans overflow-hidden relative border-x border-slate-900">
      
      {/* --- 顶部仪表盘 --- */}
      <header className="bg-slate-900/80 backdrop-blur-sm border-b border-slate-800 p-4 z-20">
        <div className="flex justify-between items-center mb-2">
            <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${isRunning ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
                <span className="text-[10px] font-mono text-slate-400 uppercase tracking-widest">
                    {isRunning ? 'SYSTEM ONLINE' : 'SYSTEM PAUSED'}
                </span>
            </div>
            <span className="text-xs font-mono text-slate-500">{player.time_of_day}</span>
        </div>

        <div className="grid grid-cols-2 gap-4">
            {/* 地点信息 */}
            <div>
                <div className="text-[10px] text-slate-500 font-bold uppercase">LOCATION</div>
                <div className="text-sm font-bold text-white truncate">{player.location}</div>
            </div>
            {/* 状态信息 */}
            <div className="flex justify-end gap-3">
                <div className="text-right">
                    <div className="text-[10px] text-emerald-500 font-bold">HP</div>
                    <div className="text-lg font-mono leading-none text-emerald-400">{player.hp}</div>
                </div>
                <div className="text-right">
                    <div className="text-[10px] text-amber-500 font-bold">LV</div>
                    <div className="text-lg font-mono leading-none text-amber-400">{player.level}</div>
                </div>
            </div>
        </div>
      </header>

      {/* --- AI 思考过程可视化 (脑机接口风格) --- */}
      <div className="bg-slate-950 border-b border-slate-800 p-3 flex items-start gap-3 shadow-inner">
        <BrainCircuit className={`w-5 h-5 mt-0.5 ${isRunning ? 'text-purple-400 animate-pulse' : 'text-slate-600'}`} />
        <div className="flex-1">
            <div className="text-[10px] text-purple-500 font-bold uppercase mb-1">Neural Core Processing</div>
            <div className="text-xs font-mono text-purple-200 leading-relaxed italic">
                "{aiThought}"
            </div>
        </div>
      </div>

      {/* --- 日志流 --- */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-6 scroll-smooth bg-slate-950">
        {logs.map((log) => (
          <div key={log.id} className="flex flex-col gap-1 animate-in fade-in slide-in-from-bottom-2 duration-500">
            {/* 时间戳与动作 */}
            <div className="flex items-center gap-2 opacity-60">
                <Terminal className="w-3 h-3 text-slate-500" />
                <span className="text-[10px] font-mono text-slate-500">{log.time}</span>
                <span className="text-[10px] text-emerald-500 font-bold uppercase tracking-wider">[{log.action}]</span>
            </div>
            {/* 剧情 */}
            <div className="text-sm font-serif text-slate-300 leading-relaxed pl-5 border-l border-slate-800">
                {log.narrative}
            </div>
          </div>
        ))}
        {/* 底部留白方便查看 */}
        <div className="h-24"></div>
      </div>

      {/* --- 底部控制台 --- */}
      <div className="absolute bottom-0 w-full bg-slate-900/95 backdrop-blur border-t border-slate-800 p-4 z-30">
        {/* 属性概览小条 */}
        <div className="flex gap-4 mb-4 overflow-x-auto text-[10px] font-mono text-slate-400 pb-2 border-b border-slate-800/50">
            <span>STR:{player.attributes?.str}</span>
            <span>DEX:{player.attributes?.dex}</span>
            <span>INT:{player.attributes?.int}</span>
            <span>EXP:{player.exp}</span>
            <span className="text-slate-500">|</span>
            {player.inventory?.map((i:string, idx:number) => (
                <span key={idx} className="text-amber-500">{i}</span>
            ))}
        </div>

        {/* 主控制按钮 */}
        <button 
            onClick={toggleGame}
            className={`w-full py-4 rounded-lg font-bold tracking-widest uppercase transition-all flex items-center justify-center gap-2 ${
                isRunning 
                ? 'bg-red-950/50 text-red-500 border border-red-900/50 hover:bg-red-900/50' 
                : 'bg-emerald-950/80 text-emerald-400 border border-emerald-900/50 hover:bg-emerald-900/80'
            }`}
        >
            {isRunning ? <><Pause className="w-4 h-4" /> 中止连接</> : <><Play className="w-4 h-4" /> 激活代理 AI</>}
        </button>
      </div>
    </div>
  );
}