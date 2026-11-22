import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { ITEMS, SLOTS, SLOT_NAME } from '@/lib/vpet/catalog';
import { buy, claim, doAction, ensureVirtualPets, equip, setMemorial, snapshot, VpetError, type ActionKind } from '@/lib/vpet/service';

export const dynamic = 'force-dynamic';

// 毛孩數位分身
// GET  → 我的分身、物品、點數、簽到與任務狀態、商品目錄
// POST { op: 'action', vpetId, action: feed|use|play|pet|bath, sku? }
// POST { op: 'buy', sku, qty?, requestId }
// POST { op: 'equip', vpetId, slot, sku|null }
// POST { op: 'claim', kind: checkin|daily_care }
// POST { op: 'memorial', vpetId, on }

const catalog = { items: ITEMS, slots: SLOTS.map(s => ({ key: s, name: SLOT_NAME[s] })) };
const UUID = /^[0-9a-f-]{36}$/i;
const ID = /^[0-9a-f-]{36}$/i;

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ loggedIn: false, catalog });
  try {
    await ensureVirtualPets(userId);
    return NextResponse.json({ loggedIn: true, catalog, ...(await snapshot(userId)) });
  } catch (e: any) {
    console.error('[api/vpet] 讀取失敗', e?.message);
    return NextResponse.json({ error: '暫時無法讀取毛孩' }, { status: 503 });
  }
}

export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: '請先登入' }, { status: 401 });
  const body = await req.json().catch(() => null);
  const op = body?.op;
  try {
    let result: Record<string, unknown> = {};
    if (op === 'action') {
      if (!ID.test(String(body.vpetId))) throw new VpetError('參數錯誤', 400);
      const action = body.action as ActionKind;
      if (!['feed', 'use', 'play', 'pet', 'bath'].includes(action)) throw new VpetError('參數錯誤', 400);
      result = await doAction(userId, body.vpetId, action, typeof body.sku === 'string' ? body.sku : undefined);
    } else if (op === 'buy') {
      if (typeof body.sku !== 'string' || !UUID.test(String(body.requestId))) throw new VpetError('參數錯誤', 400);
      result = await buy(userId, body.sku, Number(body.qty) || 1, body.requestId);
    } else if (op === 'equip') {
      if (!ID.test(String(body.vpetId))) throw new VpetError('參數錯誤', 400);
      await equip(userId, body.vpetId, body.slot, typeof body.sku === 'string' ? body.sku : null);
    } else if (op === 'claim') {
      if (body.kind !== 'checkin' && body.kind !== 'daily_care') throw new VpetError('參數錯誤', 400);
      result = await claim(userId, body.kind);
    } else if (op === 'memorial') {
      if (!ID.test(String(body.vpetId)) || typeof body.on !== 'boolean') throw new VpetError('參數錯誤', 400);
      await setMemorial(userId, body.vpetId, body.on);
    } else {
      throw new VpetError('參數錯誤', 400);
    }
    return NextResponse.json({ ok: true, result, ...(await snapshot(userId)) });
  } catch (e: any) {
    if (e instanceof VpetError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('[api/vpet] 操作失敗', op, e?.message);
    return NextResponse.json({ error: '暫時無法完成，請再試一次' }, { status: 500 });
  }
}
