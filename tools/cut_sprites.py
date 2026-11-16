"""从素材包的战场拆件稿里抠出塔、水晶、小兵的透明图。
用法：python3 tools/cut_sprites.py <素材包 art 目录> <输出目录>
依赖：pip install numpy opencv-python pillow
"""
import sys
import numpy as np
import cv2
from PIL import Image

ART, OUT = sys.argv[1].rstrip('/') + '/', sys.argv[2].rstrip('/') + '/'


def cutout(path, tol, shadow=None, holes=0):
    """从四边向内泛洪去掉纯色背景，返回 RGBA 数组。shadow=(亮度下限, 饱和度上限) 时把与背景连通的灰色投影也去掉。"""
    rgb = np.asarray(Image.open(path).convert('RGB'))
    h, w = rgb.shape[:2]
    bg = np.median(np.concatenate([rgb[2, :], rgb[-3, :], rgb[:, 2], rgb[:, -3]]), axis=0)
    diff = np.abs(rgb.astype(int) - bg).max(axis=2)
    cand = diff <= tol
    if shadow:
        mx, mn = rgb.max(axis=2).astype(int), rgb.min(axis=2).astype(int)
        cand |= (mn >= shadow[0]) & ((mx - mn) <= shadow[1])
    # 只保留与图像边缘连通的候选像素（避免把角色内部的浅色衣物挖空）
    n, lab = cv2.connectedComponents(cand.astype(np.uint8), connectivity=4)
    edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    bgmask = np.isin(lab, edge[edge > 0])
    if holes:  # 被弓弦、手臂等围住的背景块：颜色与背景几乎一致且面积够大才算
        n2, lab2, st2, _ = cv2.connectedComponentsWithStats(((diff <= 6) & ~bgmask).astype(np.uint8), connectivity=4)
        bgmask |= np.isin(lab2, [i for i in range(1, n2) if st2[i][4] >= holes])
    fg = (~bgmask).astype(np.uint8)
    fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    alpha = cv2.GaussianBlur(cv2.erode(fg, np.ones((3, 3), np.uint8)) * 255, (0, 0), 0.8)
    return np.dstack([rgb, alpha]), fg


def parts(fg, min_area):
    """连通部件：返回 (标签图, [(标签, x, y, w, h, 面积)])。"""
    n, lab, st, _ = cv2.connectedComponentsWithStats(fg, connectivity=8)
    return lab, [(i, *[int(v) for v in st[i]]) for i in range(1, n) if st[i][4] >= min_area]


def save(rgba, lab, group, name, hue=None, pad=4, drop_shadow=False):
    """把一组部件（主体 + 悬浮的星盘/纸鹤等）存成一张图；裁剪框里不属于这组的像素设为透明。"""
    x0 = min(g[1] for g in group); y0 = min(g[2] for g in group)
    x1 = max(g[1] + g[3] for g in group); y1 = max(g[2] + g[4] for g in group)
    sl = (slice(max(0, y0 - pad), y1 + pad), slice(max(0, x0 - pad), x1 + pad))
    crop = rgba[sl].copy()
    keep = cv2.dilate(np.isin(lab[sl], [g[0] for g in group]).astype(np.uint8), np.ones((5, 5), np.uint8))
    crop[..., 3] = crop[..., 3] * keep
    if drop_shadow:  # 小兵脚下烘焙的灰色投影：底部 30% 里的大块中性灰 → 透明（游戏里另画贴地阴影）
        rgb = crop[..., :3].astype(int); mx, mn = rgb.max(axis=2), rgb.min(axis=2)
        grey = ((mx - mn) <= 16) & (mn >= 150) & (mx <= 222) & (crop[..., 3] > 0)
        grey[: int(crop.shape[0] * 0.7)] = False
        n, l2, st, _ = cv2.connectedComponentsWithStats(grey.astype(np.uint8), connectivity=8)
        sh = np.isin(l2, [i for i in range(1, n) if st[i][4] >= 1200])
        crop[..., 3][cv2.dilate(sh.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0] = 0
    if hue is not None:  # 整体偏色（给没有独立设定稿的英雄做区分）
        hsv = cv2.cvtColor(crop[..., :3], cv2.COLOR_RGB2HSV).astype(int)
        hsv[..., 0] = (hsv[..., 0] + hue) % 180
        crop[..., :3] = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2RGB)
    k = 0.5 if name.startswith(('hero', 'melee', 'ranged')) else 1   # 角色在屏幕上远小于原稿，预先缩小省内存
    im = Image.fromarray(crop)
    if k != 1: im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
    im.save(OUT + name + '.png', optimize=True)
    print(f'{name:18s} {crop.shape[1]}x{crop.shape[0]}')
    return crop


def attach(bodies, extras):
    """把小部件归给水平距离最近的主体。"""
    groups = [[b] for b in bodies]
    for e in extras:
        gap = [max(0, e[1] - (b[1] + b[3]), b[1] - (e[1] + e[3])) for b in bodies]
        groups[int(np.argmin(gap))].append(e)
    return groups


sheet = []
# —— 战场拆件：上排 塔蓝/塔红/水晶蓝/水晶红，下排 近战蓝/近战红/远程蓝/远程红 ——
rgba, fg = cutout(ART + 'battlefield-props.png', 14, shadow=(196, 14))
lab, ps = parts(fg, 4000)
top = sorted([p for p in ps if p[2] < 400], key=lambda p: p[1]); bot = sorted([p for p in ps if p[2] >= 400], key=lambda p: p[1])
assert len(top) == 4 and len(bot) == 4, (top, bot)
for p, n in zip(top + bot, ['tower-blue', 'tower-red', 'core-blue', 'core-red', 'melee-blue', 'melee-red', 'ranged-blue', 'ranged-red']):
    sheet.append(save(rgba, lab, [p], n, drop_shadow=n.startswith(('melee', 'ranged'))))
# 英雄不再从设定稿里抠：改用独立的透明上场图，见 tools/import_heroes.py

# 检查用拼图（绿底，看有没有白边/残影）
H = max(s.shape[0] for s in sheet); W = sum(s.shape[1] + 10 for s in sheet)
canvas = Image.new('RGB', (W, H), (70, 120, 90)); x = 0
for s in sheet:
    im = Image.fromarray(s); canvas.paste(im, (x, H - s.shape[0]), im); x += s.shape[1] + 10
canvas.save(sys.argv[3] if len(sys.argv) > 3 else OUT + '_contact.png')
