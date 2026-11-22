// 毛孩數位分身：資料庫操作。
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { pointsSummary } from '@/lib/report-trust';
import {
  ITEM_BY_SKU, STARTER_SKUS, FREE_FEED_PER_DAY, FREE_FEED_EFFECT, PET_EFFECT, BATH_EFFECT, COOLDOWN_MIN,
  ACTIONS_PER_MINUTE, DAILY_XP_CAP, CHECKIN_POINTS, STREAK_BONUS, WEEKLY_LOGIN_POINTS, DAILY_CARE_POINTS, headKeyFor,
  levelOf, xpForLevel, type Effect, type Slot, SLOTS,
} from '@/lib/vpet/catalog';
import { applyEffect, currentStats, dayKeyTW, gainXp, moodText, prevDayKey, weekKeyTW } from '@/lib/vpet/engine';

const MIN = 60_000;
export class VpetError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}
const isUnique = (e: any) => e?.code === 'P2002';
const todayStartTW = () => new Date(`${dayKeyTW()}T00:00:00+08:00`);

// 每個寵物檔案都有一隻分身；第一次建立時送開局物品
export async function ensureVirtualPets(userId: string) {
  const pets = await prisma.pet.findMany({ where: { ownerId: userId }, select: { id: true, type: true, breed: true, virtualPet: { select: { id: true } } } });
  const missing = pets.filter(p => !p.virtualPet);
  if (missing.length === 0) return;
  await prisma.virtualPet.createMany({
    data: missing.map(p => {
      const species = p.type === 'CAT' ? 'cat' : 'dog';
      return { petId: p.id, userId, species, headKey: headKeyFor(species, p.breed) };
    }),
    skipDuplicates: true,
  });
  await prisma.inventory.createMany({ data: STARTER_SKUS.map(sku => ({ userId, sku, qty: 1 })), skipDuplicates: true });
}

// 連續簽到天數（到昨天或今天為止）
async function checkinStreak(userId: string) {
  const rows = await prisma.pointLedger.findMany({ where: { userId, reason: 'checkin' }, orderBy: { createdAt: 'desc' }, take: 8, select: { refId: true } });
  const days = new Set(rows.map(r => r.refId));
  const today = dayKeyTW();
  let k = days.has(today) ? today : prevDayKey(today);
  let n = 0;
  while (days.has(k) && n < 8) { n++; k = prevDayKey(k); }
  return { streak: n, checkedInToday: days.has(today) };
}

const minutesLeft = (last: Date | null, cooldownMin: number, now: number) =>
  last ? Math.max(0, Math.ceil((last.getTime() + cooldownMin * MIN - now) / MIN)) : 0;

