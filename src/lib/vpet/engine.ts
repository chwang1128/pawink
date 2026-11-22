// 毛孩數位分身：數值計算（純函式，不碰資料庫）。
// 時間一律用伺服器時間；不採用前端傳來的時間。

import { DECAY_PER_HOUR, DAILY_XP_CAP, levelOf, type Effect } from '@/lib/vpet/catalog';

const HOUR = 3_600_000;
const clamp = (n: number) => Math.max(0, Math.min(100, n));

export const dayKeyTW = (d = new Date()) => new Date(d.getTime() + 8 * HOUR).toISOString().slice(0, 10);
// ISO 週（台灣時間），例如 2026-W47
export function weekKeyTW(d = new Date()) {
  const tw = new Date(d.getTime() + 8 * HOUR);
  const t = new Date(Date.UTC(tw.getUTCFullYear(), tw.getUTCMonth(), tw.getUTCDate()));
  const dayNum = t.getUTCDay() || 7; // 週一 = 1 … 週日 = 7
  t.setUTCDate(t.getUTCDate() + 4 - dayNum); // 移到該週的週四
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
export const prevDayKey = (key: string) => {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

export interface Stats { fullness: number; cleanliness: number; mood: number }
interface Ticking extends Stats { lastTickAt: Date; memorialAt: Date | null }

// 依經過時間算出現在的數值（最低 0，不會死）
export function currentStats(p: Ticking, now = new Date()): Stats {
  if (p.memorialAt) return { fullness: 100, cleanliness: 100, mood: 100 };
  const h = Math.max(0, (now.getTime() - p.lastTickAt.getTime()) / HOUR);
  return {
    fullness: clamp(p.fullness - DECAY_PER_HOUR.fullness * h),
    cleanliness: clamp(p.cleanliness - DECAY_PER_HOUR.cleanliness * h),
    mood: clamp(p.mood - DECAY_PER_HOUR.mood * h),
  };
}

export function applyEffect(s: Stats, e: Effect): Stats {
  return {
    fullness: clamp(s.fullness + (e.fullness ?? 0)),
    cleanliness: clamp(s.cleanliness + (e.cleanliness ?? 0)),
    mood: clamp(s.mood + (e.mood ?? 0)),
  };
}

// 每日經驗上限
export function gainXp(p: { xp: number; dailyXp: number; dailyXpDate: string | null }, amount: number, today = dayKeyTW()) {
  const used = p.dailyXpDate === today ? p.dailyXp : 0;
  const gained = Math.max(0, Math.min(amount, DAILY_XP_CAP - used));
  return { xp: p.xp + gained, dailyXp: used + gained, dailyXpDate: today, gained };
}

// 給畫面用的狀態文字（不會死，只會餓、髒、想你）
export function moodText(s: Stats, memorial: boolean): string {
  if (memorial) return '在彩虹橋的那一端，一直陪著你';
  if (s.fullness < 10) return '肚子餓扁了…';
  if (s.cleanliness < 15) return '身上髒髒的，想洗澡';
  if (s.fullness < 30) return '肚子有點餓';
  if (s.mood < 20) return '好想你，陪我玩';
  if (s.cleanliness < 30) return '有點髒了';
  if (s.mood >= 80 && s.fullness >= 60) return '超開心！';
  return '今天也很好';
}

export { levelOf };
