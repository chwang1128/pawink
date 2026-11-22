'use client';

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Walker } from '@/components/petMapWalker';

// 地圖主畫面上的毛孩分身。牠不會講話，全部用肢體動作表達：
// - 點頭＝摸摸（瞇眼開心）；連續摸會翻肚要你摸肚子；點身體＝開心叫一聲
// - 把飼料、罐罐、玩具拖到牠旁邊（或點一下），牠會走過去吃或玩；拖食物時會站起來拜拜、拖玩具時會歪頭
// - 會餓（趴著）、會髒（抓耳朵）、會寂寞（坐著歪頭等你），但不會死
// - 一陣子沒理牠會睡著，點一下叫醒會伸懶腰
// - 可以帶去散步：走進地圖，叫牠就跑回來
// 美術：ChatGPT 生成的盲盒公仔風柴犬（public/pet）。其他品種之後補。

type Pose = 'idle' | 'petted' | 'eat' | 'play' | 'walk' | 'hungry' | 'sleep' | 'stretch'
  | 'sit' | 'tilt' | 'sniff' | 'belly' | 'shake' | 'beg' | 'run' | 'bark' | 'scratch';
interface Stats { fullness: number; cleanliness: number; mood: number }
interface VPet { id: string; name: string; species: 'dog' | 'cat'; stats: Stats; memorial: boolean; sparkle: boolean; level: number; freeFeedsLeft: number; cooldown: { pet: number; play: number; bath: number } }
interface Snap { loggedIn: boolean; pets?: VPet[]; inventory?: Record<string, number>; points?: number; pending?: number }

type ItemKind = 'food' | 'toy' | 'bath';
interface TrayItem { key: string; sku?: string; label: string; img: string; kind: ItemKind; disabled?: string }
interface Drop { id: number; item: TrayItem; x: number; done?: boolean }
interface Particle { id: number; x: number; y: number; text: string; cls?: string }

