import { NextResponse } from 'next/server';
import { searchPlaces, photoProxyUrl, PlacesApiError } from '@/lib/places';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const rawKeyword = searchParams.get('keyword') || '寵物';
  const lat = Number(searchParams.get('lat') || '25.0330');
  const lng = Number(searchParams.get('lng') || '121.5434');

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ results: [], error: '座標格式錯誤' }, { status: 400 });
  }

  const cleanKeyword = rawKeyword.replace(/(狗狗|貓咪|\?|？|請問|我要找|想找)/g, '').trim() || '寵物';

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
    }));

    return NextResponse.json({ results });
  } catch (error: any) {
    const status = error instanceof PlacesApiError ? error.status : 500;
    console.error('[api/places]', error?.message);
    return NextResponse.json({ error: error?.message || '搜尋失敗', results: [] }, { status: status >= 400 ? status : 500 });
  }
}
