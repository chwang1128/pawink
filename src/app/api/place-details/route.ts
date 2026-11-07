import { NextResponse } from 'next/server';
import { getPlaceDetails, PlacesApiError, PLACE_ID_PATTERN, verifyDetailsToken } from '@/lib/places';

export const dynamic = 'force-dynamic';

// 使用者點開店家時才呼叫：取得真實的營業時間、電話、網站與 Google 評論
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id') || '';
  if (!PLACE_ID_PATTERN.test(id)) {
    return NextResponse.json({ error: '店家 ID 格式錯誤' }, { status: 400 });
  }
  // 只接受本站搜尋時簽發的憑證，避免被拿來刷 Google 費用
  if (!verifyDetailsToken(id, searchParams.get('token'))) {
    return NextResponse.json({ error: '店家資料連結已過期，請重新搜尋' }, { status: 403 });
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
