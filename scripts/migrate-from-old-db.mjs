// 一次性：把舊資料庫（Supabase）的資料複製到新資料庫（Neon）。
//
// 何時執行：只在 Vercel 部署、且設定了 MIGRATE_FROM_DATABASE_URL 時（建置步驟中、db-sync 建好資料表之後）。
// 來源：MIGRATE_FROM_DATABASE_URL（舊資料庫）；目的地：DIRECT_URL（新資料庫，不經連線池）。
// 可以重複執行：已存在的資料（相同主鍵）會略過，不會覆蓋或刪除任何東西。
// 密碼只存在 Vercel 環境變數裡，記錄只印出各資料表筆數。
import { PrismaClient } from '@prisma/client';

const from = process.env.MIGRATE_FROM_DATABASE_URL;
const to = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!from) {
  console.log('[migrate] 未設定 MIGRATE_FROM_DATABASE_URL，略過');
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
