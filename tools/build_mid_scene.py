"""把中路河口的纯场景底图（mid-river-environment.png）注册到世界坐标，并从同一张图里抠出立体物的前景遮挡片。
用法：python3 tools/build_mid_scene.py <mid-river-environment.png> assets [检查图输出路径]
依赖：pip install numpy opencv-python pillow

底图自带斜俯视投影。量出来的参数（见 README「中路底图」）：
  桥心（罗盘中心）像素 (957.5, 403.3)  ↔  世界 (600, 600)
  桥面两条台阶沿线相距 421px          ↔  中路宽 92 世界单位   →  6.1 像素/世界单位
  桥向屏幕斜率 0.575、河向 0.656       →  地面纵向压缩 0.636，相对地图几乎没有旋转（约 0.65°）
"""
import json, sys
import numpy as np, cv2
from PIL import Image

SRC, OUT = sys.argv[1], sys.argv[2].rstrip('/') + '/'
S, KY, AU, AV, WX, WY = 6.1, 0.636, 957.5, 403.3, 600.0, 600.0
to_world = lambda u, v: [round(float(WX + (u - AU) / S), 1), round(float(WY + (v - AV) / (S * KY)), 1)]

rgb = np.asarray(Image.open(SRC).convert('RGB'))
H, W = rgb.shape[:2]

# —— 1. 地面层：四周羽化，和程序化地表过渡 ——
F = 90
ax = np.minimum(np.arange(W), W - 1 - np.arange(W)) / F
ay = np.minimum(np.arange(H), H - 1 - np.arange(H)) / F
alpha = np.clip(np.minimum.outer(ay, ax), 0, 1)
alpha = (alpha * alpha * (3 - 2 * alpha) * 255).astype(np.uint8)
Image.fromarray(np.dstack([rgb, alpha])).save(OUT + 'scene/mid-river-ground.png', optimize=True)

