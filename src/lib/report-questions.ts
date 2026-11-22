// 飼主回報的題目。依店家類型給不同題組；每題只回答「是／否」。
// 這是 Pawink 自己的資料（飼主親身經驗），與 Google 地圖內容無關。

export interface ReportQuestion { key: string; label: string }
export type ReportKind = 'boarding' | 'grooming' | 'vet' | 'dining' | 'lodging' | 'store' | 'park' | 'general';

const Q = {
  no_cage: '不關籠',
  staff_overnight: '夜間有人員看顧',
  photo_updates: '會主動傳照片回報',
  large_dog: '接受大型犬',
  cat_ok: '接受貓',
  owner_can_watch: '可陪同或看得到美容過程',
  gentle_handling: '對緊張的毛孩有耐心',
  night_emergency: '有夜間急診',
  exotic_ok: '看特殊寵物（兔、鳥、爬蟲等）',
  cat_friendly: '有貓專用候診區或診間',
  fee_explained: '治療前會先說明費用',
  indoor_ok: '寵物可進室內',
  floor_ok: '寵物可落地',
  pet_menu: '有寵物餐',
  same_room: '可和寵物同房',
  no_extra_fee: '不另收寵物清潔費',
  pets_enter: '寵物可一起進店',
  fresh_food: '有販售寵物鮮食',
  off_leash: '可以放繩',
  small_dog_area: '有小型犬專區',
  water: '有飲水設施',
  pets_welcome: '歡迎寵物入內',
} as const;
type QKey = keyof typeof Q;

const SETS: Record<ReportKind, QKey[]> = {
  boarding: ['no_cage', 'staff_overnight', 'photo_updates', 'large_dog', 'cat_ok'],
  grooming: ['large_dog', 'cat_ok', 'owner_can_watch', 'gentle_handling'],
  vet: ['night_emergency', 'exotic_ok', 'cat_friendly', 'fee_explained'],
  dining: ['indoor_ok', 'floor_ok', 'large_dog', 'pet_menu'],
  lodging: ['same_room', 'large_dog', 'cat_ok', 'no_extra_fee'],
  store: ['pets_enter', 'fresh_food'],
  park: ['off_leash', 'small_dog_area', 'water'],
  general: ['pets_welcome', 'large_dog'],
};

const LODGING = /^(lodging|hotel|motel|bed_and_breakfast|guest_house|hostel|inn|resort_hotel|campground|cottage|farmstay|japanese_inn|budget_japanese_inn|private_guest_room|extended_stay_hotel)$/;
const DINING = /(restaurant|cafe|coffee_shop|bakery|bar|bistro|brunch|tea_house|dessert|food_court|meal_)/;

export function kindOf(primaryType: string | null | undefined, name = ''): ReportKind {
  const t = primaryType || '';
  if (t === 'veterinary_care') return 'vet';
  if (t === 'pet_boarding_service') return 'boarding';
  if (t === 'pet_store') return 'store';
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
