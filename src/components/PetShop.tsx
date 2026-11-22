'use client';

import React, { useEffect, useMemo, useState } from 'react';

// 毛孩商店：從地圖左側工具列的「商店」打開。用點數買零食、玩具、穿搭。
// 版面依 ChatGPT 的設計稿：桌機置中彈窗（720 寬）、手機從下面拉上來的抽屜；三個分頁、左圖右文的商品卡、購買前確認。
// 商品圖是 ChatGPT 生成的盲盒公仔風 3D 圖（和主畫面的柴犬同一套風格）。

interface Item { sku: string; name: string; category: 'food' | 'treat' | 'care' | 'toy' | 'wear'; price: number; consumable: boolean; species?: 'dog' | 'cat'; desc: string }
interface State { loggedIn: boolean; catalog?: { items: Item[] }; inventory?: Record<string, number>; points?: number; pending?: number; pets?: { species: 'dog' | 'cat' }[] }

type Tab = 'use' | 'toy' | 'wear';
const TABS: { key: Tab; label: string }[] = [
  { key: 'use', label: '零食與洗澡' },
  { key: 'toy', label: '玩具' },
  { key: 'wear', label: '穿搭' },
];
const tabOf = (i: Item): Tab => (i.category === 'toy' ? 'toy' : i.category === 'wear' ? 'wear' : 'use');
const OLD_PROPS = ['can_food', 'jerky', 'ball', 'rope', 'plush_bone', 'bubble_bath'];
export const itemImg = (sku: string) => (OLD_PROPS.includes(sku) ? `/pet/props/${sku}.webp` : `/pet/shop/${sku}.webp`);
const uuid = (): string => (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
  ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16); });

const C = { bg: '#FFFDF9', sand: '#F7F2EA', line: '#E8DFD8', gold: '#B88746', green: '#4D8B6F', ink: '#38312D', sub: '#6E5A4D' };

