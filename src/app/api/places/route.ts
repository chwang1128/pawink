import { NextResponse } from 'next/server';
import { searchPlaces, photoProxyUrl, detailsToken, PlacesApiError } from '@/lib/places';
import { isServiceCategory, shouldExclude } from '@/lib/service-categories';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const rawKeyword = searchParams.get('keyword') || '寵物';
  const lat = Number(searchParams.get('lat') || '25.0330');
  const lng = Number(searchParams.get('lng') || '121.5434');

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ results: [], error: '座標格式錯誤' }, { status: 400 });
  }

  // 只去掉口語贅字。「狗狗」「貓咪」保留，因為「貓咪友善咖啡」這類查詢需要它們。
  const cleanKeyword = rawKeyword.replace(/(\?|？|請問|我要找|想找)/g, '').trim() || '寵物';

  const category = searchParams.get('category');
  const openNow = searchParams.get('openNow') === '1';
  // 搜尋偏好半徑：附近 3 公里；指定縣市時由前端放寬（花蓮、台東這類地方店家較分散）
  const radius = Math.min(Math.max(Number(searchParams.get('radius')) || 3000, 500), 20000);

  try {
    let places = await searchPlaces(cleanKeyword, { lat, lng, radiusMeters: radius, maxResults: 20, openNow });

    // 依服務類別排除不相干的店，例如找毛孩寄宿時排除一般人住的飯店
    const keep = (list: typeof places) => (isServiceCategory(category) ? list.filter(p => !shouldExclude(category, p)) : list);
    places = keep(places);

    // 加了特徵詞（例如「不關籠」）卻少於 3 家：改用基本詞重搜補上，並告訴前端條件已放寬
    let relaxed = false;
    const fallback = (searchParams.get('fallback') || '').trim();
    if (places.length < 3 && fallback && fallback !== cleanKeyword) {
      const more = keep(await searchPlaces(fallback, { lat, lng, radiusMeters: radius, maxResults: 20, openNow }));
      const seen = new Set(places.map(p => p.id));
      places = [...places, ...more.filter(p => !seen.has(p.id))];
      relaxed = true;
    }

    // 回傳格式沿用舊版 Places API 的欄位名稱，前端不需要改
    const results = places.map((p) => ({
      place_id: p.id,
      name: p.name,
      formatted_address: p.address,
      geometry: { location: { lat: p.lat, lng: p.lng } },
      rating: p.rating ?? undefined,
      user_ratings_total: p.userRatingCount ?? undefined,
      photoUrl: photoProxyUrl(p.photoName),
      photoAttributions: p.photoAttributions,
      // 點開店家時向 /api/place-details 出示的憑證
      detailsToken: detailsToken(p.id),
    }));

    return NextResponse.json({ results, relaxed });
  } catch (error: any) {
    // 詳細原因只寫進 log；回給瀏覽器的訊息不帶 Google 的錯誤內容。
    // 上游（Google）失敗一律回 502，與「前端參數錯誤」的 400 區分開。
    const upstreamStatus = error instanceof PlacesApiError ? error.status : undefined;
    console.error('[api/places] 搜尋失敗', upstreamStatus, error?.message);
    return NextResponse.json({ error: '店家搜尋暫時無法使用', results: [] }, { status: 502 });
  }
}
