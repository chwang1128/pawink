// Google Places API (New) 的後端共用函式。只能在伺服器端（API route）使用。
// 文件：https://developers.google.com/maps/documentation/places/web-service/text-search

import { createHmac, timingSafeEqual } from 'crypto';

const PLACES_BASE = 'https://places.googleapis.com/v1';

// 伺服器端專用金鑰。建議在 Vercel 另設 GOOGLE_MAPS_SERVER_KEY（不加 NEXT_PUBLIC_ 前綴，
// 不會被打包進瀏覽器），並在 Google Cloud 限制為只能呼叫 Places API (New)。
// 未設定時退回原本的 NEXT_PUBLIC_GOOGLE_MAPS_API_KEY，讓既有部署不中斷，但會在 log 留警告：
// 瀏覽器用的金鑰應設網址（referrer）限制，而有網址限制的金鑰無法從伺服器呼叫 Places API。
let warnedFallback = false;
export function getServerMapsKey(): string | undefined {
  const serverKey = process.env.GOOGLE_MAPS_SERVER_KEY || process.env.GOOGLE_MAPS_API_KEY;
  if (serverKey) return serverKey;
  const publicKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (publicKey && !warnedFallback) {
    console.warn('[places] 未設定 GOOGLE_MAPS_SERVER_KEY，暫用瀏覽器端金鑰呼叫 Places API');
    warnedFallback = true;
  }
  return publicKey;
}

// 上游（Google）錯誤。status 保留 Google 回的狀態碼，只寫進 log，不直接回給瀏覽器。
export class PlacesApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

// Google 規定：照片的作者標示（authorAttributions）必須跟照片一起顯示
export interface Attribution {
  displayName: string;
  uri: string | null;
}

export interface PlaceSummary {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  rating: number | null;
  userRatingCount: number | null;
  photoName: string | null;
  photoAttributions: Attribution[];
  // Google 的主要類別（例如 hotel、pet_store），用來排除不相干的結果
  primaryType: string | null;
}

const toAttributions = (list: any): Attribution[] =>
  Array.isArray(list)
    ? list
        .filter((a: any) => a?.displayName)
        .map((a: any) => ({ displayName: String(a.displayName), uri: typeof a.uri === 'string' ? a.uri : null }))
    : [];

interface SearchTextOptions {
  lat: number;
  lng: number;
  radiusMeters?: number;
  maxResults?: number;
  // 只要目前營業中的店（飼主說「現在」「半夜」「還有開」時）
  openNow?: boolean;
}

const SEARCH_FIELDS = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.rating',
  'places.userRatingCount',
  'places.photos',
  'places.primaryType',
].join(',');

