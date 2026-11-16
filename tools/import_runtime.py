"""导入「星阙峡谷 · 静态替换素材」包（xingque-runtime-assets）。
用法：python3 tools/import_runtime.py <xingque-runtime-assets 目录> assets
做的事：裁掉透明边、按屏幕上的实际大小缩小、把素材包约定的锚点换算成裁剪后的比例，写出 assets/art/manifest.json。
依赖：pip install numpy pillow

素材包约定：768×512 画布，锚点 = 底边中心 (384, 512)，英雄和小兵朝屏幕右下。
这里有一处刻意的偏离：塔和水晶不是用底边、而是用**底座占地的中心**对齐世界坐标，
因为碰撞圆、射程圈、小兵围攻的位置都以世界坐标为圆心（详见 README「和素材包不一致」）。
"""
import json, shutil, sys
import numpy as np
from PIL import Image

SRC, OUT = sys.argv[1].rstrip('/') + '/', sys.argv[2].rstrip('/') + '/'
AX, AY = 384, 512
manifest = {'heroes': {}, 'minions': {}, 'structures': {}, 'rocks': [], 'brush': [], 'trees': [], 'tiles': {}}


def footprint_row(a):
    """圆形底座的占地中心所在行：轮廓最宽的那几行里最靠下的一行。"""
    w = a.sum(axis=1)
    return int(np.where(w >= w.max() * 0.985)[0].max())


def put(src, dst, upp, shrink, anchor_y=AY, extra=None):
    """upp = 每个源像素对应多少世界单位。返回写进 manifest 的条目。"""
    im = Image.open(SRC + src).convert('RGBA')
    a = np.asarray(im)[..., 3] > 24
    ys, xs = np.where(a)
    x0, x1, y0, y1 = int(xs.min()), int(xs.max()) + 1, int(ys.min()), int(ys.max()) + 1
    crop = im.crop((x0, y0, x1, y1))
    crop.resize((max(1, round(crop.width * shrink)), max(1, round(crop.height * shrink))), Image.LANCZOS).save(OUT + 'art/' + dst + '.png', optimize=True)
    e = {'file': dst, 'h': round((y1 - y0) * upp, 2), 'ax': round((AX - x0) / (x1 - x0), 4), 'ay': round((anchor_y - y0) / (y1 - y0), 4)}
    e.update(extra or {})
    print(f'{src:34s} -> {dst:24s} {e}')
    return e, a


# —— 英雄：星璃高 37 世界单位（镜头标定以她为准），其余按体型系数 ——
HEROES = {'xingli': ('星璃', 1.00), 'xuanyuan': ('玄垣', 1.22), 'hedeng': ('鹤灯', 1.14), 'yelan': ('夜岚', 1.12), 'feixian': ('绯弦', 1.12), 'chiyan': ('赤檐', 1.18)}
for key, (name, k) in HEROES.items():
    manifest['heroes'][key], _ = put(f'heroes/{key}.png', 'hero-' + key, 37.0 * k / 512, 0.7, extra={'name': name})
# —— 小兵 ——
for kind, h in (('melee', 20.0), ('ranged', 19.0)):
    for team in ('blue', 'red'):
        manifest['minions'][f'{kind}-{team}'], _ = put(f'minions/{team}-{kind}.png', f'{kind}-{team}', h / 512, 0.42)
# —— 建筑：完好/摧毁用同一缩放、同一锚点；锚点取完好状态底座的占地中心 ——
for kind, upp, shrink in (('tower', 0.112, 0.75), ('core', 0.18, 1.0)):
    for team in ('blue', 'red'):
        a = np.asarray(Image.open(SRC + f'structures/{team}-{kind}-intact.png').convert('RGBA'))[..., 3] > 24
        row = footprint_row(a) if kind == 'tower' else 404   # 水晶的飞檐比圆台宽，量不准，按圆台底面中心手工取值
        for state in ('intact', 'destroyed'):
            manifest['structures'][f'{kind}-{team}-{state}'], _ = put(f'structures/{team}-{kind}-{state}.png', f'{kind}-{team}-{state}', upp, shrink, anchor_y=row)
# —— 地形单件：不带固定世界尺寸，渲染时按碰撞半径缩放；记录宽高比和底边锚点 ——
for group, files, shrink in (('rocks', ['rock-flat', 'rock-moss', 'rock-tall'], 0.6), ('brush', ['brush-short', 'brush-tall'], 0.5), ('trees', ['tree-broadleaf', 'tree-pine'], 0.55)):
    for f in files:
        e, a = put(f'terrain/{f}.png', f, 1.0, shrink)
        e['aspect'] = round(float(a.any(axis=0).sum() / a.any(axis=1).sum()), 4)   # 宽 / 高
        del e['h']
        manifest[group].append(e)
# —— 地表贴图：512×512 正俯视、可平铺；span = 一张贴图铺多少世界单位 ——
for name, span in (('grass', 120), ('stone', 100), ('water', 110)):
    shutil.copy(SRC + f'tiles/{name}.png', OUT + f'tiles/{name}.png')
    manifest['tiles'][name] = {'file': name, 'span': span}
json.dump(manifest, open(OUT + 'art/manifest.json', 'w'), ensure_ascii=False, indent=1)
