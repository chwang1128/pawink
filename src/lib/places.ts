// Google Places API (New) 的後端共用函式。只能在伺服器端（API route）使用。
// 文件：https://developers.google.com/maps/documentation/places/web-service/text-search

const PLACES_BASE = 'https://places.googleapis.com/v1';

// 伺服器端專用金鑰。建議在 Vercel 另設 GOOGLE_MAPS_SERVER_KEY（不加 NEXT_PUBLIC_ 前綴，
// 不會被打包進瀏覽器），並在 Google Cloud 限制為只能呼叫 Places API (New)。
// 未設定時退回原本的 NEXT_PUBLIC_GOOGLE_MAPS_API_KEY，讓既有部署不中斷。
export function getServerMapsKey(): string | undefined {
  return (
    process.env.GOOGLE_MAPS_SERVER_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  );
}

export class PlacesApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
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
}

interface SearchTextOptions {
  lat: number;
  lng: number;
  radiusMeters?: number;
  maxResults?: number;
}

const SEARCH_FIELDS = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.rating',
  'places.userRatingCount',
  'places.photos',
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
    },
    SEARCH_FIELDS,
    apiKey,
  );

  return (data.places || []).map((p: any) => ({
    id: p.id,
    name: p.displayName?.text || '',
    address: p.formattedAddress || '',
    lat: p.location?.latitude,
    lng: p.location?.longitude,
    rating: typeof p.rating === 'number' ? p.rating : null,
    userRatingCount: typeof p.userRatingCount === 'number' ? p.userRatingCount : null,
    photoName: p.photos?.[0]?.name || null,
  }));
}

// 把地名（例如「台中市西區」）轉成座標。用 Text Search 取第一筆，
// 不必另外啟用 Geocoding API。查不到時回傳 null。
export async function geocodeArea(area: string): Promise<{ lat: number; lng: number } | null> {
  const apiKey = getServerMapsKey();
  if (!apiKey || !area.trim()) return null;
  try {
    const data = await callSearchText(
      { textQuery: area, languageCode: 'zh-TW', regionCode: 'TW', pageSize: 1 },
      'places.location',
      apiKey,
    );
    const loc = data.places?.[0]?.location;
    if (typeof loc?.latitude !== 'number' || typeof loc?.longitude !== 'number') return null;
    return { lat: loc.latitude, lng: loc.longitude };
  } catch {
    return null;
  }
}

// 照片資源名稱的格式：places/{placeId}/photos/{photoId}
export const PHOTO_NAME_PATTERN = /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/;

// 前端使用的照片網址：經由本站 /api/photo 轉送，金鑰不會出現在瀏覽器。
export function photoProxyUrl(photoName: string | null): string | null {
  return photoName ? `/api/photo?name=${encodeURIComponent(photoName)}` : null;
}