async function callSearchText(body: Record<string, unknown>, fieldMask: string, apiKey: string) {
  const res = await fetch(`${PLACES_BASE}/places:searchText`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': fieldMask,
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new PlacesApiError(data?.error?.message || `Places API 回應 ${res.status}`, res.status);
  }
  return data;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// 以關鍵字搜尋指定座標附近的地點。locationBias 是「偏好」而非硬性限制，
// 與舊版 textsearch 的 location + radius 行為一致。
export async function searchPlaces(query: string, opts: SearchTextOptions): Promise<PlaceSummary[]> {
  const apiKey = getServerMapsKey();
  if (!apiKey) throw new PlacesApiError('伺服器未設定 Google Maps 金鑰', 500);

  const data = await callSearchText(
    {
      textQuery: query,
      languageCode: 'zh-TW',
      regionCode: 'TW',
      pageSize: Math.min(opts.maxResults ?? 20, 20),
      locationBias: {
        circle: {
          center: { latitude: opts.lat, longitude: opts.lng },
          radius: opts.radiusMeters ?? 1000,
        },
      },
      ...(opts.openNow ? { openNow: true } : {}),
    },
    SEARCH_FIELDS,
    apiKey,
  );

  return (data.places || [])
    // 沒有座標的地點無法放上地圖，直接略過
    .filter((p: any) => p?.id && isNum(p.location?.latitude) && isNum(p.location?.longitude))
    .map((p: any) => ({
      id: p.id,
      name: p.displayName?.text || '',
      address: p.formattedAddress || '',
      lat: p.location.latitude,
      lng: p.location.longitude,
      rating: isNum(p.rating) ? p.rating : null,
      userRatingCount: isNum(p.userRatingCount) ? p.userRatingCount : null,
      photoName: p.photos?.[0]?.name || null,
      photoAttributions: toAttributions(p.photos?.[0]?.authorAttributions),
      primaryType: typeof p.primaryType === 'string' ? p.primaryType : null,
    }));
}

// ---- 店家詳細資料（評論、營業時間、電話） ----

export interface PlaceReview {
  text: string;
  rating: number | null;
  author: string;
  authorUri: string | null;
  // Google 規定顯示評論時至少要顯示作者頭像
  authorPhotoUri: string | null;
  relativeTime: string;
  // 這則評論在 Google 地圖上的原文頁（必須讓使用者能點過去看）
  url: string | null;
  // 檢舉這則評論的連結
  flagUrl: string | null;
  // Google 自動翻譯成中文時為 true（原文是其他語言）
  translated: boolean;
}

export interface PlaceDetails {
  id: string;
  phone: string | null;
  website: string | null;
  googleMapsUri: string | null;
  openNow: boolean | null;
  weekdayHours: string[];
  editorialSummary: string | null;
  reviews: PlaceReview[];
}

// 計費：reviews 屬於 Place Details Enterprise + Atmosphere SKU，是最貴的一級。
// 只在使用者點開店家時呼叫，用來原樣顯示；評論不會送進我們自己的 AI 提示詞
// （AI 評估改用 Gemini 的 Google 地圖工具，見 lib/grounding.ts）。
const DETAIL_FIELDS = [
  'id',
  'nationalPhoneNumber',
  'websiteUri',
  'googleMapsUri',
  'currentOpeningHours.openNow',
  'regularOpeningHours.weekdayDescriptions',
  'editorialSummary',
  'reviews',
].join(',');

export const PLACE_ID_PATTERN = /^[A-Za-z0-9_-]{10,300}$/;

export async function getPlaceDetails(placeId: string): Promise<PlaceDetails> {
  if (!PLACE_ID_PATTERN.test(placeId)) throw new PlacesApiError('店家 ID 格式錯誤', 400);
  const apiKey = getServerMapsKey();
  if (!apiKey) throw new PlacesApiError('伺服器未設定 Google Maps 金鑰', 500);

  const res = await fetch(`${PLACES_BASE}/places/${placeId}?languageCode=zh-TW&regionCode=TW`, {
    headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': DETAIL_FIELDS },
    cache: 'no-store',
  });
  const p = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new PlacesApiError(p?.error?.message || `Places API 回應 ${res.status}`, res.status);
  }

  const reviews: PlaceReview[] = (p.reviews || [])
    .filter((r: any) => typeof r?.text?.text === 'string' && r.text.text.trim())
    .map((r: any) => ({
      text: r.text.text.trim(),
      rating: isNum(r.rating) ? r.rating : null,
      author: r.authorAttribution?.displayName || 'Google 使用者',
      authorUri: r.authorAttribution?.uri || null,
      authorPhotoUri: r.authorAttribution?.photoUri || null,
      relativeTime: r.relativePublishTimeDescription || '',
      url: typeof r.googleMapsUri === 'string' ? r.googleMapsUri : null,
      flagUrl: typeof r.flagContentUri === 'string' ? r.flagContentUri : null,
      translated:
        !!r.originalText?.languageCode && !!r.text?.languageCode && r.originalText.languageCode !== r.text.languageCode,
    }));

  return {
    id: p.id || placeId,
    phone: p.nationalPhoneNumber || null,
    website: p.websiteUri || null,
    googleMapsUri: p.googleMapsUri || null,
    openNow: typeof p.currentOpeningHours?.openNow === 'boolean' ? p.currentOpeningHours.openNow : null,
    weekdayHours: Array.isArray(p.regularOpeningHours?.weekdayDescriptions) ? p.regularOpeningHours.weekdayDescriptions : [],
    editorialSummary: p.editorialSummary?.text || null,
    reviews,
  };
}

// 行政區類型：查地名時優先採用這些結果，避免第一筆剛好是名稱相近的店家或商場
const AREA_TYPES = new Set([
  'political',
  'locality',
  'sublocality',
  'sublocality_level_1',
  'administrative_area_level_1',
  'administrative_area_level_2',
  'administrative_area_level_3',
  'neighborhood',
  'postal_town',
]);

export interface ResolvedArea {
  lat: number;
  lng: number;
  label: string;
  // 縣市等級的大範圍地名（例如「花蓮縣」「台中市」）。只用一個中心點搜尋會漏掉大部分地區，要再問區域或地標
  broad: boolean;
}

