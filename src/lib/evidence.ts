// 驗證 AI 引用的「評論原句」確實出自 Google 評論或店家簡介。
// 模型可能改寫、拼湊或捏造引句；找不到原文的引句一律作廢，該項需求改為「未確認」。

import type { PlaceDetails } from './places';

export type RequirementStatus = 'met' | 'not_met' | 'unknown';

export interface Evidence {
  quote: string;
  sourceType: 'review' | 'editorial';
  author: string | null;
  rating: number | null;
  relativeTime: string | null;
  url: string | null;
  translated: boolean;
}

export interface RequirementCheck {
  label: string;
  isEssential: boolean;
  status: RequirementStatus;
  evidence: Evidence | null;
}

// 比對前的正規化：去掉空白、全半形標點差異與大小寫，避免因為換行或標點不同而誤判
export function normalizeForMatch(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s　]+/g, '')
    .replace(/[，,。．.！!？?、；;：:「」『』"'“”‘’（）()…~～\-—]/g, '');
}

// 引句太短（例如「很好」）幾乎任何評論都會出現，不能當作佐證
const MIN_QUOTE_CHARS = 6;

export function findEvidence(quote: unknown, details: PlaceDetails): Evidence | null {
  if (typeof quote !== 'string') return null;
  const q = normalizeForMatch(quote);
  if (q.length < MIN_QUOTE_CHARS) return null;

  for (const r of details.reviews) {
    if (normalizeForMatch(r.text).includes(q)) {
      return {
        quote: quote.trim(),
        sourceType: 'review',
        author: r.author,
        rating: r.rating,
        relativeTime: r.relativeTime || null,
        url: r.url || details.googleMapsUri,
        translated: r.translated,
      };
    }
  }
  if (details.editorialSummary && normalizeForMatch(details.editorialSummary).includes(q)) {
    return {
      quote: quote.trim(),
      sourceType: 'editorial',
      author: null,
      rating: null,
      relativeTime: null,
      url: details.googleMapsUri,
      translated: false,
    };
  }
  return null;
}

const STATUSES: RequirementStatus[] = ['met', 'not_met', 'unknown'];

// 把模型回傳的判斷整理成可信的結果：
// - 「符合」或「不符合」都必須有查得到原文的引句，否則降為「未確認」
// - 需求清單以模型列出的 requirements 為準，缺漏的項目補成「未確認」
export function verifyChecks(
  requirements: { label: string; isEssential: boolean }[],
  modelChecks: unknown,
  details: PlaceDetails,
): RequirementCheck[] {
  const list = Array.isArray(modelChecks) ? modelChecks : [];
  return requirements.map((req) => {
    const c: any = list.find((x: any) => x && x.label === req.label) || {};
    const claimed: RequirementStatus = STATUSES.includes(c.status) ? c.status : 'unknown';
    const evidence = claimed === 'unknown' ? null : findEvidence(c.quote, details);
    return {
      label: req.label,
      isEssential: req.isEssential,
      status: evidence ? claimed : 'unknown',
      evidence,
    };
  });
}
