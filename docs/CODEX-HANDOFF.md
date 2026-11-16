# 交接说明：给六名英雄做各自独立的技能

这份说明随工程包一起交给 Codex。工程当前是 v0.16，仓库 https://github.com/linyitao519-alt/xingque-canyon ，在线试玩 https://linyitao519-alt.github.io/xingque-canyon/ 。

## 一、现状

六名英雄都可选，每人三个技能，但除星璃外，技能只是五种通用类型换参数：

| 英雄 | ID | 定位 | 技能（类型） |
|---|---|---|---|
| 星璃 | xingli | 法师，远程 | 弦月（直线，折返，留月痕）· 定星（落点，引爆月痕定身）· 星河阵（持续区域） |
| 玄垣 | xuanyuan | 坦克，近战 | 盾击（扇形）· 冲阵（突进）· 垣壁（增益：护盾） |
| 鹤灯 | hedeng | 辅助，远程 | 引灯（直线）· 灯域（落点，带治疗）· 鹤归（增益：治疗加速） |
| 夜岚 | yelan | 刺客，近战 | 影袭（突进）· 爪刃（扇形）· 夜幕（增益：加速攻速） |
| 绯弦 | feixian | 射手，远程 | 穿云箭（直线）· 箭雨（落点）· 疾弦（增益：加速攻速） |
| 赤檐 | chiyan | 战士，近战 | 突刺（直线）· 横扫（扇形）· 破阵（突进） |

问题：玄垣、夜岚、赤檐都有"扇形 + 突进"，鹤灯、绯弦都有"直线 + 落点"，夜岚和绯弦的大招是同一个增益。玩起来像同一个英雄换皮。

## 二、技能相关的代码在哪

| 内容 | 位置 |
|---|---|
| 英雄数值与技能数据 | `assets/data/match-rules.json` 的 `heroes.<id>`（生命、普攻、三个技能）；星璃的技能在 `xingli.skills` |
| 技能结算 | `src/sim.ts`：`castSkill(i, aim, hero)` 按 `kind` 分支；`updateCrescents`（直线弹与折返）、`updateZones`（持续区域）、`stepDash`（突进）、`damage`（护盾先扣） |
| 状态字段 | `src/sim.ts` 的 `Base` / `Hero`：`slowUntil` `rootUntil` `stunned` `moonUntil` `shield` `hasteUntil` `atkBuffUntil` `dash` |
| 现有技能类型 | `line` 直线穿透 · `ground-circle` 落点范围 · `cone` 扇形 · `dash` 突进 · `buff` 增益 · `zone` 持续区域 |
| 触控瞄准 | `src/hud.ts`：`aimWorld()` 按类型决定是方向瞄准还是落点瞄准；`release()` 松手出手；拖到取消区松手取消 |
| 瞄准范围与特效 | `src/render.ts`：`drawGroundFx()` 里的瞄准提示；`drawSkillFx()` 画扇形、突进、增益、星河阵、月痕；`drawUpright()` 里画直线弹和护盾罩 |
| 音效 | `src/audio.ts` 的 `update()`：按事件类型播放 |
| 技能图标 | `src/hud.ts` 的 `skillIcon()`：自动加载 `assets/icons/icon-<英雄ID>-<技能ID>.png`，没有就画矢量占位 |
| 英雄选择 | `src/main.ts` 的 `openPick()` / `pickHero()`；`?hero=<id>` 直接指定 |
| AI | `src/sim.ts` 的 `controlBot()`；AI 英雄目前只用普攻。`autoSkills()` 只在托管玩家英雄时用 |
| three.js 渲染层 | `src/three_layer.ts`；贴地的东西画在 2D 画布上作为纹理，立体物件逐件提交贴图片 |

事件：技能出手时往 `game.events` 里 push `{ type, t, x, y, ... }`，渲染和音效都读它。现有类型：`cast` `hit` `beacon` `cone` `dash` `buff` `zone` `zoneEnd` `detonate` `shot` `dmg` 等。

## 三、现有素材规格

| 素材 | 路径与命名 | 规格 |
|---|---|---|
| 技能图标 | `assets/icons/icon-<英雄ID>-<技能ID>.png` | 透明 PNG，256×256，圆形构图，四周留 12px |
| 直线弹 | `assets/fx/fx-<英雄ID>-<技能ID>.png` | 透明 PNG，512×256，朝右，锚点 (256,128) |
| 扇形挥击 | 同上 | 透明 PNG，512×512，俯视，开口朝右，锚点 (0,256) |
| 落点爆发 | 同上 | 透明 PNG，横排 4 帧，每帧 256×256，锚点每帧正中 |
| 护盾罩 | 同上 | 透明 PNG，256×256，锚点正中 |
| 头像 | `assets/art/portrait-<英雄ID>.png` | 透明 PNG，256×256 胸像 |
| 动作帧带 | `assets/anim/hero-<ID>-{idle,run,attack}.png` | 导入后每帧 384×256（原稿 768×512），待机 4 帧、跑步 6 帧、攻击 4 帧，脚底锚点在帧底边中点 |
| 音效 | `assets/audio/*.wav` | 现有 8 个；新技能目前复用它们 |

新特效贴图要在 `src/render.ts` 的 `loadFx()` 列表里登记文件名（不带扩展名）。

## 四、验证方式

```bash
npm install && npm run build
npm test                                     # 规则测试，现在 22 项全过
npm start                                    # http://localhost:5173/
python3 tests/e2e_camera.py                  # 需要 Playwright for Python；29 项
python3 tests/e2e_media.py                   # 19 项
XQ_BACKEND=canvas python3 tests/e2e_mobile.py  # 29 项
python3 tools/build_single.py                # 重新生成单文件版
```

调试参数：`?hero=<id>` 指定英雄，`?paused=1` 暂停后用 `__xq.advance(1/30)` 逐帧推进，`?r=canvas` 用 Canvas 渲染，`?auto=1&speed=8` 托管快进。

## 五、不要动的东西

- 塔位、塔和小兵的数值、镜头（屏高 102、跟随速率 18、瞄准取景默认关）。
- 触控布局（摇杆、普攻、三个技能键、取消区）。
- three.js 与 Canvas 两个渲染后端都要能用；单文件版要能生成。
- `assets/data/map.json`。

## 六、这一轮顺带要调的手感

- **移速**：英雄移速现在是 84（`match-rules.json` 的 `heroDefaults.moveSpeed`），要再慢一点点，建议 76–80。
- **步频**：跑步动画的步子太碎。跑步帧带 6 帧是两步，帧的推进按走过的距离算：`src/render.ts` 的 `drawUpright()` 里 `a.phase += moved / (u.kind === 'hero' ? 33 : 17)`，
  即英雄每走 33 世界单位播完一圈（两步）。移速 84 时是每秒 2.5 圈、5 步。请把英雄调到每秒约 1.6–1.8 圈（移速 78 时一圈约 44–48 单位），小兵按同样比例放慢（现在 17 单位一圈，移速 40）。
  调完检查脚底有没有明显滑步，以及走走停停时跑步和待机之间的切换。
- **被动**：这一轮不加被动。
