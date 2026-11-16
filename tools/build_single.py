"""把整个游戏打成一个 HTML 文件：three.js（r128，MIT）、编译后的全部脚本、全部素材（base64）都内嵌，双击即可打开，不需要服务器和网络。
用法：先 tsc -p .，再 python3 tools/build_single.py [输出路径]
"""
import base64, io, json, os, re, sys
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'dist-single', 'xingque-canyon.html')
os.makedirs(os.path.dirname(OUT), exist_ok=True)

# ---- 1. 脚本：每个模块包成一个立即执行函数，import/export 改写成对象解构（不依赖打包器） ----
mods = {f[:-3]: open(os.path.join(ROOT, 'dist', f), encoding='utf-8').read() for f in os.listdir(os.path.join(ROOT, 'dist')) if f.endswith('.js')}
deps = {m: re.findall(r"from '\./([\w-]+)\.js'", src) for m, src in mods.items()}
order = []
def visit(m, stack=()):
    if m in order: return
    assert m not in stack, ('循环依赖', stack, m)
    for d in deps[m]: visit(d, stack + (m,))
    order.append(m)
visit('main')
def convert(name, src):
    exports = []
    def imp(mo):
        names = ', '.join(p.strip().replace(' as ', ': ') for p in mo.group(1).split(',') if p.strip())
        return f"const {{ {names} }} = __m['{mo.group(2)}'];"
    src = re.sub(r"^import\s*\{([^}]*)\}\s*from\s*'\./([\w-]+)\.js';?", imp, src, flags=re.M)
    src = re.sub(r"^import\s*\*\s*as\s+(\w+)\s+from\s*'\./([\w-]+)\.js';?", lambda mo: f"const {mo.group(1)} = __m['{mo.group(2)}'];", src, flags=re.M)   # import * as X
    assert not re.search(r'^import\s', src, flags=re.M), (name, re.findall(r'^import.*$', src, flags=re.M))
    def exp(mo): exports.append(mo.group(2)); return mo.group(1) + mo.group(2)
    src = re.sub(r'^export\s+((?:async\s+)?(?:function\*?|class|const|let|var)\s+)([A-Za-z_$][\w$]*)', exp, src, flags=re.M)
    def expl(mo): exports.extend(p.strip() for p in mo.group(1).split(',') if p.strip()); return ''
    src = re.sub(r'^export\s*\{([^}]*)\};?', expl, src, flags=re.M)
    assert not re.search(r'^export\s', src, flags=re.M), (name, re.findall(r'^export.*$', src, flags=re.M)[:3])
    # let 导出的变量可能在模块内被重新赋值：用 getter 保持活绑定
    body = ', '.join(f'get {e}() {{ return {e}; }}' for e in exports)
    return f"// ---- {name}.js ----\n__m['{name}'] = (() => {{\n{src}\nreturn {{ {body} }};\n}})();\n"
bundle = 'const __m = {};\n' + ''.join(convert(m, mods[m]) for m in order)

# ---- 2. 素材：全部转成 data URL；不带透明的大图转 JPEG 省体积 ----
SKIP = lambda p: os.path.basename(p).startswith('._') or 'occ-' in p or p.endswith('mid-river-ground.png') or p.endswith('size-ref.json')
assets = {}; sizes = {}
for sub in ['data', 'anim', 'fx', 'audio', 'art', 'tiles', 'scene', 'icons']:
    for d, _, fs in os.walk(os.path.join(ROOT, 'assets', sub)):
        for f in sorted(fs):
            p = os.path.join(d, f); rel = os.path.relpath(p, ROOT).replace(os.sep, '/')
            if SKIP(rel): continue
            raw = open(p, 'rb').read(); ext = f.rsplit('.', 1)[-1].lower()
            mime = {'png': 'image/png', 'jpg': 'image/jpeg', 'json': 'application/json', 'wav': 'audio/wav'}.get(ext)
            if not mime: continue
            if ext == 'png':
                im = Image.open(io.BytesIO(raw))
                if len(raw) > 300_000 and (im.mode in ('RGB', 'L', 'P') and 'transparency' not in im.info or (im.mode == 'RGBA' and im.getchannel('A').getextrema()[0] == 255)):
                    b = io.BytesIO(); im.convert('RGB').save(b, 'JPEG', quality=90, optimize=True); raw = b.getvalue(); mime = 'image/jpeg'
            assets[rel] = f'data:{mime};base64,' + base64.b64encode(raw).decode(); sizes[rel] = len(raw)
shim = '''const __A = %s;
(() => {
  const f = window.fetch.bind(window);
  window.fetch = (u, o) => f(typeof u === 'string' && __A[u] ? __A[u] : u, o);
  const d = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  Object.defineProperty(HTMLImageElement.prototype, 'src', { configurable: true, enumerable: true, get() { return d.get.call(this); }, set(v) { d.set.call(this, __A[v] || v); } });
})();
''' % json.dumps(assets)

# ---- 3. 页面 ----
html = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
three = open(os.path.join(ROOT, 'lib', 'three.min.js'), encoding='utf-8').read()
esc = lambda s: s.replace('</script', '<\\/script')
assert '<script src="lib/three.min.js"></script>' in html and '<script type="module" src="dist/main.js"></script>' in html
html = html.replace('<script src="lib/three.min.js"></script>', '<script>\n' + esc(three) + '\n</script>')
html = html.replace('<script type="module" src="dist/main.js"></script>', '<script>\n' + esc(shim) + '</script>\n<script type="module">\n' + esc(bundle) + '</script>')
html = html.replace('请通过 npm start 启动的地址访问（不能直接双击 index.html）。', '')
open(OUT, 'w', encoding='utf-8').write(html)
print(OUT, round(os.path.getsize(OUT) / 1e6, 1), 'MB；脚本', round(len(bundle) / 1e3), 'KB；three.js', round(len(three) / 1e3), 'KB；素材', len(assets), '个', round(sum(sizes.values()) / 1e6, 1), 'MB（编码前）；模块顺序', order)
