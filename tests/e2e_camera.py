"""镜头试验的浏览器验证：两档屏高的判定一致性、敌塔屏边提示、塔偏移（含射程边缘来回走的抖动测量）、技能瞄准取景。
用法：先 npm start，再 python3 tests/e2e_camera.py [http://localhost:5173/]
暂停实时循环，用 __xq.advance(1/30) 固定步长推进，输入走真实的触摸事件（CDP）。
"""
import json, math, sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:5173/'
results = []
def check(name, ok, detail=''):
    results.append(ok); print(('PASS ' if ok else 'FAIL ') + name + (('  — ' + str(detail)) if detail != '' else ''))

class Touch:
    def __init__(self, cdp): self.cdp, self.pts = cdp, {}
    def _send(self, kind): self.cdp.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': [{'x': x, 'y': y, 'id': i} for i, (x, y) in self.pts.items()]})
    def down(self, i, x, y): self.pts[i] = (x, y); self._send('touchStart')
    def move(self, i, x, y): self.pts[i] = (x, y); self._send('touchMove')
    def up(self, i):
        x, y = self.pts.pop(i); self.cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': [{'x': x, 'y': y, 'id': i}]})

SETUP = """(() => { const g = __xq.game; __xq.restart(); const p = g.player; p.x = %d; p.y = %d;
  const foe = g.heroes.find(h => h.team === 'red' && h.lane === 'mid'); foe.speed = 0;      // 对线 AI 留在出生点，场景里只留防御塔这一个威胁
  window.__keep = true; __xq.cam.ox = __xq.cam.oy = 0; __xq.cam.snap(p.x, p.y); })()"""
ADV = "(n) => { const g = __xq.game; for (let i = 0; i < n; i++) { if (window.__keep) g.player.hp = g.player.maxHp; __xq.advance(1 / 30); } return g.time; }"
STATE = """(() => { const g = __xq.game, p = g.player, c = __xq.cam, r = __xq.rig, t = g.towers.find(t => t.jsonId === 'red-mid-t1'), sr = __xq.hud.safeRect(), s = c.toScreen(t.x, t.y);
  return { x: p.x, y: p.y, hp: p.hp, cds: p.cds, dist: Math.hypot(t.x - p.x, t.y - p.y), locked: t.target === p, ox: c.ox, oy: c.oy, mode: r.mode, z: c.z,
           baseOn: s[0] >= sr[0] && s[0] <= sr[2] && s[1] >= sr[1] && s[1] <= sr[3], hints: r.hints.map(h => ({ id: h.tower.jsonId, locked: h.locked, x: h.x, y: h.y })) }; })()"""

