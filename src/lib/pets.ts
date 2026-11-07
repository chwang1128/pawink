import { prisma } from '@/lib/prisma';
import { nextVaccineDue, type PetData } from '@/lib/pet-input';

const withLatestVaccine = { vaccines: { orderBy: { administeredAt: 'desc' as const }, take: 1 } };

export function listPets(ownerId: string) {
  return prisma.pet.findMany({ where: { ownerId }, orderBy: { createdAt: 'asc' }, include: withLatestVaccine });
}

// 疫苗：和最近一筆相同就不重複新增，不同則新增一筆（保留施打紀錄）
async function recordVaccine(petId: string, data: PetData) {
  if (!data.vaccineName || !data.vaccineLastDate) return;
  const latest = await prisma.vaccineRecord.findFirst({ where: { petId }, orderBy: { administeredAt: 'desc' } });
  if (latest && latest.vaccineName === data.vaccineName && latest.administeredAt.getTime() === data.vaccineLastDate.getTime()) {
    return;
  }
  await prisma.vaccineRecord.create({
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

export async function createPet(ownerId: string, data: PetData) {
  const pet = await prisma.pet.create({ data: { ownerId, ...petFields(data) } });
  await recordVaccine(pet.id, data);
  return prisma.pet.findUniqueOrThrow({ where: { id: pet.id }, include: withLatestVaccine });
}

// 只能更新自己的寵物；不是自己的或不存在回傳 null
export async function updatePet(ownerId: string, petId: string, data: PetData) {
  const { count } = await prisma.pet.updateMany({ where: { id: petId, ownerId }, data: petFields(data) });
  if (count === 0) return null;
  await recordVaccine(petId, data);
  return prisma.pet.findUniqueOrThrow({ where: { id: petId }, include: withLatestVaccine });
}

// 每位飼主最多建立的寵物數，避免被灌資料
export const MAX_PETS_PER_OWNER = 10;
