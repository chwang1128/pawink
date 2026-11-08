import './globals.css';
import type { Metadata } from 'next';
import Providers from '@/components/Providers';

export const metadata: Metadata = {
  title: 'PetHub Taiwan 寵物生態系平台',
  description: '全台一站式寵物生活生態系平台 (B2C & B2B)',
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
