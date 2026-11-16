"""把 export_layout_guide.mjs 导出的投影结果画成制作基准：mid-layout-guide.png / .json（另出一张叠在现有底图上的对照版）。
用法：node tools/export_layout_guide.mjs > raw.json && python3 tools/draw_layout_guide.py raw.json <现有底图.png> <输出目录>
"""
import json, math, sys
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont

raw = json.load(open(sys.argv[1])); ART = sys.argv[2]; OUT = sys.argv[3].rstrip('/') + '/'
bd = raw['backdrop']; S, KY = bd['pxPerUnit'], bd['ky']; AU, AV = bd['anchorPx']; WX, WY = bd['anchorWorld']; W, H = bd['size']
SV = round(S * KY, 4)
P = lambda w: (AU + (w[0] - WX) * S, AV + (w[1] - WY) * SV)
EXT_SIZE, EXT_OFF = (2800, 1500), (460, 332)          # 外扩画布与原图左上角在其中的整数偏移
r1 = lambda p: [round(float(p[0]), 1), round(float(p[1]), 1)]
FONT = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
F = lambda n: ImageFont.truetype(FONT, n)

def clip(pts, w, h):
    """折线裁到画布内（Liang–Barsky），返回若干段。"""
    out = []
    for a, b in zip(pts, pts[1:]):
        dx, dy, t0, t1 = b[0] - a[0], b[1] - a[1], 0.0, 1.0
        ok = True
        for p, q in ((-dx, a[0]), (dx, w - a[0]), (-dy, a[1]), (dy, h - a[1])):
            if p == 0:
                if q < 0: ok = False
            else:
                t = q / p
                if p < 0: t0 = max(t0, t)
                else: t1 = min(t1, t)
        if ok and t0 < t1:
            s, e = r1((a[0] + dx * t0, a[1] + dy * t0)), r1((a[0] + dx * t1, a[1] + dy * t1))
            if out and out[-1][-1] == s: out[-1].append(e)
            else: out.append([s, e])
    return out[0] if len(out) == 1 else out

def cross(p1, p2, p3, p4):
    d = (p1[0] - p2[0]) * (p3[1] - p4[1]) - (p1[1] - p2[1]) * (p3[0] - p4[0])
    a, b = p1[0] * p2[1] - p1[1] * p2[0], p3[0] * p4[1] - p3[1] * p4[0]
    return ((a * (p3[0] - p4[0]) - (p1[0] - p2[0]) * b) / d, (a * (p3[1] - p4[1]) - (p1[1] - p2[1]) * b) / d)

wd = raw['world']; hw, rw = raw['laneHalfWidth'], raw['riverHalfWidth']
# 画面内中路与河道都是直线：取穿过桥心的那一段
i = wd['laneCenter'].index([600, 600]); la, lb = wd['laneCenter'][i - 1], wd['laneCenter'][i + 1]
Ld = np.array([lb[0] - la[0], lb[1] - la[1]], float); Ld /= np.linalg.norm(Ld); Ln = np.array([-Ld[1], Ld[0]])          # Ln 指向东南（屏幕右下）
j = wd['riverCenter'].index([600, 600]); ra, rb = wd['riverCenter'][j - 1], wd['riverCenter'][j + 1]
Rd = np.array([rb[0] - ra[0], rb[1] - ra[1]], float); Rd /= np.linalg.norm(Rd); Rn = np.array([-Rd[1], Rd[0]])          # Rn 指向西南（屏幕左下）
C = np.array([WX, WY])
wpt = lambda l=0, n=0, r=0, m=0: C + l * Ld + n * Ln + r * Rd + m * Rn
corner = lambda sn, sm: np.array(cross(tuple(C + sn * hw * Ln), tuple(C + sn * hw * Ln + Ld), tuple(C + sm * rw * Rn), tuple(C + sm * rw * Rn + Rd))) - C
corners = {'W': corner(-1, 1), 'N': corner(-1, -1), 'E': corner(1, -1), 'S': corner(1, 1)}                            # NW 路沿 × SW 河岸 = 西角，依此类推

