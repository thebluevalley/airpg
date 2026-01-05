// lib/game/engine.ts

// --- 1. 游戏数据配置 (可以理解为策划表) ---

export const RECIPES: Record<string, { needs: Record<string, number>; type: string; stats?: any }> = {
  "石斧": { needs: { "木头": 2, "石头": 1 }, type: "weapon", stats: { atk: 5 } },
  "绷带": { needs: { "草药": 2 }, type: "consumable", stats: { heal: 30 } },
  "火把": { needs: { "木头": 1 }, type: "tool", stats: { light: 10 } }
};

export const BIOMES = {
  FOREST: { name: "迷雾森林", resources: ["木头", "草药", "毒蘑菇"], danger: 10, enemies: ["狂暴野猪", "丛林蜘蛛"] },
  MOUNTAIN: { name: "灰烬山脉", resources: ["石头", "铁矿", "硫磺"], danger: 30, enemies: ["岩石巨人", "鹰身女妖"] },
  PLAINS: { name: "荒芜平原", resources: ["干草", "浆果"], danger: 5, enemies: ["流浪野狗"] },
  RUINS: { name: "旧日废墟", resources: ["废铁", "电子元件"], danger: 50, enemies: ["失控机器人"] }
};

// --- 2. 核心逻辑引擎 (纯代码，无 AI) ---

export class GameEngine {
  
  // 地图生成算法 (基于坐标的伪随机，保证同一坐标永远是同一地形)
  static getBiome(x: number, y: number) {
    // 简单的哈希算法
    const val = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    const hash = val - Math.floor(val);
    
    if (hash > 0.8) return "RUINS";
    if (hash > 0.6) return "MOUNTAIN";
    if (hash > 0.3) return "FOREST";
    return "PLAINS";
  }

  // 战斗计算 (回合制模拟)
  static resolveCombat(player: any, enemyName: string) {
    const biome = Object.values(BIOMES).find(b => b.enemies.includes(enemyName));
    const enemyAtk = (biome?.danger || 10) * (1 + Math.random());
    const enemyHp = (biome?.danger || 10) * 2;

    const playerAtk = (player.attributes.str * 2) + (player.equipment.weapon?.stats?.atk || 0);
    const playerDef = (player.attributes.dex * 0.5) + (player.equipment.armor?.stats?.def || 0);

    // 模拟战斗
    let p_hp = player.hp;
    let e_hp = enemyHp;
    let rounds = 0;
    const log = [];

    while (p_hp > 0 && e_hp > 0 && rounds < 10) {
        rounds++;
        // 玩家攻击
        const dmgToEnemy = Math.floor(playerAtk * (0.9 + Math.random() * 0.2)); // ±10% 浮动
        e_hp -= dmgToEnemy;
        
        if (e_hp <= 0) break;

        // 敌人攻击
        const dmgToPlayer = Math.max(1, Math.floor(enemyAtk - playerDef));
        p_hp -= dmgToPlayer;
    }

    const win = p_hp > 0;
    
    return {
        win,
        hp_remaining: Math.max(0, p_hp),
        rounds,
        exp_gain: win ? Math.floor(enemyHp * 1.5) : 0,
        loot: win && Math.random() > 0.5 ? biome?.resources[0] : null // 简单的掉落逻辑
    };
  }

  // 制作逻辑
  static tryCraft(inventory: any[], itemName: string) {
    const recipe = RECIPES[itemName];
    if (!recipe) return { success: false, reason: "未知配方" };

    // 检查材料
    const needed = { ...recipe.needs };
    const indicesToRemove: number[] = [];

    // 统计背包里的材料
    // 这里简化处理：只要名字匹配就行
    for (const [mat, count] of Object.entries(needed)) {
        let found = 0;
        inventory.forEach((item, idx) => {
            if (found < count && (item.name === mat || item === mat)) {
                found++;
                indicesToRemove.push(idx);
            }
        });
        if (found < count) return { success: false, reason: `缺少材料: ${mat}` };
    }

    return { 
        success: true, 
        item: { name: itemName, ...recipe },
        indicesToRemove 
    };
  }

  // 探索掉落逻辑
  static explore(x: number, y: number) {
    const key = this.getBiome(x, y);
    const biome = BIOMES[key as keyof typeof BIOMES];
    
    // 30% 遇敌, 50% 捡垃圾, 20% 啥也没有
    const roll = Math.random();
    
    if (roll < 0.3) {
        const enemy = biome.enemies[Math.floor(Math.random() * biome.enemies.length)];
        return { type: "COMBAT", biomeName: biome.name, enemy, biomeKey: key };
    } else if (roll < 0.8) {
        const resource = biome.resources[Math.floor(Math.random() * biome.resources.length)];
        return { type: "GATHER", biomeName: biome.name, item: resource, biomeKey: key };
    } else {
        return { type: "EMPTY", biomeName: biome.name, biomeKey: key };
    }
  }
}