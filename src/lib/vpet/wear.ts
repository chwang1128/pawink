// 穿搭：每件配件都有 17 個姿勢各一張「圖層」（public/pet/wear/<sku>/<pose>.webp），直接疊在毛孩圖上。
// 圖層怎麼來：把 17 個姿勢拼成一張（art/shiba_pose_sheet.png）給 ChatGPT 一次全部穿上，
// 再跟原本的狗對齊比對，只摳出多出來的配件（scratchpad 的 extract.py）。
// 每件配件只要生一次圖；好幾件可以一起穿，依 z 由小到大疊。

export interface WearArt { z: number }

export const WEAR: Record<string, WearArt> = {
  backpack: { z: 1 },
  bell_collar: { z: 2 },
  bandana_red: { z: 3 },
  round_glasses: { z: 4 },
  beanie: { z: 5 },
  straw_hat: { z: 5 },
};

// 柴犬姿勢圖的原始尺寸
export const POSE_SIZE: Record<string, [number, number]> = {
  bark: [340, 341], beg: [225, 350], belly: [329, 277], eat: [423, 320], hungry: [415, 247], idle: [351, 409], petted: [372, 381],
  play: [367, 403], run: [343, 300], scratch: [313, 343], shake: [283, 336], sit: [263, 336], sleep: [512, 365], sniff: [350, 297],
  stretch: [512, 381], tilt: [261, 353], walk: [409, 384],
};

// 圖層比姿勢圖每邊多留的邊（配件可能超出狗的範圍，例如帽子的毛球）。
// 拼圖時每格 256x341、狗縮放到 (206, 291) 內，摳圖時每邊多留 60px，換回原尺寸就是 60 / 縮放比
const padOf = (w: number, h: number) => 60 / Math.min(206 / w, 291 / h);

// 算出每張圖層在「毛孩圖片框」裡的位置（框內 img 是 object-contain、靠下對齊）
export function wearLayout(pose: string, skus: string[], boxW: number, boxH: number) {
  const size = POSE_SIZE[pose];
  if (!size) return [];
  const [iw, ih] = size;
  const k = Math.min(boxW / iw, boxH / ih);
  const dw = iw * k, dh = ih * k;
  const ox = (boxW - dw) / 2, oy = boxH - dh;
  const m = padOf(iw, ih) * k;
  return skus
    .filter(sku => WEAR[sku])
    .sort((a, b) => WEAR[a].z - WEAR[b].z)
    .map(sku => ({ sku, img: `/pet/wear/${sku}/${pose}.webp`, left: ox - m, top: oy - m, width: dw + 2 * m, height: dh + 2 * m }));
}