export async function snapshot(userId: string) {
  const now = new Date();
  const today = dayKeyTW(now);
  const [vpets, inv, pts, streak, weekly, careClaimed, todayEvents, reportedToday] = await Promise.all([
    prisma.virtualPet.findMany({ where: { userId }, orderBy: { createdAt: 'asc' }, include: { pet: { select: { name: true, breed: true } }, equipped: true } }),
    prisma.inventory.findMany({ where: { userId, qty: { gt: 0 } }, select: { sku: true, qty: true } }),
    pointsSummary(prisma, userId),
    checkinStreak(userId),
    prisma.pointLedger.findUnique({ where: { userId_reason_refId: { userId, reason: 'weekly_login', refId: weekKeyTW(now) } } }),
    prisma.pointLedger.findUnique({ where: { userId_reason_refId: { userId, reason: 'daily_care', refId: today } } }),
    prisma.petCareEvent.findMany({ where: { userId, dayKey: today }, select: { vpetId: true, type: true, sku: true } }),
    prisma.placeReport.count({ where: { userId, createdAt: { gte: todayStartTW() } } }),
  ]);
  const did = (type: string) => todayEvents.some(e => e.type === type);
  return {
    points: pts.points,
    pending: pts.pending,
    inventory: Object.fromEntries(inv.map(i => [i.sku, i.qty])),
    pets: vpets.map(v => {
      const s = currentStats(v, now);
      const level = levelOf(v.xp);
      const freeFeedsUsed = todayEvents.filter(e => e.vpetId === v.id && e.type === 'feed').length;
      return {
        id: v.id,
        name: v.pet.name,
        breed: v.pet.breed,
        species: v.species,
        headKey: v.headKey,
        stats: { fullness: Math.round(s.fullness), cleanliness: Math.round(s.cleanliness), mood: Math.round(s.mood) },
        status: moodText(s, !!v.memorialAt),
        memorial: !!v.memorialAt,
        sparkle: !!v.sparkleUntil && v.sparkleUntil > now,
        level,
        xp: v.xp,
        xpThisLevel: v.xp - xpForLevel(level),
        xpNextLevel: xpForLevel(level + 1) - xpForLevel(level),
        dailyXpLeft: Math.max(0, DAILY_XP_CAP - (v.dailyXpDate === today ? v.dailyXp : 0)),
        freeFeedsLeft: Math.max(0, FREE_FEED_PER_DAY - freeFeedsUsed),
        cooldown: {
          pet: minutesLeft(v.lastPetAt, COOLDOWN_MIN.pet, now.getTime()),
          play: minutesLeft(v.lastPlayAt, COOLDOWN_MIN.play, now.getTime()),
          bath: minutesLeft(v.lastBathAt, COOLDOWN_MIN.bath, now.getTime()),
        },
        equipped: Object.fromEntries(v.equipped.map(e => [e.slot, e.sku])),
      };
    }),
    rewards: {
      checkedInToday: streak.checkedInToday,
      streak: streak.streak,
      // 下一次簽到是連續第幾天（1–7 循環）可得的點數
      nextCheckin: CHECKIN_POINTS + (STREAK_BONUS[(streak.streak % 7) + 1] ?? 0),
      weeklyClaimed: !!weekly,
      care: { feed: did('feed') || did('use'), pet: did('pet'), play: did('play'), report: reportedToday > 0, claimed: !!careClaimed },
    },
  };
}

// ---- 照顧 ----
export type ActionKind = 'feed' | 'use' | 'play' | 'pet' | 'bath';

export async function doAction(userId: string, vpetId: string, action: ActionKind, sku?: string) {
  const recent = await prisma.petCareEvent.count({ where: { userId, createdAt: { gte: new Date(Date.now() - MIN) } } });
  if (recent >= ACTIONS_PER_MINUTE) throw new VpetError('動作太快了，休息一下再來', 429);

  const now = new Date();
  const today = dayKeyTW(now);
  return prisma.$transaction(async (tx) => {
    const v = await tx.virtualPet.findFirst({ where: { id: vpetId, userId } });
    if (!v) throw new VpetError('找不到這隻毛孩', 404);
    if (v.memorialAt && action !== 'pet') throw new VpetError('紀念模式下只能摸摸牠');

    let effect: Effect;
    const patch: Prisma.VirtualPetUpdateManyMutationInput = {};
    const stats = currentStats(v, now);
    const cd = (last: Date | null, m: number) => last && now.getTime() - last.getTime() < m * MIN;

    if (action === 'feed') {
      if (stats.fullness >= 95) throw new VpetError('已經吃飽了');
      const used = await tx.petCareEvent.count({ where: { vpetId, type: 'feed', dayKey: today } });
      if (used >= FREE_FEED_PER_DAY) throw new VpetError('今天的免費飼料吃完了，可以用罐罐或零食');
      effect = FREE_FEED_EFFECT;
    } else if (action === 'use') {
      const item = sku ? ITEM_BY_SKU[sku] : undefined;
      if (!item || !item.consumable) throw new VpetError('這個物品不能使用', 400);
      if (item.species && item.species !== v.species) throw new VpetError(`${item.name}只適合${item.species === 'cat' ? '貓咪' : '狗狗'}`);
      if (item.category === 'food' && stats.fullness >= 95) throw new VpetError('已經吃飽了');
      const taken = await tx.inventory.updateMany({ where: { userId, sku: item.sku, qty: { gte: 1 } }, data: { qty: { decrement: 1 } } });
      if (taken.count !== 1) throw new VpetError(`沒有${item.name}了，可以到商店買`);
      effect = item.effect || {};
      if (effect.sparkleHours) patch.sparkleUntil = new Date(now.getTime() + effect.sparkleHours * 3_600_000);
      if (item.category === 'care') patch.lastBathAt = now;
    } else if (action === 'play') {
      const item = sku ? ITEM_BY_SKU[sku] : undefined;
      if (!item || item.category !== 'toy') throw new VpetError('要選一個玩具', 400);
      if (item.species && item.species !== v.species) throw new VpetError(`${item.name}只適合${item.species === 'cat' ? '貓咪' : '狗狗'}`);
      const own = await tx.inventory.findUnique({ where: { userId_sku: { userId, sku: item.sku } } });
      if (!own || own.qty < 1) throw new VpetError(`還沒有${item.name}`);
      if (cd(v.lastPlayAt, COOLDOWN_MIN.play)) throw new VpetError('剛玩過，讓牠休息一下');
      effect = item.effect || {};
      patch.lastPlayAt = now;
    } else if (action === 'pet') {
      if (cd(v.lastPetAt, COOLDOWN_MIN.pet)) throw new VpetError('剛摸過囉，等一下再摸');
      effect = PET_EFFECT;
      patch.lastPetAt = now;
    } else if (action === 'bath') {
      if (cd(v.lastBathAt, COOLDOWN_MIN.bath)) throw new VpetError('今天已經洗過澡了');
      effect = BATH_EFFECT;
      patch.lastBathAt = now;
    } else {
      throw new VpetError('不支援的動作', 400);
    }

    // 紀念模式下不改寫數值（凍結），只累積親密度
    const next = v.memorialAt ? {} : applyEffect(stats, effect);
    const xp = gainXp(v, effect.xp ?? 0, today);
    // 樂觀鎖：同時有兩個操作時，只有一個會成功
    const updated = await tx.virtualPet.updateMany({
      where: { id: v.id, version: v.version },
      data: { ...patch, ...next, lastTickAt: now, xp: xp.xp, dailyXp: xp.dailyXp, dailyXpDate: xp.dailyXpDate, version: { increment: 1 } },
    });
    if (updated.count !== 1) throw new VpetError('動作太快了，請再試一次');
    await tx.petCareEvent.create({ data: { vpetId: v.id, userId, type: action, sku: sku ?? null, dayKey: today } });
    return { gainedXp: xp.gained };
  });
}

