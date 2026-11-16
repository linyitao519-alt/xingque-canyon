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
    pg.evaluate('__xq.animReady'); pg.wait_for_function("Object.keys(__xq.renderer.fx).length === 23", timeout=10000)
    check('动画帧带已加载：六名英雄 + 四种小兵', sorted(pg.evaluate('__xq.anim.loaded')) == ['chiyan', 'feixian', 'hedeng', 'melee-blue', 'melee-red', 'ranged-blue', 'ranged-red', 'xingli', 'xuanyuan', 'yelan'])
    check('23 张特效/弹体贴图已加载（3 张弹体 + 18 个技能主特效 + 月痕、护盾罩）', pg.evaluate('Object.keys(__xq.renderer.fx).length') == 23 and pg.evaluate("['fx-xingli-moonmark','fx-chiyan-ring','fx-hedeng-recall','fx-feixian-draw'].every(n => __xq.renderer.fx[n].naturalWidth > 0)"))
    check('触控前音频尚未解锁（浏览器策略）', pg.evaluate('__xq.sfx.ctx === null'))
    ST = "(() => { const a = __xq.anim.last[__xq.game.player.id]; return a ? a.state : null; })()"
    sk = pg.evaluate('__xq.hud.skillBtns'); mute = pg.evaluate('__xq.hud.muteBtn')
    # 摇杆移动 → run；松开 → idle
    t.down(1, 150, 290); t.move(1, 196, 290); pg.evaluate(ADV, 6); pg.wait_for_timeout(120); run = pg.evaluate(ST)
    pg.wait_for_function('__xq.sfx.ready', timeout=10000)
    check('首次触控后音频解锁，24 个音效解码完成（6 个通用 + 18 个技能出手音）', pg.evaluate("__xq.sfx.ctx.state") == 'running')
    t.up(1); pg.evaluate(ADV, 6); pg.wait_for_timeout(120); idle = pg.evaluate(ST)
    check('星璃：推摇杆播跑步帧，松开回到待机帧', run == 'run' and idle == 'idle', [run, idle])
    # 弦月 → 出手动作 + 出手音效
    s0 = pg.evaluate('__xq.sfx.stats["sfx-xingli-crescent"] || 0')
    t.down(2, sk[0]['x'], sk[0]['y']); t.move(2, sk[0]['x'] + 70, sk[0]['y'] - 20); pg.evaluate(ADV, 2); t.up(2); pg.evaluate(ADV, 5); pg.wait_for_timeout(120)
    atk = pg.evaluate(ST); s1 = pg.evaluate('__xq.sfx.stats["sfx-xingli-crescent"] || 0'); n = pg.evaluate('__xq.game.crescents.length')
    check('弦月：播出手帧、响出手音效、弦月贴图在飞', atk == 'attack' and s1 == s0 + 1 and n == 1, [atk, s0, s1, n])
    pg.evaluate(ADV, 20); pg.wait_for_timeout(120); check('出手动作播完后回到待机', pg.evaluate(ST) == 'idle')
    # 定星 ×2 + 星河阵 → 各自的音效（星河阵：展开 1 次，3 秒后收束 1 次）
    for dx, dy in ((60, -30), (10, -70)):
        pg.evaluate('__xq.game.player.cds[1] = 0'); t.down(2, sk[1]['x'], sk[1]['y']); t.move(2, sk[1]['x'] + dx, sk[1]['y'] + dy); pg.evaluate(ADV, 2); t.up(2); pg.evaluate(ADV, 8)
    b0 = pg.evaluate('__xq.sfx.stats["sfx-xingli-beacon"]')
    t.down(2, sk[2]['x'], sk[2]['y']); t.move(2, sk[2]['x'] + 75, sk[2]['y'] - 75); pg.evaluate(ADV, 2); t.up(2); pg.evaluate(ADV, 10)
    z = pg.evaluate('__xq.game.zones.length'); pg.evaluate(ADV, 100)
    st = pg.evaluate('__xq.sfx.stats')
    check('定星两次、星河阵一次：各自的出手音分别响 2 次和 1 次（持续跳伤不重复响）；星河阵 3 秒后消失', b0 == 2 and z == 1 and st.get('sfx-xingli-beacon') == 2 and st.get('sfx-xingli-starfield') == 1 and pg.evaluate('__xq.game.zones.length') == 0, [b0, z, st])
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
    pg.evaluate('__xq.restart()'); c0 = pg.evaluate('__xq.sfx.stats["sfx-xingli-crescent"]')
    pg.evaluate('__xq.game.castCrescent(1, 0)'); pg.evaluate(ADV, 6); c1 = pg.evaluate('__xq.sfx.stats["sfx-xingli-crescent"]')
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
    # 英雄选择：不带 ?hero 时开局弹出并暂停；触摸卡片选人；"换英雄"按钮可重新打开
    pk = ctx.new_page(); pk.on('pageerror', lambda e: errs.append(str(e))); pk.goto(URL + '?mute=1&fps=0&r=canvas'); pk.wait_for_function('window.__xq && __xq.renderer.sceneReady'); pk.wait_for_timeout(700)
    s0 = pk.evaluate('[__xq.selecting(), document.querySelectorAll(".pick-card").length, __xq.game.time]')
    pk.tap('.pick-card[data-hero="yelan"]'); pk.wait_for_timeout(600)
    s1 = pk.evaluate('({sel: __xq.selecting(), hero: __xq.game.player.sprite, team: __xq.game.player.team, lane: __xq.game.player.lane, xingliTeam: __xq.game.heroes.find(h => h.sprite === "xingli").team, t: __xq.game.time, skills: __xq.game.skillsOf().map(s => s.name)})')
    pk.tap('#swap'); pk.wait_for_timeout(300); s2 = pk.evaluate('__xq.selecting()'); pk.tap('.pick-card[data-hero="xingli"]'); pk.wait_for_timeout(300); s3 = pk.evaluate('[__xq.selecting(), __xq.game.player.sprite, __xq.game.heroes.find(h => h.sprite === "yelan").team]')
    check('英雄选择：开局弹出 6 张卡并暂停；触摸选夜岚 → 她到蓝方中路、星璃顶替到红方、对局开始；"换英雄"能重新打开并换回星璃', s0[0] and s0[1] == 6 and s0[2] == 0 and not s1['sel'] and s1['hero'] == 'yelan' and s1['team'] == 'blue' and s1['lane'] == 'mid' and s1['xingliTeam'] == 'red' and s1['t'] > 0 and s2 and s3 == [False, 'xingli', 'red'], [s0, s1, s3])
    pk.close()
    # 18 个技能逐个出手：每次成功施法只响一次自己的出手音；图标都加载到
    SET = """(() => { const g = __xq.game, p = g.player; g.controlBot = () => {}; g.nextWave = 1e9; for (let i = 0; i < 6; i++) __xq.advance(1 / 30);
      p.x = 590; p.y = 606; p.faceX = 1; p.faceY = 0; p.hp = p.maxHp * 0.5; __xq.cam.snap(p.x, p.y);
      const reds = g.heroes.filter(h => h.team === 'red'), blues = g.heroes.filter(h => h.team === 'blue' && h !== p);
      reds[0].x = p.x + 46; reds[0].y = p.y; reds[0].faceX = -1; reds[0].faceY = 0; blues[0].x = p.x + 30; blues[0].y = p.y + 30; blues[0].hp = blues[0].maxHp * 0.5; __xq.advance(1 / 30); })()"""
    CAST = """(i) => { const g = __xq.game, p = g.player, s = g.skillsOf(p)[i], reds = g.heroes.filter(h => h.team === 'red'), bl = g.heroes.filter(h => h.team === 'blue' && h !== p)[0];
      const aim = { x: p.x + 40, y: p.y, dx: 1, dy: 0 }; if (s.id === 'ward' || s.id === 'thread') { aim.x = bl.x; aim.y = bl.y; } if (s.id === 'backstep') { aim.x = reds[0].x; aim.y = reds[0].y; }
      if (s.aim === 'charge') { g.beginCharge(i); for (let k = 0; k < 12; k++) __xq.advance(1 / 30); }
      const r = g.castSkill(i, aim); for (let k = 0; k < 45; k++) __xq.advance(1 / 30);
      return [s.id, r.ok, __xq.sfx.stats['sfx-' + p.sprite + '-' + s.id] || 0, p.cds[i] > 0]; }"""
    rows = []; icons = []
    for hid in ['xingli', 'xuanyuan', 'hedeng', 'yelan', 'feixian', 'chiyan']:
        hp = ctx.new_page(); hp.on('pageerror', lambda e: errs.append(str(e))); hp.goto(URL + f'?paused=1&mute=1&fps=0&r=canvas&hero={hid}'); hp.wait_for_function('window.__xq && __xq.renderer.sceneReady'); hp.evaluate(SET)
        rows += [[hid] + hp.evaluate(CAST, i) for i in range(3)]; hp.evaluate('__xq.advance(1/30)'); hp.wait_for_timeout(400)
        icons.append(hp.evaluate("Promise.all(__xq.game.skillsOf().map(s => new Promise(r => { const im = new Image(); im.onload = () => r(im.naturalWidth); im.onerror = () => r(0); im.src = 'assets/icons/icon-' + __xq.game.player.sprite + '-' + s.id + '.png'; })))")); hp.close()
    check('六名英雄 18 个技能都能出手并进入冷却；每次成功施法只响一次自己的出手音', len(rows) == 18 and all(r[2] and r[3] == 1 and r[4] for r in rows), [r for r in rows if not (r[2] and r[3] == 1 and r[4])])
    check('18 个技能图标都按 icon-<英雄>-<技能>.png 加载到（256×256）', all(w == 256 for ws in icons for w in ws), icons)
    # 触控：点按吸附目标、蓄力按住/松手/拖去取消；步频按走过的距离推进
    def hero_page(hid):
        hp = ctx.new_page(); hp.on('pageerror', lambda e: errs.append(str(e))); hp.goto(URL + f'?paused=1&mute=1&fps=0&r=canvas&hero={hid}'); hp.wait_for_function('window.__xq && __xq.renderer.sceneReady'); hp.evaluate(SET)
        return hp, Touch(ctx.new_cdp_session(hp)), hp.evaluate('__xq.hud.skillBtns'), hp.evaluate('__xq.hud.cancelBtn')
    hp, ht, hs, hc = hero_page('yelan')
    ht.down(2, hs[1]['x'], hs[1]['y']); hp.evaluate(ADV, 1); pv = hp.evaluate("(() => { const w = __xq.hud.aimWorld(__xq.hud.aim); return [w.ok, !!w.target, !!w.spot]; })()"); ht.up(2); hp.evaluate(ADV, 8)
    r1 = hp.evaluate("(() => { const g = __xq.game, p = g.player, e = g.heroes.filter(h => h.team === 'red')[0]; return [__xq.hud.lastCast, p.cds[1] > 0, Math.round(Math.hypot(p.x - e.x, p.y - e.y)), e.hp < e.maxHp]; })()")
    check('夜岚点按狐步：自动吸附最近的敌方英雄，预告给出落脚点，松手闪到她身后 21 处并造成伤害', pv == [True, True, True] and r1[0]['ok'] and r1[1] and r1[2] == 21 and r1[3], [pv, r1]); hp.close()
    hp, ht, hs, hc = hero_page('feixian')
    ht.down(2, hs[0]['x'], hs[0]['y']); ht.move(2, hs[0]['x'] + 60, hs[0]['y']); hp.evaluate(ADV, 18); q1 = hp.evaluate('[__xq.game.chargeQ(), __xq.game.player.cds[0]]')
    ht.move(2, hc['x'], hc['y']); hp.evaluate(ADV, 1); ht.up(2); hp.evaluate(ADV, 6); c1 = hp.evaluate("[__xq.game.player.cds[0], __xq.game.crescents.length, __xq.game.player.sk.charge === null, __xq.sfx.stats['sfx-feixian-draw'] || 0]")
    ht.down(2, hs[0]['x'], hs[0]['y']); ht.move(2, hs[0]['x'] + 60, hs[0]['y']); hp.evaluate(ADV, 40); q2 = hp.evaluate('__xq.game.chargeQ()'); ht.up(2); hp.evaluate(ADV, 5)
    c2 = hp.evaluate("[__xq.game.player.cds[0] > 0, __xq.game.crescents.map(c => c.base), __xq.sfx.stats['sfx-feixian-draw'] || 0]")
    check('绯弦满弦：按住蓄力（进度随时间涨）；拖到取消区松手不出手、不进冷却、不响；再按满后松手射出 100 伤害的箭', 0.3 < q1[0] < 0.7 and q1[1] == 0 and c1 == [0, 0, True, 0] and q2 == 1 and c2[0] and c2[1] == [100] and c2[2] == 1, [q1, c1, q2, c2]); hp.close()
    hp, ht, hs, hc = hero_page('chiyan')
    PH = "(() => { const p = __xq.game.player, a = __xq.renderer.actors.get(p.id); return [a.phase, p.x, p.y]; })()"
    FRM = "() => { __xq.game.player.hp = __xq.game.player.maxHp; __xq.advance(1 / 30); return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(1)))); }"
    hp.evaluate("(() => { const p = __xq.game.player; p.x = 520; p.y = 660; __xq.cam.snap(p.x, p.y); })()"); [hp.evaluate(FRM) for _ in range(3)]
    ht.down(1, 150, 290); ht.move(1, 105, 290); [hp.evaluate(FRM) for _ in range(4)]; a0 = hp.evaluate(PH); [hp.evaluate(FRM) for _ in range(30)]; a1 = hp.evaluate(PH); ht.up(1); [hp.evaluate(FRM) for _ in range(8)]; a2 = hp.evaluate(PH); [hp.evaluate(FRM) for _ in range(10)]; a3 = hp.evaluate(PH)
    walked = ((a1[1] - a0[1]) ** 2 + (a1[2] - a0[2]) ** 2) ** 0.5; cyc = a1[0] - a0[0]; spd = hp.evaluate('__xq.game.player.speed')
    check('移动手感：英雄移速 78；跑一圈 46 世界单位（约 1.7 圈/秒）；站定后跑步相位不再推进', spd == 78 and abs(walked - 78) < 3 and abs(walked / cyc - 46) < 0.5 and a3[0] == a2[0], {'速度': spd, '1秒走过': round(walked, 1), '每圈距离': round(walked / cyc, 1), '圈/秒': round(cyc, 2), '站定后相位变化': a3[0] - a2[0]})
    hp.evaluate("(() => { const g = __xq.game, p = g.player; p.cds[2] = 0; g.castSkill(2, { x: p.x + 60, y: p.y, dx: 1, dy: 0 }); })()"); b0 = hp.evaluate(PH); [hp.evaluate(FRM) for _ in range(12)]; b1 = hp.evaluate(PH)
    check('枪围跃击的位移不算进步子', abs(b1[1] - b0[1]) > 40 and abs(b1[0] - b0[0]) < 0.12, [b0, b1]); hp.close()
    check('全程无脚本报错', not errs, errs[:3])
    b.close()
print(f'\n{sum(results)}/{len(results)} 项通过'); sys.exit(0 if all(results) else 1)
