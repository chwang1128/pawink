import { getServerMapsKey, PHOTO_NAME_PATTERN } from '@/lib/places';

// 店家照片轉送：瀏覽器向本站要圖，本站用伺服器端金鑰向 Google 取圖，
// 金鑰因此不會出現在網頁或圖片網址中。
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const name = searchParams.get('name') || '';

  if (!PHOTO_NAME_PATTERN.test(name)) {
    return new Response('照片參數格式錯誤', { status: 400 });
  }

  const apiKey = getServerMapsKey();
  if (!apiKey) return new Response('伺服器未設定 Google Maps 金鑰', { status: 500 });

  const upstream = await fetch(
    `https://places.googleapis.com/v1/${name}/media?maxWidthPx=800&key=${apiKey}`,
    { redirect: 'follow' },
  );

  if (!upstream.ok || !upstream.body) {
    return new Response('無法取得照片', { status: 502 });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('content-type') || 'image/jpeg',
      // 同一張照片一天內由 CDN 快取，減少 Google 照片費用
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
    },
  });
}