# —— 路宽的几种量法（都由投影算出）——
sd = np.array([Ld[0] * S, Ld[1] * SV]); sdn = sd / np.linalg.norm(sd)                       # 路向在图上的单位向量
off = np.array([Ln[0] * 2 * hw * S, Ln[1] * 2 * hw * SV])                                   # 一条路沿到另一条路沿（沿世界法线）的像素位移
perp = abs(off[0] * sdn[1] - off[1] * sdn[0])
meas = {'perpendicularPx': round(perp, 1), 'alongProjectedLaneNormalPx': round(float(np.linalg.norm(off)), 1),
        'horizontalChordPx': round(perp / abs(sdn[1]), 1), 'verticalChordPx': round(perp / abs(sdn[0]), 1), 'unprojectedGroundPx': round(2 * hw * S, 1),
        'roadSlopeOnImage': round(-sd[1] / sd[0], 4), 'riverSlopeOnImage': round(Rd[1] * SV / (Rd[0] * S), 4)}

def build(size, offs):
    w, h = size; ox, oy = offs
    Q = lambda wp: (P(wp)[0] + ox, P(wp)[1] + oy)
    g = {'size': list(size)}
    for k in ('laneCenter', 'laneEdgeNW', 'laneEdgeSE', 'riverCenter', 'riverBankSW', 'riverBankNE'):
        g[k] = clip([Q(p) for p in wd[k]], w, h)
    g['entrances'] = [{'world': e['world'], 'px': r1(Q(e['world']))} for e in raw['entrances'] if 0 <= Q(e['world'])[0] <= w and 0 <= Q(e['world'])[1] <= h]
    inside = lambda o, rad: -rad * S <= Q(o)[0] <= w + rad * S and -rad * SV <= Q(o)[1] <= h + rad * SV
    g['combatTowers'] = [{'id': t['id'], 'world': t['world'], 'px': r1(Q(t['world'])), 'collisionRadiusWorld': t['collisionRadius'], 'footprintPx': [round(t['collisionRadius'] * S, 1), round(t['collisionRadius'] * SV, 1)]} for t in raw['towers'] if inside(t['world'], 0)]
    g['mapRocks'] = [{'world': o['world'], 'radiusWorld': o['radius'], 'px': r1(Q(o['world'])), 'footprintPx': [round(o['radius'] * S, 1), round(o['radius'] * SV, 1)]} for o in raw['mapRocks'] if inside(o['world'], o['radius'])]
    g['mapBrush'] = [{'world': o['world'], 'radiusWorld': o['radius'], 'px': r1(Q(o['world']))} for o in raw['mapBrush'] if inside(o['world'], o['radius'])]
    return g, Q

g, Q = build((W, H), (0, 0))
# —— 栅格化：可通行的过水区、桥柱/岩石允许放置区 ——
uu, vv = np.meshgrid(np.arange(W), np.arange(H)); wx = WX + (uu - AU) / S; wy = WY + (vv - AV) / SV
def dist_poly(pts):
    d = np.full(wx.shape, 1e9)
    for a, b in zip(pts, pts[1:]):
        dx, dy = b[0] - a[0], b[1] - a[1]; t = np.clip(((wx - a[0]) * dx + (wy - a[1]) * dy) / (dx * dx + dy * dy), 0, 1)
        d = np.minimum(d, np.hypot(a[0] + dx * t - wx, a[1] + dy * t - wy))
    return d
dL, dR = dist_poly(wd['laneCenter']), dist_poly(wd['riverCenter'])
dE = np.min([np.hypot(wx - e['world'][0], wy - e['world'][1]) for e in raw['entrances']], axis=0)
RULES = {'objectFootprintMinDistFromLaneCenter': hw + 6, 'objectFootprintMinDistFromRiverCenter': rw - 2, 'entranceKeepoutRadius': 30, 'canvasEdgeMarginPx': 24,
         'note': '单位为世界单位（除注明 px 的）。物体落地轮廓必须整体落在 allowedZones 内；allowedZones 已按落地半径 10 世界单位（61px）向内收过。'}
