// 由座標判斷所在的「縣市＋鄉鎮市區」。資料是內政部鄉鎮市區界線（見 src/data/README.md），
// 不使用 Google 地圖的地址，避免把 Google 地圖內容拿到 Google 地圖以外使用。
import topo from '@/data/tw-towns.topo.json';

type Ring = [number, number][];
interface Town { county: string; town: string; polys: Ring[][]; box: [number, number, number, number] }

let towns: Town[] | null = null;

function load(): Town[] {
  if (towns) return towns;
  const t: any = topo;
  const [sx, sy] = t.transform.scale;
  const [tx, ty] = t.transform.translate;
  const arcs: Ring[] = t.arcs.map((a: number[][]) => {
    let x = 0, y = 0;
    return a.map(([dx, dy]) => { x += dx; y += dy; return [x * sx + tx, y * sy + ty] as [number, number]; });
  });
  const arc = (i: number) => (i >= 0 ? arcs[i] : arcs[~i].slice().reverse());
  const ring = (idx: number[]): Ring => idx.flatMap((i, k) => (k ? arc(i).slice(1) : arc(i)));
  towns = t.objects.towns.geometries.map((g: any) => {
    const polys: Ring[][] = (g.type === 'Polygon' ? [g.arcs] : g.type === 'MultiPolygon' ? g.arcs : []).map((p: number[][]) => p.map(ring));
    const pts = polys.flat(2);
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    return { county: g.properties.c, town: g.properties.t, polys, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
  });
  return towns!;
}

function inRing(x: number, y: number, r: Ring) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// 回傳例如「台北市大安區」；在海上或境外回傳 null
export function townOfPoint(lat: number, lng: number): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  for (const t of load()) {
    const [x0, y0, x1, y1] = t.box;
    if (lng < x0 || lng > x1 || lat < y0 || lat > y1) continue;
    // 多邊形：第一圈是外框，其餘是洞
    if (t.polys.some(p => inRing(lng, lat, p[0]) && !p.slice(1).some(h => inRing(lng, lat, h)))) return (t.county + t.town).replace(/臺/g, '台');
  }
  return null;
}