def open_page(ctx, q):
    pg = ctx.new_page(); pg.goto(URL + '?paused=1' + q); pg.wait_for_function('window.__xq && __xq.renderer.sceneReady')
    return pg, Touch(ctx.new_cdp_session(pg))

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 844, 'height': 390}, device_scale_factor=1, has_touch=True, is_mobile=True)

    # ---------- 1. 两档屏高：同一串触控输入 → 模拟结果逐项相同 ----------
    runs = {}
    for vh in (120, 102):
        pg, t = open_page(ctx, f'&viewh={vh}')
        lay = pg.evaluate("({sk: __xq.hud.skillBtns, atk: __xq.hud.atkBtn})"); sk = lay['sk']
        pg.evaluate(SETUP % (640, 660)); pg.evaluate("window.__keep = false")
        t.down(1, 150, 290); t.move(1, 150, 240); pg.evaluate(ADV, 20)                       # 向上走进塔射程
        t.down(2, sk[0]['x'], sk[0]['y']); t.move(2, sk[0]['x'] + 78, sk[0]['y']); pg.evaluate(ADV, 10); t.up(2); pg.evaluate(ADV, 20)
        t.down(2, sk[1]['x'], sk[1]['y']); t.move(2, sk[1]['x'], sk[1]['y'] - 78); pg.evaluate(ADV, 6); t.up(2)
        t.move(1, 110, 290); pg.evaluate(ADV, 40); t.up(1); pg.evaluate(ADV, 10)
        s = pg.evaluate(STATE); runs[vh] = {k: s[k] for k in ('x', 'y', 'hp', 'cds', 'dist', 'locked')}
        runs[vh]['marks'] = pg.evaluate("__xq.game.marks.map(m => [m.x, m.y])"); runs[vh]['time'] = pg.evaluate("__xq.game.time"); pg.close()
    check('屏高 120 与 102：同一串触控后位置、血量、冷却、星标落点、塔锁定状态完全一致', json.dumps(runs[120]) == json.dumps(runs[102]), runs[120])

    # ---------- 2. 屏边提示（只开提示） ----------
    for vh, expect_hint in ((120, False), (102, True)):
        pg, t = open_page(ctx, f'&viewh={vh}')
        pg.evaluate(SETUP % (644, 639)); pg.evaluate(ADV, 2); s0 = pg.evaluate(STATE)
        pg.evaluate("__xq.game.player.y = 603"); pg.evaluate(ADV, 45); s1 = pg.evaluate(STATE)
        ok = s0['hints'] == [] and s1['locked'] and (len(s1['hints']) == 1 and s1['hints'][0]['locked'] and not s1['baseOn']) == expect_hint
        check(f'屏高 {vh}：站在塔南侧 103 单位处被锁定 → ' + ('塔底座已出取景框，出现强化箭头' if expect_hint else '塔底座仍在取景框内，不出箭头'), ok and s1['ox'] == 0 and s1['oy'] == 0, {'dist': round(s1['dist'], 1), 'baseOn': s1['baseOn'], 'hints': s1['hints']})
        # 塔北侧：底座在屏幕下沿之外，两档都应提示
        pg.evaluate("(() => { const p = __xq.game.player; p.x = 669; p.y = 435; __xq.cam.snap(p.x, p.y); })()"); pg.evaluate(ADV, 30); s2 = pg.evaluate(STATE)
        check(f'屏高 {vh}：站在塔北侧（底座落到屏幕下沿外）→ 出现箭头并指向下方', len(s2['hints']) == 1 and s2['hints'][0]['y'] > 250, s2['hints'])
        if vh == 102: pg.screenshot(path='/tmp/hint-102.png')
        pg.close()

    # ---------- 3. 塔偏移（102 档，独立开关） ----------
    pg, t = open_page(ctx, '&viewh=102&toweroffset=1')
    pg.evaluate(SETUP % (644, 639)); pg.evaluate(ADV, 10); a = pg.evaluate(STATE)
    pg.evaluate("__xq.game.player.y = 603"); pg.evaluate(ADV, 60); bst = pg.evaluate(STATE)
    cap = pg.evaluate("__xq.rig.towerCap")
    pg.evaluate("(() => { const p = __xq.game.player; p.x = 649; p.y = 619; })()"); pg.evaluate(ADV, 60); far = pg.evaluate(STATE)
    check('塔偏移：未被锁定时不动；锁定且底座出屏后把底座拉回安全框，位移不超过上限（横 19 / 纵 26）', a['ox'] == 0 and a['oy'] == 0 and bst['mode'] == 'tower' and bst['baseOn'] and bst['hints'] == [] and abs(far['oy']) <= cap['y'] + 1e-6 and abs(abs(far['oy']) - cap['y']) < 0.2,
          {'南侧90处偏移': [round(bst['ox'], 1), round(bst['oy'], 1)], '底座回到框内': bst['baseOn'], '南侧106处偏移(到上限)': round(far['oy'], 1)})
    pg.evaluate("(() => { const p = __xq.game.player; p.x = 644; p.y = 690; })()"); pg.evaluate(ADV, 90); c2 = pg.evaluate(STATE)
    check('塔偏移：离开威胁后 3 秒内平滑回中（残余 < 0.3 世界单位）', not c2['locked'] and abs(c2['ox']) < 0.3 and abs(c2['oy']) < 0.3, [round(c2['ox'], 2), round(c2['oy'], 2)])
    # 沿射程边缘来回走：摇杆上下各 0.5 秒 × 8 个来回，记录每帧镜头偏移
    pg.evaluate("(() => { const p = __xq.game.player; p.x = 644; p.y = 633; __xq.cam.snap(p.x, p.y); })()"); pg.evaluate(ADV, 30)
    t.down(1, 150, 290); series = []
    for cyc in range(8):
        for dy in (-50, 50):
            t.move(1, 150, 290 + dy)
            for _ in range(15):
                pg.evaluate(ADV, 1); s = pg.evaluate("(() => { const c = __xq.cam, g = __xq.game, t = g.towers.find(t => t.jsonId === 'red-mid-t1'); return [c.oy * c.z * __xq.tuning.KY, t.target === g.player ? 1 : 0, c.toScreen(g.player.x, g.player.y)[1]]; })()"); series.append(s)
    t.up(1)
    oy = [s[0] for s in series]; d = [oy[i + 1] - oy[i] for i in range(len(oy) - 1)]
    rev = sum(1 for i in range(len(d) - 1) if d[i] * d[i + 1] < 0 and abs(d[i]) > 0.3 and abs(d[i + 1]) > 0.3)
    jerk = max(abs(d[i + 1] - d[i]) for i in range(len(d) - 1))
    locks = sum(1 for i in range(len(series) - 1) if series[i][1] != series[i + 1][1])
    jit = {'玩家换向次数': 16, '锁定切换次数': locks, '镜头换向次数': rev, '每帧最大位移px': round(max(abs(x) for x in d), 2), '相邻两帧位移差最大px': round(jerk, 2), '偏移摆动范围px': [round(min(oy), 1), round(max(oy), 1)], '时长s': len(series) / 30}
    check('塔偏移：沿射程边缘来回走 8 个来回（测量项，见数值）：镜头换向少于玩家换向、没有单帧跳变（相邻两帧位移差 ≤ 6px）', rev < 16 and jerk <= 6, jit)
    pg.close()

    # ---------- 4. 技能瞄准取景 ----------
    for vh in (120, 102):
        pg, t = open_page(ctx, f'&viewh={vh}&aimcam=full')
        sk = pg.evaluate("__xq.hud.skillBtns"); cancel = pg.evaluate("__xq.hud.cancelBtn")
        pg.evaluate(SETUP % (640, 660)); pg.evaluate(ADV, 5)
        t.down(2, sk[0]['x'], sk[0]['y']); t.move(2, sk[0]['x'] + 78, sk[0]['y']); pg.evaluate(ADV, 1)
        w0 = pg.evaluate("__xq.hud.aimWorld(__xq.hud.aim)"); pg.evaluate(ADV, 30)
        w1 = pg.evaluate("__xq.hud.aimWorld(__xq.hud.aim)"); s = pg.evaluate(STATE)
        tip = pg.evaluate("(() => { const w = __xq.hud.aimWorld(__xq.hud.aim), s = __xq.cam.toScreen(w.x, w.y), r = __xq.hud.safeRect(); return { sx: s[0], right: r[2] }; })()")
        check(f'屏高 {vh}：弦月向右拖满 → 镜头朝落点平移，射程末端进入安全框；同一拖动量的世界落点不随镜头移动而变', s['mode'] == 'aim' and s['ox'] > 3 and tip['sx'] <= tip['right'] + 1 and abs(w0['x'] - w1['x']) < 1e-6 and abs(w0['y'] - w1['y']) < 1e-6,
              {'offsetX': round(s['ox'], 1), 'tipX': round(tip['sx']), 'safeRight': round(tip['right']), 'aimWorld': [round(w1['x'], 1), round(w1['y'], 1)]})
        t.move(2, cancel['x'], cancel['y']); pg.evaluate(ADV, 2); t.up(2); pg.evaluate(ADV, 45); s2 = pg.evaluate(STATE); print('   回中残余', round(s2['ox'], 3), round(s2['oy'], 3), s2['mode'], s2['cds'])
        check(f'屏高 {vh}：拖到取消区松手 → 不施放，镜头 1.5 秒内回中', s2['cds'][0] == 0 and abs(s2['ox']) < 0.3 and abs(s2['oy']) < 0.3 and s2['mode'] == 'none', [round(s2['ox'], 2), s2['cds'][0]])
        pg.close()
    # 瞄准期间优先取景，塔继续用箭头提示（102 + 塔偏移开）
    pg, t = open_page(ctx, '&viewh=102&toweroffset=1&aimcam=full')
    sk = pg.evaluate("__xq.hud.skillBtns"); pg.evaluate(SETUP % (649, 619)); pg.evaluate(ADV, 60); s0 = pg.evaluate(STATE)
    t.down(1, 150, 290); t.move(1, 115, 255)                                                   # 左手往左上走
    t.down(2, sk[0]['x'], sk[0]['y']); t.move(2, sk[0]['x'] + 78, sk[0]['y'] + 10); pg.evaluate(ADV, 12); s1 = pg.evaluate(STATE)
    check('两指同时操作：边走边拖满弦月 → 取景模式为"瞄准"，塔偏移让位，被锁定的塔改用箭头提示', s0['mode'] == 'tower' and s1['mode'] == 'aim' and s1['x'] < s0['x'] - 15 and any(h['locked'] for h in s1['hints']), {'before': s0['mode'], 'during': s1['mode'], 'hints': len(s1['hints'])})
    t.up(2); pg.evaluate(ADV, 3); s2 = pg.evaluate(STATE)
    check('松手施放弦月并进入冷却', s2['cds'][0] > 3)
    t.up(1); pg.close()

    # ---------- 4b. 敌塔锁定提示：画面内 = 脚下红环，出框 = 屏边红箭头 ----------
    LK = "(() => { const g = __xq.game, r = __xq.rig, t = g.towers.find(t => t.jsonId === 'red-mid-t1'); return { mode: r.lock.mode, alpha: r.lock.alpha, flash: r.lock.flash, locked: t.target === g.player, hints: r.hints.map(h => h.locked), alive: t.alive }; })()"
    pg, t = open_page(ctx, '')
    pg.evaluate(SETUP % (540, 655)); pg.evaluate(ADV, 5); n0 = pg.evaluate(LK)
    pg.evaluate("(() => { const p = __xq.game.player; p.x = 624; p.y = 578; __xq.cam.snap(p.x, p.y); })()"); pg.evaluate(ADV, 2); a1 = pg.evaluate(LK); pg.evaluate(ADV, 20); a2 = pg.evaluate(LK)
    check('塔在画面内锁定玩家：脚下红环出现，锁定瞬间提亮、0.3 秒后转为常亮；不出箭头', n0['mode'] == 'none' and n0['alpha'] == 0 and a1['locked'] and a1['mode'] == 'ring' and a1['alpha'] == 1 and a1['flash'] > 0.5 and a2['mode'] == 'ring' and a2['alpha'] == 1 and a2['flash'] == 0 and a2['hints'] == [], [a1, a2])
    pg.screenshot(path='/tmp/lock-ring.png')
    # 同一座塔出框 → 红环淡出、改成红箭头；回到框内 → 换回红环
    pg.evaluate("(() => { const p = __xq.game.player; p.x = 644; p.y = 611; __xq.cam.snap(p.x, p.y); })()"); pg.evaluate(ADV, 8); b1 = pg.evaluate(LK)
    check('锁定玩家的塔出框：0.2 秒内红环淡出，改用屏边红箭头', b1['locked'] and b1['mode'] == 'arrow' and b1['alpha'] == 0 and b1['hints'] == [True], b1)
    # 贴着框边来回走（塔底座在取景框上沿附近进出），全程保持被锁定：每帧必须恰好是红环或箭头之一，切换次数不超过实际越线次数
    # 先找出塔底座正好压在取景框上沿时玩家的 y，再以它为中心小幅来回走
    thr = pg.evaluate("(() => { const g = __xq.game, p = g.player, c = __xq.cam, t = g.towers.find(t => t.jsonId === 'red-mid-t1'), top = __xq.hud.safeRect()[1]; p.x = 644; for (let y = 570; y < 625; y += 0.25) { p.y = y; c.snap(p.x, p.y); if (c.toScreen(t.x, t.y)[1] < top) return y; } return -1; })()")
    Q = "(() => { const g = __xq.game, r = __xq.rig, c = __xq.cam, t = g.towers.find(t => t.jsonId === 'red-mid-t1'), s = c.toScreen(t.x, t.y), sr = __xq.hud.safeRect(); return [r.lock.mode, t.target === g.player, s[1] >= sr[1], r.hints.filter(h => h.locked).length, s[1]]; })()"
    def walk(amp, cycles, half):
        # 让塔底座在取景框上沿两侧按三角波移动（直接摆放玩家+镜头，排除跟随平滑的影响；提示逻辑只看几何）
        pg.evaluate("(y) => { const p = __xq.game.player; p.x = 644; p.y = y; p.hp = p.maxHp; __xq.cam.snap(p.x, p.y); }", thr - 14); pg.evaluate(ADV, 12)
        seq = []
        for i in range(cycles * half * 2):
            ph = (i % (2 * half)) / half; tri = ph if ph <= 1 else 2 - ph            # 0→1→0
            pg.evaluate("(y) => { const p = __xq.game.player; p.y = y; p.hp = p.maxHp; __xq.cam.snap(p.x, p.y); }", thr - 0.125 + (tri * 2 - 1) * amp); pg.evaluate(ADV, 1); seq.append(pg.evaluate(Q))
        raw = sum(1 for i in range(len(seq) - 1) if seq[i][2] != seq[i + 1][2]); sw = sum(1 for i in range(len(seq) - 1) if seq[i][0] != seq[i + 1][0])
        ok = all(s[1] for s in seq) and all((s[0] == 'ring' and s[3] == 0) or (s[0] == 'arrow' and s[3] == 1) for s in seq)
        return ok, raw, sw
    ok1, raw1, sw1 = walk(3, 12, 3)       # 底座在框边 ±7px 内抖动，落在 ±14px 回差带里
    check('塔底座在框边 ±7px 内来回 12 次：每帧恰好是红环或红箭头之一；底座反复越线但提示不切换', thr > 0 and ok1 and raw1 >= 20 and sw1 == 0, {'玩家y': thr, '底座越过框边': raw1, '红环/箭头切换': sw1})
    ok2, raw2, sw2 = walk(11, 4, 8)       # ±27px：真正出框/进框
    check('塔底座越过框边 ±27px 来回 4 次：每帧恰好是红环或红箭头之一；每次真正出框/进框都切换一次', ok2 and raw2 == 8 and sw2 == raw2, {'底座越过框边': raw2, '红环/箭头切换': sw2})
    # 塔转火小兵
    pg.evaluate("(() => { const p = __xq.game.player; p.x = 624; p.y = 578; __xq.cam.snap(p.x, p.y); })()"); pg.evaluate(ADV, 10); c0 = pg.evaluate(LK)
    pg.evaluate("(() => { const g = __xq.game; while (!g.minions.some(m => m.team === 'blue' && m.lane === 'mid')) __xq.advance(1 / 30); const t = g.towers.find(t => t.jsonId === 'red-mid-t1'), m = g.minions.find(m => m.team === 'blue' && m.lane === 'mid'); g.player.hp = g.player.maxHp; m.x = t.x - 40; m.y = t.y + 40; m.hp = m.maxHp = 9999; t.target = m; })()")
    pg.evaluate(ADV, 7); c1 = pg.evaluate(LK)
    check('塔转火小兵：红环 0.2 秒内淡出', c0['mode'] == 'ring' and not c1['locked'] and c1['mode'] == 'none' and c1['alpha'] == 0, [c0['mode'], c1])
    pg.close()
    # 边走边瞄准时红环保持；塔被摧毁时提示清除
    pg, t = open_page(ctx, '&aimcam=full'); sk = pg.evaluate("__xq.hud.skillBtns")
    pg.evaluate(SETUP % (624, 578)); pg.evaluate(ADV, 12)
    t.down(1, 150, 290); t.move(1, 150 - 40, 290 - 20); t.down(2, sk[1]['x'], sk[1]['y']); t.move(2, sk[1]['x'] + 50, sk[1]['y'] - 40); pg.evaluate(ADV, 6); d1 = pg.evaluate(LK); md = pg.evaluate('__xq.rig.mode')
    t.up(2); t.up(1)
    check('边走边瞄准（镜头在取景）：红环照常显示', d1['locked'] and d1['mode'] == 'ring' and d1['alpha'] == 1 and md == 'aim', [d1, md])
    pg.evaluate("(() => { const g = __xq.game, t = g.towers.find(t => t.jsonId === 'red-mid-t1'); g.player.x = 624; g.player.y = 578; g.player.hp = g.player.maxHp; })()"); pg.evaluate(ADV, 20)
    e0 = pg.evaluate(LK); pg.evaluate("(() => { const g = __xq.game, t = g.towers.find(t => t.jsonId === 'red-mid-t1'); g.damage(g.player, t, 99999); })()"); pg.evaluate(ADV, 7); e1 = pg.evaluate(LK)
    check('锁定玩家的塔被摧毁：红环和箭头都清除', e0['mode'] == 'ring' and not e1['alive'] and e1['mode'] == 'none' and e1['alpha'] == 0 and e1['hints'] == [], [e0['mode'], e1])
    pg.close()

    # ---------- 4c. 镜头稳定：站定时受击、普攻、瞄准、取消、塔毁都不带动画面 ----------
    CAMP = "(() => { const c = __xq.cam; return [c.x * c.z, c.y * c.z * __xq.tuning.KY]; })()"
    pg, t = open_page(ctx, ''); sk = pg.evaluate("__xq.hud.skillBtns"); atk = pg.evaluate("__xq.hud.atkBtn"); cz = pg.evaluate("__xq.hud.cancelBtn")
    pg.evaluate("(() => { for (let i = 0; i < 660; i++) __xq.game.update(1 / 30); const g = __xq.game, p = g.player; p.x = 590; p.y = 606; __xq.cam.snap(p.x, p.y); g.minions.filter(m => m.team === 'red' && m.alive).slice(0, 3).forEach((m, i) => { m.x = p.x + 16 + i * 9; m.y = p.y - 6 + i * 7; m.hp = m.maxHp = 400; }); })()")
    pg.evaluate(ADV, 3); c0 = pg.evaluate(CAMP); hp0 = pg.evaluate('__xq.game.player.hp'); mv = 0.0
    def drift(n):
        global mv
        for _ in range(n): pg.evaluate("__xq.game.player.hp = Math.max(__xq.game.player.hp, 200)"); pg.evaluate(ADV, 1); c = pg.evaluate(CAMP); mv = max(mv, abs(c[0] - c0[0]), abs(c[1] - c0[1]))
    drift(45); hit = pg.evaluate('__xq.game.player.hp') < hp0                      # 站着挨打
    t.down(3, atk['x'], atk['y']); drift(60); t.up(3)                               # 连续普攻
    t.down(2, sk[0]['x'], sk[0]['y']); t.move(2, sk[0]['x'] - 75, sk[0]['y'] - 20); drift(20); aiming = pg.evaluate('!!__xq.hud.aim')
    t.move(2, cz['x'], cz['y']); drift(8); t.up(2); drift(10); cd = pg.evaluate('__xq.game.player.cds[0]')   # 拖到取消区松手
    t.down(2, sk[1]['x'], sk[1]['y']); t.move(2, sk[1]['x'] - 50, sk[1]['y'] - 30); drift(12); t.up(2); drift(20); cd1 = pg.evaluate('__xq.game.player.cds[1]')   # 站定施法
    check('站定时受击、连续普攻、拖动瞄准、取消、施法：镜头位移为 0', hit and aiming and cd == 0 and cd1 > 0 and mv == 0, {'被打到': hit, '镜头最大位移px': mv, '取消后冷却': cd, '施法后冷却': round(cd1, 1)})
    # 急转向：英雄在屏幕上的摆幅（镜头滞后量）
    pg.evaluate("(() => { const g = __xq.game, p = g.player; p.x = 590; p.y = 606; p.hp = p.maxHp; __xq.cam.snap(p.x, p.y); })()"); xs = []
    for k in range(96):
        if k % 12 == 0: d = [(1, 0), (-1, 0), (1, 0), (-1, 0), (0, -1), (0, 1), (0, -1), (0, 1)][k // 12]; (t.down(1, 150, 290) if 1 not in t.pts else None); t.move(1, 150 + d[0] * 46, 290 + d[1] * 46)
        pg.evaluate("__xq.game.player.hp = __xq.game.player.maxHp"); pg.evaluate(ADV, 1); xs.append(pg.evaluate("(() => { const p = __xq.game.player; return __xq.cam.toScreen(p.x, p.y); })()"))
    t.up(1); sw = [max(v[i] for v in xs) - min(v[i] for v in xs) for i in (0, 1)]
    st = 0
    for k in range(30):
        a = pg.evaluate(CAMP); pg.evaluate(ADV, 1); b2 = pg.evaluate(CAMP)
        if a != b2: st = k + 1
    check('急转向 3 秒：英雄在屏幕上的摆幅 ≤ 30px（v11 是横 74 / 纵 47）；松手后 0.3 秒内镜头停稳', sw[0] <= 30 and sw[1] <= 30 and st <= 9, {'摆幅px': [round(v) for v in sw], '松手后镜头还在动的帧数': st})
    # 阵亡：镜头留在原地，复活时直接切到出生点（不横扫全图）
    a = pg.evaluate(CAMP); pg.evaluate("(() => { const g = __xq.game, p = g.player; g.damage(null, p, 99999); })()"); pg.evaluate(ADV, 30); b2 = pg.evaluate(CAMP)
    check('阵亡后镜头留在倒下的位置，不横扫回基地', not pg.evaluate('__xq.game.player.alive') and abs(a[0] - b2[0]) < 1 and abs(a[1] - b2[1]) < 1, [a, b2])
    pg.close()

    # ---------- 4d. 敌塔攻击范围边线 ----------
    import io
    from PIL import Image
    pg, t = open_page(ctx, '&r=canvas')
    RINGPT = "(() => { const g = __xq.game, p = g.player, t = g.towers.find(t => t.jsonId === 'red-mid-t1'), a = Math.atan2(p.y - t.y, p.x - t.x) + 0.45, s = __xq.cam.toScreen(t.x + Math.cos(a) * t.range, t.y + Math.sin(a) * t.range); return [s[0], s[1], t.range, Math.hypot(p.x - t.x, p.y - t.y), t.target === p]; })()"
    def ring_px(x, y):
        # 同一帧开/关边线各截一张，取该点附近的最大色差——只量边线本身，不受地面底色影响
        shots = []
        for on in (True, False):
            pg.evaluate("(v) => { __xq.renderer.towerRings = v; __xq.renderer.draw(0); __xq.hud.draw(document.getElementById('game').getContext('2d'), 0); }", on); shots.append(Image.open(io.BytesIO(pg.screenshot())).convert('RGB'))
        pg.evaluate("__xq.renderer.towerRings = true"); best = 0
        for dx in range(-3, 4):
            for dy in range(-3, 4):
                q = (int(round(x)) + dx, int(round(y)) + dy)
                if 0 <= q[0] < 844 and 0 <= q[1] < 390: a2, b3 = shots[0].getpixel(q), shots[1].getpixel(q); best = max(best, sum(abs(a2[i] - b3[i]) for i in range(3)))
        return best
    res = {}
    for label, (x, y) in {'射程外 140': (694 - 0.7335 * 256, 513 + 0.6797 * 256), '射程外 30': (694 - 0.7335 * 146, 513 + 0.6797 * 146), '射程内': (694 - 0.7335 * 100, 513 + 0.6797 * 100)}.items():
        pg.evaluate(SETUP % (int(x), int(y))); pg.evaluate("(() => { const g = __xq.game; for (const u of [...g.minions, ...g.heroes]) if (u.team === 'red') { u.hp = 0; u.alive = false; } })()"); pg.evaluate(ADV, 2); pt = pg.evaluate(RINGPT); res[label] = [round(ring_px(pt[0], pt[1])), round(pt[3])]
    check('敌塔范围边线：远处不画；靠近（射程外 70 内）出现淡线；进入射程后提亮', res['射程外 140'][0] == 0 and 12 <= res['射程外 30'][0] < res['射程内'][0] and res['射程内'][0] > 90, res)
    # 半径跟实际判定走：把 t.range 改成 80，线跟着移到 80；己方小兵扛塔（塔的目标不是玩家）时线仍在
    pg.evaluate("(() => { const g = __xq.game, t = g.towers.find(t => t.jsonId === 'red-mid-t1'), p = g.player; t.range = 80; p.x = t.x - 0.7335 * 70; p.y = t.y + 0.6797 * 70; __xq.cam.snap(p.x, p.y); const m = { ...g.minions.find(m => m.team === 'blue') }; })()")
    pg.evaluate("(() => { const g = __xq.game, t = g.towers.find(t => t.jsonId === 'red-mid-t1'); while (!g.minions.some(m => m.team === 'blue' && m.alive && m.lane === 'mid')) __xq.advance(1 / 30); const m = g.minions.find(m => m.team === 'blue' && m.alive && m.lane === 'mid'); m.x = t.x - 20; m.y = t.y + 30; m.hp = m.maxHp = 99999; t.target = m; g.player.hp = g.player.maxHp; })()")
    pg.evaluate(ADV, 2); pt = pg.evaluate(RINGPT); on80 = ring_px(pt[0], pt[1]); old = pg.evaluate("(() => { const g = __xq.game, p = g.player, t = g.towers.find(t => t.jsonId === 'red-mid-t1'), a = Math.atan2(p.y - t.y, p.x - t.x) + 0.45; return __xq.cam.toScreen(t.x + Math.cos(a) * 116, t.y + Math.sin(a) * 116); })()"); on116 = ring_px(old[0], old[1])
    check('边线半径读 t.range（改成 80 后线在 80 处、116 处没有）；塔在打小兵时边线仍显示', pt[2] == 80 and not pt[4] and on80 > 90 and on116 == 0, {'range': pt[2], '塔锁定玩家': pt[4], '80处': round(on80), '116处': round(on116)})
    pg.close()

    # ---------- 5. 试验按钮可点 ----------
    pg, t = open_page(ctx, '')
    d = pg.evaluate("({vh: __xq.rig.viewH, o: __xq.rig.opts, lab: __xq.hud.labBtns().length, us: __xq.tuning.UNIT_SCALE})")
    check('正式默认：屏高 102、塔提示开、瞄准取景关、塔偏移关、不显示试验按钮；英雄约 20% 屏高', d['vh'] == 102 and d['o'] == {'hint': True, 'towerOffset': False, 'aimCam': False, 'legacy': False} and d['lab'] == 0 and abs(37 * d['us'] / 102 - 0.2) < 0.01, d)
    pg.evaluate(SETUP % (644, 603)); pg.evaluate(ADV, 45)
    h = pg.evaluate("(() => { const u = innerHeight, hs = __xq.rig.hints, bar = __xq.hud.safe.t + 0.107 * u; return hs.map(h => ({ y: h.y, top: h.y - u * 0.058 * 1.75 * 1.16, barBottom: bar, locked: h.locked })); })()")
    check('上方箭头（含光晕）整体在计时条下沿之外', len(h) == 1 and h[0]['locked'] and h[0]['top'] >= h[0]['barBottom'], h)
    pg.screenshot(path='/tmp/hint-default.png'); pg.close()
    pg, t = open_page(ctx, '&lab=1')
    btns = pg.evaluate("__xq.hud.labBtns()"); z = btns[0]
    t.down(1, z['x'] + z['w'] / 2, z['y'] + z['h'] / 2); t.up(1); v1 = pg.evaluate("__xq.rig.viewH")
    t.down(1, z['x'] + z['w'] / 2, z['y'] + z['h'] / 2); t.up(1); v2 = pg.evaluate("__xq.rig.viewH")
    hero = pg.evaluate("37 * __xq.tuning.UNIT_SCALE")
    check('调试按钮（?lab=1）：点「屏高」在 102 ↔ 120 之间切换', v1 == 120 and v2 == 102, [v1, v2])
    pg.close(); b.close()

print(f'\n{sum(results)}/{len(results)} 项通过'); sys.exit(0 if all(results) else 1)
