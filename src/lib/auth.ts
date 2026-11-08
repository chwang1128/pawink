import type { NextAuthOptions } from 'next-auth';
import { getServerSession } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import LineProvider from 'next-auth/providers/line';
import { PrismaAdapter } from '@next-auth/prisma-adapter';
import { prisma } from '@/lib/prisma';

// 只啟用已設定憑證的登入方式（例如只設了 Google 時，畫面上就只出現 Google）
const providers: NextAuthOptions['providers'] = [];
if (process.env.LINE_CLIENT_ID && process.env.LINE_CLIENT_SECRET) {
  providers.push(
    LineProvider({
      clientId: process.env.LINE_CLIENT_ID,
      clientSecret: process.env.LINE_CLIENT_SECRET,
    }),
  );
}
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  );
}

export const enabledProviders = providers.map((p) => p.id);

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers,
  // 用 JWT 保存登入狀態，每次請求不必查資料庫；使用者與綁定的帳號仍存在資料庫
  session: { strategy: 'jwt' },
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    session({ session, token }) {
      if (session.user && token.sub) (session.user as any).id = token.sub;
      return session;
    },
  },
};

// 取得目前登入者的 ID；未登入、或登入功能尚未設定（缺 NEXTAUTH_SECRET）時回傳 null
export async function getCurrentUserId(): Promise<string | null> {
  if (!process.env.NEXTAUTH_SECRET) return null;
  try {
    const session = await getServerSession(authOptions);
    return ((session?.user as any)?.id as string | undefined) ?? null;
  } catch (err: any) {
    console.error('[auth] 讀取登入狀態失敗', err?.message);
    return null;
  }
}