allowed = (dL >= hw + 6 + 10) & (dR >= rw - 2 + 10) & (dE >= 30 + 10) & (uu >= 24) & (uu < W - 24) & (vv >= 24) & (vv < H - 24)
water = (dR <= rw) & (dL > hw)
def polys(mask, eps=2.5, min_area=1500):
    cs, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    return [[[int(p[0][0]), int(p[0][1])] for p in cv2.approxPolyDP(c, eps, True)] for c in cs if cv2.contourArea(c) >= min_area]

# —— 前景物的建议底点 ——
cur = {o['id']: o for o in raw['current']}
objs = []
for key, sn, sm in (('W', -1, 1), ('N', -1, -1), ('E', 1, -1), ('S', 1, 1)):
    wp = C + corners[key] + sn * 12 * Ln + sm * 6 * Rn                      # 桥角向路外推 12、向岸上推 6
    was = cur['pillar-' + key.lower()]
    objs.append({'id': 'pillar-' + key.lower(), 'kind': 'pillar', 'status': 'move-slightly', 'baseWorld': r1(wp), 'basePx': r1(P(wp)), 'collisionRadiusWorld': 5,
                 'footprintPx': [round(5 * S, 1), round(5 * SV, 1)], 'currentBasePx': r1(was['px']), 'maxHeightPx': 170})
for pid in ('pillar-sw', 'pillar-ne'):
    was = cur[pid]; rel = np.array(was['pos']) - C; l, n = float(rel @ Ld), float(rel @ Ln)
    alt = wpt(l=l, n=-(hw + 12))
    objs.append({'id': pid, 'kind': 'pillar', 'status': 'remove-from-1881', 'currentBasePx': r1(was['px']), 'currentDistFromLaneCenterWorld': round(abs(n), 1),
                 'reason': f'落在兵线范围内（离中路中线 {abs(n):.1f}，路沿在 {hw}）', 'ifKeptIn2800': {'baseWorld': r1(alt), 'basePxIn2800': r1((P(alt)[0] + EXT_OFF[0], P(alt)[1] + EXT_OFF[1])), 'collisionRadiusWorld': 5}})
for rid in ('rock-w1', 'rock-w2', 'rock-e', 'rock-s', 'rock-ne'):
    o = cur[rid]; r = o['blockRadius']
    objs.append({'id': rid, 'kind': 'rock', 'status': 'keep', 'baseWorld': o['pos'], 'basePx': r1(o['px']), 'collisionRadiusWorld': r, 'footprintPx': [round(r * S, 1), round(r * SV, 1)]})
o = cur['rock-se']; ent = np.array([746, 642]); new = np.array([740.2, 678.8])
objs.append({'id': 'rock-se', 'kind': 'rock', 'status': 'shrink-and-move', 'baseWorld': r1(new), 'basePx': r1(P(new)), 'collisionRadiusWorld': 7, 'footprintPx': [round(7 * S, 1), round(7 * SV, 1)],
             'currentBasePx': r1(o['px']), 'reason': f'现在离东南野区入口只有 {np.hypot(*(np.array(o["pos"]) - ent)) - o["blockRadius"]:.1f} 世界单位的净空；改后净空 {np.hypot(*(new - ent)) - 7:.1f}'})

# 自检：每个建议底点都必须满足 placement.rules
def dpt(p, pts): return min(np.hypot(*(np.array(p) - (np.array(a) + np.clip(((np.array(p) - a) @ (np.array(b) - a)) / ((np.array(b) - a) @ (np.array(b) - a)), 0, 1) * (np.array(b) - a)))) for a, b in zip(map(np.array, pts), map(np.array, pts[1:])))
for o_ in objs:
    if 'baseWorld' not in o_: continue
    r_ = o_['collisionRadiusWorld']; w_ = o_['baseWorld']
    o_['clearanceWorld'] = {'toLaneEdge': round(float(dpt(w_, wd['laneCenter']) - r_ - hw), 1), 'toRiverBank': round(float(dpt(w_, wd['riverCenter']) - r_ - rw), 1),
                            'toNearestEntrance': round(float(min(np.hypot(w_[0] - e['world'][0], w_[1] - e['world'][1]) for e in raw['entrances']) - r_), 1)}
    c_ = o_['clearanceWorld']; o_['meetsRules'] = bool(c_['toLaneEdge'] >= 6 and c_['toRiverBank'] >= -2 and c_['toNearestEntrance'] >= 30)

