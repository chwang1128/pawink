import { NextResponse } from 'next/server';
import { getServerMapsKey } from '@/lib/places';

// 研究用（只在預覽環境）：做法 B——Gemini 不查資料、憑記憶推薦店名，再用 Places 逐家核實。
export async function POST(req: Request) {
  if (process.env.VERCEL_ENV !== 'preview') return NextResponse.json({ error: 'not found' }, { status: 404 });
  const apiKey = process.env.GEMINI_API_KEY;
  const mapsKey = getServerMapsKey();
  if (!apiKey || !mapsKey) return NextResponse.json({ error: 'no key' }, { status: 500 });
  const { prompt, lat, lng, model = 'gemini-3.8-flash' } = await req.json();

  const t0 = Date.now();
  const gRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: '你是台灣寵物服務助理。依你所知推薦最多 5 家真實存在的店家。只回 JSON。reason 寫你為什麼認為它符合條件；不確定就寫「不確定」。' }] },
      contents: [{ role: 'user', parts: [{ text: String(prompt).slice(0, 500) }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: { type: 'OBJECT', properties: { stores: { type: 'ARRAY', items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, area: { type: 'STRING' }, reason: { type: 'STRING' } }, required: ['name', 'area', 'reason'] } } }, required: ['stores'] },
      },
    }),
  });
  const gData = await gRes.json();
  const geminiMs = Date.now() - t0;
  let stores: { name: string; area: string; reason: string }[] = [];
  try { stores = JSON.parse(gData?.candidates?.[0]?.content?.parts?.[0]?.text || '{}').stores || []; } catch {}

  const t1 = Date.now();
  const checked = await Promise.all(stores.slice(0, 5).map(async (s) => {
    const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': mapsKey, 'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.businessStatus,places.primaryType,places.location' },
      body: JSON.stringify({ textQuery: `${s.name} ${s.area}`, languageCode: 'zh-TW', regionCode: 'TW', maxResultCount: 1, locationBias: { circle: { center: { latitude: Number(lat), longitude: Number(lng) }, radius: 30000 } } }),
    });
    const p = (await r.json())?.places?.[0];
    const distKm = p?.location ? Math.round(Math.hypot((p.location.latitude - lat) * 111, (p.location.longitude - lng) * 101) * 10) / 10 : null;
    return { ...s, found: p ? { name: p.displayName?.text, address: p.formattedAddress, status: p.businessStatus, type: p.primaryType, distKm } : null };
  }));
  return NextResponse.json({ geminiMs, verifyMs: Date.now() - t1, error: gData?.error?.message, checked });
}
