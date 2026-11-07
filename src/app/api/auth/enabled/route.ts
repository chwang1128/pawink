import { NextResponse } from 'next/server';
import { enabledProviders } from '@/lib/auth';

// 每次請求時讀取環境變數，設定登入憑證後重新部署即生效
export const dynamic = 'force-dynamic';

// 前端用來決定要顯示哪些登入按鈕，以及資料庫是否已設定（未設定時不顯示登入）
export function GET() {
  const databaseReady = !!process.env.DATABASE_URL && !!process.env.DIRECT_URL && !!process.env.NEXTAUTH_SECRET;
  return NextResponse.json({ providers: databaseReady ? enabledProviders : [] });
}
