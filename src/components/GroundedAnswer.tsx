'use client';

import React from 'react';
import type { GroundingResult } from '@/lib/grounding';
import { isNothingFound } from '@/lib/grounding';

// 顯示 AI 查證（Grounding）的結果。依 Google 規定：
// - AI 文字整段照原樣顯示（只把 Markdown 的 ** 轉成粗體，不改內容）
// - Google 地圖來源緊接在文字後面，標示「Google Maps」（不翻譯、不換行）並連到來源
// - 網路搜尋的結果要原樣附上 Google 提供的搜尋建議
// - 告知使用者這段內容使用了 Google 地圖與網路資料

function RichLine({ line }: { line: string }) {
  const parts = line.replace(/^\s*[*\-•]\s+/, '• ').split(/\*\*(.+?)\*\*/g);
  return <>{parts.map((p, i) => (i % 2 === 1 ? <strong key={i}>{p}</strong> : <React.Fragment key={i}>{p}</React.Fragment>))}</>;
}

function GroundedText({ text }: { text: string }) {
  return (
    <div className="text-[13px] leading-relaxed text-[#38312D] whitespace-pre-line">
      {text.split('\n').map((l, i) => (
        <div key={i}>
          <RichLine line={l} />
        </div>
      ))}
    </div>
  );
}

const GoogleMapsMark = () => (
  <span translate="no" className="notranslate whitespace-nowrap" style={{ fontFamily: 'Roboto, Arial, sans-serif', fontWeight: 400, color: '#5E5E5E' }}>
    Google Maps
  </span>
);

function SearchSuggestions({ html }: { html: string }) {
  // Google 提供的搜尋建議 HTML，照原樣放在沙箱 iframe 裡；連結另開新分頁
  const doc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"></head><body style="margin:0">${html}</body></html>`;
  return (
    <iframe
      title="Google 搜尋建議"
      srcDoc={doc}
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      className="w-full h-[58px] border-0 mt-2 rounded-lg"
    />
  );
}

export function GroundingLoading() {
  return (
    <div className="text-xs font-bold text-[#A67C52] flex items-center gap-2">
      <span className="inline-block w-3 h-3 rounded-full border-2 border-[#B88746] border-t-transparent animate-spin" />
      正在查 Google 地圖評論與網路上的飼主分享…
    </div>
  );
}

export default function GroundedAnswer({ result }: { result: GroundingResult }) {
  const { maps, search } = result;
  return (
    <div className="space-y-3">
      <p className="text-[11px] font-bold text-[#8A6A3E]">🔍 AI 查證（內容由 AI 依 Google 地圖與網路資料整理，請再向店家確認）</p>

      {maps && (
        <div className="rounded-xl bg-[#FBF8F4] ring-1 ring-[#EFE5D8] p-3">
          <p className="text-[11px] font-black text-[#8A6A3E] mb-1">Google 地圖評論與店家資訊</p>
          {isNothingFound(maps.text) ? <p className="text-xs text-[#5E5E5E]">{maps.text}</p> : <GroundedText text={maps.text} />}
          <ul className="mt-2 space-y-1">
            {maps.sources.slice(0, 6).map(s => (
              <li key={s.uri} className="text-[12px] leading-snug">
                <a href={s.uri} target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: '#1F1F1F' }}>
                  {s.title}
                </a>
                <span className="text-[#5E5E5E]"> · </span>
                <GoogleMapsMark />
              </li>
            ))}
          </ul>
        </div>
      )}

      {search && (
        <div className="rounded-xl bg-[#FBF8F4] ring-1 ring-[#EFE5D8] p-3">
          <p className="text-[11px] font-black text-[#8A6A3E] mb-1">網路上的飼主分享</p>
          {isNothingFound(search.text) ? <p className="text-xs text-[#5E5E5E]">{search.text}</p> : <GroundedText text={search.text} />}
          <ul className="mt-2 space-y-1">
            {search.sources.slice(0, 5).map(s => (
              <li key={s.uri} className="text-[12px] leading-snug truncate">
                <a href={s.uri} target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: '#1F1F1F' }}>
                  {s.title}
                </a>
                {s.domain && s.domain !== s.title && <span className="text-[#5E5E5E]"> · {s.domain}</span>}
              </li>
            ))}
          </ul>
          {search.suggestionsHtml && <SearchSuggestions html={search.suggestionsHtml} />}
        </div>
      )}
    </div>
  );
}
