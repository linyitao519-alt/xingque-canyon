"""导入 xingque-v7-update 的动作帧带、特效和音效。
用法：python3 tools/import_anim.py <xingque-v7-update 目录> assets
帧带原稿每帧 768×512、锚点 (384, 512)、朝右下。这里做两件事：① 稳帧——把待机和跑步各帧按上半身重心对齐到同一条竖线（原稿逐帧左右漂移，循环起来像抽搐）；
② 等比缩小（英雄 ½、小兵 ¼，解码后内存从约 220MB 降到约 30MB）。帧数、帧序、脚底高度不变；特效和音效原样拷贝。
"""
import json, shutil, sys, glob, os
import numpy as np
from PIL import Image
SRC, OUT = sys.argv[1].rstrip('/') + '/', sys.argv[2].rstrip('/') + '/'
man = json.load(open(OUT + 'art/manifest.json'))
FRAMES = {'idle': 4, 'run': 6, 'attack': 4}
RAW = len(sys.argv) > 3 and sys.argv[3] == '--raw'      # 不稳帧，输出到 assets/anim-raw（只用于前后对比）
ADIR = 'anim-raw/' if RAW else 'anim/'
os.makedirs(OUT + ADIR, exist_ok=True)
# 整帧（512px 高）对应的世界高度：英雄沿用静态图的体型系数，小兵沿用 20 / 19
HERO_K = {'xingli': 1.00, 'xuanyuan': 1.22, 'hedeng': 1.14, 'yelan': 1.12, 'feixian': 1.12, 'chiyan': 1.18}
units = {}; jit = {}; report = {}
# 上一版各单位待机的可见身高（原稿像素），用来保持屏幕体型；文件不存在就不换算
PREV = json.load(open(OUT + 'anim/size-ref.json')) if os.path.exists(OUT + 'anim/size-ref.json') else {}
OLD = json.load(open(OUT + 'anim/anim.json')) if os.path.exists(OUT + 'anim/anim.json') else {'units': {}}
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import astrolabe
def torso_cx(fr):
    """上半身（头+躯干）的水平重心。fr 是单帧 RGBA 数组。"""
    a = fr[..., 3] > 24; ys = np.where(a)[0]; top, h = ys.min(), ys.max() - ys.min()
    return float(np.where(a[top + int(h * 0.08):top + int(h * 0.58)])[1].mean())
def feet_cx(fr):
    a = fr[..., 3] > 24; ys = np.where(a)[0]; top, bot = ys.min(), ys.max()
    return float(np.where(a[bot - int((bot - top) * 0.07):bot + 1])[1].mean())