export default function PetShop({ open, onClose, onLogin, onBought }: {
  open: boolean;
  onClose: () => void;
  onLogin: () => void;
  onBought: (points: number, pending: number) => void; // 買完更新右上的點數、工具列的背包
}) {
  const [state, setState] = useState<State | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<Tab>('use');
  const [pick, setPick] = useState<Item | null>(null); // 正在確認購買的商品
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFailed(false);
    fetch('/api/vpet').then(r => (r.ok ? r.json() : Promise.reject())).then(setState).catch(() => setFailed(true));
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') (pick ? setPick(null) : onClose()); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open, pick, onClose]);
  useEffect(() => { if (!toast) return; const t = window.setTimeout(() => setToast(null), 2200); return () => window.clearTimeout(t); }, [toast]);

  const items = useMemo(() => (state?.catalog?.items ?? []).filter(i => i.price > 0), [state]);
  if (!open) return null;

  const inv = state?.inventory ?? {};
  const points = state?.points ?? 0;
  const pending = state?.pending ?? 0;
  const hasCat = (state?.pets ?? []).some(p => p.species === 'cat');
  const loggedIn = !!state?.loggedIn;
  const list = items.filter(i => tabOf(i) === tab);
  const owned = (i: Item) => !i.consumable && (inv[i.sku] ?? 0) > 0;
  const catOnly = (i: Item) => i.species === 'cat' && !hasCat;

  const openBuy = (i: Item) => {
    if (!loggedIn) { onLogin(); return; }
    setErr(null); setQty(1); setPick(i);
  };
  const confirm = async () => {
    if (!pick) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/vpet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'buy', sku: pick.sku, qty: pick.consumable ? qty : 1, requestId: uuid() }) });
      const j = await res.json();
      if (!res.ok) { setErr(j.error || '買不了，等一下再試'); return; }
      setState(s => ({ ...(s as State), ...j }));
      if (typeof j.points === 'number') onBought(j.points, j.pending ?? 0);
      setToast(`買到了 ${pick.name}${pick.consumable && qty > 1 ? ` ×${qty}` : ''}`);
      setPick(null);
    } catch {
      setErr('網路不穩，等一下再試');
    } finally {
      setBusy(false);
    }
  };

  const total = pick ? pick.price * (pick.consumable ? qty : 1) : 0;
  const short = Math.max(0, total - points);

  return (
    <div className="fixed inset-0 z-[120] flex items-end md:items-center justify-center" role="dialog" aria-modal="true" aria-label="毛孩商店">
      <button type="button" aria-label="關閉商店" onClick={onClose} className="absolute inset-0 bg-[#38312D]/35 backdrop-blur-[2px] animate-[shopfade_.18s_ease-out]" />
      <div
        className="relative w-full md:w-[720px] h-[92vh] md:h-auto md:max-h-[84vh] flex flex-col rounded-t-[24px] md:rounded-[28px] shadow-[0_16px_48px_rgba(56,49,45,.16)] overflow-hidden animate-[shopsheet_.22s_ease-out] md:animate-[shoppop_.18s_ease-out]"
        style={{ background: C.bg, color: C.ink }}
      >
        <div className="md:hidden mx-auto mt-2 w-10 h-1.5 rounded-full bg-[#E8DFD8]" aria-hidden="true" />

        {/* 頂部：招牌、店名、點數 */}
        <div className="shrink-0 px-4 md:px-6 pt-3 md:pt-5 pb-3 flex items-center gap-3 border-b" style={{ borderColor: C.line }}>
          <img src="/pet/shop/booth.webp" alt="" className="w-16 h-16 md:w-20 md:h-20 object-contain -my-1" draggable={false} />
          <div className="flex-1 min-w-0">
            <h2 className="text-lg md:text-xl font-black leading-tight">毛孩商店</h2>
            {loggedIn ? (
              <p className="mt-1 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-black" style={{ background: 'rgba(184,135,70,.12)', color: C.gold }}>
                <img src="/pet/shop/coin.webp" alt="" className="w-4 h-4 object-contain" draggable={false} />
                可用 {points.toLocaleString()} P
                {pending > 0 && <span className="text-[11px] font-bold" style={{ color: C.sub }}>＋{pending} 確認中</span>}
              </p>
            ) : (
              <button type="button" onClick={onLogin} className="mt-1 text-sm font-black underline" style={{ color: C.gold }}>登入後才能用點數購買</button>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="關閉" className="w-9 h-9 rounded-full flex items-center justify-center text-xl leading-none hover:bg-[#F7F2EA]" style={{ color: C.sub }}>×</button>
        </div>

        {/* 分頁 */}
        <div className="shrink-0 px-4 md:px-6 pt-3 flex gap-2" role="tablist">
          {TABS.map(t => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className="px-4 py-1.5 rounded-full text-sm font-black transition-colors duration-150"
              style={tab === t.key ? { background: C.gold, color: '#fff' } : { background: C.sand, color: C.ink }}
            >{t.label}</button>
          ))}
        </div>

        {/* 商品 */}
        <div className="flex-1 overflow-y-auto px-4 md:px-6 py-3">
          {tab === 'wear' && (
            <p className="mb-3 rounded-2xl px-3 py-2 text-xs font-bold leading-relaxed" style={{ background: C.sand, color: C.sub }}>
              穿搭買了會先收進衣櫃 地圖上的毛孩還穿不上去 這個功能準備中
            </p>
          )}
          {failed && <p className="py-10 text-center text-sm font-bold" style={{ color: C.sub }}>商店暫時打不開 等一下再試</p>}
          {!failed && !state && <p className="py-10 text-center text-sm font-bold" style={{ color: C.sub }}>載入中…</p>}
          {state && (
            list.length > 0 && list.every(owned) ? (
              <div className="py-8 text-center">
                <img src="/pet/shop/booth.webp" alt="" className="w-24 h-24 mx-auto object-contain opacity-90" draggable={false} />
                <p className="mt-2 text-sm font-black">這一區都收藏完了</p>
                <p className="text-xs font-bold" style={{ color: C.sub }}>去別區幫毛孩挑挑</p>
              </div>
            ) : (
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
                {list.map(i => {
                  const has = owned(i);
                  const forCat = catOnly(i);
                  return (
                    <li key={i.sku} className="flex gap-3 rounded-[20px] p-3 md:p-3.5 transition-transform duration-150 md:hover:-translate-y-0.5 md:hover:shadow-md" style={{ background: C.sand, border: '1px solid rgba(184,135,70,.16)' }}>
                      <span className="shrink-0 w-[80px] h-[80px] md:w-[88px] md:h-[88px] rounded-full flex items-center justify-center" style={{ background: C.bg }}>
                        <img src={itemImg(i.sku)} alt="" className="w-[70px] h-[70px] md:w-[76px] md:h-[76px] object-contain drop-shadow-[0_4px_4px_rgba(56,49,45,.12)]" draggable={false} />
                      </span>
                      <div className="flex-1 min-w-0 flex flex-col">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[15px] md:text-base font-black leading-tight">{i.name}</span>
                          {i.species === 'cat' && <span className="rounded-full px-2 py-0.5 text-[10px] font-black" style={{ background: 'rgba(77,139,111,.14)', color: C.green }}>貓咪專用</span>}
                          {has && <span className="rounded-full px-2 py-0.5 text-[10px] font-black text-white" style={{ background: C.green }}>已擁有</span>}
                        </div>
                        <p className="mt-0.5 text-[13px] leading-snug" style={{ color: 'rgba(56,49,45,.72)' }}>{i.desc}{i.consumable ? '・可一次買多個' : ''}</p>
                        <div className="mt-auto pt-2 flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[15px] font-black" style={{ background: 'rgba(184,135,70,.12)', color: C.gold }}>
                            <img src="/pet/shop/coin.webp" alt="" className="w-4 h-4 object-contain" draggable={false} />{i.price}P
                          </span>
                          <button
                            type="button"
                            disabled={has || forCat}
                            onClick={() => openBuy(i)}
                            className="px-4 py-1.5 rounded-full text-sm font-black text-white active:scale-95 disabled:active:scale-100"
                            style={has || forCat ? { background: C.line, color: C.sub } : { background: C.gold }}
                          >{has ? (i.category === 'wear' ? '在衣櫃裡' : '已收藏') : forCat ? '要有貓咪' : '購買'}</button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )
          )}
        </div>

        <div className="shrink-0 px-4 md:px-6 py-2.5 text-[11px] font-bold border-t" style={{ borderColor: C.line, color: C.sub }}>
          玩具和穿搭買一次永久擁有 零食和泡泡球用完可以再買 確認中的點數入帳後才能用
        </div>

        {/* 購買確認 */}
        {pick && (
          <div className="absolute inset-0 z-10 flex items-end md:items-center justify-center bg-[#38312D]/25">
            <div className="w-full md:w-[360px] rounded-t-[24px] md:rounded-[24px] p-5 shadow-xl animate-[shopsheet_.2s_ease-out]" style={{ background: C.bg }}>
              <div className="flex items-center gap-3">
                <span className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: C.sand }}>
                  <img src={itemImg(pick.sku)} alt="" className="w-14 h-14 object-contain" draggable={false} />
                </span>
                <div>
                  <p className="font-black text-base">{pick.name}</p>
                  <p className="text-xs font-bold" style={{ color: C.sub }}>{pick.consumable ? pick.desc : pick.category === 'wear' ? '永久擁有 先收進衣櫃' : '永久擁有'}</p>
                </div>
              </div>
              {pick.consumable && (
                <div className="mt-4 flex items-center justify-center gap-4">
                  <button type="button" aria-label="少一個" disabled={qty <= 1} onClick={() => setQty(q => Math.max(1, q - 1))} className="w-9 h-9 rounded-full text-lg font-black disabled:opacity-40" style={{ background: C.sand }}>−</button>
                  <span className="w-8 text-center text-xl font-black" aria-live="polite">{qty}</span>
                  <button type="button" aria-label="多一個" disabled={qty >= 10} onClick={() => setQty(q => Math.min(10, q + 1))} className="w-9 h-9 rounded-full text-lg font-black disabled:opacity-40" style={{ background: C.sand }}>＋</button>
                </div>
              )}
              <div className="mt-4 rounded-2xl px-3 py-2 text-sm font-bold flex justify-between" style={{ background: C.sand }}>
                <span style={{ color: C.sub }}>合計</span>
                <span style={{ color: C.gold }} className="font-black">{total}P</span>
              </div>
              {short > 0 && <p className="mt-2 text-xs font-black text-[#C0705A]">點數不夠 還差 {short}P{pending > 0 ? `（${pending}P 還在確認中 不能用）` : ''}</p>}
              {err && <p className="mt-2 text-xs font-black text-[#C0705A]">{err}</p>}
              <div className="mt-4 flex gap-2">
                <button type="button" onClick={() => setPick(null)} className="flex-1 py-2.5 rounded-xl text-sm font-black" style={{ background: C.sand, color: C.ink }}>取消</button>
                <button type="button" disabled={busy || short > 0} onClick={confirm} className="flex-1 py-2.5 rounded-xl text-sm font-black text-white disabled:opacity-50" style={{ background: C.gold }}>{busy ? '購買中…' : short > 0 ? '點數不夠' : '確認購買'}</button>
              </div>
            </div>
          </div>
        )}

        {toast && (
          <div role="status" className="absolute left-1/2 -translate-x-1/2 bottom-14 px-4 py-2 rounded-full text-sm font-black text-white shadow-lg animate-[petfloat_2.2s_ease-out_forwards]" style={{ background: C.green }}>{toast}</div>
        )}
      </div>
    </div>
  );
}
