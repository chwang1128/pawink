import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';

// 每日用量上限（以台灣時間的日期計）。資料庫出錯時一律拒絕，避免費用失控。
// IP 只存加鹽雜湊，不存原始 IP。
const dayTW = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

export function clientKey(req: Request): string {
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
  const salt = process.env.NEXTAUTH_SECRET || 'pawink';
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 24);
}

// 先檢查再加一；超過任一上限就回 false
export async function takeDailyQuota(feature: string, client: string, perClient: number, total: number): Promise<boolean> {
  const day = dayTW();
  const allKey = `${feature}:${day}:all`;
  const clientKeyName = `${feature}:${day}:ip:${client}`;
  try {
    const rows = await prisma.usageCounter.findMany({ where: { key: { in: [allKey, clientKeyName] } } });
    const used = (k: string) => rows.find(r => r.key === k)?.count ?? 0;
    if (used(allKey) >= total || used(clientKeyName) >= perClient) return false;
    await prisma.$transaction([
      prisma.usageCounter.upsert({ where: { key: allKey }, create: { key: allKey, count: 1 }, update: { count: { increment: 1 } } }),
      prisma.usageCounter.upsert({ where: { key: clientKeyName }, create: { key: clientKeyName, count: 1 }, update: { count: { increment: 1 } } }),
    ]);
    return true;
  } catch (e: any) {
    console.error('[usage-limit] 無法檢查用量，暫停此功能', e?.message);
    return false;
  }
}
