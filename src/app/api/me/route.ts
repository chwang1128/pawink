import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUserId } from '@/lib/auth';
import { cookies } from 'next/headers';
import { adoptAnonReports, pointsSummary } from '@/lib/report-trust';
import { ANON_COOKIE } from '@/lib/report-questions';

// 目前登入者的點數：points 已入帳、pending 確認中（7 天後入帳）
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ loggedIn: false, points: null, pending: 0 });
  try {
    // 登入前用這個瀏覽器做的回報，移到帳號底下（不補發點數）
    const anon = cookies().get(ANON_COOKIE)?.value;
    const adopted = anon && /^[0-9a-f-]{36}$/.test(anon) ? await adoptAnonReports(prisma, userId, anon) : 0;
    const res = NextResponse.json({ loggedIn: true, adopted, ...(await pointsSummary(prisma, userId)) });
    if (anon) res.cookies.delete(ANON_COOKIE);
    return res;
  } catch (e: any) {
    console.error('[api/me] 讀取失敗', e?.message);
    return NextResponse.json({ loggedIn: true, points: null, pending: 0 }, { status: 500 });
  }
}
