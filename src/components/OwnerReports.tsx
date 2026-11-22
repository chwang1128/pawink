'use client';

import React, { useEffect, useState } from 'react';
import { kindOf, POINTS_PER_REPORT, DAILY_REPORT_POINTS_CAP, POINTS_PENDING_DAYS, MIN_REPORTS_TO_OVERTURN, type ReportQuestion } from '@/lib/report-questions';

// 飼主回報：飼主依自己的經驗回答是／否。這是 Pawink 自己的資料，和 Google 評論分開顯示。
// variant="summary"：放在店家卡，只顯示結果與「我去過，幫忙回報」按鈕
// variant="form"：放在另外跳出的視窗，讓飼主回答問題

interface Tally { yes: number; no: number; onSite: number; lastAt: string | null; verdict: 'yes' | 'no' | 'mixed' | 'insufficient'; flagged: boolean }
interface Summary { questions: ReportQuestion[]; tally: Record<string, Tally>; mine: Record<string, boolean>; myFlags: string[]; loggedIn: boolean }

const VERDICT: Record<Tally['verdict'], { text: string; cls: string } | null> = {
  yes: { text: '多數說是', cls: 'bg-[#EAF3EE] text-[#4D8B6F]' },
  no: { text: '多數說否', cls: 'bg-[#F8ECE8] text-[#C0705A]' },
  mixed: { text: '意見分歧', cls: 'bg-[#F7F2EA] text-[#8C7A6B]' },
  insufficient: null,
};
const EMPTY: Tally = { yes: 0, no: 0, onSite: 0, lastAt: null, verdict: 'insufficient', flagged: false };

const monthText = (iso: string | null) => (iso ? `${new Date(iso).getMonth() + 1} 月` : '');
const countText = (t: Tally) =>
  `是 ${t.yes}・否 ${t.no}${t.onSite ? `（${t.onSite} 人現場回報）` : ''}${t.lastAt ? `・最近 ${monthText(t.lastAt)}` : ''}`;

