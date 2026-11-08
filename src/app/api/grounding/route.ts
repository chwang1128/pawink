import { NextResponse } from 'next/server';
import {
  buildMapsSystem, buildSearchSystem, buildUserPrompt, parseMaps, parseSearch,
  type GroundingRequest, type GroundingResult,
} from '@/lib/grounding';

// AI 查證（Grounding）。找店時由前端在店家標上地圖後呼叫，地圖與網路分享兩個查詢同時進行。
// 用輕量模型求快；任何一邊沒有來源、逾時或失敗就略過那一邊，不影響一般搜尋結果。
const MODEL = process.env.GROUNDING_MODEL || 'gemini-3.5-flash-lite';
const TIMEOUT_MS = 9000;

async function callGemini(apiKey: string, system: string, user: string, tool: object, lat: number, lng: number) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      signal: ctrl.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        tools: [tool],
        toolConfig: { retrievalConfig: { latLng: { latitude: lat, longitude: lng }, languageCode: 'zh-TW' } },
        generationConfig: { temperature: 0.2, maxOutputTokens: 600 },
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('[api/grounding] Gemini 失敗', data?.error?.message);
      return null;
    }
    return data;
  } catch (e: any) {
    console.warn('[api/grounding] 逾時或錯誤', e?.name || e?.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(req: Request) {
  const empty: GroundingResult = { maps: null, search: null };
  if (process.env.GROUNDING_DISABLED === '1') return NextResponse.json(empty);
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json(empty);

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json(empty, { status: 400 }); }
  const lat = Number(body?.lat), lng = Number(body?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || typeof body?.need !== 'string' || !body.need.trim()) {
    return NextResponse.json(empty, { status: 400 });
  }
  const r: GroundingRequest = {
    question: String(body.question || '').slice(0, 300),
    need: body.need.trim().slice(0, 30),
    features: (Array.isArray(body.features) ? body.features : []).filter((f: unknown) => typeof f === 'string').slice(0, 2).map((f: string) => f.slice(0, 12)),
    area: typeof body.area === 'string' && body.area.trim() ? body.area.trim().slice(0, 40) : null,
    radiusKm: Math.min(Math.max(Number(body.radiusKm) || 5, 2), 15),
    lat, lng,
  };
  const user = buildUserPrompt(r);
  const t0 = Date.now();
  const [mapsData, searchData] = await Promise.all([
    callGemini(apiKey, buildMapsSystem(r.features), user, { googleMaps: {} }, lat, lng),
    callGemini(apiKey, buildSearchSystem(r.features), user, { googleSearch: {} }, lat, lng),
  ]);
  const result: GroundingResult = { maps: parseMaps(mapsData), search: parseSearch(searchData) };
  // 監控用：只記次數、延遲與有沒有來源，不記生成文字
  console.info('[api/grounding]', JSON.stringify({ ms: Date.now() - t0, maps: !!result.maps, search: !!result.search, features: r.features.length }));
  return NextResponse.json(result);
}