for d in sorted(glob.glob(SRC + 'animation/*/')):
    name = os.path.basename(d.rstrip('/'))
    hero = name.startswith('hero-'); k = 0.5 if hero else 0.25
    key = name[5:] if hero else name
    cells = {st: [np.asarray(Image.open(d + st + '.png').convert('RGBA'))[:, i * 768:(i + 1) * 768].copy() for i in range(n)] for st, n in FRAMES.items()}
    for st, n in FRAMES.items(): assert len(cells[st]) == n and cells[st][0].shape == (512, 768, 4), (name, st)
    attach = None
    # 脚底落到格子底边：新帧带的脚底普遍在 y≈492（离锚点 20px），整体下移，保留帧间起伏
    bots = [int(np.where(f[..., 3] > 24)[0].max()) for st in FRAMES for f in cells[st]]; drop = 511 - int(np.median(bots))
    if drop > 2 and not RAW:
        for st in FRAMES:
            for i in range(FRAMES[st]): c = np.zeros_like(cells[st][i]); c[drop:] = cells[st][i][:-drop]; cells[st][i] = c
    report.setdefault('脚底下移px', {})[name] = drop
    # 角色在格子里画得比上一版小/大时，按待机可见身高换算，屏幕上的体型保持不变
    vis = float(np.median([np.ptp(np.where(f[..., 3] > 24)[0]) for f in cells['idle']])); SIZE_K = 1.0
    if PREV.get(name): SIZE_K = PREV[name] / vis
    report.setdefault('待机可见身高px', {})[name] = round(vis)
    has_astro = name == 'hero-xingli' and not RAW and all(astrolabe.present(f) for f in cells['idle'])
    if name == 'hero-xingli' and not RAW and not has_astro:
        # 帧里没画星盘（v11 重画稿）：沿用已拆出的星盘贴图，挂点按每帧掌心位置量（星盘中心在掌面上方 60px）
        centres = {(st, i): (lambda pm: (pm[0], pm[1] - 60))(astrolabe.palm(cells[st][i])) for st in FRAMES for i in range(FRAMES[st])}
    if has_astro:
        # 星盘拆成独立贴图：帧里的星盘去掉，换成一张固定的星盘跟着挂点走（逐帧重画的星盘形状不一，叠化时还会出重影）
        T = astrolabe.template(cells['idle'][1]); centres = {}; fills = {}
        for st in FRAMES:
            for i in range(FRAMES[st]):
                if st == 'idle' and i == 1:
                    _, m, c, _ = astrolabe.split(cells[st][i], T); ys, xs = np.where(m); spr = cells[st][i].copy(); spr[~m] = 0
                    spr = spr[ys.min() - 2:ys.max() + 3, xs.min() - 2:xs.max() + 3]; sc = (c[0] - xs.min() + 2, c[1] - ys.min() + 2)
                cells[st][i], _, c, nfill = astrolabe.split(cells[st][i], T); centres[(st, i)] = c; fills[f'{st}{i}'] = nfill
        Image.fromarray(spr).resize((round(spr.shape[1] * k), round(spr.shape[0] * k)), Image.LANCZOS).save(f'{OUT}{ADIR}{name}-astrolabe.png', optimize=True)
        report['星盘压住、已自动补上的像素（原稿尺度）'] = fills
    if not RAW:
        # 稳帧与统一锚点。原稿每帧锚点都是 (384, 512)，实测：支撑脚确实落在 x≈384，但躯干逐帧左右漂（跑步 6 帧里漂 90px 以上）。
        #  · 三个状态的躯干都对到同一条竖线（待机四帧躯干重心的平均）；待机双脚中点保持在锚点上，不平移
        #  · 跑步的头顶高度按前后半圈配对取平均（原稿只有第 2 帧明显下沉，循环起来是每圈顿一下）
        ref = float(np.mean([torso_cx(f) for f in cells['idle']])); rep = {}
        for st, n in FRAMES.items():
            cx = [torso_cx(f) for f in cells[st]]; dxs = [int(round(max(-170, min(170, ref - c)))) for c in cx]; dys = [0] * n
            if st == 'attack': dxs = [int(round(ref - (cx[0] + cx[-1]) / 2))] * n      # 普攻整条只平移一个量（按起手/收招帧对线），保留出手时身体前探
            if st == 'run':
                tops = [int(np.where(f[..., 3] > 24)[0].min()) for f in cells[st]]; hf = n // 2
                for i in range(hf):
                    m = (tops[i] + tops[i + hf]) / 2; dys[i] = int(round(m - tops[i])); dys[i + hf] = int(round(m - tops[i + hf]))
            jit[(name, st)] = (round(float(np.std(cx)), 1), round(float(max(cx) - min(cx)), 1))
            for i in range(n):
                cell = Image.new('RGBA', (768, 512), (0, 0, 0, 0)); cell.paste(Image.fromarray(cells[st][i]), (dxs[i], dys[i])); cells[st][i] = np.asarray(cell)
                if name == 'hero-xingli': centres[(st, i)] = (centres[(st, i)][0] + dxs[i], centres[(st, i)][1] + dys[i])
            rep[st] = {'躯干重心x 稳帧前': [round(c) for c in cx], '平移dx': dxs, '平移dy': dys, '脚底中心x 稳帧后': [round(feet_cx(f)) for f in cells[st]], '躯干x 稳帧后': [round(torso_cx(f)) for f in cells[st]]}
        if name == 'hero-xingli': report['星璃各帧'] = rep; report['躯干基准线x'] = round(ref, 1)
    for st, n in FRAMES.items():
        im = Image.new('RGBA', (768 * n, 512), (0, 0, 0, 0))
        for i in range(n): im.paste(Image.fromarray(cells[st][i]), (i * 768, 0))
        im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS).save(f'{OUT}{ADIR}{name}-{st}.png', optimize=True)
    H = round((37.0 * HERO_K[key] if hero else (20.0 if key.startswith('melee') else 19.0)) * SIZE_K, 2)
    units[key] = {'file': name, 'frameW': round(768 * k), 'frameH': round(512 * k), 'h': H, 'ax': 0.5, 'ay': 1.0}
    if name == 'hero-xingli' and not RAW:
        u = H / 512; mt = lambda st, i: [round((centres[(st, i)][0] - 384) * u, 2), round((512 - centres[(st, i)][1]) * u, 2)]
        avg = lambda st: [round(float(np.mean([mt(st, i)[j] for i in range(FRAMES[st])])), 2) for j in (0, 1)]
        if has_astro: base = {'file': name + '-astrolabe.png', 'w': round(spr.shape[1] * u, 2), 'h': round(spr.shape[0] * u, 2), 'cx': round(sc[0] / spr.shape[1], 3), 'cy': round(sc[1] / spr.shape[0], 3)}
        else: base = {k2: OLD['units']['xingli']['attach'][k2] for k2 in ('file', 'w', 'h', 'cx', 'cy')}
        units[key]['attach'] = {**base, 'mount': {'idle': avg('idle'), 'run': avg('run'), 'attack': [mt('attack', i) for i in range(4)]}, 'bob': 0.5, 'follow': 10,
                                'note': '独立星盘。mount = 星盘中心相对脚底锚点的位置（世界单位：x 朝面向方向为正，y 向上）；待机/跑步各一个固定挂点，普攻逐帧（第 2 帧抬手）。follow 是跟随的收敛速率（1/秒），bob 是上下浮动幅度。'}
        report['星盘挂点（逐帧实测，世界单位）'] = {st: [mt(st, i) for i in range(FRAMES[st])] for st in FRAMES}