walls = {  # 画成齐膝石墙、但按 map.json 可以走过去的岸段（从现有底图上目测，±20px）
    'A': [[600, 0], [650, 25], [720, 60], [800, 115], [855, 165]], 'B': [[60, 95], [120, 110], [170, 130], [260, 190]], 'C': [[425, 300], [470, 325], [505, 345]],
    'D': [[1335, 480], [1430, 520], [1560, 560], [1640, 600], [1700, 640]], 'E': [[925, 690], [1010, 725], [1100, 762], [1190, 800]], 'F': [[1730, 690], [1800, 720], [1881, 750]]}
redraw = [
    {'n': 1, 'what': '两根穿模桥柱', 'items': [{'id': p, 'px': r1(cur[p]['px'])} for p in ('pillar-sw', 'pillar-ne')], 'fix': '从 1881×836 画面里删掉并补全路面；外扩版若要保留，放到 objects 里 ifKeptIn2800 的位置'},
    {'n': 2, 'what': '能走过去但画成齐膝墙的岸段', 'polylinesPx': walls, 'fix': '改成贴地矮护岸（高度不超过 12px），并沿 riverBankSW / riverBankNE 两条模板线摆放；岸线内侧 40px 画浅滩'},
    {'n': 3, 'what': '东南野区入口过窄', 'entrancePx': r1(P(ent)), 'rockPx': r1(o['px']), 'fix': 'rock-se 缩小到落地半宽 43px 并移到 objects 里的新底点；入口周围半径 183px（30 世界单位）不放任何立体物'},
]

