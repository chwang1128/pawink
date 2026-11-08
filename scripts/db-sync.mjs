// 部署時把 prisma/schema.prisma 同步到資料庫（Supabase），並對所有資料表開啟 RLS。
//
// 何時執行：
// - Production 部署：執行
// - Preview 部署：預設不執行，避免 PR 的預覽版改到正式資料庫的結構；
//   需要時在 Vercel 的 Preview 環境變數設 ALLOW_PREVIEW_DB_SYNC=1（例如資料庫還是空的、第一次建表時）
// - 未設定 DATABASE_URL 或 DIRECT_URL：略過
//
// 正式上線、有真實資料後，應改用 prisma migrate（遷移檔）以保留變更紀錄，並讓 Preview 使用獨立的資料庫。
import { execSync } from 'node:child_process';

const env = process.env.VERCEL_ENV; // production | preview | development | undefined（本機）
if (!process.env.DATABASE_URL || !process.env.DIRECT_URL) {
  console.log('[db-sync] 未設定 DATABASE_URL 或 DIRECT_URL，略過');
  process.exit(0);
}
if (env === 'preview' && process.env.ALLOW_PREVIEW_DB_SYNC !== '1') {
  console.log('[db-sync] Preview 部署預設不變更資料庫結構，略過（需要時設 ALLOW_PREVIEW_DB_SYNC=1）');
  process.exit(0);
}

// 不加 --accept-data-loss：若變更會刪除資料，指令會失敗並中止部署，而不是默默刪資料
execSync('npx prisma db push --skip-generate', { stdio: 'inherit' });

// Supabase 會把 public schema 的資料表自動開放在 Data API（REST）。
// 對每張表開啟 RLS 且不建立任何 policy：Data API 的 anon / authenticated 角色一律讀寫不到；
// Prisma 以資料表擁有者身分連線，不受 RLS 影響，網站照常運作。
const enableRls = `
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
  END LOOP;
END $$;`;
execSync('npx prisma db execute --stdin --schema prisma/schema.prisma', { input: enableRls, stdio: ['pipe', 'inherit', 'inherit'] });
console.log('[db-sync] 已對 public schema 的所有資料表開啟 RLS');