const POSES: Pose[] = ['idle', 'petted', 'eat', 'play', 'walk', 'hungry', 'sleep', 'stretch', 'sit', 'tilt', 'sniff', 'belly', 'shake', 'beg', 'run', 'bark', 'scratch'];
const SPRITE = Object.fromEntries(POSES.map(p => [p, `/pet/shiba/${p}.webp`])) as Record<Pose, string>;
// 圖片原本朝哪邊：1 朝右、-1 朝左、0 正面（不翻轉）
const NATIVE_FACING: Record<Pose, number> = {
  idle: -1, petted: 0, eat: 1, play: 0, walk: 1, hungry: 0, sleep: 0, stretch: 1,
  sit: 0, tilt: 0, sniff: 1, belly: 0, shake: 0, beg: 0, run: 1, bark: 1, scratch: 0,
};
const PROP: Record<string, string> = {
  bowl: '/pet/props/bowl_full.webp', bowl_empty: '/pet/props/bowl_empty.webp', can_food: '/pet/props/can_food.webp', jerky: '/pet/props/jerky.webp',
  ball: '/pet/props/ball.webp', rope: '/pet/props/rope.webp', plush_bone: '/pet/props/plush_bone.webp', bubble_bath: '/pet/props/bubble_bath.webp',
};
const TOYS = ['ball', 'rope', 'plush_bone'];
const SPEED = 110; // 走路速度 px/秒
const MIN_KEY = 'pawink_pet_min';
// 多久沒理牠會睡著：白天 90 秒，晚上（台灣時間 22:00–07:00）50 秒
const SLEEP_AFTER_MS = 90_000;
const SLEEP_AFTER_NIGHT_MS = 50_000;
const isNightTW = () => { const h = new Date(Date.now() + 8 * 3_600_000).getUTCHours(); return h >= 22 || h < 7; };

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
  loggedIn, guestName, hidden, hasCarousel, hasFeatured, chatOpen, chatWide, onPoints, onLogin, getMap, stores, walkHome,
}: {
  loggedIn: boolean;
  guestName: string;
  hidden: boolean;
  hasCarousel: boolean; // 下方有店家卡片列
  hasFeatured: boolean; // 左下有推薦店家面板
  chatOpen: boolean; // AI 對話框開著（手機會蓋住下半部）
  chatWide: boolean; // 桌機對話框是大的（小的寬 300–320）
  onPoints?: (points: number, pending: number) => void;
  onLogin: () => void;
  getMap: () => any; // Google 地圖物件（還沒載入時為 null）
  stores: { lat: number; lng: number; name: string }[]; // 地圖上的店家，散步時會去聞一聞
  walkHome: { lat: number; lng: number } | null; // 散步的中心（使用者位置；沒有就用地圖中心）
}) {
  const desktop = useIsDesktop();
  const W = desktop ? 420 : 180; // 舞台寬：桌機加寬讓牠走得開（舞台透明，只有牠本身可以點）
  const H = desktop ? 128 : 104; // 舞台高
  const PET_H = desktop ? 94 : 76; // 毛孩高度（原 112 / 88，縮小一點）
  // 放在地圖左下角，避開店家卡片列與推薦面板
  const [vw, setVw] = useState(1280);
  useEffect(() => { const on = () => setVw(window.innerWidth); on(); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on); }, []);
  const wide = vw >= 1024;
  // 桌機：照顧按鈕沿著畫面最左邊直排（標題列下方開始），毛孩站在左下、店家卡片的上方
  // 手機：照顧按鈕和毛孩放在一起，避開下方的店家卡片
  const bottom = desktop ? (hasCarousel ? 100 : hasFeatured ? 112 : 16) : (hasCarousel ? 136 : hasFeatured ? 214 : 16);
  const left = desktop ? 12 : 10;
  // 桌機右側 AI 對話框開著時，中間放不下就先縮成頭像（點開時蓋在最上層）
  const chatW = chatWide ? (wide ? 400 : 340) : (wide ? 320 : 300);
  const room = desktop ? (chatOpen ? vw - 24 - chatW - 16 : vw - 24) - left : vw;
  const cramped = desktop && room < W;
  const [forceOpen, setForceOpen] = useState(false);

  const [snap, setSnap] = useState<Snap | null>(null);
  const [guest, setGuest] = useState<Stats>({ fullness: 55, cleanliness: 70, mood: 60 });
  const [minimized, setMinimized] = useState(false);
  const [pose, setPose] = useState<Pose>('idle');
  const [x, setX] = useState(60);
  const [facing, setFacing] = useState(-1);
  const [hop, setHop] = useState(0);
  const [notice, setNotice] = useState<string | null>(null); // 給飼主看的提示（不是牠在講話）
  const [drops, setDrops] = useState<Drop[]>([]);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [drag, setDrag] = useState<{ item: TrayItem; x: number; y: number; moved: boolean } | null>(null);
  const [asleep, setAsleep] = useState(false);
  const [out, setOut] = useState<'home' | 'out' | 'returning'>('home');
  const [showStats, setShowStats] = useState(0); // 點牠時在頭上顯示名字與數值（時間戳）
  const [openCat, setOpenCat] = useState<'food' | 'toy' | 'bath' | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // 點畫面其他地方就收起展開的分類
  useEffect(() => {
    if (!openCat) return;
    const off = (e: PointerEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpenCat(null); };
    document.addEventListener('pointerdown', off);
    return () => document.removeEventListener('pointerdown', off);
  }, [openCat]);
  useEffect(() => { if (!showStats) return; const t = window.setTimeout(() => setShowStats(0), 2600); return () => window.clearTimeout(t); }, [showStats]);

  const stageRef = useRef<HTMLDivElement>(null);
  const petBtn = useRef<HTMLButtonElement>(null);
  const xRef = useRef(60);
  const busyRef = useRef(false); // 正在做一個動作（走過去吃、玩）時不接新的
  const raf = useRef<number>();
  const idSeq = useRef(1);
  const lastInteract = useRef(Date.now());
  const pettedAt = useRef<number[]>([]);
  const mounted = useRef(true);
  const dragging = useRef(false);
  const dragCleanup = useRef<() => void>();
  const asleepRef = useRef(false);
  const walker = useRef<Walker | null>(null);
  const storesRef = useRef(stores);
  storesRef.current = stores;
  // 開發模式的 StrictMode 會先卸載再掛載一次，所以掛載時要設回 true
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; dragCleanup.current?.(); walker.current?.destroy(); if (raf.current) cancelAnimationFrame(raf.current); };
  }, []);

  const pet = snap?.pets?.[0];
  const stats: Stats = loggedIn ? (pet?.stats ?? guest) : guest;
  const name = loggedIn ? (pet?.name ?? guestName) : guestName;
  const memorial = !!pet?.memorial;
  const hungry = !memorial && stats.fullness < 30;
  const dirty = !memorial && stats.cleanliness < 30;
  const lonely = !memorial && stats.mood < 30;

  // ---- 讀取 ----
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(MIN_KEY); } catch { /* 略過 */ }
    // 沒設定過：手機先縮成頭像，不擋地圖；桌機直接展開
    setMinimized(saved === null ? !window.matchMedia('(min-width: 768px)').matches : saved === '1');
  }, []);
  useEffect(() => {
    if (!loggedIn) { setSnap({ loggedIn: false }); return; }
    fetch('/api/vpet').then(r => (r.ok ? r.json() : null)).then(j => j && mounted.current && setSnap(j)).catch(() => {});
  }, [loggedIn]);
  useLayoutEffect(() => { xRef.current = Math.min(Math.max(xRef.current, PET_H * 0.6), W - 50); setX(xRef.current); }, [W, PET_H]);

  const toggleMin = (v: boolean) => {
    setMinimized(v);
    if (v) setForceOpen(false);
    try { localStorage.setItem(MIN_KEY, v ? '1' : '0'); } catch { /* 略過 */ }
  };

  // ---- 小工具 ----
  const tell = useCallback((text: string, ms = 2600) => {
    setNotice(text);
    window.setTimeout(() => { if (mounted.current) setNotice(n => (n === text ? null : n)); }, ms);
  }, []);
  const burst = useCallback((px: number, py: number, text: string, n = 1, cls = '') => {
    const add: Particle[] = Array.from({ length: n }, (_, i) => ({ id: idSeq.current++, x: px + (i - (n - 1) / 2) * 16, y: py, text, cls }));
    setParticles(p => [...p, ...add]);
    window.setTimeout(() => { if (mounted.current) setParticles(p => p.filter(q => !add.some(a => a.id === q.id))); }, 1400);
  }, []);
  const wait = (ms: number) => new Promise(r => window.setTimeout(r, ms));
  // 做一個動作一段時間，再回到待機
  const act = useCallback(async (p: Pose, ms: number, bounce = false) => {
    setPose(p);
    if (bounce) setHop(h => h + 1);
    await new Promise(r => window.setTimeout(r, ms));
    if (mounted.current) setPose(cur => (cur === p ? 'idle' : cur));
  }, []);

  const walkTo = useCallback((target: number, gait: Pose = 'walk', speed = SPEED) => new Promise<void>(resolve => {
    const t = Math.min(Math.max(target, 45), W - 45);
    if (raf.current) cancelAnimationFrame(raf.current);
    if (Math.abs(t - xRef.current) < 4) { resolve(); return; }
    setFacing(t > xRef.current ? 1 : -1);
    setPose(gait);
    let last = performance.now();
    const step = (now: number) => {
      const dt = (now - last) / 1000; last = now;
      const dir = Math.sign(t - xRef.current);
      xRef.current += dir * speed * dt;
      if ((dir > 0 && xRef.current >= t) || (dir < 0 && xRef.current <= t)) {
        xRef.current = t;
        if (mounted.current) { setX(t); setPose('idle'); }
        resolve(); return;
      }
      if (petBtn.current) petBtn.current.style.left = `${xRef.current - PET_H * 0.6}px`;
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  }), [W, PET_H]);

  // ---- 呼叫伺服器（未登入只做動畫，不存檔）----
  const call = useCallback(async (body: Record<string, unknown>): Promise<{ ok: boolean; error?: string; gainedXp?: number }> => {
    if (!loggedIn) return { ok: true };
    try {
      const res = await fetch('/api/vpet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await res.json();
      if (!res.ok) return { ok: false, error: j.error };
      if (!mounted.current) return { ok: true };
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
  const petOnServer = async () => {
    if (!loggedIn) { guestApply({ mood: 5 }); return 0; }
    if (pet && pet.cooldown.pet === 0) { const r = await call({ op: 'action', vpetId: pet.id, action: 'pet' }); return r.gainedXp ?? 0; }
    return 0;
  };

  // ---- 睡覺與叫醒 ----
  const wake = useCallback(async () => {
    if (!asleepRef.current) return;
    asleepRef.current = false;
    setAsleep(false);
    lastInteract.current = Date.now();
    await act('stretch', 1300);
  }, [act]);
  useEffect(() => {
    if (minimized || hidden) return;
    const t = window.setInterval(() => {
      if (asleepRef.current || busyRef.current || dragging.current || out !== 'home') return;
      const limit = isNightTW() ? SLEEP_AFTER_NIGHT_MS : SLEEP_AFTER_MS;
      if (Date.now() - lastInteract.current > limit) { asleepRef.current = true; setAsleep(true); }
    }, 5000);
    return () => window.clearInterval(t);
  }, [minimized, hidden, out]);

  // ---- 點牠 ----
  const onPetClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const stage = stageRef.current!.getBoundingClientRect();
    const head = (e.clientY - r.top) / r.height < 0.5;
    const px = e.clientX - stage.left, py = e.clientY - stage.top;
    lastInteract.current = Date.now();
    setShowStats(Date.now());
    setOpenCat(null);
    if (busyRef.current) return;
    if (asleepRef.current) { await wake(); return; }
    if (!head) { await act('bark', 700, true); return; }
    // 摸頭：瞇眼開心；10 秒內摸第 3 下會翻肚要你摸肚子
    const now = Date.now();
    pettedAt.current = [...pettedAt.current.filter(t => now - t < 10_000), now];
    burst(px, py - 10, '❤', 3, 'text-[#E46B6B]');
    const roll = pettedAt.current.length >= 3 && !memorial;
    if (roll) pettedAt.current = [];
    const xp = petOnServer();
    await act(roll ? 'belly' : 'petted', roll ? 1800 : 1200);
    const gained = await xp;
    if (gained && mounted.current) burst(xRef.current, H - PET_H - 6, `❤ +${gained}`, 1, 'text-[#B88746] text-[11px] font-black');
  };

  // ---- 放下東西 ----
  const doDrop = async (item: TrayItem, dropX: number) => {
    setOpenCat(null);
    if (busyRef.current) return;
    if (out !== 'home') { tell(`${name} 出門散步了，先叫牠回來`); return; }
    if (asleepRef.current) await wake();
    if (item.disabled) { tell(item.disabled); await act('tilt', 900); return; }
    if (memorial && item.kind !== 'bath') { tell('紀念模式下不用餵食'); return; }
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
        if (!res.ok) { tell(res.error || '現在不能洗'); return; }
        setPose('sit');
        for (let i = 0; i < 4; i++) { burst(xRef.current + (Math.random() - 0.5) * 70, H - PET_H * (0.3 + Math.random() * 0.6), '🫧', 1, 'text-lg'); await wait(260); }
        setDrops(d => d.filter(q => q.id !== id));
        await act('shake', 1100, true); // 洗完甩乾
        if (!loggedIn) guestApply({ cleanliness: 100 });
        if (res.gainedXp) burst(xRef.current, H - PET_H - 6, `❤ +${res.gainedXp}`, 1, 'text-[#B88746] text-[11px] font-black');
        return;
      }

      setDrops(d => [...d, { id, item, x: dx }]);
      // 先嗅一嗅、再衝過去，站在東西旁邊面向它
      const side = dx > xRef.current ? -1 : 1;
      await walkTo(dx + side * (PET_H * 0.55), item.kind === 'toy' ? 'run' : 'walk', item.kind === 'toy' ? 190 : SPEED);
      setFacing(side === -1 ? 1 : -1);
      const res = await pending;
      if (!res.ok) { tell(res.error || '現在不行'); await act('tilt', 900); return; }

      if (item.kind === 'food') {
        await act('sniff', 500);
        setPose('eat');
        await wait(1100);
        setDrops(d => d.map(q => (q.id === id ? { ...q, done: true } : q)));
        await wait(1000);
        await act(item.key === 'bowl' ? 'petted' : 'belly', 1000, true);
        if (!loggedIn) guestApply({ fullness: item.key === 'bowl' ? 20 : 40, mood: 10 });
      } else {
        // 玩：撲向玩具、玩具彈跳、開心叫
        for (let i = 0; i < 3; i++) { setPose('play'); setHop(h => h + 1); await wait(450); setPose(i === 1 ? 'bark' : 'petted'); await wait(260); }
        if (!loggedIn) guestApply({ mood: 25 });
      }
      if (res.gainedXp) burst(xRef.current, H - PET_H - 6, `❤ +${res.gainedXp}`, 1, 'text-[#B88746] text-[11px] font-black');
      await wait(500);
    } finally {
      busyRef.current = false;
      if (mounted.current) {
        setDrops(d => d.filter(q => q.id !== id));
        setPose('idle');
      }
    }
  };

  // ---- 拖曳：拖食物時牠站起來拜拜，拖玩具時歪頭 ----
  const startDrag = (e: React.PointerEvent, item: TrayItem, onTap?: () => void) => {
    e.preventDefault();
    e.stopPropagation();
    dragging.current = true;
    lastInteract.current = Date.now();
    setDrag({ item, x: e.clientX, y: e.clientY, moved: false });
    if (!onTap && !busyRef.current && out === 'home' && !asleepRef.current && !item.disabled) setPose(item.kind === 'food' ? 'beg' : item.kind === 'toy' ? 'tilt' : 'sit');
    const sx = e.clientX, sy = e.clientY;
    const move = (ev: PointerEvent) => setDrag(d => d && { ...d, x: ev.clientX, y: ev.clientY, moved: d.moved || Math.hypot(ev.clientX - sx, ev.clientY - sy) > 8 });
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      dragging.current = false;
      dragCleanup.current = undefined;
    };
    const up = (ev: PointerEvent) => {
      cleanup();
      if (!mounted.current) return;
      setDrag(null);
      if (!busyRef.current) setPose(p => (p === 'beg' || p === 'tilt' || p === 'sit' ? 'idle' : p));
      if (ev.type === 'pointercancel') return;
      const moved = Math.hypot(ev.clientX - sx, ev.clientY - sy) > 8;
      if (!moved) { if (onTap) onTap(); else doDrop(item, xRef.current + (facing >= 0 ? 1 : -1) * PET_H * 0.9); return; } // 點一下：放在牠面前（分類按鈕則是展開）
      const r = stageRef.current?.getBoundingClientRect();
      if (r && ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top - 40 && ev.clientY <= r.bottom + 10) doDrop(item, ev.clientX - r.left);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    dragCleanup.current = cleanup;
  };

  // ---- 出門散步（走進地圖）----
  const mapBox = () => document.getElementById('full-map')?.getBoundingClientRect() ?? null;
  // 螢幕座標換成經緯度（城市範圍內用地圖邊界線性換算就夠準）
  const screenToLatLng = (map: any, cx: number, cy: number) => {
    const b = map.getBounds?.(); const r = mapBox();
    if (!b || !r) return null;
    const ne = b.getNorthEast(), sw = b.getSouthWest();
    return { lat: ne.lat() - ((cy - r.top) / r.height) * (ne.lat() - sw.lat()), lng: sw.lng() + ((cx - r.left) / r.width) * (ne.lng() - sw.lng()) };
  };
  const goWalk = async () => {
    if (out !== 'home' || busyRef.current) return;
    if (asleepRef.current) await wake();
    if (memorial) { tell('紀念模式下不能出門'); return; }
    if (hungry) { tell(`${name} 太餓了走不動，先餵牠`); await act('hungry', 1200); return; }
    const map = getMap();
    const g = (window as any).google;
    if (!map || !g?.maps) { tell('地圖還沒準備好'); return; }
    const r = petBtn.current?.getBoundingClientRect();
    const start = r ? screenToLatLng(map, r.left + r.width / 2, r.bottom - 4) : null;
    const c = map.getCenter();
    const center = walkHome ?? (c ? { lat: c.lat(), lng: c.lng() } : null);
    if (!start || !center) { tell('地圖還沒準備好'); return; }
    lastInteract.current = Date.now();
    await act('bark', 500, true);
    const { createWalker } = await import('@/components/petMapWalker');
    walker.current?.destroy();
    walker.current = createWalker({
      map, start, home: center, name,
      sprites: { walk: SPRITE.walk, idle: SPRITE.idle, eat: SPRITE.sniff, petted: SPRITE.petted, run: SPRITE.run, sit: SPRITE.sit, scratch: SPRITE.scratch, tilt: SPRITE.tilt },
      getStops: () => storesRef.current,
      onPet: () => { petOnServer(); },
    });
    if (mounted.current) setOut('out');
  };
  const callBack = async () => {
    if (out !== 'out' || !walker.current) return;
    setOut('returning');
    const m = mapBox();
    const s = stageRef.current?.getBoundingClientRect();
    const tx = s && m ? s.left + 60 - m.left : 80;
    const ty = s && m ? s.bottom - 8 - m.top : (m ? m.height - 60 : 400);
    await walker.current.recall(tx, ty);
    walker.current = null;
    if (!mounted.current) return;
    xRef.current = 60; setX(60);
    lastInteract.current = Date.now();
    setOut('home');
    burst(60, H - PET_H - 6, '❤', 3, 'text-[#E46B6B]');
    await act('belly', 1400, true); // 回到身邊開心翻肚
  };

  // ---- 沒事時的小動作 ----
  useEffect(() => {
    if (minimized || hidden) return;
    const t = window.setInterval(() => {
      if (asleepRef.current || out !== 'home' || busyRef.current || dragging.current || Date.now() - lastInteract.current < 2000) return;
      if (memorial) { if (Math.random() < 0.3) act('sit', 3000); return; }
      // 狀態優先：餓（趴著）＞ 髒（抓耳朵＋灰塵）＞ 寂寞（坐著歪頭）＞ 平常
      // 抓耳朵、歪頭只在髒、寂寞時出現，飼主一看就知道要做什麼
      if (hungry) return; // 待機就是趴著
      const roll = Math.random();
      if (dirty && roll < 0.6) { burst(xRef.current, H - PET_H * 0.7, '💨', 2, 'text-sm opacity-70'); act('scratch', 1600); return; }
      if (lonely && roll < 0.6) { act(Math.random() < 0.5 ? 'tilt' : 'sit', 1800); return; }
      if (roll < 0.65) {
        // 多半在走：一段一段走，偶爾小跑步
        const to = 60 + Math.random() * (W - 120);
        walkTo(to, Math.random() < 0.25 ? 'run' : 'walk', Math.random() < 0.25 ? 170 : SPEED);
      }
      else if (roll < 0.8) act('sniff', 1600);
      else if (roll < 0.9) act('sit', 1800);
      else setHop(h => h + 1);
    }, 2000); // 沒事時每 2 秒動一次
    return () => window.clearInterval(t);
  }, [minimized, hidden, hungry, dirty, lonely, memorial, W, H, PET_H, walkTo, act, burst, out]);

  // ---- 托盤 ----
  const inv = snap?.inventory ?? {};
  const tray: TrayItem[] = [];
  const free = loggedIn ? (pet?.freeFeedsLeft ?? 0) : 9;
  tray.push({ key: 'bowl', label: loggedIn ? `飼料 ${free}` : '飼料', img: PROP.bowl, kind: 'food', disabled: free === 0 ? '今天的免費飼料吃完了，可以用罐罐' : stats.fullness >= 95 ? `${name} 已經吃飽了` : undefined });
  for (const sku of ['can_food', 'jerky']) {
    const n = loggedIn ? inv[sku] ?? 0 : 3;
    if (n > 0) tray.push({ key: sku, sku, label: `${sku === 'can_food' ? '罐罐' : '肉乾'} ${loggedIn ? n : ''}`.trim(), img: PROP[sku], kind: 'food', disabled: sku === 'can_food' && stats.fullness >= 95 ? `${name} 已經吃飽了` : undefined });
  }
  for (const sku of TOYS) {
    if (!loggedIn ? sku === 'ball' : (inv[sku] ?? 0) > 0) tray.push({ key: sku, sku, label: sku === 'ball' ? '皮球' : sku === 'rope' ? '拔河繩' : '骨頭', img: PROP[sku], kind: 'toy' });
  }
  const bathCd = loggedIn ? (pet?.cooldown.bath ?? 0) : 0;
  if (loggedIn && (inv.bubble_bath ?? 0) > 0) tray.push({ key: 'bubble_bath', sku: 'bubble_bath', label: `泡泡 ${inv.bubble_bath}`, img: PROP.bubble_bath, kind: 'bath' });
  tray.push({ key: 'bath', label: '洗澡', img: PROP.bubble_bath, kind: 'bath', disabled: bathCd > 0 ? `今天洗過了，${Math.ceil(bathCd / 60)} 小時後再洗` : undefined });

  if (hidden || (!desktop && chatOpen)) return null;

  // ---- 縮小 ----
  if (minimized || (cramped && !forceOpen)) {
    return (
      <button
        type="button"
        onClick={() => (minimized ? toggleMin(false) : setForceOpen(true))}
        aria-label={`打開 ${name}`}
        className="absolute z-[15] pointer-events-auto w-16 h-16 rounded-full bg-[#FFF4E5]/95 ring-1 ring-[#F0D9B5] shadow-[0_8px_24px_rgba(56,49,45,0.15)] overflow-hidden active:scale-95 transition-transform"
        style={{ bottom, left }}
      >
        {out !== 'home'
          ? <span className="flex flex-col items-center justify-center h-full text-[10px] font-black text-[#B88746]"><img src={SPRITE.walk} alt="" className="w-10 h-8 object-contain" draggable={false} />散步中</span>
          : <img src={asleep ? SPRITE.sleep : hungry ? SPRITE.hungry : SPRITE.sit} alt="" className="w-full h-full object-contain p-1" draggable={false} />}
        {(hungry || dirty || lonely) && <span className="absolute top-1 right-1 w-3 h-3 rounded-full bg-[#E46B6B] ring-2 ring-white" aria-hidden="true" />}
      </button>
    );
  }

  const effPose: Pose = asleep ? 'sleep' : pose === 'idle' && hungry ? 'hungry' : pose;
  const native = NATIVE_FACING[effPose];
  const flip = native !== 0 && native !== facing;
  // 飼料欄只放三個分類：餵食、玩具、洗澡。外圈就是牠的狀態（飽足、心情、清潔），低於 30 變紅輕閃。
  // 點分類展開裡面的東西；直接拖分類＝用第一個能用的
  const cats: { key: 'food' | 'toy' | 'bath'; label: string; meter: { v: number; c: string; name: string }; items: TrayItem[] }[] = [
    { key: 'food', label: '餵食', meter: { v: stats.fullness, c: '#B88746', name: '飽足' }, items: tray.filter(t => t.kind === 'food') },
    { key: 'toy', label: '玩具', meter: { v: stats.mood, c: '#4D8B6F', name: '心情' }, items: tray.filter(t => t.kind === 'toy') },
    { key: 'bath', label: '洗澡', meter: { v: stats.cleanliness, c: '#6FA8C9', name: '清潔' }, items: tray.filter(t => t.kind === 'bath') },
  ];
  const R = 19, C = 2 * Math.PI * R;
  const itemBtn = (it: TrayItem) => (
    <button
      key={it.key}
      type="button"
      onPointerDown={e => { startDrag(e, it); }}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenCat(null); doDrop(it, xRef.current + PET_H * 0.9); } }}
      aria-label={`${it.label}${it.disabled ? `（${it.disabled}）` : ''}`}
      className="shrink-0 flex flex-col items-center rounded-xl px-0.5 py-0.5 touch-none cursor-grab active:cursor-grabbing hover:bg-[#F7F2EA]"
      style={{ width: 44 }}
    >
      <img src={it.img} alt="" draggable={false} className={`w-7 h-7 object-contain pointer-events-none ${it.disabled ? 'opacity-40' : ''}`} />
      <span className={`text-[9px] font-bold text-[#6E5A4D] leading-tight whitespace-nowrap ${it.disabled ? 'opacity-50' : ''}`}>{it.label}</span>
    </button>
  );

  const column = (
    <div className="pointer-events-auto flex flex-col items-center gap-0.5 px-1 py-1 rounded-2xl bg-[#FFFDF9]/90 backdrop-blur ring-1 ring-[#E8DFD8] shadow-sm" role="toolbar" aria-orientation="vertical" aria-label="照顧毛孩：點分類展開，或直接拖到牠旁邊">
        <button type="button" onClick={() => toggleMin(true)} aria-label="縮小毛孩" className="text-[#A67C52] text-xs leading-none py-1 w-full">—</button>
        {cats.map(cat => {
          const v = Math.round(Math.max(0, Math.min(100, cat.meter.v)));
          const low = !memorial && v < 30;
          const first = cat.items.find(i => !i.disabled) ?? cat.items[0];
          const open = openCat === cat.key;
          return (
            <div key={cat.key} className="relative">
              <button
                type="button"
                onPointerDown={e => first && startDrag(e, first, () => setOpenCat(o => (o === cat.key ? null : cat.key)))}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenCat(o => (o === cat.key ? null : cat.key)); } }}
                aria-expanded={open}
                aria-label={`${cat.label}，${cat.meter.name} ${v}${low ? '，偏低' : ''}`}
                title={`${cat.meter.name} ${v}`}
                className={`flex flex-col items-center rounded-xl px-0.5 py-0.5 touch-none cursor-pointer ${open ? 'bg-[#F7F2EA]' : 'hover:bg-[#F7F2EA]'}`}
                style={{ width: 48 }}
              >
                <span className={`relative w-10 h-10 flex items-center justify-center ${low ? 'animate-pulse' : ''}`}>
                  {!memorial && (
                    <svg className="absolute inset-0 -rotate-90" viewBox="0 0 44 44" aria-hidden="true">
                      <circle cx="22" cy="22" r={R} fill="none" stroke="#E8DFD8" strokeWidth="3" />
                      <circle cx="22" cy="22" r={R} fill="none" stroke={low ? '#C0705A' : cat.meter.c} strokeWidth="3" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - v / 100)} style={{ transition: 'stroke-dashoffset .5s' }} />
                    </svg>
                  )}
                  <img src={first?.img ?? PROP.bowl} alt="" draggable={false} className="w-7 h-7 object-contain pointer-events-none" />
                  {low && <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-[#C0705A] text-white text-[9px] font-black leading-[14px] text-center" aria-hidden="true">!</span>}
                </span>
                <span className={`text-[9px] font-bold leading-tight ${low ? 'text-[#C0705A]' : 'text-[#6E5A4D]'}`}>{cat.label}</span>
              </button>
              {open && (
                <div className="absolute left-full top-0 ml-1.5 flex gap-0.5 p-1 rounded-2xl bg-[#FFFDF9]/95 backdrop-blur ring-1 ring-[#E8DFD8] shadow-md animate-[petdrop_.2s_ease-out] z-10">
                  {cat.items.map(itemBtn)}
                  <a href="/pet" className="shrink-0 flex flex-col items-center justify-center rounded-xl px-0.5 hover:bg-[#F7F2EA]" style={{ width: 44 }}>
                    <span className="text-lg leading-7" aria-hidden="true">🛍️</span>
                    <span className="text-[9px] font-bold text-[#B88746] leading-tight">商店</span>
                  </a>
                </div>
              )}
            </div>
          );
        })}
      </div>
  );
  const ghost = drag && drag.moved ? (
    <img src={drag.item.img} alt="" className="fixed z-[200] w-12 h-12 object-contain pointer-events-none -translate-x-1/2 -translate-y-1/2 drop-shadow-lg" style={{ left: drag.x, top: drag.y }} />
  ) : null;

  // 桌機：照顧按鈕在畫面最左邊（標題列下方），毛孩在左下、店家卡片上方
  if (desktop) return (
    <div ref={rootRef} className="contents">
      <div className="absolute z-[16] pointer-events-none select-none" style={{ top: 92, left: 20 }}>
        {column}
      </div>
      <div className={`absolute ${cramped ? 'z-[75]' : 'z-[15]'} pointer-events-none select-none`} style={{ bottom, left }}>
        <div style={{ width: W }}>
        {/* 舞台 */}
        <div ref={stageRef} className="relative" style={{ height: H }}>
          <div className="absolute left-2 right-2 bottom-0 h-8 rounded-[50%] bg-[radial-gradient(ellipse_at_center,rgba(255,244,229,.95),rgba(255,244,229,.55)_60%,transparent_72%)]" aria-hidden="true" />
          {drops.map(d => (
            <img
              key={d.id}
              src={d.done && d.item.key === 'bowl' ? PROP.bowl_empty : d.item.img}
              alt=""
              draggable={false}
              className={`absolute pointer-events-none transition-opacity duration-500 ${d.done && d.item.key !== 'bowl' ? 'opacity-0' : ''} ${d.item.kind === 'toy' ? 'animate-[petball_.7s_ease-in-out_infinite]' : 'animate-[petdrop_.35s_ease-out]'}`}
              style={d.item.kind === 'bath'
                ? { left: d.x - PET_H * 0.45, bottom: PET_H * 0.25, width: PET_H * 0.9, opacity: 0.85 }
                : { left: d.x - PET_H * 0.22, bottom: 6, width: PET_H * 0.44 }}
            />
          ))}

          {out !== 'home' ? (
            <div className="absolute left-0 bottom-3 flex items-center gap-1.5 w-max max-w-[calc(100vw-28px)] whitespace-nowrap pointer-events-auto">
              <p className="text-[12px] font-bold text-[#6E5A4D] bg-[#FFFDF9]/90 rounded-full px-2.5 py-1 shadow-sm truncate min-w-0">{out === 'returning' ? `${name} 跑回來了…` : `${name} 散步中`}</p>
              <div className="flex gap-1.5 shrink-0">
                <button type="button" disabled={out !== 'out'} onClick={callBack} className="px-3 py-2 rounded-xl text-xs font-black text-white bg-[#B88746] shadow active:scale-95 disabled:opacity-50">📣 叫牠回來</button>
                <button type="button" disabled={out !== 'out'} onClick={() => walker.current?.panTo()} className="px-3 py-2 rounded-xl text-xs font-black text-[#38312D] bg-white ring-1 ring-[#E8DFD8] shadow active:scale-95 disabled:opacity-50">📍 看牠在哪</button>
              </div>
            </div>
          ) : (
            <button
              ref={petBtn}
              type="button"
              onClick={onPetClick}
              aria-label={asleep ? `${name} 睡著了，點一下叫醒牠` : `${name}：點頭摸摸，點身體逗牠`}
              className="absolute bottom-1 pointer-events-auto cursor-pointer focus:outline-none"
              style={{ left: x - PET_H * 0.6, width: PET_H * 1.2, height: PET_H }}
            >
              <div key={`${hop}-${pose}`} className={`w-full h-full ${['petted', 'belly', 'shake', 'stretch'].includes(pose) ? 'animate-[petsquash_.45s_ease-out]' : 'animate-[pethop_.5s_ease-out]'}`} style={{ transformOrigin: '50% 100%' }}>
                <div className={`relative w-full h-full ${effPose === 'walk' || effPose === 'run' ? 'animate-[petwalk_.32s_ease-in-out_infinite]' : effPose === 'idle' || effPose === 'sit' || effPose === 'sleep' ? 'animate-[petidle_3s_ease-in-out_infinite]' : effPose === 'shake' ? 'animate-[petshake_.18s_linear_infinite]' : ''}`}>
                  <img
                    src={SPRITE[effPose]}
                    alt=""
                    draggable={false}
                    className="w-full h-full object-contain object-bottom drop-shadow-[0_6px_6px_rgba(56,49,45,.18)]"
                    style={{ transform: flip ? 'scaleX(-1)' : undefined, filter: lonely && (effPose === 'idle' || effPose === 'sit') ? 'saturate(.75)' : undefined }}
                  />
                  {dirty && effPose !== 'sleep' && (
                    <>
                      <span className="absolute left-[34%] top-[58%] w-4 h-3 rounded-full bg-[#7A5A3A]/45 blur-[1px]" aria-hidden="true" />
                      <span className="absolute left-[55%] top-[70%] w-3 h-2.5 rounded-full bg-[#7A5A3A]/40 blur-[1px]" aria-hidden="true" />
                      <span className="absolute left-[44%] top-[40%] w-2.5 h-2 rounded-full bg-[#7A5A3A]/35 blur-[1px]" aria-hidden="true" />
                    </>
                  )}
                  {pet?.sparkle && <span className="absolute -top-1 right-2 text-base animate-pulse" aria-hidden="true">✨</span>}
                  {asleep && [0, 1, 2].map(i => (
                    <span key={i} className="absolute font-black text-[#8C7A6B] animate-[petzzz_2.4s_ease-out_infinite]" style={{ right: `${22 - i * 6}%`, top: '14%', fontSize: 11 + i * 3, animationDelay: `${i * 0.8}s` }} aria-hidden="true">Z</span>
                  ))}
                </div>
              </div>
            </button>
          )}
          {out === 'home' && showStats > 0 && (
            <div className="absolute -translate-x-1/2 px-2.5 py-1 rounded-full bg-[#FFFDF9]/95 ring-1 ring-[#E8DFD8] shadow text-[10px] font-bold text-[#6E5A4D] whitespace-nowrap animate-[petdrop_.2s_ease-out] pointer-events-none" style={{ left: Math.min(Math.max(x, 70), W - 70), bottom: PET_H + 4 }} aria-hidden="true">
              <b className="text-[#38312D]">{name}</b>　飽 {Math.round(stats.fullness)}・潔 {Math.round(stats.cleanliness)}・心 {Math.round(stats.mood)}
            </div>
          )}
          {out === 'home' && !asleep && !busyRef.current && !showStats && (
            <button type="button" onClick={goWalk} style={{ left: x + PET_H * 0.45 }} className="absolute bottom-0 pointer-events-auto px-2 py-1 rounded-full text-[10px] font-black text-[#4D8B6F] bg-[#FFFDF9]/90 ring-1 ring-[#CFE3D7] shadow-sm active:scale-95">🦮 散步</button>
          )}
          {particles.map(p => (
            <span key={p.id} className={`absolute pointer-events-none -translate-x-1/2 animate-[petfloat_1.3s_ease-out_forwards] ${p.cls || ''}`} style={{ left: p.x, top: p.y }} aria-hidden="true">{p.text}</span>
          ))}
        </div>

        {/* 給飼主的提示（不是牠在講話） */}
        {notice && (
          <div role="status" aria-live="polite" className="pointer-events-none mt-1 mx-1 px-2.5 py-1 rounded-xl bg-[#38312D]/85 text-white text-[11px] font-bold animate-[petdrop_.25s_ease-out]">{notice}</div>
        )}

        {!loggedIn && (
          <button type="button" onClick={onLogin} className="pointer-events-auto mt-1 text-[10px] font-bold text-[#B88746] underline px-2">登入後照顧紀錄會保存，還能賺點數</button>
        )}


      </div>
      </div>
      {ghost}
    </div>
  );

  // 手機：照顧按鈕和毛孩放在一起
  return (
    <div ref={rootRef} className={`absolute z-[15] pointer-events-none select-none flex items-end gap-1.5`} style={{ bottom, left }}>
      {column}
      <div style={{ width: W }}>
        {/* 舞台 */}
        <div ref={stageRef} className="relative" style={{ height: H }}>
          <div className="absolute left-2 right-2 bottom-0 h-8 rounded-[50%] bg-[radial-gradient(ellipse_at_center,rgba(255,244,229,.95),rgba(255,244,229,.55)_60%,transparent_72%)]" aria-hidden="true" />
          {drops.map(d => (
            <img
              key={d.id}
              src={d.done && d.item.key === 'bowl' ? PROP.bowl_empty : d.item.img}
              alt=""
              draggable={false}
              className={`absolute pointer-events-none transition-opacity duration-500 ${d.done && d.item.key !== 'bowl' ? 'opacity-0' : ''} ${d.item.kind === 'toy' ? 'animate-[petball_.7s_ease-in-out_infinite]' : 'animate-[petdrop_.35s_ease-out]'}`}
              style={d.item.kind === 'bath'
                ? { left: d.x - PET_H * 0.45, bottom: PET_H * 0.25, width: PET_H * 0.9, opacity: 0.85 }
                : { left: d.x - PET_H * 0.22, bottom: 6, width: PET_H * 0.44 }}
            />
          ))}

          {out !== 'home' ? (
            <div className="absolute left-0 bottom-3 flex items-center gap-1.5 w-max max-w-[calc(100vw-28px)] whitespace-nowrap pointer-events-auto">
              <p className="text-[12px] font-bold text-[#6E5A4D] bg-[#FFFDF9]/90 rounded-full px-2.5 py-1 shadow-sm truncate min-w-0">{out === 'returning' ? `${name} 跑回來了…` : `${name} 散步中`}</p>
              <div className="flex gap-1.5 shrink-0">
                <button type="button" disabled={out !== 'out'} onClick={callBack} className="px-3 py-2 rounded-xl text-xs font-black text-white bg-[#B88746] shadow active:scale-95 disabled:opacity-50">📣 叫牠回來</button>
                <button type="button" disabled={out !== 'out'} onClick={() => walker.current?.panTo()} className="px-3 py-2 rounded-xl text-xs font-black text-[#38312D] bg-white ring-1 ring-[#E8DFD8] shadow active:scale-95 disabled:opacity-50">📍 看牠在哪</button>
              </div>
            </div>
          ) : (
            <button
              ref={petBtn}
              type="button"
              onClick={onPetClick}
              aria-label={asleep ? `${name} 睡著了，點一下叫醒牠` : `${name}：點頭摸摸，點身體逗牠`}
              className="absolute bottom-1 pointer-events-auto cursor-pointer focus:outline-none"
              style={{ left: x - PET_H * 0.6, width: PET_H * 1.2, height: PET_H }}
            >
              <div key={`${hop}-${pose}`} className={`w-full h-full ${['petted', 'belly', 'shake', 'stretch'].includes(pose) ? 'animate-[petsquash_.45s_ease-out]' : 'animate-[pethop_.5s_ease-out]'}`} style={{ transformOrigin: '50% 100%' }}>
                <div className={`relative w-full h-full ${effPose === 'walk' || effPose === 'run' ? 'animate-[petwalk_.32s_ease-in-out_infinite]' : effPose === 'idle' || effPose === 'sit' || effPose === 'sleep' ? 'animate-[petidle_3s_ease-in-out_infinite]' : effPose === 'shake' ? 'animate-[petshake_.18s_linear_infinite]' : ''}`}>
                  <img
                    src={SPRITE[effPose]}
                    alt=""
                    draggable={false}
                    className="w-full h-full object-contain object-bottom drop-shadow-[0_6px_6px_rgba(56,49,45,.18)]"
                    style={{ transform: flip ? 'scaleX(-1)' : undefined, filter: lonely && (effPose === 'idle' || effPose === 'sit') ? 'saturate(.75)' : undefined }}
                  />
                  {dirty && effPose !== 'sleep' && (
                    <>
                      <span className="absolute left-[34%] top-[58%] w-4 h-3 rounded-full bg-[#7A5A3A]/45 blur-[1px]" aria-hidden="true" />
                      <span className="absolute left-[55%] top-[70%] w-3 h-2.5 rounded-full bg-[#7A5A3A]/40 blur-[1px]" aria-hidden="true" />
                      <span className="absolute left-[44%] top-[40%] w-2.5 h-2 rounded-full bg-[#7A5A3A]/35 blur-[1px]" aria-hidden="true" />
                    </>
                  )}
                  {pet?.sparkle && <span className="absolute -top-1 right-2 text-base animate-pulse" aria-hidden="true">✨</span>}
                  {asleep && [0, 1, 2].map(i => (
                    <span key={i} className="absolute font-black text-[#8C7A6B] animate-[petzzz_2.4s_ease-out_infinite]" style={{ right: `${22 - i * 6}%`, top: '14%', fontSize: 11 + i * 3, animationDelay: `${i * 0.8}s` }} aria-hidden="true">Z</span>
                  ))}
                </div>
              </div>
            </button>
          )}
          {out === 'home' && showStats > 0 && (
            <div className="absolute -translate-x-1/2 px-2.5 py-1 rounded-full bg-[#FFFDF9]/95 ring-1 ring-[#E8DFD8] shadow text-[10px] font-bold text-[#6E5A4D] whitespace-nowrap animate-[petdrop_.2s_ease-out] pointer-events-none" style={{ left: Math.min(Math.max(x, 70), W - 70), bottom: PET_H + 4 }} aria-hidden="true">
              <b className="text-[#38312D]">{name}</b>　飽 {Math.round(stats.fullness)}・潔 {Math.round(stats.cleanliness)}・心 {Math.round(stats.mood)}
            </div>
          )}
          {out === 'home' && !asleep && !busyRef.current && !showStats && (
            <button type="button" onClick={goWalk} style={{ left: x + PET_H * 0.45 }} className="absolute bottom-0 pointer-events-auto px-2 py-1 rounded-full text-[10px] font-black text-[#4D8B6F] bg-[#FFFDF9]/90 ring-1 ring-[#CFE3D7] shadow-sm active:scale-95">🦮 散步</button>
          )}
          {particles.map(p => (
            <span key={p.id} className={`absolute pointer-events-none -translate-x-1/2 animate-[petfloat_1.3s_ease-out_forwards] ${p.cls || ''}`} style={{ left: p.x, top: p.y }} aria-hidden="true">{p.text}</span>
          ))}
        </div>

        {/* 給飼主的提示（不是牠在講話） */}
        {notice && (
          <div role="status" aria-live="polite" className="pointer-events-none mt-1 mx-1 px-2.5 py-1 rounded-xl bg-[#38312D]/85 text-white text-[11px] font-bold animate-[petdrop_.25s_ease-out]">{notice}</div>
        )}

        {!loggedIn && (
          <button type="button" onClick={onLogin} className="pointer-events-auto mt-1 text-[10px] font-bold text-[#B88746] underline px-2">登入後照顧紀錄會保存，還能賺點數</button>
        )}


      </div>
      {ghost}
    </div>
  );
}
