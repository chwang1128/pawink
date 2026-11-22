// 穿搭：用「錨點」把配件疊到毛孩身上。
// 每個姿勢只標一次頭、眼睛、脖子、背的位置（anchors.shiba.json），每件配件只畫一張圖（public/pet/wear），
// 程式算出位置、大小、角度後疊上去。之後加新配件不用重畫毛孩；加新品種只要再標一份錨點。
import ANCHORS from './anchors.shiba.json';

export type AnchorKey = 'hat' | 'eyes' | 'neck' | 'back';
export interface Anchor { x: number; y: number; w: number; r: number }

export interface WearArt {
  img: string;
  anchor: AnchorKey;
  px: number; // 配件圖上哪一點要對到錨點（0–1）
  py: number;
  scale: number; // 相對錨點寬度
  z: number; // 疊的順序：小的先畫
}

export const WEAR: Record<string, WearArt> = {
  backpack: { img: '/pet/wear/backpack.webp', anchor: 'back', px: 0.5, py: 0.5, scale: 1.5, z: 1 },
  bandana_red: { img: '/pet/wear/bandana_red.webp', anchor: 'neck', px: 0.5, py: 0.18, scale: 0.8, z: 2 },
  bell_collar: { img: '/pet/wear/bell_collar.webp', anchor: 'neck', px: 0.5, py: 0.25, scale: 1, z: 2 },
  round_glasses: { img: '/pet/wear/round_glasses.webp', anchor: 'eyes', px: 0.5, py: 0.5, scale: 1, z: 3 },
  beanie: { img: '/pet/wear/beanie.webp', anchor: 'hat', px: 0.5, py: 0.88, scale: 1, z: 4 },
  straw_hat: { img: '/pet/wear/straw_hat.webp', anchor: 'hat', px: 0.5, py: 0.85, scale: 1.25, z: 4 },
};

// 配件圖的寬高比（高/寬）
export const WEAR_RATIO: Record<string, number> = {
  backpack: 405 / 441, bandana_red: 393 / 415, bell_collar: 316 / 429, round_glasses: 201 / 460, beanie: 406 / 433, straw_hat: 301 / 489,
};

// 柴犬姿勢圖的原始尺寸（算 object-contain 後的實際位置用）
export const POSE_SIZE: Record<string, [number, number]> = {
  bark: [340, 341], beg: [225, 350], belly: [329, 277], eat: [423, 320], hungry: [415, 247], idle: [351, 409], petted: [372, 381],
  play: [367, 403], run: [343, 300], scratch: [313, 343], shake: [283, 336], sit: [263, 336], sleep: [512, 365], sniff: [350, 297],
  stretch: [512, 381], tilt: [261, 353], walk: [409, 384],
};

export const anchorOf = (pose: string, key: AnchorKey): Anchor | null => {
  const p = (ANCHORS as unknown as Record<string, Record<AnchorKey, Anchor | null>>)[pose];
  return p?.[key] ?? null;
};

// 算出每件配件在「毛孩圖片框」裡的位置（框內 img 是 object-contain、靠下對齊）
export function wearLayout(pose: string, skus: string[], boxW: number, boxH: number) {
  const size = POSE_SIZE[pose];
  if (!size) return [];
  const [iw, ih] = size;
  const s = Math.min(boxW / iw, boxH / ih);
  const dw = iw * s, dh = ih * s;
  const ox = (boxW - dw) / 2, oy = boxH - dh;
  return skus
    .filter(sku => WEAR[sku])
    .sort((a, b) => WEAR[a].z - WEAR[b].z)
    .flatMap(sku => {
      const art = WEAR[sku];
      const a = anchorOf(pose, art.anchor);
      if (!a) return [];
      const w = a.w * dw * art.scale;
      const h = w * (WEAR_RATIO[sku] ?? 1);
      return [{ sku, img: art.img, left: ox + a.x * dw - art.px * w, top: oy + a.y * dh - art.py * h, width: w, height: h, rotate: a.r, origin: `${art.px * 100}% ${art.py * 100}%` }];
    });
}
