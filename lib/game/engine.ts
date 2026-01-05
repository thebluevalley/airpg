// lib/game/engine.ts

// --- 1. 配置数据 ---

// 词缀池：让装备千变万化
const PREFIXES = [
  { name: "锋利的", stat: "atk", val: 0.2 }, // 攻击力 +20%
  { name: "沉重的", stat: "def", val: 0.2 },
  { name: "狂暴的", stat: "crit", val: 0.1 }, // 暴击率 +10%
  { name: "灵巧的", stat: "dodge", val: 0.1 }, // 闪避率 +10%
  { name: "吸血的", stat: "lifesteal", val: 0.05 } // 吸血 5%
];

const SUFFIXES = [
  { name: "之熊", stat: "str", val: 3 },
  { name: "之鹰", stat: "dex", val: 3 },
  { name: "之智", stat: "int", val: 3 },
  { name: "之龙", stat: "hp_max", val: 20 }
];

export const BIOMES = {
  FOREST: { name: "迷雾森林", danger: 10, enemies: ["狂暴野猪", "剧毒蜘蛛", "暗影狼"] },
  MOUNTAIN: { name: "灰烬山脉", danger: 25, enemies: ["岩石巨人", "鹰身女妖", "双头食人魔"] },
  DUNGEON: { name: "远古地牢", danger: 50, enemies: ["骷髅卫士", "死灵法师", "深渊恶魔"] }
};

// 基础装备模板
const BASE_ITEMS = {
  weapon: [
    { name: "生锈短剑", baseAtk: 5 },
    { name: "精钢长剑", baseAtk: 12 },
    { name: "战斧", baseAtk: 18 },
    { name: "黑曜石之刃", baseAtk: 30 }
  ],
  armor: [
    { name: "破旧皮甲", baseDef: 2 },
    { name: "锁子甲", baseDef: 8 },
    { name: "板甲", baseDef: 15 },
    { name: "龙鳞甲", baseDef: 25 }
  ]
};

// --- 2. 核心引擎 ---

export class GameEngine {

  // 生成坐标地形
  static getBiome(x: number, y: number) {
    const val = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    const hash = val - Math.floor(val);
    
    // 只有特定坐标才是地牢入口 (每10格出现一个)
    if (Math.abs(x) % 10 === 0 && Math.abs(y) % 10 === 0 && x !== 0) return "DUNGEON"; 
    if (hash > 0.7) return "MOUNTAIN";
    return "FOREST";
  }

  // 暗黑破坏神式的掉落生成器
  static generateLoot(level: number, rarityBonus: number = 0) {
    const isWeapon = Math.random() > 0.5;
    // 这里 pool 是联合类型
    const pool = isWeapon ? BASE_ITEMS.weapon : BASE_ITEMS.armor;
    
    // 1. 根据等级选底材
    let baseIdx = Math.floor(level / 5); 
    if (baseIdx >= pool.length) baseIdx = pool.length - 1;
    // 有概率掉落更好的底材
    if (Math.random() < 0.2) baseIdx = Math.min(baseIdx + 1, pool.length - 1);
    
    const baseItem = pool[baseIdx];
    const item: any = { ...baseItem, type: isWeapon ? "weapon" : "armor", stats: {} };
    
    // 初始化基础数值
    // Fix: 使用 (baseItem as any) 强制类型断言，绕过 TS 检查
    if (isWeapon) {
        item.stats.atk = (baseItem as any).baseAtk;
    } else {
        item.stats.def = (baseItem as any).baseDef;
    }

    // 2. 随机稀有度 (0-100)
    const roll = Math.random() * 100 + rarityBonus;
    item.rarity = "common";
    let name = item.name;

    // 3. 添加词缀
    // 稀有 (Rare): 一个词缀
    if (roll > 80) {
        item.rarity = "rare";
        const prefix = PREFIXES[Math.floor(Math.random() * PREFIXES.length)];
        name = `${prefix.name}${name}`;
        // 应用词缀效果
        if (prefix.stat === 'atk') item.stats.atk = Math.floor(item.stats.atk * (1 + prefix.val));
        else if (prefix.stat === 'def') item.stats.def = Math.floor(item.stats.def * (1 + prefix.val));
        else item.stats[prefix.stat] = (item.stats[prefix.stat] || 0) + prefix.val;
    }
    
    // 史诗 (Epic): 前缀 + 后缀
    if (roll > 95) {
        item.rarity = "epic";
        const suffix = SUFFIXES[Math.floor(Math.random() * SUFFIXES.length)];
        name = `${name}${suffix.name}`;
        item.stats[suffix.stat] = (item.stats[suffix.stat] || 0) + suffix.val;
    }

    item.name = name;
    return item;
  }

