// 部署時把 prisma/schema.prisma 同步到資料庫（Supabase）。
// 尚未設定 DATABASE_URL 與 DIRECT_URL 時跳過，讓還沒接資料庫的部署照常建置。
// 正式上線、有真實資料後，應改用 prisma migrate（遷移檔）以保留變更紀錄。
import { execSync } from 'node:child_process';

if (!process.env.DATABASE_URL || !process.env.DIRECT_URL) {
  console.log('[db-sync] 未設定 DATABASE_URL 或 DIRECT_URL，略過資料表同步');
  process.exit(0);
}

// 不加 --accept-data-loss：若變更會刪除資料，指令會失敗並中止部署，而不是默默刪資料
execSync('npx prisma db push --skip-generate', { stdio: 'inherit' });
