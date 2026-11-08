import './globals.css';
import type { Metadata, Viewport } from 'next';
import Providers from '@/components/Providers';

export const metadata: Metadata = {
  title: 'Pawink 寵物生態系平台',
  description: '全台一站式寵物生活生態系平台 (B2C & B2B)',
};

// 手機鍵盤打開時縮小版面，讓底部的對話輸入框留在鍵盤上方
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // 沿用原本的設定：地圖用雙指縮放，關閉整頁縮放避免互相干擾
  maximumScale: 1,
  userScalable: false,
  interactiveWidget: 'resizes-content',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-TW">
      <body className="bg-slate-100 text-slate-800 font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