// 把地名（例如「台中市西區」）轉成座標，用 Text Search 取前五筆，優先挑行政區類型的結果。
// 不必另外啟用 Geocoding API。查不到或失敗時回傳 null，並在 log 記下原因。
// 計費：location、formattedAddress、types 同屬 Text Search Pro SKU。
export async function geocodeArea(area: string): Promise<ResolvedArea | null> {
  const apiKey = getServerMapsKey();
  if (!apiKey || !area.trim()) return null;
  try {
    const data = await callSearchText(
      { textQuery: area, languageCode: 'zh-TW', regionCode: 'TW', pageSize: 5 },
      'places.location,places.formattedAddress,places.displayName,places.types',
      apiKey,
    );
    const candidates = (data.places || []).filter(
      (p: any) => isNum(p.location?.latitude) && isNum(p.location?.longitude),
    );
    const pick =
      candidates.find((p: any) => (p.types || []).some((t: string) => AREA_TYPES.has(t))) ||
      candidates[0];
    if (!pick) {
      console.warn(`[places] 查無地名「${area}」`);
      return null;
    }
    return {
      lat: pick.location.latitude,
      lng: pick.location.longitude,
      label: pick.formattedAddress || pick.displayName?.text || area,
      broad: (pick.types || []).some((t: string) => t === 'administrative_area_level_1' || t === 'country'),
    };
  } catch (err: any) {
    console.error(`[places] 地名「${area}」查詢失敗：`, err?.message);
    return null;
  }
}

// ---- 店家照片 ----
// 照片資源名稱的格式：places/{placeId}/photos/{photoId}
export const PHOTO_NAME_PATTERN = /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/;

// 照片網址有效時間。Google 規定照片名稱不可長期快取，一律從當次搜尋結果取得，
// 所以網址只在搜尋後一小時內有效。
export const PHOTO_URL_TTL_SECONDS = 60 * 60;

// 簽章用的密鑰：優先使用 PHOTO_URL_SECRET；未設定時由伺服器端金鑰衍生，不需額外設定。
function photoSecret(): string {
  const base = process.env.PHOTO_URL_SECRET || getServerMapsKey() || '';
  return createHmac('sha256', 'pawink-photo-url').update(base).digest('hex');
}

function signPhoto(name: string, exp: number): string {
  return createHmac('sha256', photoSecret()).update(`${name}.${exp}`).digest('base64url');
}

// 前端使用的照片網址：經由本站 /api/photo，附有到期時間與簽章。
// 只有本站搜尋時發出的網址能用，外部無法拿任意照片名稱來消耗我們的 Google 額度。
export function photoProxyUrl(photoName: string | null): string | null {
  if (!photoName) return null;
  const exp = Math.floor(Date.now() / 1000) + PHOTO_URL_TTL_SECONDS;
  const sig = signPhoto(photoName, exp);
  return `/api/photo?name=${encodeURIComponent(photoName)}&exp=${exp}&sig=${sig}`;
}

export function verifyPhotoUrl(name: string, exp: string | null, sig: string | null): boolean {
  if (!PHOTO_NAME_PATTERN.test(name) || !exp || !sig || !/^\d+$/.test(exp)) return false;
  const expNum = Number(exp);
  if (expNum < Math.floor(Date.now() / 1000)) return false;
  const expected = Buffer.from(signPhoto(name, expNum));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// ---- 店家詳細資料的存取憑證 ----
// Place Details 含評論屬最高計費級別。只接受本站搜尋時簽發、一小時內有效的憑證，
// 外部無法拿任意地點 ID 消耗我們的 Google 額度。簽章內容加上前綴，與照片網址的簽章互不通用。
export function detailsToken(placeId: string): string {
  const exp = Math.floor(Date.now() / 1000) + PHOTO_URL_TTL_SECONDS;
  return `${exp}.${signPhoto(`details:${placeId}`, exp)}`;
}

export function verifyDetailsToken(placeId: string, token: string | null): boolean {
  if (!PLACE_ID_PATTERN.test(placeId) || !token) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || !/^\d+$/.test(exp)) return false;
  const expNum = Number(exp);
  if (expNum < Math.floor(Date.now() / 1000)) return false;
  const expected = Buffer.from(signPhoto(`details:${placeId}`, expNum));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
