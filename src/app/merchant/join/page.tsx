'use client';
import React from 'react';
import Link from 'next/link';
import { Store, Calendar, ArrowRight, ShieldCheck, MapPin, UserCheck, BarChart3 } from 'lucide-react';

export default function MerchantJoinWeb() {
  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      <header className="max-w-7xl mx-auto px-8 h-20 flex items-center justify-between">
        <div className="flex items-center gap-2 font-bold text-2xl text-blue-600">
          🐾 Pawink
        </div>
        <div className="flex items-center gap-4">
          <Link href="/merchant/dashboard" className="px-4 py-2 text-slate-600 font-medium hover:text-blue-600">店家登入</Link>
          <Link href="/merchant/dashboard" className="px-5 py-2.5 bg-blue-600 text-white font-bold rounded-xl shadow-md shadow-blue-500/20">免費加入店家</Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-8 py-12 grid grid-cols-12 gap-12 items-center">
        {/* 左側：三步驟說明 (對應附圖 3) */}
        <div className="col-span-5 flex flex-col gap-8">
          <div>
            <span className="px-3 py-1 bg-blue-50 text-blue-600 text-xs font-bold rounded-full border border-blue-100">加入 Pawink，讓更多毛孩家長找到你</span>
            <h1 className="text-4xl font-extrabold text-slate-900 mt-4 leading-tight">店家免費加入 Pawink</h1>
            <p className="text-slate-500 text-sm mt-2">只要三個步驟，立即建立專屬店家頁，開始接收預約！</p>
          </div>

          <div className="flex flex-col gap-6">
            {[
              { step: '1', title: '建立店家頁', desc: '填寫基本資料，建立專屬店家形象' },
              { step: '2', title: '上架服務與時段', desc: '新增服務項目，設定可預約時段' },
              { step: '3', title: '開始接收預約', desc: '開啟線上預約，輕鬆管理訂單與顧客' },
            ].map((s) => (
              <div key={s.step} className="flex items-start gap-4">
                <div className="w-8 h-8 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center shrink-0">{s.step}</div>
                <div>
                  <h3 className="font-bold text-slate-800">{s.title}</h3>
                  <p className="text-xs text-slate-400 mt-0.5">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <Link href="/merchant/dashboard" className="w-fit px-8 py-4 bg-blue-600 text-white font-bold rounded-2xl shadow-xl shadow-blue-500/20 flex items-center gap-2 hover:bg-blue-700 transition">
            立即免費加入 <ArrowRight className="w-5 h-5" />
          </Link>
        </div>

        {/* 右側：店家 Preview 卡片 (對應附圖 3) */}
        <div className="col-span-7 bg-white p-6 rounded-3xl border border-slate-100 shadow-xl flex flex-col gap-6">
          <div className="relative h-48 bg-blue-100 rounded-2xl overflow-hidden flex items-center justify-center text-5xl">
            🐩
            <div className="absolute top-4 right-4 p-2 bg-white/80 rounded-xl text-xs font-bold backdrop-blur-sm">📷 編輯封面</div>
          </div>

          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">HappyPaws 寵物美容 <ShieldCheck className="w-5 h-5 text-blue-600" /></h2>
              <p className="text-xs text-slate-400 mt-1">4.9 ★★★★★ (126) • 寵物美容 • 台北市大安區</p>
            </div>
            <button className="px-6 py-2.5 bg-blue-600 text-white font-bold rounded-xl shadow-md">預約服務</button>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="p-3 bg-slate-50 rounded-2xl text-xs"><span className="text-slate-400">營業中</span> 10:00 - 20:00</div>
            <div className="p-3 bg-slate-50 rounded-2xl text-xs"><MapPin className="w-3.5 h-3.5 text-blue-600 inline" /> 台北市大安區</div>
            <div className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl text-xs font-bold">CRM 已啟用</div>
          </div>

          {/* 三欄功能底列 (對應附圖 3 最下方) */}
          <div className="grid grid-cols-3 gap-4 border-t border-slate-100 pt-4 text-center">
            <div className="flex flex-col items-center gap-1"><Calendar className="w-5 h-5 text-blue-600" /><span className="text-xs font-bold">預約管理</span></div>
            <div className="flex flex-col items-center gap-1"><UserCheck className="w-5 h-5 text-emerald-600" /><span className="text-xs font-bold">顧客管理</span></div>
            <div className="flex flex-col items-center gap-1"><BarChart3 className="w-5 h-5 text-purple-600" /><span className="text-xs font-bold">數據分析</span></div>
          </div>
        </div>
      </main>
    </div>
  );
}
