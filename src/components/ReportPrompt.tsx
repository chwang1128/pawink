'use client';

import React, { useEffect, useRef } from 'react';
import OwnerReports from '@/components/OwnerReports';
import { POINTS_PER_REPORT } from '@/lib/report-questions';

// 另外跳出的「幫忙回報」視窗。
// stage="ask"：飼主按過導航或通話、回到網站時，先問「你最近去過嗎？」
// stage="form"：直接回答問題（從店家卡按「我去過，幫忙回報」進來，或在 ask 按「去過」）

export interface VisitStore { id: string; name: string; primaryType?: string | null; lat: number; lng: number; locToken?: string }

export default function ReportPrompt({
  store, stage, here, onStage, onClose, onNotYet, onAnswered, onPoints, onLogin,
}: {
  store: VisitStore;
  stage: 'ask' | 'form';
  here: { lat: number; lng: number } | null;
  onStage: (s: 'form') => void;
  onClose: () => void;
  onNotYet: () => void; // 按「還沒去」：之後再問一次
  onAnswered: () => void;
  onPoints?: (points: number, pending: number) => void;
  onLogin: () => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);

  // Esc 關閉；Tab 只在視窗內移動
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab' || !boxRef.current) return;
      const items = Array.from(boxRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]'));
      if (items.length === 0) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!boxRef.current.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 視窗開著時背景不捲動；關閉後焦點回到原本的位置
  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prevOverflow; prevFocus?.focus?.(); };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[110] flex items-end md:items-center justify-center p-3 md:p-4 bg-[#2A2320]/40 backdrop-blur-md animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-prompt-title"
        onClick={e => e.stopPropagation()}
        className="bg-[#FFFDF9] w-full max-w-md rounded-[28px] shadow-2xl ring-1 ring-white/80 flex flex-col max-h-[85dvh]"
      >
        <div className="px-5 pt-5 pb-3 shrink-0">
          <h2 id="report-prompt-title" className="text-base font-black text-[#38312D] leading-snug">
            {stage === 'ask' ? `你最近去過「${store.name}」嗎？` : `幫忙回報「${store.name}」`}
          </h2>
          {stage === 'ask' && (
            <p className="text-[12px] text-[#8C7A6B] mt-1.5 leading-relaxed">
              可以幫其他飼主回答幾個是非題嗎？大約 30 秒，登入後每題 {POINTS_PER_REPORT} 點，不確定的可以略過。
            </p>
          )}
        </div>

        {stage === 'ask' ? (
          <div className="px-5 pb-5 flex flex-col gap-2">
            <button
              type="button"
              autoFocus
              onClick={() => onStage('form')}
              className="w-full bg-[#B88746] hover:bg-[#A67C52] text-white font-black text-sm py-3 rounded-2xl transition-all active:scale-[0.98]"
            >
              去過，幫忙回答
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={onNotYet} className="flex-1 bg-[#F7F2EA] hover:bg-[#E8DFD8] text-[#38312D] font-bold text-xs py-2.5 rounded-2xl">
                還沒去
              </button>
              <button type="button" onClick={onClose} className="flex-1 bg-[#F7F2EA] hover:bg-[#E8DFD8] text-[#38312D] font-bold text-xs py-2.5 rounded-2xl">
                下次再說
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="px-5 pb-3 overflow-y-auto">
              <OwnerReports
                variant="form"
                placeId={store.id}
                primaryType={store.primaryType}
                name={store.name}
                place={{ lat: store.lat, lng: store.lng, token: store.locToken }}
                here={here}
                onPoints={onPoints}
                onAnswered={onAnswered}
                onLogin={onLogin}
              />
            </div>
            <div className="px-5 pb-5 pt-2 shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="w-full bg-[#38312D] hover:bg-[#2A2320] text-white font-black text-sm py-3 rounded-2xl transition-all active:scale-[0.98]"
              >
                完成
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