anim = {
    'note': '帧带横排；每帧锚点在 (ax, ay) 比例处；h 是整帧高度对应的世界单位。states 里 fps/loop 可调；attack 的 release 是出手帧的序号（从 0 起）。',
    'states': {'idle': {'frames': 4, 'fps': 5, 'loop': True}, 'run': {'frames': 6, 'fps': 11 if RAW else 13, 'loop': True}, 'attack': {'frames': 4, 'fps': 11, 'loop': False, 'release': 2}},
    'blend': 0.45,   # 循环动作每帧最后 45% 的时间里把下一帧淡入，补足低帧率
    'units': units,
}
json.dump(anim, open(OUT + ADIR + 'anim.json', 'w'), ensure_ascii=False, indent=1)
if RAW: sys.exit(0)
for f in glob.glob(SRC + 'fx/*.png'): shutil.copy(f, OUT + 'fx/')
for f in glob.glob(SRC + 'audio/*.wav'): shutil.copy(f, OUT + 'audio/')
json.dump(report, open(OUT + '../docs/xingli-anchor-report.json', 'w'), ensure_ascii=False, indent=1) if os.path.isdir(OUT + '../docs') else None
print(json.dumps(report, ensure_ascii=False))
print('稳帧前上半身重心的左右抖动（标准差px, 极差px）:', {f'{k[0]}/{k[1]}': v for k, v in jit.items() if k[1] == 'run'})
print(len(units), 'units', sorted(units)); os.system(f'du -sh {OUT}anim {OUT}fx {OUT}audio')
