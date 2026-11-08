import { NextResponse } from 'next/server';

// 研究用：只在 Vercel 預覽環境開放，量測 Grounding with Google Maps 的準確度與速度。正式站一律 404。
export async function POST(req: Request) {
  if (process.env.VERCEL_ENV !== 'preview') return NextResponse.json({ error: 'not found' }, { status: 404 });
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'no key' }, { status: 500 });
  const { prompt, lat, lng, model = 'gemini-3.8-flash', system, widget, tool = 'maps' } = await req.json();
  const tools: any[] = [];
  if (tool === 'maps' || tool === 'both') tools.push({ googleMaps: widget ? { enableWidget: true } : {} });
  if (tool === 'search' || tool === 'both') tools.push({ googleSearch: {} });
  const body: any = {
    contents: [{ role: 'user', parts: [{ text: String(prompt).slice(0, 500) }] }],
    tools,
    toolConfig: { retrievalConfig: { latLng: { latitude: Number(lat), longitude: Number(lng) }, languageCode: 'zh-TW' } },
  };
  if (system) body.systemInstruction = { parts: [{ text: String(system).slice(0, 3000) }] };
  const t0 = Date.now();
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
  });
  const ms = Date.now() - t0;
  const data = await res.json();
  const cand = data?.candidates?.[0];
  const gm = cand?.groundingMetadata || {};
  return NextResponse.json({
    status: res.status,
    ms,
    error: data?.error?.message,
    text: (cand?.content?.parts || []).map((p: any) => p.text || '').join(''),
    chunks: (gm.groundingChunks || []).map((c: any) => (c?.maps ? { kind: 'maps', title: c.maps.title, placeId: c.maps.placeId, uri: c.maps.uri } : { kind: 'web', title: c?.web?.title, uri: c?.web?.uri, domain: c?.web?.domain })),
    searchEntryPoint: !!gm.searchEntryPoint?.renderedContent,
    supports: (gm.groundingSupports || []).length,
    queries: gm.webSearchQueries || gm.retrievalQueries || null,
    widgetToken: !!gm.googleMapsWidgetContextToken,
    metaKeys: Object.keys(gm),
    usage: data?.usageMetadata,
  });
}
