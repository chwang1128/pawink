'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSession, signIn } from 'next-auth/react';
import { ArrowLeft, Coins, Gift, ShoppingBag, Shirt, Backpack, Check, Heart } from 'lucide-react';

// 毛孩樂園：數位分身養成頁。會餓、會髒、會想你，但不會死。
// 正式美術（盲盒公仔風）完成前，先用圖示暫代。

type Slot = 'head' | 'face' | 'neck' | 'body' | 'back';
interface Item { sku: string; name: string; category: 'food' | 'treat' | 'care' | 'toy' | 'wear'; price: number; consumable: boolean; slot?: Slot; species?: 'dog' | 'cat'; icon: string; desc: string }
interface VPet {
  id: string; name: string; breed: string | null; species: 'dog' | 'cat'; headKey: string;
  stats: { fullness: number; cleanliness: number; mood: number }; status: string; memorial: boolean; sparkle: boolean;
  level: number; xp: number; xpThisLevel: number; xpNextLevel: number; dailyXpLeft: number; freeFeedsLeft: number;
  cooldown: { pet: number; play: number; bath: number }; equipped: Partial<Record<Slot, string>>;
}
interface State {
  loggedIn: boolean;
  catalog: { items: Item[]; slots: { key: Slot; name: string }[] };
  points?: number; pending?: number; inventory?: Record<string, number>; pets?: VPet[];
  rewards?: { checkedInToday: boolean; streak: number; nextCheckin: number; weeklyClaimed: boolean; care: { feed: boolean; pet: boolean; play: boolean; report: boolean; claimed: boolean } };
}

const C = { ink: '#38312D', sub: '#8C7A6B', gold: '#B88746', line: '#E8DFD8', cream: '#FFFDF9', sand: '#F7F2EA', green: '#4D8B6F', red: '#C0705A' };
const SLOT_POS: Record<Slot, string> = {
  head: 'top-[2%] left-1/2 -translate-x-1/2 text-5xl',
  face: 'top-[30%] left-1/2 -translate-x-1/2 text-3xl',
  neck: 'top-[50%] left-1/2 -translate-x-1/2 text-3xl',
  body: 'bottom-[8%] left-1/2 -translate-x-1/2 text-5xl',
  back: 'top-[42%] right-[14%] text-4xl',
};
const uuid = (): string => (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
  ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));

