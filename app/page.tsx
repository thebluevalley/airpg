'use client';

import { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Map, Backpack, Hammer, Send, Loader2 } from 'lucide-react';

// 初始化 Supabase
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const DEMO_USER_ID = 'demo-user-001';

export default function GamePage() {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  const [player, setPlayer] = useState<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 初始化加载
  useEffect(() => {
    const fetchInit = async () => {
      const { data: p } = await supabase.from('players').select('*').eq('user_id', DEMO_USER_ID).single();
      if (p) setPlayer(p);
      const { data: l } = await supabase.from('game_logs').select('*').eq('player_id', p?.id).order('created_at', { ascending: true }).limit(20);
      if (l) setLogs(l);
    };
    fetchInit();
  }, []);

  // 自动滚动
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  // 发送指令
  const handleAction = async () => {
    if (!input.trim() || loading) return;
    const action = input;
    setInput('');
    setLoading(true);

    // 乐观更新 UI
    const tempLog = { id: Date.now(), action: action, narrative: '...', isTemp: true };
    setLogs(prev => [...prev, tempLog]);

    try {
      const res = await fetch('/api/game/act', {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      const data = await res.json();

      setPlayer(prev => ({ ...prev, ...data.state }));
      setLogs(prev => prev.map(l => l.id === tempLog.id ? { ...l, narrative: data.narrative, isTemp: false } : l));
    } catch (e) {
      alert("连接断开");
    } finally {
      setLoading(false);
    }
  };

  if (!player) return <div className="flex h-screen items-center justify-center bg-slate-950 text-slate-400"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="flex flex-col h-[100dvh] w-full max-w-md mx-auto bg-slate-950 text-slate-200 font-sans overflow-hidden shadow-2xl relative">
      {/* 顶栏 */}
      <header className="flex justify-between items-center p-4 bg-slate-950/90 backdrop-blur-md border-b border-slate-800 z-20 absolute top-0 w-full">
        <div className="flex flex-col">
            <span className="text-xs text-slate-500 font-bold tracking-widest uppercase">Location</span>
            <span className="text-sm font-serif font-bold text-slate-200">{player.location}</span>
        </div>
        <div className="flex gap-3">
          <div className="flex flex-col items-end">
             <span className="text-[10px] text-red-500 font-bold uppercase">Health</span>
             <span className="text-lg font-mono leading-none text-red-400">{player.hp}</span>
          </div>
        </div>
      </header>

      {/* 日志流 */}
      <div ref={scrollRef} className="flex-1 w-full overflow-y-auto pt-20 pb-4 px-4 space-y-6 scroll-smooth">
        {logs.map((log) => (
          <div key={log.id} className={`flex flex-col gap-2 ${log.isTemp ? 'opacity-50' : 'opacity-100 transition-opacity duration-500'}`}>
            <div className="self-end bg-slate-800/80 px-3 py-2 rounded-2xl rounded-tr-sm max-w-[85%] border border-slate-700">
                <p className="text-sm text-slate-300">{log.action}</p>
            </div>
            {log.narrative !== '...' && (
                <div className="self-start px-1 py-1 max-w-[95%]">
                    <p className="text-sm font-serif leading-7 text-slate-300 tracking-wide">
                        {log.narrative}
                    </p>
                </div>
            )}
          </div>
        ))}
        {loading && <div className="text-xs text-slate-500 animate-pulse pl-2">命运正在计算...</div>}
        <div className="h-24"></div> 
      </div>

      {/* 底部操作 */}
      <div className="bg-slate-900/95 backdrop-blur border-t border-slate-800 p-4 pb-6 absolute bottom-0 w-full z-20 flex flex-col gap-3">
        <div className="flex gap-2 relative">
            <input 
                type="text" 
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAction()}
                placeholder="你想做什么？(例: 搜寻物资)"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-amber-600 transition-all placeholder:text-slate-600"
            />
            <button onClick={handleAction} disabled={loading} className="absolute right-2 top-2 bg-slate-800 hover:bg-slate-700 text-slate-200 p-1.5 rounded-md transition-colors">
                {loading ? <Loader2 className="w-4 h-4 animate-spin"/> : <Send className="w-4 h-4" />}
            </button>
        </div>
        <div className="flex justify-between px-4 pt-2">
            <button className="flex flex-col items-center gap-1 text-slate-400"><Map className="w-5 h-5" /><span className="text-[10px] uppercase font-bold">Map</span></button>
            <button className="flex flex-col items-center gap-1 text-slate-400"><Backpack className="w-5 h-5" /><span className="text-[10px] uppercase font-bold">Bag</span></button>
            <button className="flex flex-col items-center gap-1 text-slate-400"><Hammer className="w-5 h-5" /><span className="text-[10px] uppercase font-bold">Craft</span></button>
        </div>
      </div>
    </div>
  );
}