// ---- 商店 ----
export async function buy(userId: string, sku: string, qty: number, requestId: string) {
  const item = ITEM_BY_SKU[sku];
  if (!item || item.price <= 0) throw new VpetError('這個商品沒有販售', 400);
  const n = item.consumable ? Math.max(1, Math.min(10, Math.floor(qty) || 1)) : 1;
  const total = item.price * n;
  // 耐久品一個帳號只能買一次：用固定的 refId，重複購買會撞唯一鍵
  const refId = item.consumable ? `req:${requestId}` : `item:${sku}`;
  try {
    await prisma.$transaction(async (tx) => {
      if (!item.consumable) {
        const own = await tx.inventory.findUnique({ where: { userId_sku: { userId, sku } } });
        if (own && own.qty > 0) throw new VpetError('已經有了');
      }
      await tx.pointLedger.create({ data: { userId, amount: -total, reason: 'purchase', refId, status: 'granted' } });
      // 只扣已入帳的點數；點數不夠就整筆取消
      const paid = await tx.user.updateMany({ where: { id: userId, points: { gte: total } }, data: { points: { decrement: total } } });
      if (paid.count !== 1) throw new VpetError(`點數不夠，需要 ${total} 點（確認中的點數入帳後才能用）`);
      await tx.inventory.upsert({
        where: { userId_sku: { userId, sku } },
        create: { userId, sku, qty: n },
        update: { qty: item.consumable ? { increment: n } : 1 },
      });
    });
  } catch (e: any) {
    if (isUnique(e)) {
      if (!item.consumable) throw new VpetError('已經有了');
      return { replay: true, bought: 0, spent: 0 }; // 同一個請求重送：視為已完成
    }
    throw e;
  }
  return { replay: false, bought: n, spent: total };
}

