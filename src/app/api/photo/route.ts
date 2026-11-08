import { getServerMapsKey, verifyPhotoUrl } from '@/lib/places';

// 店家照片：驗證網址簽章後，向 Google 取得照片的實際圖檔網址（不含金鑰），
// 再把瀏覽器導向該網址。圖檔由瀏覽器直接向 Google 下載，不經本站轉送，
// 金鑰也不會出現在網頁中。
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const name = searchParams.get('name') || '';

  if (!verifyPhotoUrl(name, searchParams.get('exp'), searchParams.get('sig'))) {
    return new Response('照片網址無效或已過期', { status: 403 });
  }

  const apiKey = getServerMapsKey();
  if (!apiKey) return new Response('伺服器未設定 Google Maps 金鑰', { status: 500 });

  try {
    const upstream = await fetch(
      `https://places.googleapis.com/v1/${name}/media?maxWidthPx=800&skipHttpRedirect=true`,
      { headers: { 'X-Goog-Api-Key': apiKey }, cache: 'no-store' },
    );
    const data = await upstream.json().catch(() => ({}));

    if (!upstream.ok || typeof data.photoUri !== 'string') {
      console.error('[api/photo] Google 回應', upstream.status, data?.error?.message);
      // 照片不存在或名稱已過期時回 404，其餘上游錯誤回 502
      return new Response('無法取得照片', { status: upstream.status === 404 || upstream.status === 400 ? 404 : 502 });
    }

    return new Response(null, {
      status: 302,
      headers: {
        Location: data.photoUri,
        // 只讓使用者自己的瀏覽器短暫快取，不放進共用 CDN
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (err: any) {
    console.error('[api/photo] 連線失敗', err?.message);
    return new Response('無法取得照片', { status: 502 });
  }
}