# —— 2. 立体物：给一个包围框，GrabCut 抠轮廓 → 前景遮挡片 + 碰撞圆 ——
# (名字, 类型, 包围框 x0,y0,x1,y1, 触地中心 u,v, 触地半宽 px) —— 都是在底图上人工量的
OBJS = [
    ('pillar-w',  'pillar', 478, 285, 596, 445, 536, 418, 48), ('pillar-n',  'pillar', 838, 62, 952, 222, 895, 196, 48),
    ('pillar-e',  'pillar', 1240, 340, 1362, 505, 1301, 478, 50), ('pillar-s',  'pillar', 836, 572, 958, 738, 897, 712, 50),
    ('pillar-ne', 'pillar', 1182, 0, 1290, 105, 1235, 82, 44), ('pillar-sw', 'pillar', 70, 680, 196, 836, 132, 812, 52),
    ('rock-w1', 'rock', 252, 142, 390, 262, 320, 240, 58), ('rock-w2', 'rock', 312, 240, 438, 338, 376, 318, 54),
    ('rock-e',  'rock', 1422, 352, 1622, 505, 1522, 470, 90), ('rock-s',  'rock', 902, 716, 1056, 836, 978, 812, 68),
    ('rock-se', 'rock', 1698, 556, 1878, 694, 1790, 664, 82), ('rock-ne', 'rock', 1808, 182, 1881, 298, 1850, 278, 34),
]
hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
blockers, occluders, check = [], [], rgb.copy()
for name, kind, x0, y0, x1, y1, bu, bv, half in OBJS:
    pad = 30
    X0, Y0, X1, Y1 = max(0, x0 - pad), max(0, y0 - pad), min(W, x1 + pad), min(H, y1 + pad)
    sub = np.ascontiguousarray(rgb[Y0:Y1, X0:X1][..., ::-1]); sat = hsv[Y0:Y1, X0:X1, 1]; hue = hsv[Y0:Y1, X0:X1, 0]
    mask = np.full(sub.shape[:2], cv2.GC_BGD, np.uint8)
    rx0, ry0, rx1, ry1 = x0 - X0, y0 - Y0, x1 - X0, y1 - Y0
    mask[ry0:ry1, rx0:rx1] = cv2.GC_PR_BGD
    inner = np.zeros_like(mask); cv2.ellipse(inner, ((rx0 + rx1) // 2, (ry0 + ry1) // 2), (int((rx1 - rx0) * 0.46), int((ry1 - ry0) * 0.47)), 0, 0, 360, 1, -1)
    grey = (sat < 62) | ((hue > 95) & (hue < 125) & (kind == 'pillar'))          # 石头是低饱和灰；桥柱顶上的晶体偏蓝
    mask[(inner > 0) & grey] = cv2.GC_PR_FGD
    core = np.zeros_like(mask)
    if kind == 'pillar': core[ry0 + int((ry1 - ry0) * 0.3):ry1 - int((ry1 - ry0) * 0.12), rx0 + int((rx1 - rx0) * 0.3):rx1 - int((rx1 - rx0) * 0.3)] = 1
    else: cv2.ellipse(core, ((rx0 + rx1) // 2, (ry0 + ry1) // 2), (int((rx1 - rx0) * 0.25), int((ry1 - ry0) * 0.25)), 0, 0, 360, 1, -1)
    mask[(core > 0) & (grey | (kind == 'pillar'))] = cv2.GC_FGD
    cv2.grabCut(sub, mask, None, np.zeros((1, 65)), np.zeros((1, 65)), 5, cv2.GC_INIT_WITH_MASK)
    fg = ((mask == 1) | (mask == 3)).astype(np.uint8)
    fg[min(sub.shape[0], int(bv - Y0 + half * KY * 0.9)):] = 0                    # 触地线以下不属于这个物体
    fg = cv2.morphologyEx(cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8)), cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(fg, 8)
    fg = (lab == 1 + np.argmax(st[1:, 4])).astype(np.uint8)
    ys, xs = np.where(fg > 0)
    bx0, bx1, by0, by1 = int(xs.min()), int(xs.max()) + 1, int(ys.min()), int(ys.max()) + 1
    a = cv2.GaussianBlur(fg * 255, (0, 0), 1.2)
    crop = np.dstack([rgb[Y0 + by0:Y0 + by1, X0 + bx0:X0 + bx1], a[by0:by1, bx0:bx1]])
    Image.fromarray(crop).save(OUT + f'scene/occ-{name}.png', optimize=True)
    wpos = to_world(bu, bv); r = round(half / S * (0.62 if kind == 'pillar' else 0.85), 1)
    # 这两根桥柱画在了地图的兵线范围内（底图的路在桥外拐了弯，地图的中路是直的）：先关掉碰撞，否则会挡兵线
    inlane = name in ('pillar-sw', 'pillar-ne')
    blockers.append({'id': name, 'kind': kind, 'pos': wpos, 'blockRadius': 0 if inlane else r, **({'note': '画在兵线上，碰撞已关闭，待重绘'} if inlane else {})})
    occluders.append({'id': name, 'file': f'occ-{name}', 'base': wpos, 'ax': round((bu - (X0 + bx0)) / (bx1 - bx0), 4), 'ay': round((bv - (Y0 + by0)) / (by1 - by0), 4),
                      'w': round((bx1 - bx0) / S, 2), 'h': round((by1 - by0) / S, 2)})
    cnt, _ = cv2.findContours(fg, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cv2.drawContours(check, [c + np.array([X0, Y0]) for c in cnt], -1, (255, 0, 255), 2)
    cv2.ellipse(check, (int(bu), int(bv)), (int(r * S), int(r * S * KY)), 0, 0, 360, (255, 255, 0), 2)
    print(f'{name:10s} 触地像素 ({bu:5d},{bv:4d}) → 世界 {wpos}  碰撞半径 {r}  轮廓占框 {fg.sum() / ((x1 - x0) * (y1 - y0)):.2f}')

scene = {
    'version': 2,
    'note': '中路河口。backdrop 是自带斜俯视投影的整张地面图；blockers 是画在图里的桥柱和岩石（进碰撞与寻路）；occluders 是从同一张图抠出的前景遮挡片，按 base 的世界 Y 参与前后排序。',
    'backdrop': {'file': 'mid-river-ground', 'size': [W, H], 'anchorPx': [AU, AV], 'anchorWorld': [WX, WY], 'pxPerUnit': S, 'ky': KY,
                 'worldRect': to_world(0, 0) + to_world(W, H)},
    'props': blockers, 'occluders': occluders,
}
json.dump(scene, open(OUT + 'data/scenery.json', 'w'), ensure_ascii=False, indent=1)
print('worldRect', scene['backdrop']['worldRect'])
if len(sys.argv) > 3: Image.fromarray(check).save(sys.argv[3])
