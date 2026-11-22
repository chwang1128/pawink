'use client';

import React, { useEffect, useState } from 'react';
import { kindOf, POINTS_PER_REPORT, DAILY_REPORT_POINTS_CAP, type ReportQuestion } from '@/lib/report-questions';

// 店家卡上的「飼主回報」：飼主依自己的經驗回答是／否。
// 這是 Pawink 自己的資料，和 Google 評論分開顯示。

interface Tally { yes: number; no: number; lastAt: string | null }
interface Summary { questions: ReportQuestion[]; tally: Record<string, Tally>; mine: Record<string, boolean>; loggedIn: boolean }

const monthText = (iso: string | null) => (iso ? `${new Date(iso).getMonth() + 1} 月` : '');

export default function OwnerReports({
  placeId, primaryType, name, onPoints, onLogin,
}: {
  placeId: string;
  primaryType?: string | null;
  name: string;
  onPoints?: (points: number) => void;
  onLogin: () => void;
}) {
  const kind = kindOf(primaryType, name);
  const [data, setData] = useState<Summary | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setData(null); setNote(null); setFailed(false);
    fetch(`/api/place-reports?placeId=${encodeURIComponent(placeId)}&kind=${kind}`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(j => { if (alive) setData(j); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [placeId, kind]);

  const answer = async (question: string, value: boolean) => {
    if (!data?.loggedIn) { onLogin(); return; }
    if (busy) return;
    setBusy(question);
    try {
      const res = await fetch('/api/place-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ placeId, kind, question, answer: value }),
      });
      const j = await res.json();
      if (!res.ok) { setNote(j.error || '回報暫時無法送出'); return; }
      setData(j);
      if (typeof j.points === 'number') onPoints?.(j.points);
      if (j.awarded > 0) setNote(`謝謝回報！獲得 ${j.awarded} 點`);
      else if (j.capped) setNote(`已記錄。今天回報的點數已達 ${DAILY_REPORT_POINTS_CAP} 點上限，明天再領`);
      else setNote('已更新你的回答');
    } catch {
      setNote('回報暫時無法送出');
    } finally {
      setBusy(null);
    }
  };

  if (failed) return null;

  return (
    <div className="px-5 pb-4">
      <h3 className="text-xs md:text-sm font-black text-[#38312D] flex items-center mb-1">
        <span className="w-1.5 h-3.5 rounded-full bg-[#B88746] mr-2"></span>
        飼主回報
      </h3>
      <p className="text-[10px] text-[#8C7A6B] mb-2.5">
        來自 Pawink 飼主的親身經驗，僅供參考，不代表店家或 Pawink 認證。
        {data && !data.loggedIn ? ` 登入後回報每題可得 ${POINTS_PER_REPORT} 點。` : ` 第一次回報每題 ${POINTS_PER_REPORT} 點，每天最多 ${DAILY_REPORT_POINTS_CAP} 點。`}
      </p>

      {!data ? (
        <div className="text-[11px] text-[#A67C52]">讀取中…</div>
      ) : (
        <div className="space-y-2">
          {data.questions.map(q => {
            const t = data.tally[q.key] || { yes: 0, no: 0, lastAt: null };
            const mine = data.mine[q.key];
            const total = t.yes + t.no;
            return (
              <div key={q.key} className="bg-white ring-1 ring-[#E8DFD8] rounded-2xl px-3 py-2 flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-bold text-[#38312D]">{q.label}</div>
                  <div className="text-[10px] text-[#8C7A6B]">
                    {total === 0 ? '還沒有人回報' : `是 ${t.yes}・否 ${t.no}${t.lastAt ? `（最近：${monthText(t.lastAt)}）` : ''}`}
                  </div>
                </div>
                {([true, false] as const).map(v => (
                  <button
                    key={String(v)}
                    type="button"
                    disabled={busy === q.key}
                    onClick={() => answer(q.key, v)}
                    aria-pressed={mine === v}
                    className={`text-[11px] font-black px-3 py-1.5 rounded-xl transition-all active:scale-95 ${
                      mine === v
                        ? (v ? 'bg-[#4D8B6F] text-white' : 'bg-[#C0705A] text-white')
                        : 'bg-[#F7F2EA] text-[#38312D] hover:bg-[#E8DFD8]'
                    } disabled:opacity-50`}
                  >
                    {v ? '是' : '否'}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
      {note && <p className="text-[11px] font-bold text-[#4D8B6F] mt-2" role="status">{note}</p>}
      {data && !data.loggedIn && (
        <button type="button" onClick={onLogin} className="mt-2 text-[11px] font-bold text-[#B88746] underline">
          登入後回報（註冊送 100 點）
        </button>
      )}
    </div>
  );
}
