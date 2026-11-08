import { NextResponse } from 'next/server';
import { searchPlaces, photoProxyUrl, detailsToken, PlacesApiError } from '@/lib/places';

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

  try {
    // 半徑 1 公里，與地圖 15 倍放大的視野相符
    const places = await searchPlaces(cleanKeyword, { lat, lng, radiusMeters: 1000, maxResults: 20 });

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

    return NextResponse.json({ results });
  } catch (error: any) {
    // 詳細原因只寫進 log；回給瀏覽器的訊息不帶 Google 的錯誤內容。
    // 上游（Google）失敗一律回 502，與「前端參數錯誤」的 400 區分開。
    const upstreamStatus = error instanceof PlacesApiError ? error.status : undefined;
    console.error('[api/places] 搜尋失敗', upstreamStatus, error?.message);
    return NextResponse.json({ error: '店家搜尋暫時無法使用', results: [] }, { status: 502 });
  }
}
