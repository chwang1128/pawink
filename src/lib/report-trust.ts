// 飼主回報的可信度計算與點數確認。
//
// - 只統計近 12 個月的回報
// - 每票有權重：新帳號（註冊未滿 7 天）或回報常被多數推翻的人權重較低；現場回報權重較高
// - 至少 3 人回報才給結論；加權後一方占 2/3 以上才算「多數」，否則「意見分歧」
// - 點數先「確認中」，7 天後若沒被多數推翻才入帳
import type { Prisma, PrismaClient } from '@prisma/client';
import { FLAG_WINDOW_DAYS, FLAGS_TO_WARN, MIN_REPORTS_FOR_CONCLUSION, REPORT_WINDOW_DAYS } from '@/lib/report-questions';

type Db = PrismaClient | Prisma.TransactionClient;
const DAY = 86_400_000;

export interface QuestionTally {
  yes: number; no: number; onSite: number; lastAt: string | null;
  verdict: 'yes' | 'no' | 'mixed' | 'insufficient';
  flagged: boolean;
}

const verdictOf = (wYes: number, wNo: number, count: number): QuestionTally['verdict'] => {
  if (count < MIN_REPORTS_FOR_CONCLUSION) return 'insufficient';
  const total = wYes + wNo;
  if (total <= 0) return 'insufficient';
  if (wYes / total >= 2 / 3) return 'yes';
  if (wNo / total >= 2 / 3) return 'no';
  return 'mixed';
};

// 每位回報者的權重
async function voterWeights(db: Db, userIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!userIds.length) return out;
  const users = await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, createdAt: true } });
  const voids = await db.pointLedger.groupBy({ by: ['userId'], where: { userId: { in: userIds }, reason: 'report', status: 'void' }, _count: { _all: true } });
  const voidCount = new Map(voids.map(v => [v.userId, v._count._all]));
  for (const u of users) {
    let w = 1;
    if (Date.now() - u.createdAt.getTime() < 7 * DAY) w = 0.5; // 新帳號
    if ((voidCount.get(u.id) ?? 0) >= 3) w = 0.3; // 常被多數推翻
    out.set(u.id, w);
  }
  return out;
}

export async function tallyFor(db: Db, placeId: string, keys: string[]): Promise<Record<string, QuestionTally>> {
  const since = new Date(Date.now() - REPORT_WINDOW_DAYS * DAY);
  const rows = await db.placeReport.findMany({
    where: { placeId, question: { in: keys }, updatedAt: { gte: since } },
    select: { userId: true, question: true, answer: true, onSite: true, updatedAt: true },
  });
  const flags = await db.placeReportFlag.groupBy({
    by: ['question'],
    where: { placeId, question: { in: keys }, createdAt: { gte: new Date(Date.now() - FLAG_WINDOW_DAYS * DAY) } },
    _count: { _all: true },
  });
  const flagCount = new Map(flags.map(f => [f.question, f._count._all]));
  const weights = await voterWeights(db, Array.from(new Set(rows.map(r => r.userId))));

  const out: Record<string, QuestionTally> = {};
  for (const k of keys) {
    const rs = rows.filter(r => r.question === k);
    let wYes = 0, wNo = 0, lastAt: string | null = null;
    for (const r of rs) {
      const w = (weights.get(r.userId) ?? 1) * (r.onSite ? 1.5 : 1);
      if (r.answer) wYes += w; else wNo += w;
      const at = r.updatedAt.toISOString();
      if (!lastAt || at > lastAt) lastAt = at;
    }
    out[k] = {
      yes: rs.filter(r => r.answer).length,
      no: rs.filter(r => !r.answer).length,
      onSite: rs.filter(r => r.onSite).length,
      lastAt,
      verdict: verdictOf(wYes, wNo, rs.length),
      flagged: (flagCount.get(k) ?? 0) >= FLAGS_TO_WARN,
    };
  }
  return out;
}

// 到期的確認中點數：回報還在、且沒有被多數推翻 → 入帳；否則取消
export async function settlePendingPoints(db: PrismaClient, userId: string): Promise<void> {
  const due = await db.pointLedger.findMany({
    where: { userId, status: 'pending', availableAt: { lte: new Date() } },
    select: { id: true, amount: true, refId: true },
  });
  for (const e of due) {
    const report = e.refId ? await db.placeReport.findUnique({ where: { id: e.refId } }) : null;
    let ok = !!report;
    if (report) {
      const t = (await tallyFor(db, report.placeId, [report.question]))[report.question];
      const overturned = (report.answer && t.verdict === 'no') || (!report.answer && t.verdict === 'yes');
      ok = !overturned;
    }
    await db.$transaction(async (tx) => {
      // 用狀態當條件更新，避免同時結算兩次
      const changed = await tx.pointLedger.updateMany({ where: { id: e.id, status: 'pending' }, data: { status: ok ? 'granted' : 'void' } });
      if (changed.count === 1 && ok) await tx.user.update({ where: { id: userId }, data: { points: { increment: e.amount } } });
    });
  }
}

export async function pointsSummary(db: PrismaClient, userId: string) {
  await settlePendingPoints(db, userId);
  const me = await db.user.findUnique({ where: { id: userId }, select: { points: true } });
  const pending = await db.pointLedger.aggregate({ where: { userId, status: 'pending' }, _sum: { amount: true } });
  return { points: me?.points ?? 0, pending: pending._sum.amount ?? 0 };
}
