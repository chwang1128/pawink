import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { parsePetInput, toProfile } from '@/lib/pet-input';
import { updatePet } from '@/lib/pets';

export const dynamic = 'force-dynamic';

// 更新自己的寵物
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: '請先登入' }, { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ error: '找不到這隻毛孩' }, { status: 404 });

  const parsed = parsePetInput(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const pet = await updatePet(userId, params.id, parsed.data);
    if (!pet) return NextResponse.json({ error: '找不到這隻毛孩' }, { status: 404 });
    return NextResponse.json({ pet: toProfile(pet) });
  } catch (err: any) {
    console.error('[api/pets/:id] 更新失敗', err?.message);
    return NextResponse.json({ error: '暫時無法儲存寵物檔案' }, { status: 503 });
  }
}
