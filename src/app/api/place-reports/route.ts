import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUserId } from '@/lib/auth';
import {
  DAILY_REPORT_POINTS_CAP, FLAG_MIN_ACCOUNT_DAYS, ON_SITE_METERS, POINTS_PENDING_DAYS, POINTS_PER_REPORT, REFRESH_SAME_ANSWER_DAYS, REPORTS_PER_MINUTE,
  isReportKind, questionsFor, type ReportKind,
} from '@/lib/report-questions';
import { pointsSummary, tallyFor } from '@/lib/report-trust';
import { verifyLocationToken } from '@/lib/places';

// 飼主回報
// GET  ?placeId=&kind=  → 題目、各題統計與結論、我的回答與我按過的「可能已改變」
// POST { placeId, kind, question, answer, here?, place? } → 回答是／否（需登入）
//      第一次回答給點，但先「確認中」，7 天後沒被多數推翻才入帳；每天上限 20 點
// POST { placeId, kind, question, action: 'flag' } → 反映「這題可能已改變」（需登入）

const PLACE_ID = /^[A-Za-z0-9_-]{10,300}$/;
const DAY = 86_400_000;
const todayStartTW = () => {
  const now = new Date(Date.now() + 8 * 3600_000);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 8 * 3600_000);
};
const isLatLng = (v: any) => v && Number.isFinite(v.lat) && Number.isFinite(v.lng) && Math.abs(v.lat) <= 90 && Math.abs(v.lng) <= 180;
const metersBetween = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6371000, r = (x: number) => (x * Math.PI) / 180;
  const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

async function summary(placeId: string, kind: ReportKind, userId: string | null) {
  const questions = questionsFor(kind);
  const keys = questions.map(q => q.key);
  const tally = await tallyFor(prisma, placeId, keys);
  let mine: Record<string, boolean> = {};
  let myFlags: string[] = [];
  if (userId) {
    const rows = await prisma.placeReport.findMany({ where: { placeId, userId, question: { in: keys } }, select: { question: true, answer: true } });
    mine = Object.fromEntries(rows.map(r => [r.question, r.answer]));
    myFlags = (await prisma.placeReportFlag.findMany({ where: { placeId, userId, question: { in: keys } }, select: { question: true } })).map(f => f.question);
  }
  return { questions, tally, mine, myFlags, loggedIn: !!userId };
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
  const { placeId, kind, question, answer, action } = body || {};
  if (typeof placeId !== 'string' || !PLACE_ID.test(placeId) || !isReportKind(kind) || !questionsFor(kind).some(q => q.key === question)) {
    return NextResponse.json({ error: '參數錯誤' }, { status: 400 });
  }

  try {
    // 防洗版：一分鐘內送出太多次就先擋下
    const since = new Date(Date.now() - 60_000);
    const recent = await prisma.placeReport.count({ where: { userId, updatedAt: { gte: since } } })
      + await prisma.placeReportFlag.count({ where: { userId, createdAt: { gte: since } } });
    if (recent >= REPORTS_PER_MINUTE) return NextResponse.json({ error: '回報太快了，請稍後再試' }, { status: 429 });

    if (action === 'flag') {
      // 註冊未滿 7 天的帳號不能反映，避免開小號洗「可能已改變」
      const me = await prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true } });
      if (!me || Date.now() - me.createdAt.getTime() < FLAG_MIN_ACCOUNT_DAYS * DAY) {
        return NextResponse.json({ error: `註冊滿 ${FLAG_MIN_ACCOUNT_DAYS} 天後才能反映「可能已改變」` }, { status: 403 });
      }
      await prisma.placeReportFlag.upsert({
        where: { placeId_question_userId: { placeId, question, userId } },
        create: { placeId, question, userId },
        update: { createdAt: new Date() },
      });
      return NextResponse.json({ ...(await summary(placeId, kind, userId)), flagged: true });
    }

    if (typeof answer !== 'boolean') return NextResponse.json({ error: '參數錯誤' }, { status: 400 });
    // 現場回報：店家座標必須是本站搜尋時簽發的（防偽造），只比對距離，不保存任何位置
    const onSite = isLatLng(body.here) && isLatLng(body.place)
      && verifyLocationToken(placeId, body.place.lat, body.place.lng, body.place.token)
      && metersBetween(body.here, body.place) <= ON_SITE_METERS;

    const result = await prisma.$transaction(async (tx) => {
      // 鎖住這位使用者，讓同時送出的回報排隊計算每日點數，避免超過上限
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      const existing = await tx.placeReport.findUnique({ where: { placeId_userId_question: { placeId, userId, question } } });
      if (existing) {
        if (existing.answer !== answer) {
          await tx.placeReport.update({ where: { id: existing.id }, data: { answer, onSite } });
        } else if (Date.now() - existing.updatedAt.getTime() >= REFRESH_SAME_ANSWER_DAYS * DAY) {
          // 同樣的答案隔 30 天以上再按：更新時間，表示最近仍然如此（避免一直按來延長有效期）
          await tx.placeReport.update({ where: { id: existing.id }, data: { answer, onSite: existing.onSite || onSite } });
        }
        return { awarded: 0, capped: false };
      }
      const created = await tx.placeReport.create({ data: { placeId, userId, question, answer, onSite } });
      // 每天（台灣時間）從回報拿到的點數上限（含確認中）；回答數量不限
      const earned = await tx.pointLedger.aggregate({
        where: { userId, reason: 'report', status: { in: ['pending', 'granted'] }, createdAt: { gte: todayStartTW() } },
        _sum: { amount: true },
      });
      const room = DAILY_REPORT_POINTS_CAP - (earned._sum.amount ?? 0);
      const awarded = Math.max(0, Math.min(POINTS_PER_REPORT, room));
      if (awarded > 0) {
        await tx.pointLedger.create({
          data: { userId, amount: awarded, reason: 'report', refId: created.id, status: 'pending', availableAt: new Date(Date.now() + POINTS_PENDING_DAYS * DAY) },
        });
      }
      return { awarded, capped: awarded < POINTS_PER_REPORT };
    });
    return NextResponse.json({ ...(await summary(placeId, kind, userId)), ...result, onSite, ...(await pointsSummary(prisma, userId)) });
  } catch (e: any) {
    // 兩個請求同時送出時，唯一鍵衝突：視為已回答
    if (e?.code === 'P2002') return NextResponse.json({ ...(await summary(placeId, kind, userId)), awarded: 0, capped: false });
    console.error('[api/place-reports] 寫入失敗', e?.message);
    return NextResponse.json({ error: '回報暫時無法送出' }, { status: 500 });
  }
}
