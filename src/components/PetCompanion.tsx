'use client';

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

// 地圖主畫面上的毛孩分身：
// - 點頭＝摸摸（瞇眼、冒愛心）；點身體＝跳一下、叫一聲
// - 把下方的飼料、罐罐、玩具拖到牠旁邊（或直接點一下），牠會走過去吃或玩
// - 會餓、會髒、會想你，但不會死
// 美術：ChatGPT 生成的盲盒公仔風圖（public/pet）。目前只有柴犬一組，其他品種之後補。

type Pose = 'idle' | 'petted' | 'eat' | 'play' | 'walk' | 'hungry';
interface Stats { fullness: number; cleanliness: number; mood: number }
interface VPet { id: string; name: string; species: 'dog' | 'cat'; stats: Stats; status: string; memorial: boolean; sparkle: boolean; level: number; freeFeedsLeft: number; cooldown: { pet: number; play: number; bath: number } }
interface Snap { loggedIn: boolean; pets?: VPet[]; inventory?: Record<string, number>; points?: number; pending?: number }

type ItemKind = 'food' | 'toy' | 'bath';
interface TrayItem { key: string; sku?: string; label: string; img: string; kind: ItemKind; count?: number; disabled?: string }
interface Drop { id: number; item: TrayItem; x: number; done?: boolean }
interface Particle { id: number; x: number; y: number; text: string; cls?: string }

const SPRITE: Record<Pose, string> = {
  idle: '/pet/shiba/idle.webp', petted: '/pet/shiba/petted.webp', eat: '/pet/shiba/eat.webp',
  play: '/pet/shiba/play.webp', walk: '/pet/shiba/walk.webp', hungry: '/pet/shiba/hungry.webp',
};
// 圖片原本朝哪邊：1 朝右、-1 朝左、0 正面（不翻轉）
const NATIVE_FACING: Record<Pose, number> = { idle: -1, petted: 0, eat: 1, play: 0, walk: 1, hungry: 0 };
const PROP: Record<string, string> = {
  bowl: '/pet/props/bowl_full.webp', bowl_empty: '/pet/props/bowl_empty.webp', can_food: '/pet/props/can_food.webp', jerky: '/pet/props/jerky.webp',
  ball: '/pet/props/ball.webp', rope: '/pet/props/rope.webp', plush_bone: '/pet/props/plush_bone.webp', bubble_bath: '/pet/props/bubble_bath.webp',
};
const TOYS = ['ball', 'rope', 'plush_bone'];
const SPEED = 110; // 走路速度 px/秒
const MIN_KEY = 'pawink_pet_min';

