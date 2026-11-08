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

// 一次查詢完成「加一並取回目前次數」（減少資料庫往返）；超過任一上限就回 false
export async function takeDailyQuota(feature: string, client: string, perClient: number, total: number): Promise<boolean> {
  const day = dayTW();
  const allKey = `${feature}:${day}:all`;
  const clientKeyName = `${feature}:${day}:ip:${client}`;
  try {
    const rows = await prisma.$queryRaw<{ key: string; count: number }[]>`
      INSERT INTO "UsageCounter" ("key", "count", "updatedAt")
      VALUES (${allKey}, 1, now()), (${clientKeyName}, 1, now())
      ON CONFLICT ("key") DO UPDATE SET "count" = "UsageCounter"."count" + 1, "updatedAt" = now()
      RETURNING "key", "count"`;
    const used = (k: string) => Number(rows.find(r => r.key === k)?.count ?? Infinity);
    return used(allKey) <= total && used(clientKeyName) <= perClient;
  } catch (e: any) {
    console.error('[usage-limit] 無法檢查用量，暫停此功能', e?.message);
    return false;
  }
}
