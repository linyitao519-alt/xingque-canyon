"""动画、特效、音效的浏览器验证。用法：先 npm start，再 python3 tests/e2e_media.py [http://localhost:5173/]"""
import math, sys
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
ADV = "(n) => { for (let i = 0; i < n; i++) __xq.advance(1 / 30); }"
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 844, 'height': 390}, device_scale_factor=1, has_touch=True, is_mobile=True)
    pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.goto(URL + '?paused=1'); pg.wait_for_function('window.__xq && __xq.renderer.sceneReady'); t = Touch(ctx.new_cdp_session(pg))
    pg.evaluate('__xq.animReady'); pg.wait_for_function("Object.keys(__xq.renderer.fx).length === 8", timeout=10000)
    check('动画帧带已加载：六名英雄 + 四种小兵', sorted(pg.evaluate('__xq.anim.loaded')) == ['chiyan', 'feixian', 'hedeng', 'melee-blue', 'melee-red', 'ranged-blue', 'ranged-red', 'xingli', 'xuanyuan', 'yelan'])
    check('8 张特效/弹体贴图已加载', sorted(pg.evaluate('Object.keys(__xq.renderer.fx)')) == ['beacon', 'beacon-burst', 'crescent', 'hero-bolt', 'tower-bolt-blue', 'tower-bolt-red', 'triangle-edge', 'triangle-vertex'])
    check('触控前音频尚未解锁（浏览器策略）', pg.evaluate('__xq.sfx.ctx === null'))
    ST = "(() => { const a = __xq.anim.last[__xq.game.player.id]; return a ? a.state : null; })()"
    sk = pg.evaluate('__xq.hud.skillBtns'); mute = pg.evaluate('__xq.hud.muteBtn')
    # 摇杆移动 → run；松开 → idle
    t.down(1, 150, 290); t.move(1, 196, 290); pg.evaluate(ADV, 6); pg.wait_for_timeout(120); run = pg.evaluate(ST)
    pg.wait_for_function('__xq.sfx.ready', timeout=10000)
    check('首次触控后音频解锁，8 个音效解码完成', pg.evaluate("__xq.sfx.ctx.state") == 'running')
    t.up(1); pg.evaluate(ADV, 6); pg.wait_for_timeout(120); idle = pg.evaluate(ST)
    check('星璃：推摇杆播跑步帧，松开回到待机帧', run == 'run' and idle == 'idle', [run, idle])
    # 弦月 → 出手动作 + 出手音效
    s0 = pg.evaluate('__xq.sfx.stats["attack-cast"] || 0')
    t.down(2, sk[0]['x'], sk[0]['y']); t.move(2, sk[0]['x'] + 70, sk[0]['y'] - 20); pg.evaluate(ADV, 2); t.up(2); pg.evaluate(ADV, 2); pg.wait_for_timeout(120)
    atk = pg.evaluate(ST); s1 = pg.evaluate('__xq.sfx.stats["attack-cast"] || 0'); n = pg.evaluate('__xq.game.crescents.length')
    check('弦月：播出手帧、响出手音效、弦月贴图在飞', atk == 'attack' and s1 == s0 + 1 and n == 1, [atk, s0, s1, n])
    pg.evaluate(ADV, 20); pg.wait_for_timeout(120); check('出手动作播完后回到待机', pg.evaluate(ST) == 'idle')
    # 定星 ×2 + 三星结界 → 各自的音效
    for dx, dy in ((60, -30), (10, -70)):
        pg.evaluate('__xq.game.player.cds[1] = 0'); t.down(2, sk[1]['x'], sk[1]['y']); t.move(2, sk[1]['x'] + dx, sk[1]['y'] + dy); pg.evaluate(ADV, 2); t.up(2); pg.evaluate(ADV, 3)
    t.down(2, sk[2]['x'], sk[2]['y']); t.move(2, sk[2]['x'] + 75, sk[2]['y'] - 75); pg.evaluate(ADV, 2); t.up(2); pg.evaluate(ADV, 3)
    st = pg.evaluate('__xq.sfx.stats')
    check('定星两次、三星结界一次：星标音效 2 次、结界闭合音效 1 次', st.get('beacon-placed') == 2 and st.get('constellation-close') == 1, st)
    # 静音键
    t.down(1, mute['x'], mute['y']); t.up(1); m1 = pg.evaluate('[__xq.hud.muted, __xq.sfx.muted]')
    t.down(1, mute['x'], mute['y']); t.up(1); m2 = pg.evaluate('[__xq.hud.muted, __xq.sfx.muted]')
    check('右上角静音键可开关', m1 == [True, True] and m2 == [False, False], [m1, m2])
    # 实战里的事件音效：把星璃放到桥心，让对局自己跑到 60 秒（小兵在身边交战）
    pg.evaluate("(() => { const g = __xq.game, p = g.player; p.x = 600; p.y = 606; while (g.time < 60) { p.hp = p.maxHp; __xq.advance(1 / 30); } })()"); pg.wait_for_timeout(150)
    st = pg.evaluate('__xq.sfx.stats'); mn = pg.evaluate("Object.values(__xq.anim.last).map(a => a.state)")
    check('自动对局到 60 秒：身边的命中音效被触发；画面里的单位出现过跑步或攻击帧', st.get('attack-hit', 0) > 5 and ('run' in mn or 'attack' in mn), {k: st[k] for k in sorted(st)})
    far = pg.evaluate("(() => { const g = __xq.game, s = __xq.sfx, p = g.player, a = s.stats['attack-hit']; p.x = 150; p.y = 1043; for (let i = 0; i < 150; i++) __xq.advance(1 / 30); return s.stats['attack-hit'] - a; })()")
    check('离战场 300 单位以外听不到命中音效', far == 0, far)
    th = pg.evaluate("(() => { const g = __xq.game, s = __xq.sfx, p = g.player, t = g.towers.find(t => t.jsonId === 'red-mid-t1'); p.x = 640; p.y = 560; const a = s.stats['tower-hit'] || 0; g.time += 1e-6; g.damage(p, t, 10); __xq.advance(1 / 30); return (s.stats['tower-hit'] || 0) - a; })()")
    check('塔受击音效', th == 1, th)
    # 整局结束 → 结算音效；重开后音效继续工作
    pg.evaluate("(() => { let n = 0; while (!__xq.game.over && n++ < 20000) __xq.advance(1 / 30); })()")
    st = pg.evaluate('__xq.sfx.stats'); w = pg.evaluate('__xq.game.winner')
    exp = {'blue': 'victory', 'red': 'defeat'}.get(w)
    check('整局结束：塔毁音效响过；按胜负播放一次结算音效（平局不播）', st.get('tower-destroyed', 0) >= 1 and (exp is None or st.get(exp) == 1) and st.get('victory', 0) + st.get('defeat', 0) == (0 if exp is None else 1), {'winner': w, 'tower-destroyed': st.get('tower-destroyed'), 'victory': st.get('victory'), 'defeat': st.get('defeat')})
    pg.evaluate('__xq.restart()'); c0 = pg.evaluate('__xq.sfx.stats["attack-cast"]')
    pg.evaluate('__xq.game.castCrescent(1, 0)'); pg.evaluate(ADV, 2); c1 = pg.evaluate('__xq.sfx.stats["attack-cast"]')
    check('重开后音效继续工作', c1 == c0 + 1, [c0, c1])
    # 星璃的星盘：独立贴图，跟随固定挂点
    pg.evaluate("(() => { __xq.restart(); const p = __xq.game.player; p.x = 560; p.y = 640; __xq.cam.snap(p.x, p.y); })()")
    FR = "() => { const g = __xq.game, p = g.player; p.hp = p.maxHp; __xq.advance(1 / 30); return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r([__xq.anim.last[p.id].state, __xq.attach[p.id].x, __xq.attach[p.id].y])))); }"
    at = pg.evaluate("fetch('assets/anim/anim.json').then(r => r.json()).then(d => d.units.xingli.attach)")
    seq = [pg.evaluate(FR) for _ in range(12)]; t.down(1, 150, 290); t.move(1, 196, 290); seq += [pg.evaluate(FR) for _ in range(40)]; t.up(1); seq += [pg.evaluate(FR) for _ in range(20)]
    run = [s for s in seq[34:52] if s[0] == 'run']; mv = max(math.hypot(seq[i + 1][1] - seq[i][1], seq[i + 1][2] - seq[i][2]) for i in range(len(seq) - 1))
    ok = at and len(run) >= 16 and all(abs(s[1] - at['mount']['run'][0]) < 0.05 and abs(s[2] - at['mount']['run'][1]) < 0.05 for s in run) and abs(seq[5][1] - at['mount']['idle'][0]) < 0.05 and mv < 1.1
    check('星璃的星盘是独立贴图：起跑约 0.7 秒后一直停在固定挂点上；待机↔跑步切换时平滑过渡（30fps 步进下每帧位移 < 1.1 世界单位，约 2.4 屏幕像素）', ok, {'挂点': at and at['mount'], '每帧最大位移': round(mv, 2)})
    # 草丛：两种可隐身样式都按原判定圆生效；进出时显隐正确
    for label, bi in (('野区紧凑草', 7), ('河边长条草', 11)):
        r = pg.evaluate("""(bi) => { __xq.restart(); const g = __xq.game, p = g.player, b = g.map.brush[bi], e = g.heroes.find(h => h.team === 'red'), R = __xq.renderer;
          const see = () => g.visible(e, 'blue'), out = {};
          out.style = R.brushStyle[bi].variant;
          e.x = b.center[0] + 4; e.y = b.center[1]; p.x = b.center[0] - b.radius - 30; p.y = b.center[1]; __xq.cam.snap(p.x, p.y); __xq.advance(1 / 30); out.enemyInBrush = e.brush === bi; out.hiddenFromOutside = !see();
          p.x = b.center[0] - b.radius + 2; __xq.advance(1 / 30); out.edgeInside = p.brush === bi; out.seenFromInside = see();
          p.x = b.center[0] - b.radius - 2; __xq.advance(1 / 30); out.edgeOutside = p.brush === -1; out.hiddenAgain = !see();
          e.x = b.center[0] + b.radius + 3; __xq.advance(1 / 30); out.enemyLeftVisible = see();
          return out; }""", bi)
        check(f'{label}：敌人在草里时草外看不到；玩家踩进判定圆边缘就能看到；退出后再次看不到；敌人走出草丛立即可见', r['style'] == (2 if label == '野区紧凑草' else 1) and all(v for k, v in r.items() if k != 'style'), r)
    check('全程无脚本报错', not errs, errs[:3])
    b.close()
print(f'\n{sum(results)}/{len(results)} 项通过'); sys.exit(0 if all(results) else 1)
