"""导入已经是透明背景的英雄上场图：裁掉空白、缩小、量出触地点，写入 assets/sprites/ 和 heroes.json。
用法：python3 tools/import_heroes.py <英雄图目录> assets/sprites
"""
import json, sys
import numpy as np
from PIL import Image

SRC, OUT = sys.argv[1].rstrip('/') + '/', sys.argv[2].rstrip('/') + '/'
# 游戏内的造型键 → (源文件, 显示名, 原图朝向 1右/-1左, 相对星璃的体型系数)
HEROES = {
    'xingli':   ('xingli',   '星璃', 1, 1.00),
    'guardian': ('xuanyuan', '轩辕', -1, 1.22),
    'crane':    ('hedeng',   '鹤灯', 1, 1.14),
    'fox':      ('yelan',    '夜岚', -1, 1.12),
    'archer':   ('feixian',  '飞弦', 1, 1.12),
    'lancer':   ('chiyan',   '赤焰', -1, 1.18),
}
BASE_H = 37.0   # 星璃的世界高度（镜头标定以她为准）
meta, ref = {}, None
for key, (src, name, native, k) in HEROES.items():
    im = Image.open(SRC + src + '.png').convert('RGBA')
    a = np.asarray(im)[..., 3] > 24
    ys, xs = np.where(a)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    im = im.crop((x0, y0, x1, y1)); a = a[y0:y1, x0:x1]
    h = a.shape[0]
    # 触地点：脚部（最底下 7% 行）不透明像素的水平中心；身体（躯干）中心作参考，避免被武器/饰物带偏
    feet = np.where(a[int(h * 0.93):].any(axis=0))[0]
    ax = float((feet.min() + feet.max()) / 2 / a.shape[1])
    ref = ref or h
    meta[key] = {'file': 'hero-' + key, 'name': name, 'h': round(BASE_H * k * h / ref, 1), 'ax': round(ax, 3), 'ay': 0.985, 'native': native}
    s = 0.7
    im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS).save(OUT + 'hero-' + key + '.png', optimize=True)
    print(key, src, im.size, meta[key])
json.dump(meta, open(OUT + 'heroes.json', 'w'), ensure_ascii=False, indent=2)
