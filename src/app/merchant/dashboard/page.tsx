'use client';
import React, { useState } from 'react';
import Link from 'next/link';
import { 
  Store, Scissors, Home as HomeIcon, MapPin, Plus, Calendar, Bell, ChevronLeft
} from 'lucide-react';

export default function MerchantDashboardApp() {
  const [step, setStep] = useState<'role' | 'form' | 'dashboard'>('dashboard');

  return (
    <div className="max-w-md mx-auto min-h-screen bg-slate-50 flex flex-col font-sans pb-10 shadow-2xl">
      {/* 頂部切換選單 */}
      <header className="px-6 py-4 bg-white border-b border-slate-100 flex justify-between items-center">
        <div className="flex items-center gap-2">
          {step !== 'dashboard' && <button onClick={() => setStep('dashboard')}><ChevronLeft className="w-5 h-5" /></button>}
          <span className="font-bold text-slate-800">Pawink 店家中心</span>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setStep('role')} className={`text-xs px-2.5 py-1 rounded-full ${step === 'role' ? 'bg-blue-600 text-white' : 'bg-slate-100'}`}>登入</button>
          <button onClick={() => setStep('form')} className={`text-xs px-2.5 py-1 rounded-full ${step === 'form' ? 'bg-blue-600 text-white' : 'bg-slate-100'}`}>建店</button>
          <button onClick={() => setStep('dashboard')} className={`text-xs px-2.5 py-1 rounded-full ${step === 'dashboard' ? 'bg-blue-600 text-white' : 'bg-slate-100'}`}>看板</button>
        </div>
      </header>

      {/* 畫面 1: 選擇身份與登入 (對應附圖 4 左) */}
      {step === 'role' && (
        <div className="p-6 flex flex-col items-center gap-6 mt-8">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center text-white text-3xl font-bold shadow-lg">🐾</div>
          <div className="text-center">
            <h2 className="text-2xl font-bold text-slate-800">讓更多毛孩家庭找到你的專業服務</h2>
            <p className="text-xs text-slate-400 mt-2">加入 Pawink，輕鬆管理預約、會員與評價。</p>
          </div>
          <button onClick={() => setStep('form')} className="w-full py-4 bg-blue-600 text-white font-bold rounded-2xl shadow-lg">我是店家</button>
          <Link href="/" className="w-full py-4 border border-blue-600 text-blue-600 font-bold rounded-2xl text-center">我是毛孩家長</Link>
        </div>
      )}

      {/* 畫面 2: 快速建立店家頁 (對應附圖 4 中) */}
      {step === 'form' && (
        <div className="p-6 flex flex-col gap-5">
          <h2 className="text-xl font-bold text-slate-800">快速建立店家頁</h2>
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">店家名稱 *</label>
            <input type="text" defaultValue="毛樂園寵物美容" className="w-full bg-white p-3 rounded-xl border border-slate-200 text-sm" />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">服務類別 *</label>
            <div className="grid grid-cols-3 gap-2">
              <button className="p-3 bg-blue-50 border border-blue-600 text-blue-600 font-bold rounded-xl text-xs flex flex-col items-center gap-1"><Scissors className="w-4 h-4" /> 寵物美容</button>
              <button className="p-3 bg-slate-50 border border-slate-200 text-slate-600 rounded-xl text-xs flex flex-col items-center gap-1"><HomeIcon className="w-4 h-4" /> 寵物住宿</button>
              <button className="p-3 bg-slate-50 border border-slate-200 text-slate-600 rounded-xl text-xs flex flex-col items-center gap-1"><Store className="w-4 h-4" /> 更多</button>
            </div>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-700 block mb-1">地址 *</label>
            <div className="flex items-center bg-white p-3 rounded-xl border border-slate-200 text-sm gap-2">
              <MapPin className="w-4 h-4 text-blue-600" />
              <input type="text" defaultValue="台北市大安區忠孝東路四段123號1樓" className="w-full outline-none" />
            </div>
          </div>
          <button onClick={() => setStep('dashboard')} className="w-full py-4 bg-blue-600 text-white font-bold rounded-2xl shadow-lg mt-4">下一步</button>
        </div>
      )}

      {/* 畫面 3: 店家營運 Dashboard (對應附圖 4 右) */}
      {step === 'dashboard' && (
        <div className="p-6 flex flex-col gap-6">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-xl font-bold text-slate-800">早安，毛樂園 👋</h2>
              <p className="text-xs text-slate-400 mt-1">今天是美好的一天，繼續加油！</p>
            </div>
            <Bell className="w-5 h-5 text-slate-600" />
          </div>

          {/* 今日概覽 4 卡片 (對應附圖 4 右上) */}
          <div>
            <span className="text-xs font-bold text-slate-700 block mb-2">今日概覽</span>
            <div className="grid grid-cols-4 gap-2">
              <div className="p-2.5 bg-blue-50 rounded-2xl text-center">
                <span className="text-[10px] text-slate-400 block">預約數</span>
                <span className="text-sm font-bold text-blue-600">8</span>
                <span className="text-[9px] text-blue-500 block">較昨日 +14%</span>
              </div>
              <div className="p-2.5 bg-emerald-50 rounded-2xl text-center">
                <span className="text-[10px] text-slate-400 block">營業額</span>
                <span className="text-sm font-bold text-emerald-600">$12.6k</span>
                <span className="text-[9px] text-emerald-500 block">較昨日 +8%</span>
              </div>
              <div className="p-2.5 bg-purple-50 rounded-2xl text-center">
                <span className="text-[10px] text-slate-400 block">新會員</span>
                <span className="text-sm font-bold text-purple-600">5</span>
                <span className="text-[9px] text-purple-500 block">較昨日 +25%</span>
              </div>
              <div className="p-2.5 bg-amber-50 rounded-2xl text-center">
                <span className="text-[10px] text-slate-400 block">好評數</span>
                <span className="text-sm font-bold text-amber-600">23</span>
                <span className="text-[9px] text-amber-500 block">較昨日 +15%</span>
              </div>
            </div>
          </div>

          {/* 近期預約 (對應附圖 4 中右) */}
          <div>
            <span className="text-xs font-bold text-slate-700 block mb-2">近期預約</span>
            <div className="flex flex-col gap-2">
              {[
                { time: '10:00', name: '美容洗澡 - 黃金獵犬', user: '王小明', status: '已確認', color: 'bg-emerald-100 text-emerald-600' },
                { time: '13:30', name: '住宿 - 貓咪 2 晚', user: '林怡君', status: '待服務', color: 'bg-blue-100 text-blue-600' },
                { time: '15:00', name: '美容洗澡 - 貴賓犬', user: '陳大文', status: '已完成', color: 'bg-slate-100 text-slate-600' },
              ].map((item, idx) => (
                <div key={idx} className="p-3 bg-white border border-slate-100 rounded-2xl flex justify-between items-center text-xs">
                  <div>
                    <span className="font-bold text-slate-800 mr-2">{item.time}</span>
                    <span className="text-slate-600">{item.name} ({item.user})</span>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${item.color}`}>{item.status}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 會員與評論 (對應附圖 4 右下) */}
          <div className="p-4 bg-white border border-slate-100 rounded-3xl flex justify-between items-center">
            <div>
              <span className="text-xs text-slate-400 block">會員總數</span>
              <span className="text-lg font-extrabold text-slate-800">1,286</span>
              <span className="text-[10px] text-blue-500 block">較上月 +12%</span>
            </div>
            <div className="text-right">
              <span className="text-xs text-slate-400 block">平均評分</span>
              <span className="text-lg font-extrabold text-amber-500">4.9 ★★★★★</span>
              <span className="text-[10px] text-slate-400 block">(256 則評論)</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
