'use client';

import { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Map, Backpack, Hammer, Send, Loader2, Zap, Play } from 'lucide-react';

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
  // 新增：存储 AI 推荐的动作
  const [suggestions, setSuggestions] = useState<string[]>(["搜寻物资", "观察四周", "检查身体状态"]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 初始化
  useEffect(() => {
    const fetchInit = async () => {
      const { data: p } = await supabase.from('players').select('*').eq('user_id', DEMO_USER_ID).single();
      if (p) setPlayer(p);
      const { data: l } = await supabase.from('game_logs').select('*').eq('player_id', p?.id).order('created_at', { ascending: true }).limit(30);
      if (l) setLogs(l);
    };
    fetchInit();
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [logs]);

  // 统一处理动作发送
  const handleAction = async (actionText: string, isAuto: boolean = false) => {
    if (loading) return;
    setLoading(true);
    setInput(''); // 清空输入框

    // 乐观 UI 更新
    const displayAction = isAuto ? "⚡️ 自动决策中..." : actionText;
    const tempLog = { id: Date.now(), action: displayAction, narrative: '...', isTemp: true };
    setLogs((prev: any[]) => [...prev, tempLog]);

    try {
      const res = await fetch('/api/game/act', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            action: actionText,
            autoMode: isAuto 
        }),
      });
      const data = await res.json();

      setPlayer((prev: any) => ({ ...prev, ...data.state }));
      setLogs((prev: any[]) => prev.map(l => l.id === tempLog.id ? { ...l, action: isAuto ? `⚡️ 自动: ${data.state.location}` : actionText, narrative: data.narrative, isTemp: false } : l));
      
      // 更新推荐按钮
      if (data.suggestions && data.suggestions.length > 0) {
          setSuggestions(data.suggestions);
      }
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
            <span className="text-[10px] text-slate-500 font-bold tracking-widest uppercase">LOCATION</span>
            <span className="text-sm font-serif font-bold text-slate-100">{player.location}</span>
        </div>
        <div className="flex flex-col items-end">
             <span className="text-[10px] text-emerald-500 font-bold uppercase">STATUS</span>
             <div className="flex gap-2 text-xs font-mono text-slate-400">
                <span>HP:{player.hp}</span>
             </div>
        </div>
      </header>

      {/* 日志流 */}
      <div ref={scrollRef} className="flex-1 w-full overflow-y-auto pt-20 pb-48 px-4 space-y-8 scroll-smooth">
        {logs.map((log) => (
          <div key={log.id} className={`flex flex-col gap-2 ${log.isTemp ? 'opacity-50' : 'opacity-100 transition-opacity duration-500'}`}>
            {/* 动作标签 */}
            <div className="flex justify-center">
                <span className="text-[10px] uppercase tracking-widest text-slate-600 border-b border-slate-800 pb-1 mb-1">
                    {log.action}
                </span>
            </div>
            {/* 剧情文本 */}
            {log.narrative !== '...' && (
                <div className="text-sm font-serif leading-7 text-slate-300 tracking-wide text-justify">
                    {log.narrative}
                </div>
            )}
          </div>
        ))}
        {loading && <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 text-slate-600 animate-spin"/></div>}
      </div>

      {/* 底部控制台 (高度增加以容纳按钮) */}
      <div className="bg-slate-900/95 backdrop-blur border-t border-slate-800 p-4 pb-8 absolute bottom-0 w-full z-20 flex flex-col gap-4 shadow-[0_-10px_40px_rgba(0,0,0,0.5)]">
        
        {/* 1. 智能推荐按钮区 */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
            {/* 自动按钮 */}
            <button 
                onClick={() => handleAction("", true)}
                disabled={loading}
                className="flex-shrink-0 flex items-center gap-1 bg-amber-900/30 text-amber-500 border border-amber-800/50 px-3 py-1.5 rounded-full text-xs font-bold hover:bg-amber-900/50 transition-colors"
            >
                <Zap className="w-3 h-3" /> 自动探索
            </button>
            
            {/* AI 推荐的动态按钮 */}
            {suggestions.map((s, i) => (
                <button 
                    key={i}
                    onClick={() => handleAction(s)}
                    disabled={loading}
                    className="flex-shrink-0 bg-slate-800 text-slate-300 border border-slate-700 px-3 py-1.5 rounded-full text-xs hover:bg-slate-700 hover:text-white transition-colors"
                >
                    {s}
                </button>
            ))}
        </div>

        {/* 2. 传统输入框 (保留以防玩家想微操) */}
        <div className="flex gap-2 relative">
            <input 
                type="text" 
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAction(input)}
                placeholder="或者输入指令..."
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-slate-600 transition-all placeholder:text-slate-700"
            />
            <button 
                onClick={() => handleAction(input)}
                disabled={loading}
                className="absolute right-2 top-2 bg-slate-800 hover:bg-slate-700 text-slate-200 p-1.5 rounded-md transition-colors"
            >
                {loading ? <Loader2 className="w-4 h-4 animate-spin"/> : <Send className="w-4 h-4" />}
            </button>
        </div>

        {/* 3. 底部导航 */}
        <div className="flex justify-around pt-1 border-t border-slate-800/50 mt-1">
            <button className="flex flex-col items-center gap-1 text-slate-500 hover:text-slate-200"><Map className="w-4 h-4" /><span className="text-[10px] font-bold">MAP</span></button>
            <button className="flex flex-col items-center gap-1 text-slate-500 hover:text-slate-200"><Backpack className="w-4 h-4" /><span className="text-[10px] font-bold">BAG</span></button>
            <button className="flex flex-col items-center gap-1 text-slate-500 hover:text-slate-200"><Hammer className="w-4 h-4" /><span className="text-[10px] font-bold">CRAFT</span></button>
        </div>
      </div>
    </div>
  );
}