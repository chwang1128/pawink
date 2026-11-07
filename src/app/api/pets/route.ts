import { NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { parsePetInput, toProfile } from '@/lib/pet-input';
import { createPet, listPets, MAX_PETS_PER_OWNER } from '@/lib/pets';

export const dynamic = 'force-dynamic';

// 目前登入者的寵物清單
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: '請先登入' }, { status: 401 });
  try {
    const pets = await listPets(userId);
    return NextResponse.json({ pets: pets.map(toProfile) });
  } catch (err: any) {
    console.error('[api/pets] 讀取失敗', err?.message);
    return NextResponse.json({ error: '暫時無法讀取寵物檔案' }, { status: 503 });
  }
}

// 新增寵物
export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: '請先登入' }, { status: 401 });

  const parsed = parsePetInput(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const existing = await listPets(userId);
    if (existing.length >= MAX_PETS_PER_OWNER) {
      return NextResponse.json({ error: `每個帳號最多 ${MAX_PETS_PER_OWNER} 隻毛孩` }, { status: 409 });
    }
    const pet = await createPet(userId, parsed.data);
    return NextResponse.json({ pet: toProfile(pet) }, { status: 201 });
  } catch (err: any) {
    console.error('[api/pets] 新增失敗', err?.message);
    return NextResponse.json({ error: '暫時無法儲存寵物檔案' }, { status: 503 });
  }
}
