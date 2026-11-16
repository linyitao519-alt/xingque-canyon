"""手机横屏浏览器端到端验证（真实多点触控，经 CDP 注入触摸事件）。
用法：先 `npm start`，再 `python3 tests/e2e_mobile.py [http://localhost:5173/] [截图输出目录]`
依赖：pip install playwright && playwright install chromium
"""
import math
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:5173/'
import os; BACKEND = os.environ.get('XQ_BACKEND', '')   # XQ_BACKEND=canvas：用 Canvas 后端跑（无头浏览器里 WebGL 是软件渲染，实时项会因帧率过低而超时）
OUT = sys.argv[2] if len(sys.argv) > 2 else '.'
results = []


def check(name, ok, detail=''):
    results.append(ok)
    print(('PASS ' if ok else 'FAIL ') + name + (('  — ' + str(detail)) if detail != '' else ''))


class Touch:
    """跟踪当前按在屏幕上的所有手指，按 CDP 的要求每次上报完整列表。"""

    def __init__(self, cdp):
        self.cdp, self.pts = cdp, {}

    def _send(self, kind):
        self.cdp.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': [{'x': x, 'y': y, 'id': i} for i, (x, y) in self.pts.items()]})

    def down(self, i, x, y):
        self.pts[i] = (x, y); self._send('touchStart')

    def move(self, i, x, y):
        self.pts[i] = (x, y); self._send('touchMove')

    def up(self, i):
        # touchEnd 上报的是"抬起的那根手指"，其余手指保持按住
        x, y = self.pts.pop(i)
        self.cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': [{'x': x, 'y': y, 'id': i}]})


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={'width': 844, 'height': 390}, device_scale_factor=2, has_touch=True, is_mobile=True)
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.goto(URL + ('?r=' + BACKEND if BACKEND else ''))
    page.wait_for_function('window.__xq')
    ev = page.evaluate
    touch = Touch(ctx.new_cdp_session(page))
    wait = page.wait_for_timeout

    # ---------- 0. 加载 ----------
    wait(500)
    check('页面加载无报错', not errors, errors[:3])
    check('三个技能图标已加载（256×256 透明 PNG）', ev("[...Array(3)].every((_, i) => __xq.hud.icons[i].naturalWidth === 256)"))
    check('运行时素材已加载（25 张单件 + 3 张地表贴图）', ev('__xq.art.length') == 28, ev('__xq.art.length'))
    page.wait_for_function('__xq.renderer.sceneReady'); check('中路底图和 10 张遮挡片已加载', ev('Object.keys(__xq.renderer.occImgs).length') == 10)
    check('默认不显示调试射程圈', ev('__xq.renderer.debug') is False)
    lay = ev("({atk: __xq.hud.atkBtn, sk: __xq.hud.skillBtns, cancel: __xq.hud.cancelBtn, restart: __xq.hud.restartBtn, W: innerWidth, H: innerHeight})")
    atk, sk = lay['atk'], lay['sk']
    check('按钮都在屏幕内', all(b['x'] + b['r'] <= lay['W'] and b['y'] + b['r'] <= lay['H'] and b['y'] - b['r'] >= 0 for b in sk + [atk]))

    # ---------- 1. 三路出兵 ----------
    wait(6500)
    lanes = ev("Object.fromEntries(['north','mid','south'].flatMap(l => ['blue','red'].map(t => [t+'-'+l, __xq.game.minions.filter(m => m.team===t && m.lane===l).length])))")
    check('三路双方都已出兵', all(v == 3 for v in lanes.values()), lanes)

    # ---------- 2. 摇杆移动 + 同时拖动技能瞄准 ----------
    p0 = ev("({x: __xq.game.player.x, y: __xq.game.player.y})")
    touch.down(1, 150, 290)                      # 左手：摇杆
    touch.move(1, 195, 255)                      # 往右上推（朝中路）
    wait(400)
    touch.down(2, sk[0]['x'], sk[0]['y'])        # 右手：按住弦月
    touch.move(2, sk[0]['x'] + 50, sk[0]['y'] - 40)
    wait(300)
    st = ev("({aim: __xq.hud.aim, joy: __xq.hud.joy.id, x: __xq.game.player.x, y: __xq.game.player.y, mx: __xq.game.input.mx, my: __xq.game.input.my})")
    check('两指同时按住：摇杆在移动、技能在瞄准', st['aim'] is not None and st['aim']['i'] == 0 and st['joy'] >= 0 and st['mx'] > 0.3 and st['my'] < -0.3, st)
    page.screenshot(path=f'{OUT}/e2e-aim-while-moving.png')
    x_before = st['x']
    wait(300)
    touch.up(2)                                  # 松手施放，摇杆仍按着
    wait(250)
    st2 = ev("({cast: __xq.hud.lastCast, cd: __xq.game.player.cds[0], x: __xq.game.player.x, joy: __xq.hud.joy.id})")
    check('松开技能键施放弦月并进入冷却', st2['cast']['skill'] == 0 and st2['cast']['ok'] and st2['cd'] > 3, st2)
    check('瞄准与施放期间英雄一直在移动', st2['x'] > x_before + 20 and x_before > p0['x'] + 10 and st2['joy'] >= 0, [p0['x'], x_before, st2['x']])

    # ---------- 3. 定星 ×2 + 三星结界（仍然一边走） ----------
    touch.down(2, sk[1]['x'], sk[1]['y']); touch.move(2, sk[1]['x'], sk[1]['y'] - 70); wait(120); touch.up(2)
    wait(200)
    m1 = ev("__xq.game.marks.length")
    ev("__xq.game.player.cds[1] = 0")              # 仅为缩短等待：跳过定星 3 秒冷却
    touch.down(2, sk[1]['x'], sk[1]['y']); touch.move(2, sk[1]['x'] + 70, sk[1]['y']); wait(120); touch.up(2)
    wait(200)
    m2 = ev("__xq.game.marks.length")
    check('定星两次落点后保留两枚星标', m1 == 1 and m2 == 2, [m1, m2])
    touch.down(2, sk[2]['x'], sk[2]['y']); touch.move(2, sk[2]['x'] - 60, sk[2]['y'] + 50); wait(150)
    aim_ok = ev("__xq.hud.aimWorld(__xq.hud.aim).ok")
    page.screenshot(path=f'{OUT}/e2e-constellation-aim.png')
    touch.up(2); wait(200)
    st3 = ev("({cast: __xq.hud.lastCast, cd: __xq.game.player.cds[2], marks: __xq.game.marks.length})")
    check('三星结界以两枚星标 + 落点成阵并消耗星标', aim_ok and st3['cast']['skill'] == 2 and st3['cast']['ok'] and st3['cd'] > 20 and st3['marks'] == 0, st3)
    # 缺标记时取消且不进冷却
    ev("__xq.game.player.cds[2] = 0")
    touch.down(2, sk[2]['x'], sk[2]['y']); touch.move(2, sk[2]['x'] - 60, sk[2]['y'] + 50); wait(100); touch.up(2); wait(150)
    st4 = ev("({cast: __xq.hud.lastCast, cd: __xq.game.player.cds[2]})")
    check('缺星标时三星结界取消、不进冷却', (st4['cast'] or {}).get('reason') == 'marks' and st4['cd'] == 0, st4)

    # ---------- 4. 拖到取消区放弃 ----------
    ev("__xq.game.player.cds[0] = 0; __xq.hud.lastCast = null")
    touch.down(2, sk[0]['x'], sk[0]['y']); touch.move(2, lay['cancel']['x'], lay['cancel']['y']); wait(120)
    hot = ev("__xq.hud.aim.cancel"); touch.up(2); wait(150)
    st5 = ev("({cast: __xq.hud.lastCast, cd: __xq.game.player.cds[0]})")
    check('拖到取消区松手：不施放、不进冷却', hot and st5['cast'] is None and st5['cd'] == 0, st5)

    # ---------- 5. 普攻键（与摇杆同时） ----------
    touch.down(2, atk['x'], atk['y']); wait(150)
    a1 = ev("__xq.game.input.attack && __xq.game.input.mx > 0.3"); touch.up(2); wait(100)
    a2 = ev("__xq.game.input.attack")
    touch.up(1); wait(100)
    check('普攻键按住/松开生效，且不打断摇杆', a1 and not a2 and ev("__xq.game.input.mx === 0 && __xq.hud.joy.id === -1"))

    page.keyboard.down('d'); wait(150); kb = ev("__xq.game.input.mx"); page.keyboard.up('d'); wait(80)
    check('桌面调试键位（WASD）可用', kb == 1 and ev("__xq.game.input.mx") == 0)

    # ---------- 6. 镜头：平滑跟随 / 边缘限位 / 构图标定 ----------
    ev("(() => { const g = __xq.game, p = g.player; p.x = 600; p.y = 600; })()")
    wait(34)
    lag = ev("Math.hypot(__xq.cam.x - 600, __xq.cam.y - 600)")
    wait(1500)
    settled = ev("Math.hypot(__xq.cam.x - __xq.game.player.x, __xq.cam.y - __xq.game.player.y)")
    check('镜头平滑跟随（瞬移后先滞后、随后追上）', lag > 30 and settled < 1.5, [round(lag, 1), round(settled, 2)])
    cal = ev("""(() => { const c = __xq.cam, t = __xq.tuning, a = c.toScreen(423, 764), b = c.toScreen(777, 436), v = c.view(), p = c.toScreen(__xq.game.player.x, __xq.game.player.y);
      const e1 = c.toScreen(600 + 46 * 0.68, 600 + 46 * 0.733), e2 = c.toScreen(600 - 46 * 0.68, 600 - 46 * 0.733), d = [b[0]-a[0], b[1]-a[1]], L = Math.hypot(d[0], d[1]);
      return { slope: -(b[1]-a[1])/(b[0]-a[0]), heroFrac: 37 * t.UNIT_SCALE * c.z / c.H, roadFrac: Math.abs((e1[0]-e2[0])*d[1] - (e1[1]-e2[1])*d[0]) / L / c.H, viewW: v[2]-v[0], viewD: v[3]-v[1], px: p[0]/c.W, py: p[1]/c.H, ky: t.KY }; })()""")
    cal['deg'] = round(math.degrees(math.atan(cal['slope'])), 1)
    bd = ev("__xq.renderer.scenery.backdrop")
    check('镜头标定：英雄约 20% 屏高；桥向斜率与底图一致（0.575±0.03）；地面压缩与底图相同；脚底在 0.47/0.62', abs(cal['heroFrac'] - 0.20) < 0.012 and abs(cal['slope'] - 0.575) < 0.03 and abs(cal['ky'] - bd['ky']) < 1e-6 and abs(cal['px'] - 0.47) < 0.02 and abs(cal['py'] - 0.62) < 0.02, {k: round(v, 3) for k, v in cal.items()})
    wr = bd['worldRect']; vv = ev("__xq.cam.view()")
    cov = max(0, min(wr[2], vv[2]) - max(wr[0], vv[0])) * max(0, min(wr[3], vv[3]) - max(wr[1], vv[1])) / ((vv[2] - vv[0]) * (vv[3] - vv[1]))
    check('站在桥心时底图覆盖屏幕 ≥ 90%（其余靠羽化边过渡到程序化地表）', cov >= 0.9, {'coverage': round(cov, 3), 'view': [round(n) for n in vv], 'backdrop': wr})
    page.screenshot(path=f'{OUT}/e2e-mid-lane.png')
    ev("(() => { const p = __xq.game.player; p.x = 80; p.y = 1090; })()"); wait(1200)
    v = ev("__xq.cam.view()")
    check('镜头到地图边缘限位', v[0] >= -40.5 and v[3] <= 1240.5, [round(n) for n in v])

    # ---------- 7. 岩体挡路（真实摇杆） ----------
    ev("(() => { const p = __xq.game.player; p.x = 150; p.y = 772; })()")   # 岩体 (235,768) r42 的正左侧
    touch.down(1, 150, 290); touch.move(1, 200, 290)                        # 一直往右推
    mind = 1e9
    for _ in range(40):
        wait(80)
        mind = min(mind, ev("Math.hypot(__xq.game.player.x - 235, __xq.game.player.y - 768)"))
    px = ev("__xq.game.player.x"); touch.up(1)
    check('摇杆顶着岩体走：不穿模，贴边绕过', mind >= 51.9 and px > 235 + 42, [round(mind, 1), round(px)])

    # ---------- 8. 竖屏提示并暂停 ----------
    page.set_viewport_size({'width': 390, 'height': 844}); wait(300)
    t0 = ev("__xq.game.time"); wait(500); t1 = ev("__xq.game.time")
    check('竖屏显示横屏提示并暂停对局', ev("getComputedStyle(document.getElementById('rotate')).display") == 'flex' and t1 == t0)
    page.set_viewport_size({'width': 844, 'height': 390}); wait(300)

    # ---------- 8b. 安全区：模拟 iPhone 横屏（左右刘海 47、底部横条 21），所有常驻按钮必须完整落在安全区内 ----------
    for vw, vh, safe in ((844, 390, (47, 47, 0, 21)), (932, 430, (59, 59, 0, 21)), (667, 375, (0, 0, 0, 0))):
        pg2 = ctx.new_page(); pg2.set_viewport_size({'width': vw, 'height': vh})
        pg2.goto(URL + ('?r=' + BACKEND + '&' if BACKEND else '?') + 'paused=1&safe=' + ','.join(map(str, safe))); pg2.wait_for_function('window.__xq')
        rects = pg2.evaluate('__xq.hud.controlRects()')
        bad = {k: [round(n) for n in r] for k, r in rects.items() if r[0] < safe[0] or r[2] > vw - safe[1] or r[1] < safe[2] or r[3] > vh - safe[3]}
        names = list(rects); overlap = [(a, b) for i, a in enumerate(names) for b in names[i + 1:] if a != 'cancel' and b != 'cancel' and not (rects[a][2] <= rects[b][0] or rects[b][2] <= rects[a][0] or rects[a][3] <= rects[b][1] or rects[b][3] <= rects[a][1])]
        check(f'{vw}×{vh} 安全区 {safe}：小地图、摇杆、普攻、技能键完整可见且互不重叠', not bad and not overlap, bad or overlap or '')
        if vw == 844: pg2.wait_for_timeout(300); pg2.screenshot(path=f'{OUT}/e2e-safe-area.png')
        pg2.close()

    # ---------- 9. 整局：水晶被摧毁 → 结算 → 重开（JSON 原始数值，玩家不操作，16 倍速） ----------
    ev("__xq.restart(); __xq.setSpeed(16)")
    page.wait_for_function('__xq.game.over', timeout=120000)
    wait(300)
    end = ev("({winner: __xq.game.winner, time: __xq.game.time, blueCore: __xq.game.cores.blue.alive, down: __xq.game.towers.filter(t => !t.alive).map(t => t.jsonId)})")
    check('水晶被摧毁后进入结算', end['winner'] in ('red', 'blue') and not end['blueCore'], end)
    page.screenshot(path=f'{OUT}/e2e-result.png')
    frozen = ev("[__xq.game.time, __xq.game.minions.length]"); wait(600)
    check('结算后对局停止', ev("[__xq.game.time, __xq.game.minions.length]") == frozen)
    ev("__xq.setSpeed(1)")
    rb = lay['restart']
    touch.down(1, rb['x'] + rb['w'] / 2, rb['y'] + rb['h'] / 2); touch.up(1); wait(400)
    rs = ev("""({over: __xq.game.over, time: __xq.game.time, towers: __xq.game.towers.filter(t => t.alive).length, minions: __xq.game.minions.length,
      cores: [__xq.game.cores.blue.hp, __xq.game.cores.red.hp], cds: __xq.game.player.cds, marks: __xq.game.marks.length, kills: __xq.game.kills})""")
    check('点「再来一局」后场上单位、冷却、计时全部复位', (not rs['over']) and rs['time'] < 1 and rs['towers'] == 18 and rs['minions'] == 0 and rs['cds'] == [0, 0, 0] and rs['marks'] == 0 and rs['kills'] == {'blue': 0, 'red': 0}, rs)
    page.screenshot(path=f'{OUT}/e2e-restarted.png')
    check('全程无脚本报错', not errors, errors[:3])
    browser.close()

print(f'\n{sum(results)}/{len(results)} 项通过')
sys.exit(0 if all(results) else 1)
