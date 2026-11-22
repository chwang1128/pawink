// 毛孩數位分身：商品目錄與數值設定。
// 商品先寫在程式裡（之後要做後台再搬進資料表）。價格與效果都在這裡調。

export type Species = 'dog' | 'cat';
export type Slot = 'head' | 'face' | 'neck' | 'body' | 'back';
export type Category = 'food' | 'treat' | 'care' | 'toy' | 'wear';

export interface Effect { fullness?: number; cleanliness?: number; mood?: number; xp?: number; sparkleHours?: number }

export interface Item {
  sku: string;
  name: string;
  category: Category;
  price: number; // 0 表示不販售（例如開局送的玩具）
  consumable: boolean;
  slot?: Slot;
  effect?: Effect;
  species?: Species; // 只適合某一種（例如貓草）；沒填表示都可以
  icon: string; // 正式美術完成前的暫代圖示
  desc: string;
}

export const ITEMS: Item[] = [
  // 消耗品
  { sku: 'can_food', name: '罐罐', category: 'food', price: 8, consumable: true, effect: { fullness: 40, mood: 10, xp: 6 }, icon: '🥫', desc: '飽足 +40、心情 +10' },
  { sku: 'jerky', name: '肉乾零食', category: 'treat', price: 10, consumable: true, effect: { fullness: 10, mood: 15, xp: 6 }, icon: '🍖', desc: '心情 +15，親密度加比較多' },
  { sku: 'catnip', name: '貓草', category: 'treat', price: 10, consumable: true, species: 'cat', effect: { mood: 25, xp: 6 }, icon: '🌿', desc: '貓咪專用，心情 +25' },
  { sku: 'bubble_bath', name: '泡泡沐浴球', category: 'care', price: 12, consumable: true, effect: { cleanliness: 100, mood: 5, xp: 5, sparkleHours: 24 }, icon: '🫧', desc: '洗得香香的，閃亮 24 小時' },
  // 玩具（不消耗）
  { sku: 'ball', name: '小皮球', category: 'toy', price: 0, consumable: false, effect: { mood: 20, xp: 5 }, icon: '⚽', desc: '開局附贈' },
  { sku: 'rope', name: '拔河繩', category: 'toy', price: 50, consumable: false, effect: { mood: 25, xp: 6 }, icon: '🪢', desc: '心情 +25' },
  { sku: 'feather_wand', name: '逗貓棒', category: 'toy', price: 50, consumable: false, species: 'cat', effect: { mood: 30, xp: 6 }, icon: '🪶', desc: '貓咪專用，心情 +30' },
  { sku: 'plush_bone', name: '骨頭娃娃', category: 'toy', price: 80, consumable: false, effect: { mood: 30, xp: 7 }, icon: '🦴', desc: '心情 +30' },
  // 穿戴
  { sku: 'bandana_red', name: '紅色領巾', category: 'wear', price: 60, consumable: false, slot: 'neck', icon: '🧣', desc: '經典款' },
  { sku: 'bell_collar', name: '鈴鐺項圈', category: 'wear', price: 80, consumable: false, slot: 'neck', icon: '🔔', desc: '走路叮叮噹噹' },
  { sku: 'round_glasses', name: '圓框眼鏡', category: 'wear', price: 70, consumable: false, slot: 'face', icon: '👓', desc: '看起來很有學問' },
  { sku: 'beanie', name: '毛線帽', category: 'wear', price: 90, consumable: false, slot: 'head', icon: '🧶', desc: '冬天必備' },
  { sku: 'straw_hat', name: '草帽', category: 'wear', price: 100, consumable: false, slot: 'head', icon: '👒', desc: '去海邊玩' },
  { sku: 'backpack', name: '小背包', category: 'wear', price: 150, consumable: false, slot: 'back', icon: '🎒', desc: '出門散步用' },
  { sku: 'raincoat', name: '黃色雨衣', category: 'wear', price: 180, consumable: false, slot: 'body', icon: '🧥', desc: '下雨天也要散步' },
  { sku: 'dino_hoodie', name: '恐龍裝', category: 'wear', price: 220, consumable: false, slot: 'body', icon: '🦖', desc: '嗷嗚' },
];