  // 高级战斗计算 (加入暴击/闪避)
  static resolveCombat(player: any, enemyName: string) {
    const biome = Object.values(BIOMES).find(b => b.enemies.includes(enemyName));
    const levelScaling = player.level * 1.5;
    
    // 敌人属性
    let e_hp = (biome?.danger || 10) * 3 + levelScaling * 5;
    const e_atk = (biome?.danger || 5) + levelScaling;
    
    // 玩家属性整合
    const p_str = player.attributes.str;
    const p_dex = player.attributes.dex;
    const weapon = player.equipment.weapon?.stats || {};
    const armor = player.equipment.armor?.stats || {};

    const p_atk = (p_str * 2) + (weapon.atk || 0);
    const p_def = (p_dex * 0.5) + (armor.def || 0);
    const crit_rate = 0.05 + (weapon.crit || 0); // 基础 5% 暴击
    const dodge_rate = 0.05 + (armor.dodge || 0); // 基础 5% 闪避
    const lifesteal = (weapon.lifesteal || 0);

    let p_hp = player.hp;
    let rounds = 0;
    let logDetail = "";

    while (p_hp > 0 && e_hp > 0 && rounds < 10) {
        rounds++;
        
        // --- 玩家回合 ---
        // 判定暴击
        const isCrit = Math.random() < crit_rate;
        let dmg = Math.max(1, p_atk * (isCrit ? 2 : 1));
        // 浮动伤害
        dmg = Math.floor(dmg * (0.9 + Math.random() * 0.2));
        
        e_hp -= dmg;
        logDetail += `你造成${dmg}${isCrit ? ' (暴击!)' : ''}伤害。`;

        // 吸血
        if (lifesteal > 0) {
            const heal = Math.floor(dmg * lifesteal);
            p_hp += heal;
        }

        if (e_hp <= 0) break;

        // --- 敌人回合 ---
        // 判定闪避
        if (Math.random() < dodge_rate) {
            logDetail += " 你闪避了攻击！";
            continue;
        }

        const e_dmg = Math.max(1, Math.floor(e_atk - p_def));
        p_hp -= e_dmg;
    }

    const win = p_hp > 0;
    
    // 掉落计算
    let loot = null;
    if (win && Math.random() < 0.4) { // 40% 概率掉装备
        // 只有在地牢里才容易掉极品
        const bonus = biome?.name === "远古地牢" ? 20 : 0;
        loot = this.generateLoot(player.level, bonus);
    }

    return {
        win,
        hp_remaining: Math.max(0, p_hp),
        rounds,
        exp_gain: win ? Math.floor(e_atk * 2) : 0,
        loot,
        logDetail // 返回给前端展示战斗细节
    };
  }

  static explore(x: number, y: number) {
    const key = this.getBiome(x, y);
    const biome = BIOMES[key as keyof typeof BIOMES];
    
    // 地牢全是怪
    if (key === "DUNGEON") {
         const enemy = biome.enemies[Math.floor(Math.random() * biome.enemies.length)];
         return { type: "COMBAT", biomeName: biome.name, enemy, biomeKey: key };
    }

    const roll = Math.random();
    if (roll < 0.4) {
        const enemy = biome.enemies[Math.floor(Math.random() * biome.enemies.length)];
        return { type: "COMBAT", biomeName: biome.name, enemy, biomeKey: key };
    } else {
        return { type: "EMPTY", biomeName: biome.name, biomeKey: key };
    }
  }
}