export async function equip(userId: string, vpetId: string, slot: Slot, sku: string | null) {
  if (!SLOTS.includes(slot)) throw new VpetError('部位錯誤', 400);
  const v = await prisma.virtualPet.findFirst({ where: { id: vpetId, userId }, select: { id: true } });
  if (!v) throw new VpetError('找不到這隻毛孩', 404);
  if (!sku) {
    await prisma.virtualPetEquip.deleteMany({ where: { vpetId, slot } });
    return;
  }
  const item = ITEM_BY_SKU[sku];
  if (!item || item.category !== 'wear' || item.slot !== slot) throw new VpetError('這件不能穿在這裡', 400);
  const own = await prisma.inventory.findUnique({ where: { userId_sku: { userId, sku } } });
  if (!own || own.qty < 1) throw new VpetError(`還沒有${item.name}`);
  await prisma.virtualPetEquip.upsert({ where: { vpetId_slot: { vpetId, slot } }, create: { vpetId, slot, sku }, update: { sku } });
}

// ---- 簽到與任務 ----
async function grant(userId: string, reason: string, refId: string, amount: number) {
  if (!(amount > 0)) throw new Error('grant 只能加點');
  try {
    await prisma.$transaction([
      prisma.pointLedger.create({ data: { userId, amount, reason, refId, status: 'granted' } }),
      prisma.user.update({ where: { id: userId }, data: { points: { increment: amount } } }),
    ]);
    return amount;
  } catch (e) {
    if (isUnique(e)) return 0; // 已經領過
    throw e;
  }
}

export async function claim(userId: string, kind: 'checkin' | 'daily_care') {
  const today = dayKeyTW();
  if (kind === 'checkin') {
    const { streak, checkedInToday } = await checkinStreak(userId);
    if (checkedInToday) throw new VpetError('今天已經簽到過了');
    const day = (streak % 7) + 1; // 第 1–7 天循環
    const got = await grant(userId, 'checkin', today, CHECKIN_POINTS + (STREAK_BONUS[day] ?? 0));
    if (got === 0) throw new VpetError('今天已經簽到過了');
    const weekly = await grant(userId, 'weekly_login', weekKeyTW(), WEEKLY_LOGIN_POINTS);
    return { got: got + weekly, day, weekly: weekly > 0 };
  }
  const snap = await snapshot(userId);
  const c = snap.rewards.care;
  if (c.claimed) throw new VpetError('今天的任務獎勵已經領過了');
  if (!(c.feed && c.pet && c.play && c.report)) throw new VpetError('還有任務沒完成');
  const got = await grant(userId, 'daily_care', today, DAILY_CARE_POINTS);
  if (got === 0) throw new VpetError('今天的任務獎勵已經領過了');
  return { got };
}

// 紀念模式：只凍結數值，不改寫數值（避免開開關關把餓肚子洗成飽飽）；每天只能切換一次
export async function setMemorial(userId: string, vpetId: string, on: boolean) {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const v = await tx.virtualPet.findFirst({ where: { id: vpetId, userId } });
    if (!v) throw new VpetError('找不到這隻毛孩', 404);
    if (!!v.memorialAt === on) return;
    try {
      await tx.rewardClaim.create({ data: { userId, kind: `memorial:${vpetId}`, periodKey: dayKeyTW(now) } });
    } catch (e) {
      if (isUnique(e)) throw new VpetError('紀念模式每天只能切換一次');
      throw e;
    }
    // 開啟：把到現在為止的變化先算進去再凍結；關閉：從凍結時的數值繼續，紀念期間不算飢餓
    const frozen = on ? currentStats(v, now) : {};
    const updated = await tx.virtualPet.updateMany({
      where: { id: v.id, version: v.version },
      data: { ...frozen, memorialAt: on ? now : null, lastTickAt: now, version: { increment: 1 } },
    });
    if (updated.count !== 1) throw new VpetError('請再試一次');
  });
}

// 每天第一次回報店家：送一份肉乾零食（補足點數 7 天才入帳的空窗）
export async function giveReportTreat(userId: string): Promise<boolean> {
  try {
    await prisma.$transaction([
      prisma.rewardClaim.create({ data: { userId, kind: 'report_treat', periodKey: dayKeyTW() } }),
      prisma.inventory.upsert({ where: { userId_sku: { userId, sku: 'jerky' } }, create: { userId, sku: 'jerky', qty: 1 }, update: { qty: { increment: 1 } } }),
    ]);
    return true;
  } catch (e) {
    if (!isUnique(e)) console.error('[vpet] 送零食失敗', (e as any)?.message);
    return false;
  }
}