function useIsDesktop() {
  const [d, setD] = useState(false);
  useEffect(() => {
    const m = window.matchMedia('(min-width: 768px)');
    const on = () => setD(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return d;
}

export default function PetCompanion({
  loggedIn, guestName, hidden, hasCarousel, hasFeatured, chatOpen, onPoints, onLogin,
}: {
  loggedIn: boolean;
  guestName: string;
  hidden: boolean;
  hasCarousel: boolean; // 下方有店家卡片列
  hasFeatured: boolean; // 左下有推薦店家面板
  chatOpen: boolean; // AI 對話框開著（手機會蓋住下半部）
  onPoints?: (points: number, pending: number) => void;
  onLogin: () => void;
}) {
  const desktop = useIsDesktop();
  const W = desktop ? 300 : 230; // 舞台寬
  const H = desktop ? 170 : 132; // 舞台高
  const PET_H = desktop ? 118 : 92;
  // 放在地圖左下角，避開店家卡片列與推薦面板
  const wide = typeof window !== 'undefined' && window.innerWidth >= 1024;
  const bottom = desktop ? (hasCarousel ? 220 : 24) : (hasCarousel ? 196 : hasFeatured ? 214 : 20);
  const left = desktop ? (hasFeatured && !hasCarousel ? (wide ? 380 : 320) : 24) : 10;

  const [snap, setSnap] = useState<Snap | null>(null);
  const [guest, setGuest] = useState<Stats>({ fullness: 55, cleanliness: 70, mood: 60 });
  const [minimized, setMinimized] = useState(false);
  const [pose, setPose] = useState<Pose>('idle');
  const [x, setX] = useState(W / 2);
  const [facing, setFacing] = useState(-1);
  const [hop, setHop] = useState(0);
  const [bubble, setBubble] = useState<string | null>(null);
  const [drops, setDrops] = useState<Drop[]>([]);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [drag, setDrag] = useState<{ item: TrayItem; x: number; y: number; moved: boolean } | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);
  const xRef = useRef(W / 2);
  const busyRef = useRef(false); // 正在做一個動作（走過去吃、玩）時不接新的
  const raf = useRef<number>();
  const idSeq = useRef(1);
  const lastInteract = useRef(Date.now());

  const pet = snap?.pets?.[0];
  const stats: Stats = loggedIn ? (pet?.stats ?? guest) : guest;
  const name = loggedIn ? (pet?.name ?? guestName) : guestName;
  const memorial = !!pet?.memorial;
  const hungry = !memorial && stats.fullness < 30;
  const dirty = !memorial && stats.cleanliness < 30;
  const lonely = !memorial && stats.mood < 30;

  // ---- 讀取 ----
  useEffect(() => {
    try { setMinimized(localStorage.getItem(MIN_KEY) === '1'); } catch { /* 略過 */ }
  }, []);
  useEffect(() => {
    if (!loggedIn) { setSnap({ loggedIn: false }); return; }
    fetch('/api/vpet').then(r => (r.ok ? r.json() : null)).then(j => j && setSnap(j)).catch(() => {});
  }, [loggedIn]);
  useLayoutEffect(() => { xRef.current = Math.min(Math.max(xRef.current, 50), W - 50); setX(xRef.current); }, [W]);

  const toggleMin = (v: boolean) => {
    setMinimized(v);
    try { localStorage.setItem(MIN_KEY, v ? '1' : '0'); } catch { /* 略過 */ }
  };

  // ---- 小工具 ----
  const say = useCallback((text: string, ms = 2200) => {
    setBubble(text);
    window.setTimeout(() => setBubble(b => (b === text ? null : b)), ms);
  }, []);
  const burst = useCallback((px: number, py: number, text: string, n = 1, cls = '') => {
    const add: Particle[] = Array.from({ length: n }, (_, i) => ({ id: idSeq.current++, x: px + (i - (n - 1) / 2) * 16, y: py, text, cls }));
    setParticles(p => [...p, ...add]);
    window.setTimeout(() => setParticles(p => p.filter(q => !add.some(a => a.id === q.id))), 1400);
  }, []);
  const wait = (ms: number) => new Promise(r => window.setTimeout(r, ms));

  const walkTo = useCallback((target: number) => new Promise<void>(resolve => {
    const t = Math.min(Math.max(target, 45), W - 45);
    if (raf.current) cancelAnimationFrame(raf.current);
    if (Math.abs(t - xRef.current) < 4) { resolve(); return; }
    setFacing(t > xRef.current ? 1 : -1);
    setPose('walk');
    let last = performance.now();
    const step = (now: number) => {
      const dt = (now - last) / 1000; last = now;
      const dir = Math.sign(t - xRef.current);
      xRef.current += dir * SPEED * dt;
      if ((dir > 0 && xRef.current >= t) || (dir < 0 && xRef.current <= t)) {
        xRef.current = t; setX(t); setPose('idle'); resolve(); return;
      }
      setX(xRef.current);
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  }), [W]);

  // ---- 呼叫伺服器（未登入只做動畫，不存檔）----
  const call = useCallback(async (body: Record<string, unknown>): Promise<{ ok: boolean; error?: string; gainedXp?: number }> => {
    if (!loggedIn) return { ok: true };
    try {
      const res = await fetch('/api/vpet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await res.json();
      if (!res.ok) return { ok: false, error: j.error };
      setSnap(prev => ({ ...(prev || { loggedIn: true }), ...j }));
      if (typeof j.points === 'number') onPoints?.(j.points, j.pending ?? 0);
      return { ok: true, gainedXp: j.result?.gainedXp };
    } catch {
      return { ok: false, error: '網路不穩，等一下再試' };
    }
  }, [loggedIn, onPoints]);
  const guestApply = (d: Partial<Stats>) => setGuest(g => ({
    fullness: Math.min(100, g.fullness + (d.fullness ?? 0)),
    cleanliness: Math.min(100, g.cleanliness + (d.cleanliness ?? 0)),
    mood: Math.min(100, g.mood + (d.mood ?? 0)),
  }));

  // ---- 點牠 ----
  const onPetClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
    lastInteract.current = Date.now();
    const r = e.currentTarget.getBoundingClientRect();
    const stage = stageRef.current!.getBoundingClientRect();
    const head = (e.clientY - r.top) / r.height < 0.5;
    const px = e.clientX - stage.left, py = e.clientY - stage.top;
    if (busyRef.current) return;
    if (head) {
      setPose('petted');
      burst(px, py - 10, '❤', 3, 'text-[#E46B6B]');
      say(memorial ? '我一直都在' : lonely ? '最喜歡你了！' : '好舒服～');
      if (!loggedIn) guestApply({ mood: 5 });
      else if (pet && pet.cooldown.pet === 0) {
        const res = await call({ op: 'action', vpetId: pet.id, action: 'pet' });
        if (res.ok && res.gainedXp) burst(px, py - 40, `親密度 +${res.gainedXp}`, 1, 'text-[#B88746] text-[11px] font-black');
      }
      await wait(1400);
      setPose('idle');
    } else {
      setHop(h => h + 1);
      say(pet?.species === 'cat' ? '喵～' : '汪！', 1200);
    }
  };

  // ---- 放下東西 ----
  const doDrop = async (item: TrayItem, dropX: number) => {
    if (busyRef.current) return;
    if (item.disabled) { say(item.disabled); return; }
    if (memorial && item.kind !== 'bath') { say('牠在彩虹橋那邊吃飽飽了'); return; }
    lastInteract.current = Date.now();
    busyRef.current = true;
    const dx = Math.min(Math.max(dropX, 40), W - 40);
    const id = idSeq.current++;

    // 先送出（未登入直接成功），走過去的同時等結果
    const body = !pet ? null
      : item.kind === 'bath' && !item.sku ? { op: 'action', vpetId: pet.id, action: 'bath' }
      : item.key === 'bowl' ? { op: 'action', vpetId: pet.id, action: 'feed' }
      : item.kind === 'toy' ? (pet.cooldown.play === 0 ? { op: 'action', vpetId: pet.id, action: 'play', sku: item.sku } : null)
      : { op: 'action', vpetId: pet.id, action: 'use', sku: item.sku };
    const pending = loggedIn && body ? call(body) : Promise.resolve({ ok: true } as { ok: boolean; error?: string; gainedXp?: number });

    try {
      if (item.kind === 'bath') {
        setDrops(d => [...d, { id, item, x: xRef.current }]);
        const res = await pending;
        if (!res.ok) { say(res.error || '現在不能洗'); return; }
        setPose('petted');
        for (let i = 0; i < 4; i++) { burst(xRef.current + (Math.random() - 0.5) * 70, H - PET_H * (0.3 + Math.random() * 0.6), '🫧', 1, 'text-lg'); await wait(260); }
        say('香香的！');
        if (!loggedIn) guestApply({ cleanliness: 100 });
        await wait(800);
        return;
      }

      setDrops(d => [...d, { id, item, x: dx }]);
      // 站在東西旁邊，面向它
      const side = dx > xRef.current ? -1 : 1;
      const stand = dx + side * (PET_H * 0.55);
      await walkTo(stand);
      setFacing(side === -1 ? 1 : -1);
      const res = await pending;
      if (!res.ok) { setPose('idle'); say(res.error || '牠現在不想要'); return; }

      if (item.kind === 'food') {
        setPose('eat');
        await wait(1100);
        setDrops(d => d.map(q => (q.id === id ? { ...q, done: true } : q)));
        await wait(1100);
        setPose('petted');
        say(item.key === 'bowl' ? '好吃！' : '太好吃了！');
        if (!loggedIn) guestApply({ fullness: item.key === 'bowl' ? 20 : 40, mood: 10 });
      } else {
        // 玩：撲向玩具、玩具彈跳
        for (let i = 0; i < 3; i++) { setPose('play'); setHop(h => h + 1); await wait(450); setPose('petted'); await wait(250); }
        say('再玩一次！');
        if (!loggedIn) guestApply({ mood: 25 });
      }
      if (res.gainedXp) burst(xRef.current, H - PET_H - 10, `親密度 +${res.gainedXp}`, 1, 'text-[#B88746] text-[11px] font-black');
      await wait(900);
    } finally {
      setDrops(d => d.filter(q => q.id !== id));
      setPose('idle');
      busyRef.current = false;
    }
  };

  // ---- 拖曳 ----
  const startDrag = (e: React.PointerEvent, item: TrayItem) => {
    e.preventDefault();
    setDrag({ item, x: e.clientX, y: e.clientY, moved: false });
    const sx = e.clientX, sy = e.clientY;
    const move = (ev: PointerEvent) => setDrag(d => d && { ...d, x: ev.clientX, y: ev.clientY, moved: d.moved || Math.hypot(ev.clientX - sx, ev.clientY - sy) > 8 });
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setDrag(null);
      const moved = Math.hypot(ev.clientX - sx, ev.clientY - sy) > 8;
      if (!moved) { doDrop(item, xRef.current + (facing >= 0 ? 1 : -1) * PET_H * 0.9); return; } // 點一下：放在牠面前
      const r = stageRef.current?.getBoundingClientRect();
      if (r && ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top - 40 && ev.clientY <= r.bottom + 10) doDrop(item, ev.clientX - r.left);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  // ---- 沒事時自己走走 ----
  useEffect(() => {
    if (minimized || hidden) return;
    const t = window.setInterval(() => {
      if (busyRef.current || Date.now() - lastInteract.current < 5000) return;
      if (hungry || memorial) return;
      if (Math.random() < 0.5) walkTo(60 + Math.random() * (W - 120));
      else setHop(h => h + 1);
    }, 7000);
    return () => window.clearInterval(t);
  }, [minimized, hidden, hungry, memorial, W, walkTo]);
  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current); }, []);

  // ---- 托盤 ----
  const inv = snap?.inventory ?? {};
  const tray: TrayItem[] = [];
  const free = loggedIn ? (pet?.freeFeedsLeft ?? 0) : 9;
  tray.push({ key: 'bowl', label: loggedIn ? `飼料 ${free}` : '飼料', img: PROP.bowl, kind: 'food', disabled: free === 0 ? '今天的免費飼料吃完了，可以用罐罐' : stats.fullness >= 95 ? '牠已經吃飽了' : undefined });
  for (const sku of ['can_food', 'jerky']) {
    const n = loggedIn ? inv[sku] ?? 0 : 3;
    if (n > 0) tray.push({ key: sku, sku, label: `${sku === 'can_food' ? '罐罐' : '肉乾'} ${loggedIn ? n : ''}`.trim(), img: PROP[sku], kind: 'food', count: n, disabled: sku === 'can_food' && stats.fullness >= 95 ? '牠已經吃飽了' : undefined });
  }
  for (const sku of TOYS) {
    if (!loggedIn ? sku === 'ball' : (inv[sku] ?? 0) > 0) tray.push({ key: sku, sku, label: sku === 'ball' ? '皮球' : sku === 'rope' ? '拔河繩' : '骨頭', img: PROP[sku], kind: 'toy' });
  }
  const bathCd = loggedIn ? (pet?.cooldown.bath ?? 0) : 0;
  if (loggedIn && (inv.bubble_bath ?? 0) > 0) tray.push({ key: 'bubble_bath', sku: 'bubble_bath', label: `泡泡 ${inv.bubble_bath}`, img: PROP.bubble_bath, kind: 'bath' });
  tray.push({ key: 'bath', label: '洗澡', img: PROP.bubble_bath, kind: 'bath', disabled: bathCd > 0 ? `今天洗過了，${Math.ceil(bathCd / 60)} 小時後再洗` : undefined });

  if (hidden || (!desktop && chatOpen)) return null;

  // ---- 縮小 ----
  if (minimized) {
    return (
      <button
        type="button"
        onClick={() => toggleMin(false)}
        aria-label={`打開 ${name}`}
        className="absolute z-[15] pointer-events-auto w-16 h-16 rounded-full bg-[#FFF4E5]/95 ring-1 ring-[#F0D9B5] shadow-[0_8px_24px_rgba(56,49,45,0.15)] overflow-hidden active:scale-95 transition-transform"
        style={{ bottom, left }}
      >
        <img src={hungry ? SPRITE.hungry : SPRITE.idle} alt="" className="w-full h-full object-contain p-1" draggable={false} />
        {(hungry || dirty || lonely) && <span className="absolute top-1 right-1 w-3 h-3 rounded-full bg-[#E46B6B] ring-2 ring-white" aria-hidden="true" />}
      </button>
    );
  }

  const effPose: Pose = pose === 'idle' && hungry ? 'hungry' : pose;
  const native = NATIVE_FACING[effPose];
  const flip = native !== 0 && native !== facing;
  const autoBubble = bubble ?? (pose === 'idle' && !busyRef.current ? (memorial ? null : hungry ? '肚子好餓…' : dirty ? '身上髒髒的' : lonely ? '陪我玩嘛' : null) : null);
  const bar = (v: number, c: string, label: string) => (
    <div className="flex items-center gap-1" title={`${label} ${v}`}>
      <span className="text-[9px] font-bold text-[#6E5A4D] w-3">{label}</span>
      <div className="w-9 h-1.5 rounded-full bg-[#E8DFD8] overflow-hidden"><div className="h-full rounded-full" style={{ width: `${v}%`, background: v < 30 ? '#C0705A' : c }} /></div>
    </div>
  );

  return (
    <div className="absolute z-[15] pointer-events-none select-none" style={{ bottom, left, width: W }}>
      {/* 名牌與狀態 */}
      <div className="pointer-events-auto flex items-center gap-2 mb-1 px-2.5 py-1 rounded-full bg-[#FFFDF9]/90 backdrop-blur ring-1 ring-[#E8DFD8] shadow-sm w-max max-w-full">
        <span className="text-[11px] font-black text-[#38312D] truncate max-w-[72px]">{name}</span>
        {bar(Math.round(stats.fullness), '#B88746', '飽')}
        {bar(Math.round(stats.cleanliness), '#6FA8C9', '潔')}
        {desktop && bar(Math.round(stats.mood), '#4D8B6F', '心')}
        <a href="/pet" className="text-[10px] font-black text-[#B88746] whitespace-nowrap">樂園›</a>
        <button type="button" onClick={() => toggleMin(true)} aria-label="縮小毛孩" className="text-[#A67C52] text-xs leading-none px-0.5">—</button>
      </div>

      {/* 舞台 */}
      <div ref={stageRef} className="relative" style={{ height: H }}>
        <div className="absolute left-2 right-2 bottom-0 h-8 rounded-[50%] bg-[radial-gradient(ellipse_at_center,rgba(255,244,229,.95),rgba(255,244,229,.55)_60%,transparent_72%)]" aria-hidden="true" />
        {drops.map(d => (
          <img
            key={d.id}
            src={d.done && d.item.key === 'bowl' ? '/pet/props/bowl_empty.webp' : d.item.img}
            alt=""
            draggable={false}
            className={`absolute pointer-events-none transition-opacity duration-500 ${d.done && d.item.key !== 'bowl' ? 'opacity-0' : ''} ${d.item.kind === 'toy' ? 'animate-[petball_.7s_ease-in-out_infinite]' : 'animate-[petdrop_.35s_ease-out]'}`}
            style={d.item.kind === 'bath'
              ? { left: d.x - PET_H * 0.45, bottom: PET_H * 0.25, width: PET_H * 0.9, opacity: 0.85 }
              : { left: d.x - PET_H * 0.22, bottom: 6, width: PET_H * 0.44 }}
          />
        ))}
        {/* 牠 */}
        <button
          type="button"
          onClick={onPetClick}
          aria-label={`${name}：點頭摸摸，點身體跳一下`}
          className="absolute bottom-1 pointer-events-auto cursor-pointer focus:outline-none"
          style={{ left: x - PET_H * 0.6, width: PET_H * 1.2, height: PET_H }}
        >
          <div key={hop} className="w-full h-full animate-[pethop_.5s_ease-out]">
            <div className={`relative w-full h-full ${effPose === 'walk' ? 'animate-[petwalk_.32s_ease-in-out_infinite]' : effPose === 'idle' ? 'animate-[petidle_3s_ease-in-out_infinite]' : ''}`}>
              <img
                src={SPRITE[effPose]}
                alt=""
                draggable={false}
                className="w-full h-full object-contain object-bottom drop-shadow-[0_6px_6px_rgba(56,49,45,.18)]"
                style={{ transform: flip ? 'scaleX(-1)' : undefined, filter: lonely && effPose === 'idle' ? 'saturate(.75)' : undefined }}
              />
              {dirty && (
                <>
                  <span className="absolute left-[34%] top-[58%] w-4 h-3 rounded-full bg-[#7A5A3A]/45 blur-[1px]" aria-hidden="true" />
                  <span className="absolute left-[55%] top-[70%] w-3 h-2.5 rounded-full bg-[#7A5A3A]/40 blur-[1px]" aria-hidden="true" />
                  <span className="absolute left-[44%] top-[40%] w-2.5 h-2 rounded-full bg-[#7A5A3A]/35 blur-[1px]" aria-hidden="true" />
                </>
              )}
              {pet?.sparkle && <span className="absolute -top-1 right-2 text-base animate-pulse" aria-hidden="true">✨</span>}
            </div>
          </div>
        </button>
        {/* 對話泡泡 */}
        {autoBubble && (
          <div className="absolute px-2.5 py-1 rounded-2xl bg-white shadow-md ring-1 ring-[#E8DFD8] text-[11px] font-bold text-[#38312D] whitespace-nowrap -translate-x-1/2 animate-[petdrop_.25s_ease-out]" style={{ left: Math.min(Math.max(x, 60), W - 60), bottom: PET_H + 8 }}>
            {autoBubble}
          </div>
        )}
        {particles.map(p => (
          <span key={p.id} className={`absolute pointer-events-none -translate-x-1/2 animate-[petfloat_1.3s_ease-out_forwards] ${p.cls || ''}`} style={{ left: p.x, top: p.y }} aria-hidden="true">{p.text}</span>
        ))}
      </div>

      {/* 托盤：拖到牠旁邊，或點一下 */}
      <div className="pointer-events-auto mt-1 flex gap-1.5 overflow-x-auto hide-scrollbar px-1.5 py-1.5 rounded-2xl bg-[#FFFDF9]/90 backdrop-blur ring-1 ring-[#E8DFD8] shadow-sm" role="toolbar" aria-label="拖到毛孩旁邊，或點一下">
        {tray.map(it => (
          <button
            key={it.key}
            type="button"
            onPointerDown={e => startDrag(e, it)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); doDrop(it, xRef.current + PET_H * 0.9); } }}
            aria-label={`${it.label}${it.disabled ? `（${it.disabled}）` : ''}`}
            className={`shrink-0 flex flex-col items-center rounded-xl px-1 pt-0.5 pb-0.5 touch-none cursor-grab active:cursor-grabbing hover:bg-[#F7F2EA] ${it.disabled ? 'opacity-40' : ''}`}
            style={{ width: desktop ? 50 : 44 }}
          >
            <img src={it.img} alt="" draggable={false} className="w-8 h-8 object-contain pointer-events-none" />
            <span className="text-[9px] font-bold text-[#6E5A4D] leading-tight whitespace-nowrap">{it.label}</span>
          </button>
        ))}
        <a href="/pet" className="shrink-0 flex flex-col items-center justify-center rounded-xl px-1 hover:bg-[#F7F2EA]" style={{ width: desktop ? 50 : 44 }}>
          <span className="text-xl leading-8" aria-hidden="true">🛍️</span>
          <span className="text-[9px] font-bold text-[#B88746] leading-tight">商店</span>
        </a>
      </div>
      {!loggedIn && (
        <button type="button" onClick={onLogin} className="pointer-events-auto mt-1 text-[10px] font-bold text-[#B88746] underline px-2">登入後照顧紀錄會保存，還能賺點數</button>
      )}

      {/* 拖曳中的東西 */}
      {drag && drag.moved && (
        <img src={drag.item.img} alt="" className="fixed z-[200] w-12 h-12 object-contain pointer-events-none -translate-x-1/2 -translate-y-1/2 drop-shadow-lg" style={{ left: drag.x, top: drag.y }} />
      )}
    </div>
  );
}
