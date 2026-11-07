import { NextResponse } from 'next/server';
import { getPlaceDetails, PlacesApiError, PLACE_ID_PATTERN } from '@/lib/places';

export const dynamic = 'force-dynamic';

// 使用者點開店家時才呼叫：取得真實的營業時間、電話、網站與 Google 評論
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('id') || '';
  if (!PLACE_ID_PATTERN.test(id)) {
    return NextResponse.json({ error: '店家 ID 格式錯誤' }, { status: 400 });
  }
  try {
    const details = await getPlaceDetails(id);
    return NextResponse.json({ details });
  } catch (error: any) {
    const upstreamStatus = error instanceof PlacesApiError ? error.status : undefined;
    console.error('[api/place-details] 失敗', upstreamStatus, error?.message);
    return NextResponse.json({ error: '店家詳細資料暫時無法取得' }, { status: 502 });
  }
}
