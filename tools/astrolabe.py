"""把星璃帧里的星盘拆出来：返回（去掉星盘的帧, 星盘蒙版, 星盘中心, 被星盘压住而需要补的像素数）。
做法：金棕色连通块定位星盘 → 用 idle 第 1 帧（星盘与头发之间有空隙）的星盘外形做模板，对齐到每帧 →
模板范围内除了肤色（托盘的手）和与身体连通的部分都算星盘 → 星盘原先压住的发梢/指尖用邻近像素补上（每帧 200–500px，原稿尺度）。"""
import numpy as np, cv2
from scipy import ndimage as ndi
def _cls(fr):
    al = fr[..., 3] > 24; r, g, b = [fr[..., k].astype(int) for k in range(3)]
    gold = al & (r > g + 15) & (g > b + 15) & (r > 90) & (r - b > 55)
    skin = al & (r > 170) & (g > 115) & (b > 100) & (r - b < 115)
    return al, gold, skin
def _box(fr):
    al, gold, skin = _cls(fr); W = fr.shape[1]; x1 = np.where(al)[1].max()
    lab, _ = ndi.label(ndi.binary_dilation(gold & ~skin, iterations=2)); sel = gold & ~skin & (np.arange(W)[None, :] > x1 - 60)
    ids = np.unique(lab[sel]); ids = ids[ids > 0]; core = (lab == ids[int(np.argmax([(lab == k).sum() for k in ids]))]) & gold
    xr = np.where(core)[1].max(); top = np.where(core[:, xr - 60:xr - 30].any(axis=1))[0].min()
    return xr, top, core
def template(fr):
    al, gold, skin = _cls(fr); xr, top, core = _box(fr)
    m = np.zeros_like(al); m[top - 3:top + 132, xr - 101:xr + 10] = True; m &= al & ~skin
    lab, _ = ndi.label(m); m = lab == np.bincount(lab[core & m]).argmax()
    return m[top - 6:top + 136, xr - 104:xr + 14]
def split(fr, T):
    al, gold, skin = _cls(fr); xr, top, core = _box(fr); H, W = T.shape; FH, FW = al.shape
    Tf = np.zeros_like(al); y0, x0 = top - 6, xr - 104; ys = slice(max(0, y0), min(FH, y0 + H)); xs = slice(max(0, x0), min(FW, x0 + W))
    Tf[ys, xs] = T[ys.start - y0:ys.stop - y0, xs.start - x0:xs.stop - x0]
    hull = ndi.binary_fill_holes(ndi.binary_closing(Tf, iterations=5)) | ndi.binary_dilation(Tf, iterations=3)
    bx = np.zeros_like(al); bx[ys, xs] = True
    seed = al & ~bx; body = ndi.binary_propagation(seed, mask=(al & ~(hull & bx)) | seed) | (skin & al)
    astro = al & bx & ~body
    lab, n = ndi.label(astro)
    if n > 1:
        main = lab == np.bincount(lab[astro & core]).argmax(); near = ndi.binary_dilation(main, iterations=6); astro = np.isin(lab, np.unique(lab[near & astro])) & astro
    body = al & ~astro
    lab, n = ndi.label(body); sz = np.bincount(lab.ravel()); small = np.isin(lab, np.where(sz < 700)[0]) & body; astro |= small; body &= ~small   # 甩出去的流苏尾、珠子
    fill = ndi.binary_closing(np.pad(body, 12), iterations=8)[12:-12, 12:-12] & astro
    out = fr.copy(); out[astro & ~fill] = 0
    if fill.any():
        rgb = cv2.inpaint(np.ascontiguousarray(fr[..., :3]), (astro.astype(np.uint8)) * 255, 4, cv2.INPAINT_TELEA)
        out[fill, :3] = rgb[fill]; out[fill, 3] = 255
    return out, astro, (xr - 48, top + 62), int(fill.sum())

def present(fr):
    """帧里是否画了星盘：角色最右侧 110px 内、上半身高度的金棕色像素够多才算。"""
    al, gold, skin = _cls(fr); ys, xs = np.where(al); x1 = xs.max(); top, h = ys.min(), ys.max() - ys.min()
    m = gold & ~skin; m[:, :max(0, x1 - 110)] = False; m[top + int(h * 0.5):] = False
    return int(m.sum()) > 2500
def palm(fr):
    """摊开的右手：上半身里最靠右的那一小块。返回（掌心 x, 掌面顶端 y）。"""
    al = fr[..., 3] > 24; ys, xs = np.where(al); top, h = ys.min(), ys.max() - ys.min()
    up = al.copy(); up[top + int(h * 0.6):] = False; x1 = np.where(up)[1].max()
    hand = up[:, x1 - 34:x1 + 1]; return x1 - 4, int(np.where(hand)[0].min())
