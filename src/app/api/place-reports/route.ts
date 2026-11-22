import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUserId } from '@/lib/auth';
import {
  DAILY_REPORT_POINTS_CAP, POINTS_PER_REPORT, REPORTS_PER_MINUTE, isReportKind, questionsFor, type ReportKind,
} from '@/lib/report-questions';

// 飼主回報
// GET  ?placeId=&kind=  → 題目、各題統計（是／否人數、最近回報時間）、我自己的回答
// POST { placeId, kind, question, answer } → 需登入；同一店同一題第一次回答給點（每天上限），改答案不給點

const PLACE_ID = /^[A-Za-z0-9_-]{10,300}$/;
const todayStartTW = () => {
  const now = new Date(Date.now() + 8 * 3600_000);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 8 * 3600_000);
};

async function summary(placeId: string, kind: ReportKind, userId: string | null) {
  const questions = questionsFor(kind);
  const keys = questions.map(q => q.key);
  const grouped = await prisma.placeReport.groupBy({
    by: ['question', 'answer'],
    where: { placeId, question: { in: keys } },
    _count: { _all: true },
    _max: { updatedAt: true },
  });
  const tally: Record<string, { yes: number; no: number; lastAt: string | null }> = {};
  for (const k of keys) tally[k] = { yes: 0, no: 0, lastAt: null };
  for (const g of grouped) {
    const t = tally[g.question];
    if (!t) continue;
    if (g.answer) t.yes = g._count._all; else t.no = g._count._all;
    const at = g._max.updatedAt?.toISOString() ?? null;
    if (at && (!t.lastAt || at > t.lastAt)) t.lastAt = at;
  }
  let mine: Record<string, boolean> = {};
  if (userId) {
    const rows = await prisma.placeReport.findMany({ where: { placeId, userId, question: { in: keys } }, select: { question: true, answer: true } });
    mine = Object.fromEntries(rows.map(r => [r.question, r.answer]));
  }
  return { questions, tally, mine, loggedIn: !!userId };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const placeId = searchParams.get('placeId') || '';
  const kind = searchParams.get('kind');
  if (!PLACE_ID.test(placeId) || !isReportKind(kind)) return NextResponse.json({ error: '參數錯誤' }, { status: 400 });
  try {
    return NextResponse.json(await summary(placeId, kind, await getCurrentUserId()));
  } catch (e: any) {
    console.error('[api/place-reports] 讀取失敗', e?.message);
    return NextResponse.json({ error: '飼主回報暫時無法讀取' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: '請先登入' }, { status: 401 });
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: '參數錯誤' }, { status: 400 }); }
  const { placeId, kind, question, answer } = body || {};
  if (typeof placeId !== 'string' || !PLACE_ID.test(placeId) || !isReportKind(kind) || typeof answer !== 'boolean'
    || !questionsFor(kind).some(q => q.key === question)) {
    return NextResponse.json({ error: '參數錯誤' }, { status: 400 });
  }

  try {
    // 防洗版：一分鐘內送出太多次就先擋下
    const recent = await prisma.placeReport.count({ where: { userId, updatedAt: { gte: new Date(Date.now() - 60_000) } } });
    if (recent >= REPORTS_PER_MINUTE) return NextResponse.json({ error: '回報太快了，請稍後再試' }, { status: 429 });

    const result = await prisma.$transaction(async (tx) => {
      // 鎖住這位使用者，讓同時送出的回報排隊計算每日點數，避免超過上限
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      const existing = await tx.placeReport.findUnique({ where: { placeId_userId_question: { placeId, userId, question } } });
      if (existing) {
        if (existing.answer !== answer) await tx.placeReport.update({ where: { id: existing.id }, data: { answer } });
        return { awarded: 0, capped: false };
      }
      const created = await tx.placeReport.create({ data: { placeId, userId, question, answer } });
      // 每天（台灣時間）從回報拿到的點數上限；回答數量不限
      const earned = await tx.pointLedger.aggregate({
        where: { userId, reason: 'report', createdAt: { gte: todayStartTW() } },
        _sum: { amount: true },
      });
      const room = DAILY_REPORT_POINTS_CAP - (earned._sum.amount ?? 0);
      const awarded = Math.max(0, Math.min(POINTS_PER_REPORT, room));
      if (awarded > 0) {
        await tx.pointLedger.create({ data: { userId, amount: awarded, reason: 'report', refId: created.id } });
        await tx.user.update({ where: { id: userId }, data: { points: { increment: awarded } } });
      }
      return { awarded, capped: awarded < POINTS_PER_REPORT };
    });
    const me = await prisma.user.findUnique({ where: { id: userId }, select: { points: true } });
    return NextResponse.json({ ...(await summary(placeId, kind, userId)), ...result, points: me?.points ?? null });
  } catch (e: any) {
    // 兩個請求同時送出時，唯一鍵衝突：視為已回答
    if (e?.code === 'P2002') return NextResponse.json({ ...(await summary(placeId, kind, userId)), awarded: 0, capped: false });
    console.error('[api/place-reports] 寫入失敗', e?.message);
    return NextResponse.json({ error: '回報暫時無法送出' }, { status: 500 });
  }
}
