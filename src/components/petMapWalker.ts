// 毛孩出門散步：在 Google 地圖上放一個會走動的小毛孩（OverlayView）。
// 位置用經緯度記錄，所以地圖拖動、縮放時牠會留在原地；走路速度以螢幕像素計，任何縮放看起來都差不多快。

// eat＝在店家門口聞一聞；run＝被叫回來時快跑
export interface WalkerSprites { walk: string; idle: string; eat: string; petted: string; run: string; sit: string; scratch: string; tilt: string }
export interface WalkerStop { lat: number; lng: number; name: string }
export interface Walker {
  recall(containerX: number, containerY: number): Promise<void>;
  panTo(): void;
  destroy(): void;
}

const R = 111_320; // 每度緯度約幾公尺

export function createWalker(opts: {
  map: any;
  start: { lat: number; lng: number }; // 從哪裡走進地圖（左下角毛孩的位置）
  home?: { lat: number; lng: number }; // 在哪附近散步（預設：出發點）
  sprites: WalkerSprites;
  name: string;
  getStops: () => WalkerStop[];
  onPet?: () => void;
}): Walker {
  const google = (window as any).google;
  const { map, sprites } = opts;
  const home = { ...(opts.home ?? opts.start) };
  let pos = { ...opts.start };
  let raf = 0;
  let timer = 0;
  let alive = true;
  let recalling = false;
  let facing = 1;

  const mpp = () => (156543.03392 * Math.cos((pos.lat * Math.PI) / 180)) / Math.pow(2, map.getZoom() || 15);
  const metersTo = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
    const dy = (b.lat - a.lat) * R;
    const dx = (b.lng - a.lng) * R * Math.cos((a.lat * Math.PI) / 180);
    return { dx, dy, d: Math.hypot(dx, dy) };
  };

  class PetOverlay extends google.maps.OverlayView {
    div: HTMLDivElement | null = null;
    img: HTMLImageElement | null = null;
    onAdd() {
      const div = document.createElement('div');
      div.style.cssText = 'position:absolute;width:64px;height:58px;transform:translate(-50%,-100%);cursor:pointer;pointer-events:auto;';
      div.setAttribute('role', 'button');
      div.setAttribute('aria-label', `${opts.name} 正在散步，點一下摸摸牠`);
      div.innerHTML = `
        <div style="position:absolute;left:8px;right:8px;bottom:-3px;height:8px;border-radius:50%;background:rgba(56,49,45,.22);filter:blur(2px)"></div>
        <img data-i alt="" draggable="false" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;object-position:bottom;filter:drop-shadow(0 3px 3px rgba(0,0,0,.2))" />`;
      this.div = div;
      this.img = div.querySelector('[data-i]');
      google.maps.OverlayView.preventMapHitsAndGesturesFrom(div);
      div.addEventListener('click', (e) => { e.stopPropagation(); pet(); });
      this.getPanes().overlayMouseTarget.appendChild(div);
      setPose('idle');
    }
    draw() {
      const p = this.getProjection()?.fromLatLngToDivPixel(new google.maps.LatLng(pos.lat, pos.lng));
      if (p && this.div) { this.div.style.left = `${p.x}px`; this.div.style.top = `${p.y}px`; }
    }
    onRemove() { this.div?.remove(); this.div = null; }
  }
  const ov = new PetOverlay();
  ov.setMap(map);

  // 圖片原本朝向：walk、eat 朝右；idle 朝左；petted 正面
  const NATIVE: Record<keyof WalkerSprites, number> = { walk: 1, eat: 1, idle: -1, petted: 0, run: 1, sit: 0, scratch: 0, tilt: 0 };
  function setPose(p: keyof WalkerSprites) {
    if (!ov.img) return;
    if (!ov.img.src.endsWith(sprites[p])) ov.img.src = sprites[p];
    const n = NATIVE[p];
    ov.img.style.transform = n !== 0 && n !== facing ? 'scaleX(-1)' : '';
    ov.img.style.animation = p === 'walk' || p === 'run' ? 'petwalk .32s ease-in-out infinite' : '';
  }
  let gait: 'walk' | 'run' = 'walk';
  let moving = false;
  function hearts() {
    if (!ov.div) return;
    for (let i = 0; i < 3; i++) {
      const h = document.createElement('span');
      h.textContent = '❤';
      h.style.cssText = `position:absolute;left:${20 + i * 12}px;top:-6px;color:#E46B6B;font-size:14px;animation:petfloat 1.2s ease-out forwards;pointer-events:none`;
      ov.div.appendChild(h);
      window.setTimeout(() => h.remove(), 1300);
    }
  }

  // 走到某個點（螢幕速度 px/s）
  function walkTo(target: { lat: number; lng: number }, pxPerSec: number) {
    return new Promise<void>((resolve) => {
      cancelAnimationFrame(raf);
      let last = performance.now();
      const step = (now: number) => {
        if (!alive) return resolve();
        const dt = Math.min(0.1, (now - last) / 1000); last = now;
        const { dx, dy, d } = metersTo(pos, target);
        const stepM = pxPerSec * mpp() * dt;
        const f = Math.abs(dx) > 0.5 ? Math.sign(dx) : facing;
        if (f !== facing) { facing = f; setPose(gait); }
        if (d <= stepM) { pos = { ...target }; ov.draw(); moving = false; return resolve(); }
        pos = { lat: pos.lat + (dy / d) * stepM / R, lng: pos.lng + (dx / d) * stepM / (R * Math.cos((pos.lat * Math.PI) / 180)) };
        ov.draw();
        raf = requestAnimationFrame(step);
      };
      gait = pxPerSec > 150 ? 'run' : 'walk';
      moving = true;
      setPose(gait);
      raf = requestAnimationFrame(step);
    });
  }
  const wait = (ms: number) => new Promise<void>((r) => { timer = window.setTimeout(r, ms); });

  // 散步：在出發點附近亂走，偶爾去附近的店家門口聞一聞
  async function wander() {
    await wait(300);
    // 先跑到散步的地方
    if (metersTo(pos, home).d > 5) await walkTo(home, 140);
    while (alive && !recalling) {
      const m = mpp();
      const stops = opts.getStops().filter((s) => metersTo(home, s).d < 700 * m && metersTo(home, s).d > 30);
      let target: { lat: number; lng: number };
      let atStop: WalkerStop | null = null;
      if (stops.length && Math.random() < 0.35) {
        atStop = stops[Math.floor(Math.random() * stops.length)];
        target = { lat: atStop.lat, lng: atStop.lng };
      } else {
        // 離出發點不超過約 350 像素
        const ang = Math.random() * Math.PI * 2;
        const dist = (80 + Math.random() * 180) * m;
        let t = { lat: pos.lat + (Math.sin(ang) * dist) / R, lng: pos.lng + (Math.cos(ang) * dist) / (R * Math.cos((pos.lat * Math.PI) / 180)) };
        if (metersTo(home, t).d > 350 * m) t = { lat: (t.lat + home.lat) / 2, lng: (t.lng + home.lng) / 2 };
        target = t;
      }
      await walkTo(target, 46);
      if (!alive || recalling) break;
      if (atStop) {
        // 在店家門口低頭聞一聞
        setPose('eat');
        await wait(2800);
      } else {
        const r = Math.random();
        setPose(r < 0.3 ? 'eat' : r < 0.5 ? 'sit' : r < 0.65 ? 'tilt' : r < 0.75 ? 'scratch' : 'idle');
        await wait(1500 + Math.random() * 2500);
      }
    }
  }

  function pet() {
    if (recalling) return;
    hearts();
    setPose('petted');
    window.setTimeout(() => { if (alive && !recalling) setPose(moving ? gait : 'idle'); }, 1200);
    opts.onPet?.();
  }

  wander();

  return {
    async recall(cx: number, cy: number) {
      if (recalling) return;
      recalling = true;
      window.clearTimeout(timer);
      const ll = ov.getProjection()?.fromContainerPixelToLatLng(new google.maps.Point(cx, cy));
      if (ll) await walkTo({ lat: ll.lat(), lng: ll.lng() }, 380);
      alive = false;
      ov.setMap(null);
    },
    panTo() { map.panTo(pos); },
    destroy() { alive = false; cancelAnimationFrame(raf); window.clearTimeout(timer); ov.setMap(null); },
  };
}