eg, EQ = build(EXT_SIZE, EXT_OFF)
guide = {
    'version': 1, 'canvas': {'size': [W, H], 'origin': 'top-left', 'units': 'px'},
    'projection': {
        'formula': f'u = {AU} + {S} * (X - {WX});  v = {AV} + {SV} * (Y - {WY})', 'matrixWorldToPx': [[S, 0, round(AU - S * WX, 3)], [0, SV, round(AV - SV * WY, 3)]],
        'inverse': f'X = {WX} + (u - {AU}) / {S};  Y = {WY} + (v - {AV}) / {SV}', 'pxPerWorldUnitX': S, 'pxPerWorldUnitY': SV, 'groundCompressionKY': KY,
        'anchor': {'what': '罗盘中心 = 桥中心', 'px': [AU, AV], 'world': [WX, WY]},
        'worldAxes': '世界 X 向右、Y 向下；物体的高度方向 = 图上的正上方，1 世界单位高 = 6.1px',
        'source': 'src/render.ts 的 Camera.toScreen（tools/export_layout_guide.mjs 调用），与 scenery.json 登记的公式相差 < 0.05px',
        'inGame': '游戏内屏高 120 世界单位：模板 1px 在屏幕上是 (屏幕高度 / 120) / 6.1 个 CSS 像素，390 高的手机上约 0.53'},
    'roadWidth': {**meas, 'explanation': {
        'perpendicularPx': '垂直于图上路向量出的两条路沿间距——就是之前说的 421px，重绘时用这个',
        'alongProjectedLaneNormalPx': '沿"世界里垂直于路的方向"投影到图上后量出的间距（桥面台阶的方向）',
        'horizontalChordPx': '水平方向横穿石路的长度', 'verticalChordPx': '竖直方向横穿石路的长度',
        'unprojectedGroundPx': '92 世界单位 × 6.1 = 561px 是没做斜向压缩时的地面宽度，在这张图上任何方向都量不出来；上一轮我把它写成了路宽，是错的，请以模板里的两条路沿为准'}},
    'lane': {'halfWidthWorld': hw, 'centerlinePx': g['laneCenter'], 'edgeNWPx': g['laneEdgeNW'], 'edgeSEPx': g['laneEdgeSE'], 'note': '画面内是直线；路沿是重绘依据，路面上不放任何立体物'},
    'river': {'halfWidthWorld': rw, 'centerlinePx': g['riverCenter'], 'bankSWPx': g['riverBankSW'], 'bankNEPx': g['riverBankNE'], 'note': '河道整段可通行（map.json: blocksMovement=false）'},
    'bridge': {'centerPx': [AU, AV], 'cornersWorld': {k: r1(C + v) for k, v in corners.items()}, 'cornersPx': {k: r1(P(C + v)) for k, v in corners.items()}, 'cornerNames': 'W=西(左) N=北(上) E=东(右) S=南(下)，即路沿与河岸的四个交点'},
    'entrances': [{**e, 'keepoutRadiusWorld': 30, 'keepoutPx': [round(30 * S, 1), round(30 * SV, 1)]} for e in g['entrances']],
    'walkableWater': {'polygonsPx': polys(water), 'note': '河道内除桥面外的全部水面都能走：要画成看得出能蹚过去的浅水，不要画深水和高墙'},
    'placement': {'rules': RULES, 'allowedZonesPx': polys(allowed)},
    'objects': objs, 'combatTowers': g['combatTowers'], 'redraw': redraw,
    'extended': {'size': list(EXT_SIZE), 'offsetOfOriginalTopLeft': list(EXT_OFF), 'anchorPx': [AU + EXT_OFF[0], AV + EXT_OFF[1]],
                 'formula': f'u = {AU + EXT_OFF[0]} + {S} * (X - {WX});  v = {AV + EXT_OFF[1]} + {SV} * (Y - {WY})',
                 'worldRect': [round(WX - (AU + EXT_OFF[0]) / S, 1), round(WY - (AV + EXT_OFF[1]) / SV, 1), round(WX + (EXT_SIZE[0] - AU - EXT_OFF[0]) / S, 1), round(WY + (EXT_SIZE[1] - AV - EXT_OFF[1]) / SV, 1)],
                 'note': '原图左上角放在外扩画布的 (460, 332)。上一轮写的锚点 (1417, 735) 是四舍五入，准确值是 (1417.5, 735.3)。中路在外扩范围内有两处约 1.9° 的小折点，见 laneCenter。',
                 'laneCenterPx': eg['laneCenter'], 'laneEdgeNWPx': eg['laneEdgeNW'], 'laneEdgeSEPx': eg['laneEdgeSE'], 'riverCenterPx': eg['riverCenter'], 'riverBankSWPx': eg['riverBankSW'], 'riverBankNEPx': eg['riverBankNE'],
                 'entrances': eg['entrances'], 'combatTowers': eg['combatTowers'], 'mapRocks': eg['mapRocks'], 'mapBrush': eg['mapBrush']},
}
json.dump(guide, open(OUT + 'mid-layout-guide.json', 'w'), ensure_ascii=False, indent=1)

