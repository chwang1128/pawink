import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { nextVaccineDue, type PetData } from '@/lib/pet-input';

const withLatestVaccine = { vaccines: { orderBy: { administeredAt: 'desc' as const }, take: 1 } };

export function listPets(ownerId: string) {
  return prisma.pet.findMany({ where: { ownerId }, orderBy: { createdAt: 'asc' }, include: withLatestVaccine });
}

// 疫苗紀錄（只在已確認寵物屬於目前使用者的交易中呼叫，不對外匯出）：
// - 和最近一筆完全相同：不動
// - 施打日相同、名稱不同：視為修正錯字，更新最近那一筆
// - 施打日不同：新增一筆，保留施打歷史
async function recordVaccine(tx: Prisma.TransactionClient, petId: string, data: PetData) {
  if (!data.vaccineName || !data.vaccineLastDate) return;
  const latest = await tx.vaccineRecord.findFirst({ where: { petId }, orderBy: { administeredAt: 'desc' } });
  const sameDate = latest && latest.administeredAt.getTime() === data.vaccineLastDate.getTime();
  if (sameDate && latest!.vaccineName === data.vaccineName) return;
  if (sameDate) {
    await tx.vaccineRecord.update({ where: { id: latest!.id }, data: { vaccineName: data.vaccineName } });
    return;
  }
  await tx.vaccineRecord.create({
    data: {
      petId,
      vaccineName: data.vaccineName,
      administeredAt: data.vaccineLastDate,
      nextDueDate: nextVaccineDue(data.vaccineLastDate),
    },
  });
}

const petFields = (d: PetData) => ({
  name: d.name,
  type: d.type,
  breed: d.breed,
  birthday: d.birthday,
  weightKg: d.weightKg,
  notes: d.notes,
  medBrand: d.medBrand,
  medLastDate: d.medLastDate,
});

// 寵物與疫苗紀錄在同一個交易中寫入，避免只寫進一半
export function createPet(ownerId: string, data: PetData) {
  return prisma.$transaction(async (tx) => {
    const pet = await tx.pet.create({ data: { ownerId, ...petFields(data) } });
    await recordVaccine(tx, pet.id, data);
    return tx.pet.findUniqueOrThrow({ where: { id: pet.id }, include: withLatestVaccine });
  });
}

// 只能更新自己的寵物；不是自己的或不存在回傳 null（交易內先確認所有權，才寫疫苗紀錄）
export function updatePet(ownerId: string, petId: string, data: PetData) {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.pet.updateMany({ where: { id: petId, ownerId }, data: petFields(data) });
    if (count === 0) return null;
    await recordVaccine(tx, petId, data);
    return tx.pet.findUniqueOrThrow({ where: { id: petId }, include: withLatestVaccine });
  });
}

// 帳號已被刪除、但瀏覽器的登入憑證還沒過期時，寫入會違反外鍵（P2003）
export const isMissingOwnerError = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003';

// 每位飼主最多建立的寵物數，避免被灌資料（軟性上限，不防同時送出的請求）
export const MAX_PETS_PER_OWNER = 10;
