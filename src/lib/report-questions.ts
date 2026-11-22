// 飼主回報的題目。依店家類型給不同題組；每題只回答「是／否」。
// 這是 Pawink 自己的資料（飼主親身經驗），與 Google 地圖內容無關。

export interface ReportQuestion { key: string; label: string }
export type ReportKind = 'boarding' | 'grooming' | 'vet' | 'dining' | 'lodging' | 'store' | 'mixed' | 'park' | 'general';

const Q = {
  no_cage: '不關籠',
  staff_overnight: '夜間有人員看顧',
  photo_updates: '住宿期間有回報機制（照片或影片）',
  large_dog: '接受大型犬',
  cat_ok: '接受貓',
  owner_can_watch: '可陪同或看得到美容過程',
  night_emergency: '有夜間急診',
  exotic_ok: '有看非犬貓（兔、鼠、鳥、爬蟲等）',
  cat_friendly: '有貓專用候診區或診間',
  fee_list: '有提供收費標準或報價',
  indoor_ok: '寵物可進室內',
  floor_ok: '可牽繩落地（不需推車或提袋）',
  pet_menu: '有寵物餐',
  same_room: '可和寵物同房',
  pet_amenities: '提供寵物備品（尿布墊、碗、床等）',
  pets_enter: '寵物可一起進店',
  fresh_food: '有販售寵物鮮食',
  fenced_area: '有圍欄寵物專區（可放繩）',
  small_dog_area: '有小型犬專區',
  water: '有飲水設施',
  pets_welcome: '歡迎寵物入內',
  pickup: '提供寵物接送服務',
  parking: '有停車位或附近好停車',
  water_bowl: '會主動提供寵物水碗',
  walk_space: '附近有可以散步遛狗的地方',
  rx_food: '有販售處方飼料',
  staff_advice: '店員能給餵養或用品建議',
  waste_bin: '有撿便袋或垃圾桶',
  shade: '有遮蔭或休息座位',
  groom_large_dog: '美容服務接受大型犬',
  groom_by_appointment: '美容採全預約制',
} as const;
type QKey = keyof typeof Q;

// 每種店家 5 題（「生活館」是寵物用品店兼美容，題目混合兩邊）
const SETS: Record<ReportKind, QKey[]> = {
  boarding: ['no_cage', 'staff_overnight', 'photo_updates', 'large_dog', 'cat_ok'],
  grooming: ['groom_large_dog', 'cat_ok', 'owner_can_watch', 'groom_by_appointment', 'pickup'],
  vet: ['night_emergency', 'exotic_ok', 'cat_friendly', 'fee_list', 'parking'],
  dining: ['indoor_ok', 'floor_ok', 'large_dog', 'pet_menu', 'water_bowl'],
  lodging: ['same_room', 'large_dog', 'cat_ok', 'pet_amenities', 'walk_space'],
  store: ['pets_enter', 'fresh_food', 'rx_food', 'staff_advice', 'parking'],
  mixed: ['fresh_food', 'rx_food', 'groom_large_dog', 'owner_can_watch', 'groom_by_appointment'],
  park: ['fenced_area', 'small_dog_area', 'water', 'waste_bin', 'shade'],
  general: ['pets_welcome', 'floor_ok', 'large_dog', 'cat_ok', 'parking'],
};

const LODGING = /^(lodging|hotel|motel|bed_and_breakfast|guest_house|hostel|inn|resort_hotel|campground|cottage|farmstay|japanese_inn|budget_japanese_inn|private_guest_room|extended_stay_hotel)$/;
const DINING = /(restaurant|cafe|coffee_shop|bakery|bar|bistro|brunch|tea_house|dessert|food_court|meal_)/;

export function kindOf(primaryType: string | null | undefined, name = ''): ReportKind {
  const t = primaryType || '';
  if (t === 'veterinary_care') return 'vet';
  if (t === 'pet_boarding_service') return 'boarding';
  // 寵物生活館、寵物百貨：通常同時賣用品又有美容
  // 沒有類型時要店名帶寵物字眼，避免把一般百貨公司當成寵物生活館
  if ((t === 'pet_store' || t === 'pet_care' || (!t && /(寵物|毛孩)/.test(name))) && /(生活館|百貨)/.test(name)) return 'mixed';
  if (t === 'pet_store') return /(美容|洗澡|spa|grooming|salon)/i.test(name) ? 'mixed' : 'store';
  if (t === 'dog_park' || t === 'park') return 'park';
  if (LODGING.test(t)) return /(寵物|毛孩|狗|犬|貓)(旅館|住宿|寄宿|安親)/.test(name) ? 'boarding' : 'lodging';
  if (DINING.test(t)) return 'dining';
  if (t === 'pet_care' || !t) {
    if (/(旅館|旅店|住宿|寄宿|安親|hotel)/i.test(name)) return 'boarding';
    if (/(美容|洗澡|spa|grooming|salon)/i.test(name)) return 'grooming';
    if (/(醫院|診所|hospital|clinic)/i.test(name)) return 'vet';
  }
  return 'general';
}

export function questionsFor(kind: ReportKind): ReportQuestion[] {
  return (SETS[kind] || SETS.general).map(k => ({ key: k, label: Q[k] }));
}

export function isReportKind(k: unknown): k is ReportKind {
  return typeof k === 'string' && k in SETS;
}

export const POINTS_PER_REPORT = 2;
export const DAILY_REPORT_POINTS_CAP = 20;
// 防洗版：每位飼主每分鐘最多送出幾次回報
export const REPORTS_PER_MINUTE = 15;

// ---- 防亂回報 ----
export const MIN_REPORTS_FOR_CONCLUSION = 1; // 至少幾人回報才顯示結論（目前使用者少，先 1 人；人多再調高）
export const MIN_REPORTS_TO_OVERTURN = 3; // 至少幾人回報，相反的多數才會讓確認中點數被取消（避免一個人就能取消別人的點數）
export const FLAG_WINDOW_DAYS = 90; // 「可能已改變」只看近 90 天
export const FLAGS_TO_WARN = 2; // 幾人反映就顯示提醒
export const POINTS_PENDING_DAYS = 7; // 點數確認中天數
export const ON_SITE_METERS = 200; // 距離店家多近算現場回報
export const ON_SITE_WEIGHT = 1.3; // 現場回報的加權（座標仍可能被偽造，所以只小幅加分）
export const REFRESH_SAME_ANSWER_DAYS = 30; // 同一答案隔多久再按一次，才算「最近仍然如此」
export const FLAG_MIN_ACCOUNT_DAYS = 7; // 註冊滿幾天才能反映「可能已改變」
export const SETTLE_BATCH = 10; // 每次最多結算幾筆確認中點數
export const ANON_WEIGHT = 0.3; // 未登入回報的權重
export const ANON_REPORTS_PER_IP_DAILY = 60; // 未登入回報：每個 IP 每天上限
export const ANON_COOKIE = 'pawink_voter'; // 未登入回報用的瀏覽器識別碼
