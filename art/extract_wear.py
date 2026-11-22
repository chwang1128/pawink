# 用法：python3 art/extract_wear.py <穿好配件的拼圖.png> <sku> public/pet/wear public/pet/shiba [去雜點次數=2] [最小區塊比例=0.15] [差異門檻=55]
# 從「穿好配件的 17 姿勢拼圖」摳出配件圖層：
# 每格先把 ChatGPT 的狗對齊到原本的狗（ECC 仿射對位），再比對顏色差異，只留下多出來的部分（配件）。
# 輸出每個姿勢一張跟原姿勢圖同尺寸的透明圖層，前端直接疊在原圖上即可。
import sys, os, numpy as np, cv2
from PIL import Image
from scipy import ndimage

POSES = ['idle','petted','eat','play','walk','hungry','sleep','stretch','sit','tilt','sniff','belly','shake','beg','run','bark','scratch']
dressed_path, sku, outdir, shiba = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
# 細的配件（眼鏡）不能做太強的去雜點，不然細框會被吃掉
OPEN_IT = int(sys.argv[5]) if len(sys.argv) > 5 else 2
MIN_FRAC = float(sys.argv[6]) if len(sys.argv) > 6 else 0.15
THRESH = float(sys.argv[7]) if len(sys.argv) > 7 else 55
W, H, cols, rows = 1536, 1024, 6, 3
cw, ch = W // cols, H // rows
D = Image.open(dressed_path).convert('RGB').resize((W, H), Image.LANCZOS)
D = np.array(D).astype(np.float32)
os.makedirs(f'{outdir}/{sku}', exist_ok=True)
report = []
for i, p in enumerate(POSES):
    spr = Image.open(f'{shiba}/{p}.webp').convert('RGBA')
    ow, oh = spr.size
    s = min((cw - 50) / ow, (ch - 50) / oh)
    sw, sh = int(ow * s), int(oh * s)
    x0 = (i % cols) * cw + (cw - sw) // 2; y0 = (i // cols) * ch + (ch - sh) // 2
    # 原圖放大回原尺寸的座標：在 cell 內工作，再換算
    cx0, cy0 = (i % cols) * cw, (i // cols) * ch
    O = np.ones((ch, cw, 3), np.float32) * 255
    small = np.array(spr.resize((sw, sh), Image.LANCZOS)).astype(np.float32)
    a = small[..., 3:4] / 255
    ox, oy = x0 - cx0, y0 - cy0
    O[oy:oy + sh, ox:ox + sw] = small[..., :3] * a + O[oy:oy + sh, ox:ox + sw] * (1 - a)
    Ocell_alpha = np.zeros((ch, cw), np.float32); Ocell_alpha[oy:oy + sh, ox:ox + sw] = small[..., 3] / 255
    Dc = D[cy0:cy0 + ch, cx0:cx0 + cw].copy()
    # 對位：用灰階 ECC，模型仿射
    g1 = cv2.cvtColor(O.astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32) / 255
    g2 = cv2.cvtColor(Dc.astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32) / 255
    warp = np.eye(2, 3, dtype=np.float32)
    try:
        cc, warp = cv2.findTransformECC(g1, g2, warp, cv2.MOTION_AFFINE, (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 300, 1e-6), None, 5)
    except cv2.error:
        cc = -1
    Da = cv2.warpAffine(Dc, warp, (cw, ch), flags=cv2.INTER_LINEAR + cv2.WARP_INVERSE_MAP, borderValue=(255, 255, 255))
    diff = np.sqrt(((Da - O) ** 2).sum(axis=2))
    lum = Da.mean(axis=2); sat = Da.max(axis=2) - Da.min(axis=2)
    notbg = ~((lum > 238) & (sat < 16))
    outside = ndimage.binary_erosion(Ocell_alpha < 0.5, iterations=3)  # 原本是背景的地方：多出來的東西都算
    mask = notbg & (outside | (diff > THRESH))
    if OPEN_IT: mask = ndimage.binary_opening(mask, iterations=OPEN_IT)
    lab, n = ndimage.label(mask)
    if n:
        sizes = ndimage.sum(mask, lab, range(1, n + 1))
        mask = np.isin(lab, [k + 1 for k, sz in enumerate(sizes) if sz > MIN_FRAC * sizes.max()])
        mask = ndimage.binary_fill_holes(mask)
        mask = ndimage.binary_dilation(mask, iterations=1)
    alpha = ndimage.gaussian_filter(mask.astype(np.float32), 0.7)
    # 換算回原姿勢圖尺寸：取 sprite 區域，放大到 ow x oh
    layer = np.dstack([Da, alpha * 255]).clip(0, 255).astype(np.uint8)
    full = np.zeros((ch + 400, cw + 400, 4), np.uint8)  # 允許配件超出 sprite 範圍
    full[200:200 + ch, 200:200 + cw] = layer
    # sprite 範圍往外留 margin，配件可能突出頭頂
    m = 60
    crop = full[200 + oy - m:200 + oy + sh + m, 200 + ox - m:200 + ox + sw + m]
    img = Image.fromarray(crop).resize((int(crop.shape[1] / s), int(crop.shape[0] / s)), Image.LANCZOS)
    img.save(f'{outdir}/{sku}/{p}.webp', 'WEBP', quality=88, method=6)
    report.append((p, round(float(cc), 3), int(mask.sum())))
print(report)

