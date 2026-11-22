// 飼主回報的可信度計算與點數確認。
//
// - 回報一律保留並列入統計（之後只有合作店家能刪自己店的回報）
// - 每票有權重：新帳號（註冊未滿 7 天）或回報常被多數推翻的人權重較低；現場回報權重較高
// - 至少 MIN_REPORTS_FOR_CONCLUSION 人回報才給結論；加權後一方占 2/3 以上才算「多數」，否則「意見分歧」
// - 點數先「確認中」，7 天後結算：只要相反答案沒有形成多數（2/3），就入帳；
//   回報人數不足或意見分歧都算入帳，避免冷門店家的回報者永遠拿不到點
import type { Prisma, PrismaClient } from '@prisma/client';
import { ANON_WEIGHT, FLAG_WINDOW_DAYS, FLAGS_TO_WARN, MIN_REPORTS_FOR_CONCLUSION, MIN_REPORTS_TO_OVERTURN, ON_SITE_WEIGHT, SETTLE_BATCH } from '@/lib/report-questions';

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
  // 近 90 天的結算結果：被推翻 3 筆以上、且占 30% 以上才降權（給好人復原的機會）
  const recent = await db.pointLedger.groupBy({
    by: ['userId', 'status'],
    where: { userId: { in: userIds }, reason: 'report', status: { in: ['granted', 'void'] }, createdAt: { gte: new Date(Date.now() - 90 * DAY) } },
    _count: { _all: true },
  });
  for (const u of users) {
    let w = 1;
    if (Date.now() - u.createdAt.getTime() < 7 * DAY) w = 0.5; // 新帳號
    const voids = recent.find(r => r.userId === u.id && r.status === 'void')?._count._all ?? 0;
    const granted = recent.find(r => r.userId === u.id && r.status === 'granted')?._count._all ?? 0;
    if (voids >= 3 && voids / (voids + granted) > 0.3) w = 0.3; // 近期常被多數推翻
    out.set(u.id, w);
  }
  return out;
}

export async function tallyFor(db: Db, placeId: string, keys: string[]): Promise<Record<string, QuestionTally>> {
  const rows = await db.placeReport.findMany({
    where: { placeId, question: { in: keys } },
    select: { userId: true, question: true, answer: true, onSite: true, updatedAt: true },
  });
  const flags = await db.placeReportFlag.groupBy({
    by: ['question'],
    where: { placeId, question: { in: keys }, createdAt: { gte: new Date(Date.now() - FLAG_WINDOW_DAYS * DAY) } },
    _count: { _all: true },
  });
  const flagCount = new Map(flags.map(f => [f.question, f._count._all]));
  const weights = await voterWeights(db, Array.from(new Set(rows.map(r => r.userId).filter((u): u is string => !!u))));

  const out: Record<string, QuestionTally> = {};
  for (const k of keys) {
    const rs = rows.filter(r => r.question === k);
    let wYes = 0, wNo = 0, lastAt: string | null = null;
    for (const r of rs) {
      const w = (r.userId ? (weights.get(r.userId) ?? 1) : ANON_WEIGHT) * (r.onSite ? ON_SITE_WEIGHT : 1);
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
    orderBy: { createdAt: 'asc' },
    take: SETTLE_BATCH, // 一次最多結算幾筆，避免一次太多拖慢回應
  });
  for (const e of due) {
    const report = e.refId ? await db.placeReport.findUnique({ where: { id: e.refId } }) : null;
    let ok = !!report;
    if (report) {
      const t = (await tallyFor(db, report.placeId, [report.question]))[report.question];
      // 人數夠多時，相反答案形成多數才算被推翻
      const enough = t.yes + t.no >= MIN_REPORTS_TO_OVERTURN;
      const overturned = enough && ((report.answer && t.verdict === 'no') || (!report.answer && t.verdict === 'yes'));
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

// 未登入時的回報，在登入後移到帳號底下（不補發點數）。已用帳號回答過的同一題，以帳號的答案為準。
export async function adoptAnonReports(db: PrismaClient, userId: string, anonId: string | null | undefined): Promise<number> {
  if (!anonId) return 0;
  const anonKey = `a:${anonId}`;
  const rows = await db.placeReport.findMany({ where: { voterKey: anonKey }, select: { id: true, placeId: true, question: true } });
  let moved = 0;
  for (const r of rows) {
    const taken = await db.placeReport.findUnique({ where: { placeId_voterKey_question: { placeId: r.placeId, voterKey: `u:${userId}`, question: r.question } } });
    if (taken) await db.placeReport.delete({ where: { id: r.id } });
    else { await db.placeReport.update({ where: { id: r.id }, data: { userId, voterKey: `u:${userId}` } }); moved++; }
  }
  return moved;
}
