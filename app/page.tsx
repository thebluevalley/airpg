'use client';

import { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Map, Backpack, User, Sparkles, Scroll } from 'lucide-react';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const DEMO_USER_ID = 'demo-user-001';

export default function GamePage() {
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  const [player, setPlayer] = useState<any>(null);
  const [showStats, setShowStats] = useState(false); // 属性面板开关
  
  // AI 生成的选项
  const [options, setOptions] = useState<any[]>([
      { label: "醒来，观察四周", type: "explore", risk: "none" }
  ]);
  
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const init = async () => {
      const { data: p } = await supabase.from('players').select('*').eq('user_id', DEMO_USER_ID).single();
      if (p) setPlayer(p);
      const { data: l } = await supabase.from('game_logs').select('*').eq('player_id', p?.id).order('created_at', { ascending: true }).limit(30);
      if (l) setLogs(l);
    };
    init();
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [logs]);

  // --- 核心修复在这里 ---
  const handleChoice = async (opt: any) => {
    if (loading) return;
    setLoading(true);

    // 乐观更新
    const tempLog = { id: Date.now(), action: opt.label, narrative: '...', isTemp: true };
    // Fix: 显式标记 prev 为数组
    setLogs((prev: any[]) => [...prev, tempLog]);

    try {
      const res = await fetch('/api/game/act', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choice: opt.label, type: opt.type }),
      });
      const data = await res.json();

      // Fix: 显式标记 prev 为 any
      setPlayer((prev: any) => ({ ...prev, ...data.state }));
      
      // Fix: 显式标记 prev 为数组
      setLogs((prev: any[]) => prev.map(l => l.id === tempLog.id ? { ...l, narrative: data.narrative, isTemp: false } : l));
      
      // 更新为 AI 思考后的新选项
      if (data.options && data.options.length > 0) {
          setOptions(data.options);
      }
    } catch (e) {
      alert("连接断开");
    } finally {
      setLoading(false);
    }
  };

  if (!player) return <div className="bg-slate-950 h-screen w-full flex items-center justify-center text-slate-500">Loading World...</div>;

  return (
    <div className="flex flex-col h-[100dvh] w-full max-w-md mx-auto bg-slate-950 text-slate-200 font-sans overflow-hidden shadow-2xl relative">
      
      {/* --- 属性面板 Modal --- */}
      {showStats && (
        <div className="absolute inset-0 z-50 bg-slate-950/90 backdrop-blur flex items-center justify-center p-6" onClick={() => setShowStats(false)}>
            <div className="bg-slate-900 border border-slate-700 p-6 rounded-xl w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
                <h3 className="text-xl font-bold text-amber-500 mb-4 flex items-center gap-2"><User /> 角色状态</h3>
                
                <div className="grid grid-cols-2 gap-4 mb-4">
                    <div className="bg-slate-800 p-3 rounded text-center">
                        <div className="text-slate-400 text-xs uppercase">Level</div>
                        <div className="text-2xl font-mono text-white">{player.level}</div>
                    </div>
                    <div className="bg-slate-800 p-3 rounded text-center">
                        <div className="text-slate-400 text-xs uppercase">EXP</div>
                        <div className="text-lg font-mono text-white">{player.exp}</div>
                    </div>
                </div>

                <div className="space-y-3">
                    <div className="flex justify-between border-b border-slate-800 pb-1">
                        <span className="text-slate-400">力量 (STR)</span>
                        <span className="font-mono text-orange-400">{player.attributes?.str || 5}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-800 pb-1">
                        <span className="text-slate-400">敏捷 (DEX)</span>
                        <span className="font-mono text-green-400">{player.attributes?.dex || 5}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-800 pb-1">
                        <span className="text-slate-400">智力 (INT)</span>
                        <span className="font-mono text-blue-400">{player.attributes?.int || 5}</span>
                    </div>
                </div>

                <div className="mt-6">
                    <h4 className="text-sm font-bold text-slate-500 mb-2 uppercase">背包</h4>
                    <div className="flex flex-wrap gap-2">
                        {player.inventory?.length ? player.inventory.map((item: string, i: number) => (
                            <span key={i} className="text-xs bg-slate-800 px-2 py-1 rounded text-slate-300 border border-slate-700">{item}</span>
                        )) : <span className="text-xs text-slate-600">空空如也</span>}
                    </div>
                </div>
            </div>
        </div>
      )}

      {/* --- 顶部 HUD --- */}
      <header className="absolute top-0 w-full z-10 p-4 bg-gradient-to-b from-slate-950 to-transparent">
        <div className="flex justify-between items-start">
            <div className="flex flex-col">
                <span className="text-[10px] text-slate-500 font-bold tracking-widest uppercase">LOCATION</span>
                <span className="text-lg font-serif font-bold text-slate-100 drop-shadow-md">{player.location}</span>
            </div>
            <div className="flex items-center gap-3">
                 <div className="text-right">
                    <div className="text-[10px] text-emerald-500 font-bold">HP</div>
                    <div className="text-xl font-mono leading-none">{player.hp}</div>
                 </div>
                 <div className="w-10 h-10 rounded-full bg-slate-800 border border-slate-600 flex items-center justify-center cursor-pointer hover:bg-slate-700 transition" onClick={() => setShowStats(true)}>
                    <User className="w-5 h-5 text-slate-400" />
                 </div>
            </div>
        </div>
      </header>

      {/* --- 日志区域 --- */}
      <div ref={scrollRef} className="flex-1 w-full overflow-y-auto pt-24 pb-64 px-5 space-y-6 scroll-smooth">
        {logs.map((log) => (
          <div key={log.id} className="flex flex-col gap-2 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center gap-2 opacity-70">
                <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${
                    log.action.includes('战斗') ? 'bg-red-900/50 text-red-300' : 
                    log.action.includes('制作') ? 'bg-amber-900/50 text-amber-300' :
                    'bg-slate-800 text-slate-400'
                }`}>
                    决策
                </span>
                <span className="text-xs text-slate-500 font-bold">{log.action}</span>
            </div>
            {log.narrative !== '...' && (
                <div className="text-sm font-serif leading-relaxed text-slate-300 bg-slate-900/40 p-3 rounded-lg border-l-2 border-slate-700">
                    {log.narrative}
                </div>
            )}
          </div>
        ))}
        {loading && <div className="flex justify-center"><Sparkles className="w-5 h-5 text-amber-500 animate-pulse" /></div>}
      </div>

      {/* --- 底部决策面板 (Action Deck) --- */}
      <div className="absolute bottom-0 w-full bg-slate-900/95 backdrop-blur-md border-t border-slate-800 p-5 z-20 shadow-[0_-10px_50px_rgba(0,0,0,0.7)]">
        <div className="mb-2 flex justify-between items-center">
            <span className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">待决策事项</span>
            {player.level > 1 && <span className="text-[10px] text-amber-600 font-bold">LV.{player.level}</span>}
        </div>
        
        {/* 动态选项卡片 */}
        <div className="grid grid-cols-1 gap-3">
            {options.map((opt, idx) => (
                <button 
                    key={idx}
                    onClick={() => handleChoice(opt)}
                    disabled={loading}
                    className={`
                        w-full text-left p-3 rounded-lg border transition-all active:scale-95 group
                        ${opt.type === 'combat' ? 'bg-red-950/30 border-red-900/50 hover:bg-red-900/50' : 
                          opt.type === 'craft' ? 'bg-amber-950/30 border-amber-900/50 hover:bg-amber-900/50' :
                          'bg-slate-800/50 border-slate-700/50 hover:bg-slate-800'}
                    `}
                >
                    <div className="flex justify-between items-center">
                        <span className="text-sm font-bold text-slate-200 group-hover:text-white transition-colors">
                            {opt.label}
                        </span>
                        {/* 风险指示器 */}
                        {opt.risk === 'high' && <span className="text-[10px] bg-red-950 text-red-400 px-1.5 rounded">高危</span>}
                        {opt.risk === 'none' && <span className="text-[10px] bg-emerald-950 text-emerald-400 px-1.5 rounded">安全</span>}
                    </div>
                </button>
            ))}
        </div>

        {/* 底部导航图标 (保留功能入口，暂未实现具体逻辑) */}
        <div className="flex justify-center gap-8 mt-5 opacity-50">
            <Map className="w-5 h-5 text-slate-500" />
            <Backpack className="w-5 h-5 text-slate-500" />
            <Scroll className="w-5 h-5 text-slate-500" />
        </div>
      </div>
    </div>
  );
}