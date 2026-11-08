// AI 查證：用 Gemini 內建的 Grounding with Google Maps／Google Search，讓 AI 依真實資料推薦店家。
//
// 條款重點（Google Maps Platform Service Specific Terms、Gemini API Terms）：
// - 我們不能自己抓 Google 評論給 AI 判斷（3.2.3(c)）；Grounding 是官方允許的例外。
// - 生成內容要「整段」顯示，不可刪改或穿插其他內容；Maps 來源要緊接在後，標示 Google Maps 並連到來源。
// - Google 搜尋的結果要原樣顯示 Google 提供的搜尋建議（searchEntryPoint.renderedContent）。
// - 不可用於緊急應變等高風險用途：急診、誤食、中毒一律不呼叫。
// - 沒有來源（groundingChunks 為空）代表模型沒真的查，只是憑記憶：整段不採用。

export interface MapsSource { title: string; uri: string; placeId: string | null }
export interface WebSource { title: string; uri: string; domain: string | null }

export interface GroundedBlock<S> {
  text: string;
  sources: S[];
}

export interface GroundingResult {
  maps: (GroundedBlock<MapsSource> & { citedPlaceIds: string[] }) | null;
  search: (GroundedBlock<WebSource> & { suggestionsHtml: string | null }) | null;
}

export interface GroundingRequest {
  question: string; // 家長原本的問題
  need: string; // 服務類別名稱，例如「寵物寄宿」
  features: string[]; // 條件，例如「不關籠」
  area: string | null; // 地區文字；null 表示家長目前位置附近
  radiusKm: number; // 只列中心點附近多遠內的店
  lat: number;
  lng: number;
}

const COMMON_RULES = [
  '最多列 5 家，每家一行，格式「店名－原因」。',
  '只寫來源裡真的有的內容，不要編造，不確定就不要列。',
  '不要寫電話、網址，不要給醫療處置或用藥建議。',
  '使用繁體中文（台灣用語），整段 200 字以內。',
].join('\n');

function conditionRule(features: string[], sourceName: string) {
  if (!features.length) return `依${sourceName}說明每家值得考慮的原因。`;
  const f = features.join('、');
  return `只列${sourceName}「明確提到」符合「${f}」的店。如果都沒有明確提到，只回一句：「${sourceName}中，這附近的店家沒有明確提到${f}。」`;
}

export function buildMapsSystem(features: string[]) {
  return `你是台灣寵物服務助理。一定要使用 Google 地圖工具查詢，只查一次。\n${conditionRule(features, 'Google 地圖上的店家資訊與評論')}\n${COMMON_RULES}`;
}

export function buildSearchSystem(features: string[]) {
  return `你是台灣寵物服務助理。一定要使用 Google 搜尋，只搜尋一次，找網路上飼主的實際分享（論壇、部落格、新聞）。\n${conditionRule(features, '網路上的飼主分享')}\n${COMMON_RULES}`;
}

export function buildUserPrompt(r: GroundingRequest) {
  const cond = r.features.length ? `，條件：${r.features.join('、')}` : '';
  // Google 搜尋看不到座標，只看文字：地點一定要寫出地名，並限制距離
  return `需求：${r.need}${cond}。地點：${r.area || '我目前的位置附近'}，只列距離這裡約 ${r.radiusKm} 公里內的店，太遠的不要列。原本的問題：${r.question.slice(0, 200)}`;
}

const stripPlacesPrefix = (id: unknown) => (typeof id === 'string' && id ? id.replace(/^places\//, '') : null);

export function textOf(data: any): string {
  return (data?.candidates?.[0]?.content?.parts || []).map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join('').trim();
}

export function parseMaps(data: any): GroundingResult['maps'] {
  const gm = data?.candidates?.[0]?.groundingMetadata;
  const chunks: any[] = Array.isArray(gm?.groundingChunks) ? gm.groundingChunks : [];
  const text = textOf(data);
  const sources: MapsSource[] = [];
  for (const c of chunks) {
    const m = c?.maps;
    if (!m || typeof m.uri !== 'string') continue;
    if (sources.some(s => s.uri === m.uri)) continue;
    sources.push({ title: String(m.title || 'Google Maps').replace(/\s*-\s*Google Maps$/i, ''), uri: m.uri, placeId: stripPlacesPrefix(m.placeId) });
  }
  if (!text || !sources.length) return null;
  // 回覆文字實際引用到的地點（groundingSupports 指到的來源）
  const cited = new Set<string>();
  for (const s of Array.isArray(gm?.groundingSupports) ? gm.groundingSupports : []) {
    for (const i of Array.isArray(s?.groundingChunkIndices) ? s.groundingChunkIndices : []) {
      const pid = stripPlacesPrefix(chunks[i]?.maps?.placeId);
      if (pid) cited.add(pid);
    }
  }
  return { text, sources, citedPlaceIds: Array.from(cited) };
}

export function parseSearch(data: any): GroundingResult['search'] {
  const gm = data?.candidates?.[0]?.groundingMetadata;
  const chunks: any[] = Array.isArray(gm?.groundingChunks) ? gm.groundingChunks : [];
  const text = textOf(data);
  const sources: WebSource[] = [];
  for (const c of chunks) {
    const w = c?.web;
    if (!w || typeof w.uri !== 'string') continue;
    if (sources.some(s => s.uri === w.uri)) continue;
    sources.push({ title: String(w.title || w.domain || '來源'), uri: w.uri, domain: typeof w.domain === 'string' ? w.domain : null });
  }
  if (!text || !sources.length) return null;
  const html = gm?.searchEntryPoint?.renderedContent;
  return { text, sources, suggestionsHtml: typeof html === 'string' && html ? html : null };
}

// 「只回一句：沒有明確提到」的情況，前端收成一行小字
export const isNothingFound = (text: string) => /沒有明確提到/.test(text) && text.length < 80;

// 從地址取出「縣市＋區」，例如「106台灣台北市大安區復興南路…」→「台北市大安區」
export function districtOf(address: string | null | undefined): string | null {
  if (!address) return null;
  const m = address.replace(/臺/g, '台').match(/([\u4e00-\u9fa5]{2}[市縣])([\u4e00-\u9fa5]{1,3}?[區鄉鎮市])/);
  return m ? m[1] + m[2] : null;
}

// 家長沒講地點＝就在目前位置：取離他最近幾家店的地址裡最常出現的「縣市＋區」（在區界附近也比較穩）
export function districtNear(addresses: (string | null | undefined)[]): string | null {
  const count = new Map<string, number>();
  for (const a of addresses.slice(0, 5)) {
    const d = districtOf(a);
    if (d) count.set(d, (count.get(d) || 0) + 1);
  }
  let best: string | null = null, n = 0;
  for (const [d, c] of Array.from(count.entries())) if (c > n) { best = d; n = c; }
  return best;
}
