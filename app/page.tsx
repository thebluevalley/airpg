'use client';

import { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Play, Pause, Terminal, User, Backpack, Map as MapIcon, Sword, Shield, Gem } from 'lucide-react';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const DEMO_USER_ID = 'demo-user-001';

export default function GamePage() {
  const [activeTab, setActiveTab] = useState('home'); // home | hero | bag | map
  const [isRunning, setIsRunning] = useState(false);
  const [aiThought, setAiThought] = useState("系统待机中...");
  
  const [player, setPlayer] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [mapNodes, setMapNodes] = useState<any[]>([]); // 地图数据

  const scrollRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // 初始化
  useEffect(() => {
    const init = async () => {
      const { data: p } = await supabase.from('players').select('*').eq('user_id', DEMO_USER_ID).single();
      if (p) setPlayer(p);
      const { data: l } = await supabase.from('game_logs').select('*').eq('player_id', p?.id).order('created_at', { ascending: true }).limit(50);
      if (l) setLogs(l);
      
      // 加载地图数据
      if (p) {
          const { data: m } = await supabase.from('map_nodes').select('*').eq('player_id', p.id);
          if (m) setMapNodes(m);
      }
    };
    init();
    return () => stopGame();
  }, []);

  // 自动滚动日志
  useEffect(() => {
    if (activeTab === 'home' && scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, activeTab]);

  // 游戏循环
  const runGameStep = async () => {
    if (!player) return;
    setAiThought("AI 正在计算...");

    try {
      const res = await fetch('/api/game/act', { method: 'POST' });
      const data = await res.json();

      setPlayer((prev: any) => ({ ...prev, ...data.state }));
      setAiThought(data.thought);
      setLogs((prev) => [...prev, { id: Date.now(), narrative: data.narrative }]);
      
      // 如果是在地图页面，可能需要刷新地图数据（简单起见这里不实时刷map表，只更新player location）
    } catch (e) {
      setIsRunning(false);
    }
  };

  useEffect(() => {
    if (isRunning) {
      runGameStep();
      timerRef.current = setInterval(runGameStep, 5000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isRunning]);

  const toggleGame = () => setIsRunning(!isRunning);
  const stopGame = () => { setIsRunning(false); if (timerRef.current) clearInterval(timerRef.current); };

  if (!player) return <div className="bg-slate-950 h-screen flex items-center justify-center text-slate-500">Loading RPG OS...</div>;

  // --- 子页面组件 ---

  // 1. 首页: 终端日志
  const HomeView = () => (
    <div className="flex flex-col h-full">
        {/* 思考状态栏 */}
        <div className="bg-slate-900 p-3 border-b border-slate-800 flex gap-3 items-center">
            <div className={`w-2 h-2 rounded-full ${isRunning ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
            <div className="flex-1 text-xs font-mono text-cyan-300 truncate">
                {">"} {aiThought}
            </div>
        </div>
        {/* 日志流 */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
            {logs.map((log, i) => (
                <div key={i} className="text-sm text-slate-300 font-serif leading-relaxed border-l-2 border-slate-800 pl-3">
                    {log.narrative}
                </div>
            ))}
            <div className="h-12"></div>
        </div>
    </div>
  );

  // 2. 角色: 装备与属性
  const HeroView = () => (
    <div className="p-6 space-y-8 overflow-y-auto h-full">
        <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold text-amber-500">LV.{player.level} 幸存者</h2>
            <div className="text-xs font-mono text-slate-400">EXP: {player.exp}/{player.level * 100}</div>
        </div>

        {/* 装备槽位 */}
        <div className="grid grid-cols-1 gap-4">
            {['weapon', 'armor', 'accessory'].map((slot) => {
                const item = player.equipment?.[slot];
                return (
                    <div key={slot} className="bg-slate-900 border border-slate-800 p-3 rounded-lg flex items-center gap-4">
                        <div className={`w-12 h-12 rounded flex items-center justify-center bg-slate-950 border border-slate-800 ${item ? 'border-amber-500/50 text-amber-500' : 'text-slate-700'}`}>
                            {slot === 'weapon' && <Sword size={20} />}
                            {slot === 'armor' && <Shield size={20} />}
                            {slot === 'accessory' && <Gem size={20} />}
                        </div>
                        <div>
                            <div className="text-xs uppercase text-slate-500 font-bold mb-1">{slot}</div>
                            <div className={`text-sm ${item ? 'text-amber-100' : 'text-slate-600 italic'}`}>
                                {item?.name || "未装备"}
                            </div>
                            {item?.stats && <div className="text-xs text-emerald-400 mt-1">{JSON.stringify(item.stats)}</div>}
                        </div>
                    </div>
                )
            })}
        </div>

        {/* 属性六维 */}
        <div className="bg-slate-900/50 p-4 rounded-lg grid grid-cols-2 gap-4">
            <div className="flex justify-between border-b border-slate-800 pb-1">
                <span className="text-slate-400">力量 (STR)</span>
                <span className="font-mono text-red-400">{player.attributes?.str}</span>
            </div>
            <div className="flex justify-between border-b border-slate-800 pb-1">
                <span className="text-slate-400">敏捷 (DEX)</span>
                <span className="font-mono text-green-400">{player.attributes?.dex}</span>
            </div>
            <div className="flex justify-between border-b border-slate-800 pb-1">
                <span className="text-slate-400">智力 (INT)</span>
                <span className="font-mono text-blue-400">{player.attributes?.int}</span>
            </div>
        </div>
    </div>
  );

  // 3. 背包: 物品网格
  const BagView = () => (
    <div className="p-4 h-full overflow-y-auto">
        <h2 className="text-lg font-bold text-slate-400 mb-4 flex justify-between">
            <span>物资存储</span>
            <span className="text-xs font-normal bg-slate-800 px-2 py-1 rounded">{player.inventory?.length || 0} / 50</span>
        </h2>
        <div className="grid grid-cols-2 gap-3">
            {player.inventory?.map((item: any, i: number) => (
                <div key={i} className="bg-slate-900 border border-slate-800 p-3 rounded hover:border-slate-600 transition-colors">
                    <div className={`text-sm font-bold truncate ${
                        item.rarity === 'epic' ? 'text-purple-400' : 
                        item.rarity === 'rare' ? 'text-blue-400' : 'text-slate-300'
                    }`}>
                        {item.name}
                    </div>
                    <div className="text-[10px] text-slate-500 uppercase mt-1 flex justify-between">
                        <span>{item.type}</span>
                    </div>
                </div>
            ))}
            {(!player.inventory || player.inventory.length === 0) && (
                <div className="col-span-2 text-center text-slate-600 py-10">背包空空如也</div>
            )}
        </div>
    </div>
  );

  // 4. 地图: 节点可视化
  const MapView = () => (
    <div className="p-4 h-full overflow-y-auto">
        <div className="text-center mb-6">
            <h2 className="text-lg font-bold text-slate-200">已探索区域</h2>
            <p className="text-xs text-slate-500">AI 自动记录的足迹</p>
        </div>
        <div className="space-y-4 relative">
            {/* 简单的时间轴式地图 */}
            <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-slate-800"></div>
            {mapNodes.map((node, i) => (
                <div key={i} className="relative pl-10">
                    <div className="absolute left-2.5 top-1.5 w-3 h-3 bg-slate-600 rounded-full border-2 border-slate-950 z-10"></div>
                    <div className="bg-slate-900 border border-slate-800 p-3 rounded">
                        <div className="text-sm font-bold text-slate-200">{node.name}</div>
                        <div className="text-xs text-slate-500 uppercase mt-1">{node.type || '未知区域'}</div>
                        <div className="text-[10px] font-mono text-slate-600 mt-1">COORD: {node.coordinate_x}, {node.coordinate_y}</div>
                    </div>
                </div>
            ))}
            {mapNodes.length === 0 && <div className="text-center text-slate-600 mt-10">暂无地图数据，请启动游戏进行探索。</div>}
        </div>
    </div>
  );

  return (
    <div className="flex flex-col h-[100dvh] w-full max-w-md mx-auto bg-slate-950 text-slate-200 font-sans overflow-hidden border-x border-slate-900">
      
      {/* 顶部: 始终显示 HP */}
      <div className="bg-slate-950 p-2 border-b border-slate-900 flex justify-between items-center z-20">
          <span className="text-xs font-bold text-slate-500">AIRPG v2.0</span>
          <div className="flex gap-2">
              <span className="text-xs text-emerald-500 font-mono">HP {player.hp}</span>
          </div>
      </div>

      {/* 中间: 内容区域 (根据 Tab 切换) */}
      <div className="flex-1 overflow-hidden bg-slate-950 relative">
         {activeTab === 'home' && <HomeView />}
         {activeTab === 'hero' && <HeroView />}
         {activeTab === 'bag' && <BagView />}
         {activeTab === 'map' && <MapView />}
         
         {/* 启动按钮 (仅在首页显示且未运行时) */}
         {activeTab === 'home' && (
             <div className="absolute bottom-4 right-4 z-30">
                 <button 
                    onClick={toggleGame}
                    className={`p-4 rounded-full shadow-lg transition-transform hover:scale-105 active:scale-95 ${isRunning ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'}`}
                 >
                    {isRunning ? <Pause /> : <Play />}
                 </button>
             </div>
         )}
      </div>

      {/* 底部: 导航菜单 */}
      <div className="bg-slate-900 border-t border-slate-800 p-2 flex justify-around items-center z-30">
          <button onClick={() => setActiveTab('home')} className={`flex flex-col items-center gap-1 p-2 rounded ${activeTab === 'home' ? 'text-amber-500' : 'text-slate-600'}`}>
              <Terminal size={20} />
              <span className="text-[10px] font-bold">终端</span>
          </button>
          <button onClick={() => setActiveTab('hero')} className={`flex flex-col items-center gap-1 p-2 rounded ${activeTab === 'hero' ? 'text-amber-500' : 'text-slate-600'}`}>
              <User size={20} />
              <span className="text-[10px] font-bold">角色</span>
          </button>
          <button onClick={() => setActiveTab('bag')} className={`flex flex-col items-center gap-1 p-2 rounded ${activeTab === 'bag' ? 'text-amber-500' : 'text-slate-600'}`}>
              <Backpack size={20} />
              <span className="text-[10px] font-bold">背包</span>
          </button>
          <button onClick={() => setActiveTab('map')} className={`flex flex-col items-center gap-1 p-2 rounded ${activeTab === 'map' ? 'text-amber-500' : 'text-slate-600'}`}>
              <MapIcon size={20} />
              <span className="text-[10px] font-bold">地图</span>
          </button>
      </div>
    </div>
  );
}