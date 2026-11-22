// 一次性：把舊資料庫（Supabase）的資料複製到新資料庫（Neon）。
//
// 何時執行：Vercel 環境變數 MIGRATE_FROM_OLD_DB=1 時（建置步驟中、db-sync 在新資料庫建好資料表之後）。
// 來源：DIRECT_URL（原本給 Supabase 用的連線網址，搬家期間保留）；目的地：DATABASE_URL（已改成 Neon）。
// 可以重複執行：已存在的資料（相同主鍵）會略過，不會覆蓋或刪除任何東西。
// 密碼只存在 Vercel 環境變數裡，記錄只印出各資料表筆數。
import { PrismaClient } from '@prisma/client';

const from = process.env.DIRECT_URL;
const to = process.env.DATABASE_URL;
if (process.env.MIGRATE_FROM_OLD_DB !== '1') {
  console.log('[migrate] 未設定 MIGRATE_FROM_OLD_DB=1，略過');
  process.exit(0);
}
if (!from) {
  console.log('[migrate] 找不到舊資料庫連線（DIRECT_URL），略過');
  process.exit(0);
}
if (!to || from === to) {
  console.log('[migrate] 目的地資料庫未設定，或與來源相同，略過');
  process.exit(0);
}

const src = new PrismaClient({ datasources: { db: { url: from } } });
const dst = new PrismaClient({ datasources: { db: { url: to } } });

// 依關聯順序：先有使用者，才有帳號、寵物、商家…
const MODELS = ['user', 'account', 'session', 'verificationToken', 'pet', 'vaccineRecord', 'merchant', 'service', 'appointment', 'usageCounter'];

try {
  for (const m of MODELS) {
    const rows = await src[m].findMany();
    if (!rows.length) {
      console.log(`[migrate] ${m}: 0 筆`);
      continue;
    }
    const res = await dst[m].createMany({ data: rows, skipDuplicates: true });
    console.log(`[migrate] ${m}: 來源 ${rows.length} 筆，新增 ${res.count} 筆`);
  }
  console.log('[migrate] 完成');
} catch (e) {
  // 搬資料失敗就讓部署失敗，避免預覽站用到不完整的資料
  console.error('[migrate] 失敗：', e?.message);
  process.exit(1);
} finally {
  await src.$disconnect();
  await dst.$disconnect();
}
