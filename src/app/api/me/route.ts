import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUserId } from '@/lib/auth';

// 目前登入者的點數
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ loggedIn: false, points: null });
  try {
    const me = await prisma.user.findUnique({ where: { id: userId }, select: { points: true } });
    return NextResponse.json({ loggedIn: true, points: me?.points ?? 0 });
  } catch (e: any) {
    console.error('[api/me] 讀取失敗', e?.message);
    return NextResponse.json({ loggedIn: true, points: null }, { status: 500 });
  }
}