function Bar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-8 shrink-0 font-bold" style={{ color: C.ink }}>{label}</span>
      <div className="flex-1 h-2.5 rounded-full overflow-hidden" style={{ background: C.sand }} role="meter" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${value}%`, background: value < 30 ? C.red : color }} />
      </div>
      <span className="w-7 text-right tabular-nums" style={{ color: C.sub }}>{value}</span>
    </div>
  );
}

export default function PetPage() {
  const { status: authStatus } = useSession();
  const [state, setState] = useState<State | null>(null);
  const [failed, setFailed] = useState(false);
  const [petIdx, setPetIdx] = useState(0);
  const [tab, setTab] = useState<'tasks' | 'shop' | 'wardrobe' | 'bag'>('tasks');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  const [hop, setHop] = useState(0);
  const [pick, setPick] = useState<'play' | 'use' | null>(null);
  const [confirmMemorial, setConfirmMemorial] = useState(false);

  const load = useCallback(() => {
    fetch('/api/vpet').then(r => (r.ok ? r.json() : Promise.reject())).then(setState).catch(() => setFailed(true));
  }, []);
  useEffect(() => { if (authStatus !== 'loading') load(); }, [authStatus, load]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2600); return () => clearTimeout(t); }, [toast]);

  const items = state?.catalog.items ?? [];
  const bySku = useMemo(() => Object.fromEntries(items.map(i => [i.sku, i])), [items]);
  const pet = state?.pets?.[Math.min(petIdx, (state?.pets?.length ?? 1) - 1)];
  const inv = state?.inventory ?? {};

  const post = async (body: Record<string, unknown>, okText?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/vpet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await res.json();
      if (!res.ok) { setToast({ text: j.error || '暫時無法完成', ok: false }); return; }
      setState(prev => (prev ? { ...prev, ...j } : j));
      if (body.op === 'action') setHop(h => h + 1);
      const r = j.result || {};
      const text = typeof okText === 'string' ? okText
        : body.op === 'claim' ? `拿到 ${r.got ?? 0} 點${r.weekly ? '（含本週第一次登入 15 點）' : ''}`
        : body.op === 'buy' ? (r.replay ? '已經買過了' : `買到了！花了 ${r.spent} 點`)
        : r.gainedXp ? `親密度 +${r.gainedXp}` : '完成';
      setToast({ text, ok: true });
    } catch {
      setToast({ text: '網路不穩，請再試一次', ok: false });
    } finally {
      setBusy(false);
      setPick(null);
    }
  };
  const act = (action: string, sku?: string) => pet && post({ op: 'action', vpetId: pet.id, action, sku });

  // ---- 畫面 ----
  const shell = (children: React.ReactNode) => (
    <main className="min-h-[100dvh]" style={{ background: C.cream, color: C.ink }}>
      <header className="sticky top-0 z-20 backdrop-blur-xl border-b px-4 h-14 flex items-center gap-3" style={{ background: 'rgba(255,253,249,.9)', borderColor: C.line }}>
        <Link href="/" className="p-2 -ml-2 rounded-full hover:bg-black/5" aria-label="回到地圖"><ArrowLeft className="w-5 h-5" /></Link>
        <h1 className="font-black text-base">毛孩樂園</h1>
        {state?.loggedIn && typeof state.points === 'number' && (
          <div className="ml-auto flex items-center gap-1 text-sm font-black" style={{ color: C.gold }}>
            <Coins className="w-4 h-4" aria-hidden="true" />{state.points.toLocaleString()} P
            {!!state.pending && <span className="text-[11px] font-bold" style={{ color: C.sub }}>＋{state.pending} 確認中</span>}
          </div>
        )}
      </header>
      <div className="max-w-md mx-auto px-4 pb-16">{children}</div>
      {toast && (
        <div role="status" className="fixed left-1/2 -translate-x-1/2 bottom-6 z-50 px-4 py-2.5 rounded-2xl text-sm font-bold shadow-lg text-white" style={{ background: toast.ok ? C.green : C.red }}>
          {toast.text}
        </div>
      )}
    </main>
  );

  if (failed) return shell(<p className="pt-10 text-center text-sm">暫時無法讀取毛孩，請稍後再試</p>);
  if (!state || authStatus === 'loading') return shell(<p className="pt-10 text-center text-sm" style={{ color: C.sub }}>讀取中…</p>);

  if (!state.loggedIn) return shell(
    <div className="pt-12 text-center">
      <div className="text-7xl mb-4" aria-hidden="true">🐶</div>
      <h2 className="text-lg font-black mb-2">登入後就能養你的毛孩分身</h2>
      <p className="text-sm mb-6" style={{ color: C.sub }}>餵牠、陪牠玩、幫牠換衣服；回報店家賺的點數可以在這裡用</p>
      <button type="button" onClick={() => signIn('google')} className="px-6 py-3 rounded-2xl text-white font-black" style={{ background: C.gold }}>登入（註冊送 100 點）</button>
    </div>,
  );

  if (!pet) return shell(
    <div className="pt-12 text-center">
      <div className="text-7xl mb-4" aria-hidden="true">🐾</div>
      <h2 className="text-lg font-black mb-2">還沒有毛孩檔案</h2>
      <p className="text-sm mb-6" style={{ color: C.sub }}>先到地圖頁右上角建立毛孩檔案，分身就會自動出現</p>
      <Link href="/" className="inline-block px-6 py-3 rounded-2xl text-white font-black" style={{ background: C.gold }}>去建立毛孩檔案</Link>
    </div>,
  );

  const s = pet.stats;
  const hungry = !pet.memorial && s.fullness < 30;
  const dirty = !pet.memorial && s.cleanliness < 30;
  const sad = !pet.memorial && s.mood < 30;
  const toys = items.filter(i => i.category === 'toy' && (inv[i.sku] ?? 0) > 0 && (!i.species || i.species === pet.species));
  const usables = items.filter(i => i.consumable && (inv[i.sku] ?? 0) > 0 && (!i.species || i.species === pet.species));
  const r = state.rewards!;
  const btn = 'flex-1 min-w-0 rounded-2xl py-3 text-xs font-black flex flex-col items-center gap-0.5 ring-1 ring-[#E8DFD8] transition-all active:scale-95 disabled:opacity-40';

  return shell(
    <>
      {state.pets!.length > 1 && (
        <div className="flex gap-2 pt-3 overflow-x-auto" role="tablist" aria-label="選擇毛孩">
          {state.pets!.map((p, i) => (
            <button key={p.id} role="tab" aria-selected={i === petIdx} onClick={() => setPetIdx(i)} className="px-3 py-1.5 rounded-full text-xs font-bold ring-1 ring-[#E8DFD8] whitespace-nowrap" style={i === petIdx ? { background: C.ink, color: '#fff' } : { background: '#fff', borderColor: C.line }}>
              {p.name}
            </button>
          ))}
        </div>
      )}

      {/* 分身舞台 */}
      <section className="mt-3 rounded-[28px] overflow-hidden ring-1 ring-[#E8DFD8] relative" style={{ background: pet.memorial ? 'linear-gradient(#EEF0F7,#F7F2EA)' : 'linear-gradient(#FCEBD2,#FFF6EA)', borderColor: C.line }}>
        <div className="absolute top-3 left-4 text-[11px] font-bold px-2 py-1 rounded-full bg-white/80">Lv.{pet.level}</div>
        {pet.memorial && <div className="absolute top-3 right-4 text-[11px] font-bold px-2 py-1 rounded-full bg-white/80">🌈 紀念模式</div>}
        <div className="h-64 flex items-center justify-center">
          <div key={hop} className="relative w-48 h-48 animate-[pethop_.5s_ease-out]" style={{ filter: sad ? 'saturate(.6)' : undefined }}>
            <div className="absolute inset-0 flex items-center justify-center text-[120px] leading-none select-none animate-[petidle_3s_ease-in-out_infinite]" aria-hidden="true">
              {pet.species === 'cat' ? '🐱' : '🐶'}
            </div>
            {(Object.entries(pet.equipped) as [Slot, string][]).map(([slot, sku]) => (
              <span key={slot} className={`absolute select-none ${SLOT_POS[slot]}`} aria-hidden="true">{bySku[sku]?.icon}</span>
            ))}
            {dirty && <span className="absolute bottom-4 -left-6 text-xs font-bold px-2 py-1 rounded-xl bg-white shadow" aria-hidden="true">🧼 髒髒</span>}
            {pet.sparkle && <span className="absolute top-2 right-2 text-3xl animate-pulse" aria-hidden="true">✨</span>}
            {hungry && <span className="absolute -top-2 -right-6 text-xs font-bold px-2 py-1 rounded-xl bg-white shadow" aria-hidden="true">🍚 餓餓</span>}
          </div>
        </div>
        <div className="px-5 pb-4 text-center">
          <h2 className="text-xl font-black">{pet.name}</h2>
          <p className="text-sm font-bold mt-0.5" style={{ color: hungry || dirty || sad ? C.red : C.green }}>{pet.status}</p>
          <div className="mt-2 mx-auto max-w-[220px]">
            <div className="h-1.5 rounded-full overflow-hidden bg-white/80"><div className="h-full rounded-full" style={{ width: `${Math.min(100, (pet.xpThisLevel / Math.max(1, pet.xpNextLevel)) * 100)}%`, background: C.gold }} /></div>
            <p className="text-[10px] mt-1" style={{ color: C.sub }}>親密度 {pet.xpThisLevel}/{pet.xpNextLevel}　今天還能 +{pet.dailyXpLeft}</p>
          </div>
        </div>
      </section>

      {/* 狀態 */}
      <section className="mt-3 rounded-2xl ring-1 ring-[#E8DFD8] bg-white p-4 space-y-2" style={{ borderColor: C.line }} aria-label="狀態">
        <Bar label="飽足" value={s.fullness} color={C.gold} />
        <Bar label="清潔" value={s.cleanliness} color="#6FA8C9" />
        <Bar label="心情" value={s.mood} color={C.green} />
      </section>

      {/* 互動 */}
      <section className="mt-3 flex gap-2" aria-label="互動">
        <button type="button" className={btn} style={{ background: '#fff' }} disabled={busy || pet.memorial || pet.freeFeedsLeft === 0} onClick={() => act('feed')}>
          <span className="text-xl" aria-hidden="true">🍚</span>餵飼料<span className="text-[10px] font-bold" style={{ color: C.sub }}>免費剩 {pet.freeFeedsLeft}</span>
        </button>
        <button type="button" className={btn} style={{ background: '#fff' }} disabled={busy || pet.cooldown.pet > 0} onClick={() => act('pet')}>
          <span className="text-xl" aria-hidden="true">🤲</span>摸摸<span className="text-[10px] font-bold" style={{ color: C.sub }}>{pet.cooldown.pet ? `${pet.cooldown.pet} 分後` : '可以摸'}</span>
        </button>
        <button type="button" className={btn} style={{ background: '#fff' }} disabled={busy || pet.memorial || pet.cooldown.play > 0} onClick={() => setPick(pick === 'play' ? null : 'play')}>
          <span className="text-xl" aria-hidden="true">🎾</span>玩耍<span className="text-[10px] font-bold" style={{ color: C.sub }}>{pet.cooldown.play ? `${pet.cooldown.play} 分後` : '選玩具'}</span>
        </button>
        <button type="button" className={btn} style={{ background: '#fff' }} disabled={busy || pet.memorial || pet.cooldown.bath > 0} onClick={() => act('bath')}>
          <span className="text-xl" aria-hidden="true">🛁</span>洗澡<span className="text-[10px] font-bold" style={{ color: C.sub }}>{pet.cooldown.bath ? `${Math.ceil(pet.cooldown.bath / 60)} 小時後` : '免費'}</span>
        </button>
        <button type="button" className={btn} style={{ background: '#fff' }} disabled={busy || pet.memorial} onClick={() => setPick(pick === 'use' ? null : 'use')}>
          <span className="text-xl" aria-hidden="true">🍖</span>道具<span className="text-[10px] font-bold" style={{ color: C.sub }}>{usables.length ? `${usables.length} 種` : '沒有'}</span>
        </button>
      </section>
      {pick && (
        <div className="mt-2 rounded-2xl ring-1 ring-[#E8DFD8] bg-white p-3 flex flex-wrap gap-2" style={{ borderColor: C.line }}>
          {(pick === 'play' ? toys : usables).length === 0 ? (
            <p className="text-xs" style={{ color: C.sub }}>{pick === 'play' ? '還沒有玩具' : '還沒有道具，可以到商店買；每天第一次回報店家也會送一份零食'}</p>
          ) : (pick === 'play' ? toys : usables).map(i => (
            <button key={i.sku} type="button" disabled={busy} onClick={() => act(pick, i.sku)} className="px-3 py-2 rounded-xl text-xs font-bold ring-1 ring-[#E8DFD8] flex items-center gap-1.5" style={{ background: C.sand, borderColor: C.line }}>
              <span aria-hidden="true">{i.icon}</span>{i.name}{i.consumable && <span style={{ color: C.sub }}>×{inv[i.sku]}</span>}
            </button>
          ))}
        </div>
      )}

      {/* 分頁 */}
      <nav className="mt-5 flex gap-1 p-1 rounded-2xl" style={{ background: C.sand }} role="tablist">
        {([['tasks', '任務', Gift], ['shop', '商店', ShoppingBag], ['wardrobe', '衣櫃', Shirt], ['bag', '背包', Backpack]] as const).map(([k, label, Icon]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className="flex-1 py-2 rounded-xl text-xs font-black flex items-center justify-center gap-1" style={tab === k ? { background: '#fff', color: C.ink } : { color: C.sub }}>
            <Icon className="w-3.5 h-3.5" aria-hidden="true" />{label}
          </button>
        ))}
      </nav>

      {tab === 'tasks' && (
        <section className="mt-3 space-y-3">
          <div className="rounded-2xl ring-1 ring-[#E8DFD8] bg-white p-4" style={{ borderColor: C.line }}>
            <div className="flex items-center justify-between">
              <h3 className="font-black text-sm">每日簽到</h3>
              <span className="text-[11px]" style={{ color: C.sub }}>連續 {r.streak} 天</span>
            </div>
            <div className="flex gap-1.5 my-3">
              {[1, 2, 3, 4, 5, 6, 7].map(d => {
                // 已簽到的格數：今天簽過時含今天
                const filled = r.checkedInToday ? ((r.streak - 1) % 7) + 1 : r.streak % 7;
                const done = d <= filled;
                return (
                  <div key={d} className="flex-1 text-center rounded-lg py-1.5 text-[10px] font-bold" style={done ? { background: C.gold, color: '#fff' } : { background: C.sand, color: C.sub }}>
                    {d === 3 ? '+15' : d === 7 ? '+25' : '+5'}
                  </div>
                );
              })}
            </div>
            <button type="button" disabled={busy || r.checkedInToday} onClick={() => post({ op: 'claim', kind: 'checkin' })} className="w-full py-2.5 rounded-xl text-sm font-black text-white disabled:opacity-50" style={{ background: C.gold }}>
              {r.checkedInToday ? '今天已簽到' : `簽到領 ${r.nextCheckin} 點${r.weeklyClaimed ? '' : '（本週第一次再加 15）'}`}
            </button>
          </div>
          <div className="rounded-2xl ring-1 ring-[#E8DFD8] bg-white p-4" style={{ borderColor: C.line }}>
            <h3 className="font-black text-sm mb-2">今天的照顧任務</h3>
            {([['feed', '餵一次飯'], ['pet', '摸摸一次'], ['play', '陪玩一次'], ['report', '回報一家店']] as const).map(([k, label]) => (
              <div key={k} className="flex items-center gap-2 py-1 text-sm">
                <span className="w-5 h-5 rounded-full flex items-center justify-center" style={r.care[k] ? { background: C.green, color: '#fff' } : { background: C.sand }}>{r.care[k] && <Check className="w-3 h-3" />}</span>
                {label}
                {k === 'report' && !r.care.report && <Link href="/" className="ml-auto text-[11px] font-bold underline" style={{ color: C.gold }}>去地圖回報</Link>}
              </div>
            ))}
            <button type="button" disabled={busy || r.care.claimed || !(r.care.feed && r.care.pet && r.care.play && r.care.report)} onClick={() => post({ op: 'claim', kind: 'daily_care' })} className="mt-2 w-full py-2.5 rounded-xl text-sm font-black text-white disabled:opacity-50" style={{ background: C.green }}>
              {r.care.claimed ? '今天的任務完成了' : '全部完成領 5 點'}
            </button>
          </div>
          <p className="text-[11px] leading-relaxed" style={{ color: C.sub }}>點數無償贈送，只能在 Pawink 內使用，不能換現金或轉讓。回報店家的點數 7 天後才入帳，確認中的點數還不能用</p>
        </section>
      )}

      {tab === 'shop' && (
        <section className="mt-3 grid grid-cols-2 gap-2">
          {items.filter(i => i.price > 0).map(i => {
            const owned = !i.consumable && (inv[i.sku] ?? 0) > 0;
            const tooPoor = (state.points ?? 0) < i.price;
            return (
              <div key={i.sku} className="rounded-2xl ring-1 ring-[#E8DFD8] bg-white p-3 flex flex-col" style={{ borderColor: C.line }}>
                <div className="text-3xl" aria-hidden="true">{i.icon}</div>
                <div className="text-sm font-black mt-1">{i.name}</div>
                <div className="text-[11px] flex-1" style={{ color: C.sub }}>{i.desc}{i.consumable && inv[i.sku] ? `（有 ${inv[i.sku]}）` : ''}</div>
                <button type="button" disabled={busy || owned || tooPoor} onClick={() => post({ op: 'buy', sku: i.sku, qty: 1, requestId: uuid() })} className="mt-2 py-2 rounded-xl text-xs font-black disabled:opacity-50" style={owned ? { background: C.sand, color: C.sub } : { background: C.gold, color: '#fff' }}>
                  {owned ? '已擁有' : `${i.price} 點`}
                </button>
              </div>
            );
          })}
        </section>
      )}

      {tab === 'wardrobe' && (
        <section className="mt-3 space-y-3">
          {state.catalog.slots.map(({ key, name }) => {
            const owned = items.filter(i => i.slot === key && (inv[i.sku] ?? 0) > 0);
            const on = pet.equipped[key];
            return (
              <div key={key} className="rounded-2xl ring-1 ring-[#E8DFD8] bg-white p-3" style={{ borderColor: C.line }}>
                <h3 className="text-xs font-black mb-2">{name}</h3>
                {owned.length === 0 ? <p className="text-[11px]" style={{ color: C.sub }}>還沒有，可以到商店看看</p> : (
                  <div className="flex flex-wrap gap-2">
                    {owned.map(i => (
                      <button key={i.sku} type="button" disabled={busy} aria-pressed={on === i.sku} onClick={() => post({ op: 'equip', vpetId: pet.id, slot: key, sku: on === i.sku ? null : i.sku }, on === i.sku ? `脫下${i.name}` : `穿上${i.name}`)} className="px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5" style={on === i.sku ? { boxShadow: `0 0 0 2px ${C.gold}`, background: '#FFF4E5' } : { background: C.sand }}>
                        <span aria-hidden="true">{i.icon}</span>{i.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}

      {tab === 'bag' && (
        <section className="mt-3 rounded-2xl ring-1 ring-[#E8DFD8] bg-white p-3" style={{ borderColor: C.line }}>
          {Object.entries(inv).filter(([sku]) => bySku[sku] && bySku[sku].category !== 'wear').length === 0 ? (
            <p className="text-xs" style={{ color: C.sub }}>背包是空的</p>
          ) : Object.entries(inv).filter(([sku]) => bySku[sku] && bySku[sku].category !== 'wear').map(([sku, qty]) => (
            <div key={sku} className="flex items-center gap-3 py-2 border-b last:border-0" style={{ borderColor: C.line }}>
              <span className="text-2xl" aria-hidden="true">{bySku[sku].icon}</span>
              <div className="flex-1">
                <div className="text-sm font-bold">{bySku[sku].name}{bySku[sku].consumable && <span className="font-normal" style={{ color: C.sub }}> ×{qty}</span>}</div>
                <div className="text-[11px]" style={{ color: C.sub }}>{bySku[sku].desc}</div>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* 紀念模式 */}
      <section className="mt-8 text-center">
        {!confirmMemorial ? (
          <button type="button" onClick={() => setConfirmMemorial(true)} className="text-[11px] underline" style={{ color: C.sub }}>
            {pet.memorial ? '關閉紀念模式' : '牠已經去當小天使了？開啟紀念模式'}
          </button>
        ) : (
          <div className="rounded-2xl ring-1 ring-[#E8DFD8] bg-white p-4 text-left" style={{ borderColor: C.line }}>
            <p className="text-sm mb-3 flex items-start gap-2"><Heart className="w-4 h-4 mt-0.5 shrink-0" style={{ color: C.red }} aria-hidden="true" />
              {pet.memorial ? `要讓 ${pet.name} 回到一般模式嗎？` : `開啟後 ${pet.name} 不會再餓或變髒，你還是可以摸摸牠、幫牠換衣服`}
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setConfirmMemorial(false)} className="flex-1 py-2 rounded-xl text-xs font-bold" style={{ background: C.sand }}>取消</button>
              <button type="button" disabled={busy} onClick={() => { setConfirmMemorial(false); post({ op: 'memorial', vpetId: pet.id, on: !pet.memorial }, pet.memorial ? '已回到一般模式' : '已開啟紀念模式'); }} className="flex-1 py-2 rounded-xl text-xs font-black text-white" style={{ background: C.ink }}>確定</button>
            </div>
          </div>
        )}
      </section>
      <p className="mt-6 text-center text-[10px]" style={{ color: C.sub }}>正式角色美術製作中，目前先用圖示暫代</p>
    </>,
  );
}