export const ITEM_BY_SKU: Record<string, Item> = Object.fromEntries(ITEMS.map(i => [i.sku, i]));
export const STARTER_SKUS = ['ball']; // 第一次建立分身時送的物品
export const SLOTS: Slot[] = ['head', 'face', 'neck', 'body', 'back'];
export const SLOT_NAME: Record<Slot, string> = { head: '頭', face: '臉', neck: '脖子', body: '身體', back: '背' };

// ---- 數值 ----
export const DECAY_PER_HOUR = { fullness: 1.5, cleanliness: 0.5, mood: 1 }; // 約 2 天會餓、6 天會髒
export const FREE_FEED_PER_DAY = 2; // 每天免費基礎飼料（每隻）：剛好抵掉一天的飢餓，想讓牠吃飽飽就要買罐罐
export const FREE_FEED_EFFECT: Effect = { fullness: 20, xp: 2 };
export const PET_EFFECT: Effect = { mood: 5, xp: 2 }; // 摸摸
export const BATH_EFFECT: Effect = { cleanliness: 100, xp: 5 }; // 免費洗澡
export const COOLDOWN_MIN = { pet: 10, play: 30, bath: 12 * 60 };
export const DAILY_XP_CAP = 60; // 每隻每天最多加多少親密度經驗
export const ACTIONS_PER_MINUTE = 30;
export const MEMORIAL_TOGGLES_PER_DAY = 1; // 紀念模式每天只能切換一次

// 親密度等級：25、100、225、400…（每級所需逐漸增加）
export const levelOf = (xp: number) => 1 + Math.floor(Math.sqrt(Math.max(0, xp) / 25));
export const xpForLevel = (level: number) => 25 * (level - 1) * (level - 1);

// ---- 簽到與任務 ----
export const CHECKIN_POINTS = 5;
export const STREAK_BONUS: Record<number, number> = { 3: 10, 7: 20 }; // 連續第 3 天、第 7 天額外加點；第 8 天重新算
export const WEEKLY_LOGIN_POINTS = 15;
export const DAILY_CARE_POINTS = 5; // 每日照顧任務：餵食、摸摸、玩耍、回報一家店

// ---- 外觀：依品種決定頭型 ----
const DOG_HEADS: [RegExp, string][] = [
  [/柴/, 'shiba'], [/貴賓|poodle/i, 'poodle'], [/法鬥|法國鬥牛/, 'frenchie'], [/黃金|golden/i, 'golden'],
  [/柯基|corgi/i, 'corgi'], [/臘腸|dachshund/i, 'dachshund'], [/博美|pomeranian/i, 'pomeranian'], [/雪納瑞|schnauzer/i, 'schnauzer'],
  [/哈士奇|husky/i, 'husky'], [/拉不拉多|labrador/i, 'labrador'], [/馬爾濟斯|maltese/i, 'maltese'], [/吉娃娃|chihuahua/i, 'chihuahua'],
];
const CAT_HEADS: [RegExp, string][] = [
  [/橘/, 'orange'], [/賓士/, 'tuxedo'], [/三花/, 'calico'], [/美短|美國短毛/, 'american_shorthair'], [/黑貓/, 'black'],
  [/英短|英國短毛/, 'british_shorthair'], [/布偶|ragdoll/i, 'ragdoll'], [/暹羅|siamese/i, 'siamese'],
];
export function headKeyFor(species: Species, breed: string | null | undefined): string {
  const b = breed || '';
  for (const [re, key] of species === 'dog' ? DOG_HEADS : CAT_HEADS) if (re.test(b)) return key;
  return species === 'dog' ? 'mixed_dog' : 'mixed_cat';
}