# ------------------------------------------------------------------ 出图
def render(base):
    im = base.convert('RGBA'); ov = Image.new('RGBA', im.size, (0, 0, 0, 0)); d = ImageDraw.Draw(ov)
    for poly in guide['walkableWater']['polygonsPx']: d.polygon([tuple(p) for p in poly], fill=(60, 170, 255, 70), outline=(60, 170, 255, 255))
    for poly in guide['placement']['allowedZonesPx']: d.polygon([tuple(p) for p in poly], fill=(90, 220, 90, 70), outline=(90, 220, 90, 255))
    im = Image.alpha_composite(im, ov); d = ImageDraw.Draw(im)
    line = lambda pts, col, w: d.line([tuple(p) for p in pts], fill=col, width=w)
    def dashed(pts, col, w, n=14):
        (x0, y0), (x1, y1) = pts[0], pts[-1]; L = math.hypot(x1 - x0, y1 - y0); k = int(L // n)
        for i in range(0, k, 2): d.line([(x0 + (x1 - x0) * i / k, y0 + (y1 - y0) * i / k), (x0 + (x1 - x0) * (i + 1) / k, y0 + (y1 - y0) * (i + 1) / k)], fill=col, width=w)
    def label(xy, text, col=(255, 255, 255), size=20, bg=(0, 0, 0, 190)):
        f = F(size); b = d.textbbox(xy, text, font=f); d.rectangle([b[0] - 4, b[1] - 3, b[2] + 4, b[3] + 3], fill=bg); d.text(xy, text, font=f, fill=col)
    line(guide['river']['bankSWPx'], (0, 220, 255), 4); line(guide['river']['bankNEPx'], (0, 220, 255), 4); dashed(guide['river']['centerlinePx'], (0, 220, 255), 2)
    line(guide['lane']['edgeNWPx'], (255, 255, 255), 5); line(guide['lane']['edgeSEPx'], (255, 255, 255), 5); dashed(guide['lane']['centerlinePx'], (255, 230, 120), 3)
    for e in guide['entrances']:
        x, y = e['px']; rx, ry = e['keepoutPx']; d.ellipse([x - rx, y - ry, x + rx, y + ry], outline=(255, 80, 255), width=3); d.ellipse([x - 7, y - 7, x + 7, y + 7], fill=(255, 80, 255))
        label((min(x + 12, W - 300), y - 46), f'野区入口 ({x:.0f},{y:.0f}) 禁放圈', (255, 150, 255), 18)
    for t in guide['combatTowers']:
        x, y = t['px']; rx, ry = t['footprintPx']; d.ellipse([x - rx, y - ry, x + rx, y + ry], outline=(255, 255, 255), width=2); label((x + rx + 4, y - 10), '战斗塔(游戏绘制)', (220, 220, 220), 15)
    for k, p in guide['bridge']['cornersPx'].items():
        d.rectangle([p[0] - 7, p[1] - 7, p[0] + 7, p[1] + 7], fill=(255, 230, 120)); label((p[0] + 10, p[1] + 8), f'桥角{k} ({p[0]:.0f},{p[1]:.0f})', (255, 230, 120), 17)
    d.line([(AU - 22, AV), (AU + 22, AV)], fill=(255, 60, 60), width=3); d.line([(AU, AV - 22), (AU, AV + 22)], fill=(255, 60, 60), width=3); label((AU + 14, AV - 40), f'桥心/罗盘锚点 ({AU},{AV})', (255, 120, 120), 18)
    for o in guide['objects']:
        if 'basePx' in o:
            x, y = o['basePx']; rx, ry = o['footprintPx']; col = (255, 200, 0) if o['kind'] == 'pillar' else (255, 140, 40)
            d.ellipse([x - rx, y - ry, x + rx, y + ry], outline=col, width=3); d.line([(x - 5, y), (x + 5, y)], fill=col, width=2); d.line([(x, y - 5), (x, y + 5)], fill=col, width=2)
            label((x - 30, y + ry + 4), o['id'], col, 14)
            if 'currentBasePx' in o and o['status'] != 'keep': d.line([tuple(o['currentBasePx']), (x, y)], fill=(255, 60, 60), width=2)
    red = (255, 50, 50)
    for it in redraw[0]['items']:
        x, y = it['px']; d.line([(x - 26, y - 26), (x + 26, y + 26)], fill=red, width=6); d.line([(x - 26, y + 26), (x + 26, y - 26)], fill=red, width=6)
        label((min(max(x - 60, 6), W - 330), y - 62 if y > 100 else y + 34), '① 桥柱压在兵线上：删掉', (255, 255, 255), 19, (200, 30, 30, 230))
    for k, pts in walls.items(): line(pts, (255, 120, 0), 7)
    label((1380, 548), '② 橙线：齐膝岸墙 → 改贴地矮护岸', (255, 255, 255), 19, (200, 90, 0, 230)); label((610, 70), '②', (255, 255, 255), 19, (200, 90, 0, 230)); label((960, 742), '②', (255, 255, 255), 19, (200, 90, 0, 230))
    x, y = redraw[2]['rockPx']; d.ellipse([x - 78, y - 50, x + 78, y + 50], outline=red, width=5); label((x - 330, y + 54), '③ 入口过窄：岩石缩小并移到橙圈', (255, 255, 255), 19, (200, 30, 30, 230))
    # 路宽标注：垂直于路向的 421px
    m = np.array([AU, AV]) - sdn * 250; nrm = np.array([-sdn[1], sdn[0]]); a, b = m - nrm * perp / 2, m + nrm * perp / 2
    d.line([tuple(a), tuple(b)], fill=(255, 255, 0), width=3)
    for q, sgn in ((a, 1), (b, -1)): d.polygon([tuple(q), tuple(q + nrm * 16 * sgn + sdn * 7), tuple(q + nrm * 16 * sgn - sdn * 7)], fill=(255, 255, 0))
    label(tuple((a + b) / 2 + np.array([10, -12])), f'{perp:.0f}px（垂直于路向）', (255, 255, 0), 19)
    y0 = AV + 150; xs = sorted([cross(tuple(guide['lane'][k][0]), tuple(guide['lane'][k][-1]), (0, y0), (W, y0))[0] for k in ('edgeNWPx', 'edgeSEPx')])
    d.line([(xs[0], y0), (xs[1], y0)], fill=(180, 255, 180), width=2); label(((xs[0] + xs[1]) / 2 - 120, y0 + 6), f'水平横穿 {xs[1] - xs[0]:.0f}px', (180, 255, 180), 16)
    lines = ['图例  mid-layout-guide  1881×836', '白实线 = 中路两条路沿（重绘依据）   黄虚线 = 中路中心线', '青实线 = 河道两岸   青虚线 = 河道中心线',
             '蓝色区 = 可通行的过水区（画成浅水）', '绿色区 = 桥柱/岩石的落地轮廓允许放置区', '黄圈/橙圈 = 建议底点与碰撞范围   粉圈 = 野区入口禁放圈',
             f'u = {AU} + {S}·(X−{WX:.0f})   v = {AV} + {SV}·(Y−{WY:.0f})', '561px = 未压缩的地面宽度，图上量不出来，不要用']
    f = F(17); bw = max(d.textlength(t, font=f) for t in lines) + 20; x0, y0 = 10, 10
    d.rectangle([x0, y0, x0 + bw, y0 + 26 * len(lines) + 12], fill=(0, 0, 0, 215))
    for k, t in enumerate(lines): d.text((x0 + 10, y0 + 6 + 26 * k), t, font=f, fill=(255, 255, 255) if k else (255, 230, 120))
    return im.convert('RGB')

plain = Image.new('RGB', (W, H), (52, 78, 52)); dd = ImageDraw.Draw(plain)
dd.polygon([tuple(p) for p in guide['lane']['edgeNWPx'] + guide['lane']['edgeSEPx'][::-1]], fill=(150, 146, 132))
render(plain).save(OUT + 'mid-layout-guide.png')
art = Image.open(ART).convert('RGB'); art = Image.blend(art, Image.new('RGB', art.size, (0, 0, 0)), 0.35)
render(art).save(OUT + 'mid-layout-guide-overlay.png')
print(json.dumps({'roadWidth': meas, 'corners': guide['bridge']['cornersPx'], 'entrances': [e['px'] for e in guide['entrances']], 'ext': {k: guide['extended'][k] for k in ('offsetOfOriginalTopLeft', 'anchorPx', 'worldRect')},
                  'zones': len(guide['placement']['allowedZonesPx']), 'objects': [(o['id'], o['status'], o.get('clearanceWorld'), o.get('meetsRules')) for o in objs]}, ensure_ascii=False))
