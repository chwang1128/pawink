import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUserId } from '@/lib/auth';
import { pointsSummary } from '@/lib/report-trust';

// 目前登入者的點數：points 已入帳、pending 確認中（7 天後入帳）
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ loggedIn: false, points: null, pending: 0 });
  try {
    return NextResponse.json({ loggedIn: true, ...(await pointsSummary(prisma, userId)) });
  } catch (e: any) {
    console.error('[api/me] 讀取失敗', e?.message);
    return NextResponse.json({ loggedIn: true, points: null, pending: 0 }, { status: 500 });
  }
}
