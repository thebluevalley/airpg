'use client';

import { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Map, Backpack, Hammer, Send, Loader2, Zap } from 'lucide-react';

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
  // 默认推荐动作
  const [suggestions, setSuggestions] = useState<string[]>(["观察四周", "检查身体状态", "整理背包"]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 1. 初始化数据加载
  useEffect(() => {
    const fetchInit = async () => {
      // 获取玩家最新状态
      const { data: p } = await supabase
        .from('players')
        .select('*')
        .eq('user_id', DEMO_USER_ID)
        .single();
      
      if (p) setPlayer(p);
      
      // 获取历史日志
      const { data: l } = await supabase
        .from('game_logs')
        .select('*')
        .eq('player_id', p?.id)
        .order('created_at', { ascending: true })
        .limit(30);
        
      if (l) setLogs(l);
    };
    fetchInit();
  }, []);

  // 2. 日志自动滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  // 3. 处理动作发送 (支持手动输入和自动模式)
  const handleAction = async (actionText: string, isAuto: boolean = false) => {
    if (loading) return;
    
    // 如果是手动输入且为空，则不执行
    if (!isAuto && !actionText.trim()) return;

    setLoading(true);
    setInput(''); // 清空输入框

    // 乐观 UI 更新：先在界面上显示“正在执行...”
    const displayAction = isAuto ? "⚡️ 自动决策中..." : actionText;
    const tempLog = { id: Date.now(), action: displayAction, narrative: '...', isTemp: true };
    
    // 使用函数式更新，避免依赖闭包中的旧 state
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

      // 更新玩家状态 (包括 HP, 位置, 时间, Buff, 技能)
      setPlayer((prev: any) => ({ ...prev, ...data.state }));
      
      // 更新日志内容
      setLogs((prev: any[]) => prev.map(l => 
        l.id === tempLog.id 
          ? { 
              ...l, 
              // 如果是自动模式，显示 AI 决定的具体动作；否则显示玩家输入的动作
              action: isAuto ? `⚡️ 自动: ${data.state.location}行动` : actionText, 
              narrative: data.narrative, 
              isTemp: false 
            } 
          : l
      ));
      
      // 更新智能推荐按钮
      if (data.suggestions && data.suggestions.length > 0) {
          setSuggestions(data.suggestions);
      }

    } catch (e) {
      alert("与世界的连接断开了（网络错误）");
    } finally {
      setLoading(false);
    }
  };

  // 加载中状态
  if (!player) return <div className="flex h-screen items-center justify-center bg-slate-950 text-slate-400"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="flex flex-col h-[100dvh] w-full max-w-md mx-auto bg-slate-950 text-slate-200 font-sans overflow-hidden shadow-2xl relative">
      
      {/* --- 顶部状态栏 (Header) --- */}
      <header className="flex justify-between items-start p-4 bg-slate-950/90 backdrop-blur-md border-b border-slate-800 z-20 absolute top-0 w-full min-h-[80px]">
        
        {/* 左侧：地点与技能 */}
        <div className="flex flex-col gap-1 max-w-[50%]">
            <div>
              <span className="text-[10px] text-slate-500 font-bold tracking-widest uppercase block">LOCATION</span>
              <span className="text-sm font-serif font-bold text-slate-100">{player.location}</span>
            </div>
            
            {/* 技能展示区 */}
            {player.skills && Object.keys(player.skills).length > 0 && (
              <div className="flex gap-1 flex-wrap mt-1">
                 {Object.entries(player.skills).map(([name, level]) => (
                   <span key={name} className="text-[10px] px-1.5 py-0.5 bg-indigo-950 text-indigo-300 rounded border border-indigo-900/50 whitespace-nowrap">
                     {name} Lv.{level as number}
                   </span>
                 ))}
              </div>
            )}
        </div>

        {/* 右侧：状态、时间与 Buff */}
        <div className="flex flex-col items-end gap-1 max-w-[50%]">
             {/* 基础数值 */}
             <div className="text-right">
                <span className="text-[10px] text-emerald-500 font-bold uppercase block">STATUS</span>
                <span className="text-xs font-mono text-slate-400">HP:{player.hp}</span>
             </div>

             {/* 时间显示 */}
             <div className="flex flex-col items-end gap-1">
                <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                    player.time_of_day === '深夜' ? 'bg-purple-950 text-purple-300 border border-purple-900' : 
                    player.time_of_day === '黄昏' ? 'bg-orange-950 text-orange-300 border border-orange-900' : 
                    player.time_of_day === '正午' ? 'bg-yellow-950 text-yellow-300 border border-yellow-900' : 
                    'bg-sky-950 text-sky-300 border border-sky-900'
                }`}>
                    {player.time_of_day || '清晨'}
                </span>

                {/* Buff 列表 */}
                <div className="flex gap-1 flex-wrap justify-end">
                  {player.buffs?.map((buff: string) => (
                     <span key={buff} className="text-[10px] px-1.5 py-0.5 bg-rose-950 text-rose-300 rounded border border-rose-900/50">
                       {buff}
                     </span>
                  ))}
                </div>
             </div>
        </div>
      </header>

      {/* --- 中央日志流 (Log Stream) --- */}
      <div ref={scrollRef} className="flex-1 w-full overflow-y-auto pt-24 pb-48 px-4 space-y-8 scroll-smooth">
        {logs.map((log) => (
          <div key={log.id} className={`flex flex-col gap-2 ${log.isTemp ? 'opacity-50' : 'opacity-100 transition-opacity duration-500'}`}>
            {/* 动作分割线 */}
            <div className="flex justify-center items-center gap-2">
                <div className="h-px bg-slate-800 w-8"></div>
                <span className="text-[10px] uppercase tracking-widest text-slate-600">
                    {log.action}
                </span>
                <div className="h-px bg-slate-800 w-8"></div>
            </div>
            
            {/* 剧情文本 */}
            {log.narrative !== '...' && (
                <div className="text-sm font-serif leading-7 text-slate-300 tracking-wide text-justify bg-slate-900/30 p-2 rounded-lg border border-slate-800/30">
                    {log.narrative}
                </div>
            )}
          </div>
        ))}
        {loading && <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 text-slate-600 animate-spin"/></div>}
      </div>

      {/* --- 底部控制台 (Controls) --- */}
      <div className="bg-slate-900/95 backdrop-blur border-t border-slate-800 p-4 pb-8 absolute bottom-0 w-full z-20 flex flex-col gap-4 shadow-[0_-10px_40px_rgba(0,0,0,0.5)]">
        
        {/* 1. 智能推荐按钮区 */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1 mask-linear-fade">
            {/* 自动探索按钮 */}
            <button 
                onClick={() => handleAction("", true)}
                disabled={loading}
                className="flex-shrink-0 flex items-center gap-1 bg-amber-950/50 text-amber-500 border border-amber-900/50 px-3 py-1.5 rounded-full text-xs font-bold hover:bg-amber-900 hover:text-amber-200 transition-all active:scale-95"
            >
                <Zap className="w-3 h-3 fill-current" /> 自动探索
            </button>
            
            {/* AI 生成的动态建议 */}
            {suggestions.map((s, i) => (
                <button 
                    key={i}
                    onClick={() => handleAction(s)}
                    disabled={loading}
                    className="flex-shrink-0 bg-slate-800 text-slate-300 border border-slate-700 px-3 py-1.5 rounded-full text-xs hover:bg-slate-700 hover:text-white transition-all active:scale-95"
                >
                    {s}
                </button>
            ))}
        </div>

        {/* 2. 传统输入框 (保留微操能力) */}
        <div className="flex gap-2 relative">
            <input 
                type="text" 
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAction(input)}
                placeholder="或者输入指令..."
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-amber-900/50 focus:ring-1 focus:ring-amber-900/50 transition-all placeholder:text-slate-700"
            />
            <button 
                onClick={() => handleAction(input)}
                disabled={loading}
                className="absolute right-2 top-2 bg-slate-800 hover:bg-slate-700 text-slate-200 p-1.5 rounded-md transition-colors"
            >
                {loading ? <Loader2 className="w-4 h-4 animate-spin"/> : <Send className="w-4 h-4" />}
            </button>
        </div>

        {/* 3. 底部导航栏 */}
        <div className="flex justify-around pt-2 border-t border-slate-800/50 mt-1">
            <button className="flex flex-col items-center gap-1 text-slate-500 hover:text-slate-200 transition-colors"><Map className="w-4 h-4" /><span className="text-[10px] font-bold">MAP</span></button>
            <button className="flex flex-col items-center gap-1 text-slate-500 hover:text-slate-200 transition-colors"><Backpack className="w-4 h-4" /><span className="text-[10px] font-bold">BAG</span></button>
            <button className="flex flex-col items-center gap-1 text-slate-500 hover:text-slate-200 transition-colors"><Hammer className="w-4 h-4" /><span className="text-[10px] font-bold">CRAFT</span></button>
        </div>
      </div>
    </div>
  );
}