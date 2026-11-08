// 飼主需求的服務類別。AI 只負責判斷是哪一類，搜尋詞由這裡固定產生，
// 避免模型把「寄宿」改寫成「友善飯店」、或把「評價好」「細心」塞進搜尋詞，讓 Google 回傳不相干的店。

// 一般人住的旅宿類型（Google Places 的 primaryType）。找「毛孩單獨寄宿」等服務時排除。
const HUMAN_LODGING = [
  'hotel', 'motel', 'lodging', 'resort_hotel', 'bed_and_breakfast', 'guest_house', 'hostel', 'inn',
  'extended_stay_hotel', 'private_guest_room', 'cottage', 'farmstay', 'japanese_inn', 'budget_japanese_inn',
  'campground', 'camping_cabin',
];

export interface ServiceCategory {
  label: string;      // 顯示給飼主看的類別名稱
  query: string;      // 送給 Google 的基本搜尋詞
  // 排除這些 primaryType 的結果。只用排除、不用「只收某類型」：
  // 台灣很多寵物旅館在 Google 上被店家設成寵物店或美容，只收單一類型會漏掉好店。
  excludePrimaryTypes?: string[];
}

export const SERVICE_CATEGORIES = {
  vet: { label: '動物醫院', query: '動物醫院' },
  emergency_vet: { label: '急診動物醫院', query: '24小時 急診 動物醫院' },
  exotic_vet: { label: '特殊寵物醫院', query: '特殊寵物 動物醫院' },
  grooming: { label: '寵物美容', query: '寵物美容', excludePrimaryTypes: HUMAN_LODGING },
  boarding: { label: '寵物寄宿', query: '寵物旅館 寄宿', excludePrimaryTypes: HUMAN_LODGING },
  daycare: { label: '寵物安親', query: '寵物安親', excludePrimaryTypes: HUMAN_LODGING },
  pet_friendly_lodging: { label: '寵物友善住宿', query: '寵物友善住宿' },
  pet_friendly_dining: { label: '寵物友善餐廳', query: '寵物友善餐廳' },
  supplies: { label: '寵物用品店', query: '寵物用品店', excludePrimaryTypes: HUMAN_LODGING },
  dog_park: { label: '寵物運動公園', query: '寵物運動公園 狗狗活動區', excludePrimaryTypes: ['pet_store', 'store', 'veterinary_care', ...HUMAN_LODGING] },
  training: { label: '寵物訓練', query: '狗狗訓練 行為', excludePrimaryTypes: HUMAN_LODGING },
  memorial: { label: '寵物善終', query: '寵物生命禮儀 火化', excludePrimaryTypes: HUMAN_LODGING },
  adoption: { label: '認養', query: '動物之家 認養' },
} satisfies Record<string, ServiceCategory>;

export type ServiceCategoryKey = keyof typeof SERVICE_CATEGORIES;
export const SERVICE_CATEGORY_KEYS = Object.keys(SERVICE_CATEGORIES) as ServiceCategoryKey[];

export const isServiceCategory = (v: unknown): v is ServiceCategoryKey =>
  typeof v === 'string' && v in SERVICE_CATEGORIES;

// 這些詞描述「店好不好」，Google 文字搜尋做不到，放進搜尋詞反而會把汽車旅館、一般飯店排到前面
const QUALITY_WORDS = /(評價|評論|推薦|優良|好評|高分|口碑|細心|溫柔|耐心|親切|專業|友善細心|最好|不錯|划算|便宜|乾淨|舒適|開闊|安心|可靠)/;

// 飼主明確要求的「服務特徵」（例如 不關籠、24小時、單獨火化、圍欄、貓、兔）才保留
export function cleanFeatures(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const w = raw.trim();
    if (!w || w.length > 8 || QUALITY_WORDS.test(w)) continue;
    if (!out.includes(w)) out.push(w);
    if (out.length >= 2) break;
  }
  return out;
}

// 「其他」類別時模型自訂的搜尋詞：去掉形容詞與地名後才使用
export function cleanFreeQuery(q: unknown, area?: string | null): string {
  if (typeof q !== 'string') return '';
  let s = q;
  if (area) s = s.split(area).join(' ');
  return s
    .split(/\s+/)
    .filter(w => w && !QUALITY_WORDS.test(w))
    .join(' ')
    .trim()
    .slice(0, 30);
}

export function buildQuery(category: ServiceCategoryKey | null, features: string[], freeQuery: string): string {
  const base = category ? SERVICE_CATEGORIES[category].query : freeQuery;
  return [base, ...features].filter(Boolean).join(' ').trim();
}