export default function OwnerReports({
  variant, placeId, primaryType, name, place, here, refreshKey, onPoints, onLogin, onOpenForm, onAnswered,
}: {
  variant: 'summary' | 'form';
  placeId: string;
  primaryType?: string | null;
  name: string;
  place: { lat: number; lng: number; token?: string }; // token：本站簽發的店家座標憑證
  here: { lat: number; lng: number } | null; // 使用者目前位置（只用來判斷是否在店家附近，不會保存）
  refreshKey?: number; // 改變時重新讀取（回報視窗關掉後更新店家卡）
  onPoints?: (points: number, pending: number) => void;
  onLogin: () => void;
  onOpenForm?: () => void;
  onAnswered?: () => void; // 有送出回答或反映時通知（關窗後才需要更新店家卡）
}) {
  const kind = kindOf(primaryType, name);
  const [data, setData] = useState<Summary | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [askLogin, setAskLogin] = useState(false);

  useEffect(() => {
    let alive = true;
    setNote(null); setFailed(false);
    fetch(`/api/place-reports?placeId=${encodeURIComponent(placeId)}&kind=${kind}`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(j => { if (alive) setData(j); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [placeId, kind, refreshKey]);

  const send = async (question: string, payload: Record<string, unknown>) => {
    if (!data || busy) return null;
    setBusy(question);
    try {
      const res = await fetch('/api/place-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ placeId, kind, question, ...payload }),
      });
      const j = await res.json();
      if (!res.ok) { setNote(j.error || '回報暫時無法送出'); return null; }
      setData(j);
      onAnswered?.();
      if (typeof j.points === 'number') onPoints?.(j.points, j.pending ?? 0);
      return j;
    } catch {
      setNote('回報暫時無法送出');
      return null;
    } finally {
      setBusy(null);
    }
  };

  const flag = async (question: string) => {
    if (!data?.loggedIn) { onLogin(); return; }
    const j = await send(question, { action: 'flag' });
    if (j) setNote('謝謝反映，其他飼主會看到「可能已改變」的提醒');
  };

  const answer = async (question: string, value: boolean) => {
    const j = await send(question, { answer: value, place, here });
    if (!j) return;
    const site = j.onSite ? '（現場回報）' : '';
    if (!j.loggedIn) { setNote(`已記錄${site}，謝謝分享！`); setAskLogin(true); return; }
    if (j.awarded > 0) setNote(`謝謝回報${site}！${j.awarded} 點確認中，${POINTS_PENDING_DAYS} 天後入帳`);
    else if (j.capped) setNote(`已記錄${site}。今天回報的點數已達 ${DAILY_REPORT_POINTS_CAP} 點上限，明天再領`);
    else setNote(`已更新你的回答${site}`);
  };

  if (failed) return null;

  // ---- 店家卡：只顯示結果 ----
  if (variant === 'summary') {
    const answered = data ? data.questions.filter(q => { const t = data.tally[q.key]; return t && t.yes + t.no > 0; }) : [];
    return (
      <div className="px-5 pb-4">
        <h3 className="text-xs md:text-sm font-black text-[#38312D] flex items-center mb-1">
          <span className="w-1.5 h-3.5 rounded-full bg-[#B88746] mr-2"></span>
          飼主回報
        </h3>
        <p className="text-[10px] text-[#8C7A6B] mb-2.5">來自 Pawink 飼主的親身經驗，僅供參考，不代表店家或 Pawink 認證。</p>
        {!data ? (
          <div className="text-[11px] text-[#A67C52]">讀取中…</div>
        ) : answered.length === 0 ? (
          <div className="text-[11px] text-[#8C7A6B]">還沒有飼主回報這家店。</div>
        ) : (
          <ul className="space-y-1.5">
            {answered.map(q => {
              const t = data.tally[q.key] || EMPTY;
              const v = VERDICT[t.verdict];
              return (
                <li key={q.key} className="text-[12px] text-[#38312D]">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-bold">{q.label}</span>
                    {v && <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-md ${v.cls}`}>{v.text}</span>}
                    <span className="text-[10px] text-[#8C7A6B]">{countText(t)}{t.yes + t.no < MIN_REPORTS_TO_OVERTURN ? '・回報還少，僅供參考' : ''}</span>
                  </div>
                  {t.flagged && <div className="text-[10px] font-bold text-[#C0705A]">近期有飼主反映可能已改變</div>}
                </li>
              );
            })}
          </ul>
        )}
        {onOpenForm && (
          <button
            type="button"
            onClick={onOpenForm}
            className="mt-2 text-[12px] font-black text-[#B88746] underline underline-offset-2 hover:text-[#A67C52]"
          >
            我去過，幫忙回報（每題 {POINTS_PER_REPORT} 點）
          </button>
        )}
      </div>
    );
  }

  // ---- 回報視窗：回答問題 ----
  return (
    <div>
      <p className="text-[11px] text-[#8C7A6B] mb-2.5">
        {data && !data.loggedIn
          ? `不登入也能回報；登入後每題可得 ${POINTS_PER_REPORT} 點。`
          : `第一次回報每題 ${POINTS_PER_REPORT} 點（${POINTS_PENDING_DAYS} 天後入帳），每天最多 ${DAILY_REPORT_POINTS_CAP} 點。`}
        點「是／否」就會送出，不確定的題目可以略過。
      </p>

      {!data ? (
        <div className="text-[11px] text-[#A67C52]">讀取中…</div>
      ) : (
        <div className="space-y-2">
          {data.questions.map(q => {
            const t = data.tally[q.key] || EMPTY;
            const mine = data.mine[q.key];
            const total = t.yes + t.no;
            const myFlag = data.myFlags?.includes(q.key);
            return (
              <div key={q.key} className="bg-white ring-1 ring-[#E8DFD8] rounded-2xl px-3 py-2 flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-bold text-[#38312D]">{q.label}</div>
                  <div className="text-[10px] text-[#8C7A6B]">{total === 0 ? '還沒有人回報' : countText(t)}</div>
                  {t.flagged && <div className="text-[10px] font-bold text-[#C0705A]">近期有飼主反映可能已改變，歡迎重新回報</div>}
                  {total > 0 && (
                    <button type="button" disabled={busy === q.key || myFlag} onClick={() => flag(q.key)} className="text-[10px] text-[#A67C52] underline disabled:no-underline disabled:opacity-60">
                      {myFlag ? '已反映可能已改變' : '這題好像不對了'}
                    </button>
                  )}
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
        <div className={`mt-2 rounded-xl px-3 py-2 ${askLogin ? 'bg-[#FFF4E5] ring-1 ring-[#F0D9B5]' : ''}`}>
          {askLogin && <p className="text-[11px] text-[#38312D] mb-1">登入後回報，每題可得 {POINTS_PER_REPORT} 點，剛剛的回報也會存到你的帳號。</p>}
          <button type="button" onClick={onLogin} className="text-[11px] font-bold text-[#B88746] underline">
            登入領點數（註冊送 100 點）
          </button>
        </div>
      )}
    </div>
  );
}
