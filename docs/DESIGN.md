# 口袋桌 PocketTable：设计文档 v0.2

> 状态：M0 骨架已完成（见第 10 节）。实现和设计不一致时，以本文档为准修代码，或者先改文档再改代码。

## 0. 目标与非目标

**目标**
- 局域网 / 手机热点上的派对桌游。一台手机或电脑当主机，其他人用浏览器扫码加入，**全程不需要外网**。
- 首发 5 款：爆炸猫、骗子酒馆、你猜我画、大富翁、厨房小分队。**每款都经过真人试玩才算完成。**
- 卡通贴纸风 UI（见风格样板），手机优先。
- **bug 能复现**：任何一局都能导出记录，并且能 100% 重放。

**非目标（现在不做）**
- 账号、排行榜、公网大厅、多实例扩展。
- 原生 App。Android 只做"WebView + 本机 Node"外壳。
- 需要构建步骤的前端工具链。

## 1. 总体架构

```text
浏览器（手机 / 电脑）                       主机（手机 / 电脑 / VM）
┌───────────────────────────┐      WS       ┌──────────────────────────────┐
│ 大厅 / 房间（UI 组件库）    │◀────────────▶│ 网络层  ws + http 静态文件     │
│ 游戏视图（DOM 或 Canvas）   │   JSON 消息   │ 房间层  座位 / 重连 / 房主      │
│ 事件驱动动画 / 音效         │              │ 引擎    出招 / 计时 / bot / 记录 │
└───────────────────────────┘              │ 游戏模块（纯规则，不碰网络）     │
                                           │ 快照    定期写盘，重启后恢复     │
                                           └──────────────────────────────┘
```

**原则**
1. **服务器说了算。** 客户端只发"意图"，规则全部在服务器上判定。
2. **游戏模块不知道网络、计时器和房间的存在。** 它只处理"状态 + 出招 → 新状态 + 事件"。
3. **按座位过滤视角。** 任何客户端（包括 bot 和 MCP）只能拿到 `view(state, seat)`。
4. **确定性。** 随机数只来自引擎给的种子，时间只来自引擎给的 `ctx.now`。所以同一份记录重放，一定得到同一个结果。

## 2. 目录结构

```text
server/
  index.js            入口：http + ws 共用端口、端口被占用自动换、启动恢复快照、关机保存
  http.js             静态文件 + /api/health /api/games /api/info /api/qr
  net.js              WebSocket 会话：token / pid、消息分发、限流
  rooms.js            房间：座位、准备、房主、bot、断线；对局中统一调度截止时间 / tick / bot
  match.js            一局对局的确定性核心：草稿提交、对局记录、重放（不碰网络和计时器）
  args.js             出招参数与房间选项校验
  rng.js              带种子的随机数（cyrb128 + sfc32）
  registry.js         读取 games/<id>/rules.js 和 bot.js
  snapshot.js         快照写盘（先写临时文件再改名）
  types.d.ts          游戏模块契约（只用于类型检查）
games/
  <id>/               每款游戏一个目录，目录名就是 id
    rules.js          游戏模块（见第 3 节），只在服务器上运行
    bot.js            bot：只看自己视角
    view.js           客户端视图组件（对外公开）
    theme.css         这款游戏的配色与氛围（对外公开）
    assets/           图片、音效（对外公开）
  count21/            「抢 21」：验证整条链路用的演示游戏，爆炸猫完成后从大厅隐藏
client/
  index.html          单页：大厅 → 房间 → 对局
  app.js              按状态切换页面
  store.js            唯一的 WebSocket 连接 + 全局状态
  screens/            home.js  room.js  game.js
  ui/kit.js           组件库：Icon Avatar Timer Sheet Toasts Cover（随游戏增加 Card Hand 等）
  lang/zh.js          中文语言包（含各游戏的错误键）
  theme.css           设计令牌（颜色、描边、阴影、圆角、字体）
  vendor/             preact + htm（ESM，打包进仓库，离线可用）
  fonts/              子集化后的中文字体（M1）
tests/
  core.test.js        rng、参数校验、Match（非法出招、超时、事件、重放）
  fuzz.test.js        通用随机对局测试（所有游戏自动纳入）
  determinism.test.js 规则代码里禁止 Math.random / Date.now / 计时器
  integration.test.js 起真服务器跑 WS 联机、服务器重启恢复、静态文件权限、换端口
  replays/            真人对局记录，作为回归测试（M1 起）
deploy/               沿用 GameNest 的 Oracle 脚本和自动更新（M1 搬过来）
docs/
```

`rooms.js` 和 `match.js` 的分工：`match.js` 是纯函数式的核心，输入（出招、超时、tick）都带时间戳，同样的输入永远得到同样的结果，所以能写测试、能重放。`rooms.js` 负责"什么时候把输入喂给它"：开计时器、安排 bot、广播结果。

## 3. 游戏模块接口（核心）

每款游戏导出一个对象，用 JSDoc 写类型，用 `tsc --noEmit` 检查（只是开发依赖，不需要构建）。

```js
/** @type {import('../../server/types').GameDef<KState, KOptions>} */
module.exports = {
  id: 'kittens',
  players: { min: 2, max: 5 },
  options: { bombs: { type: 'enum', values: ['auto', 'plus1'], default: 'auto' } },

  // 开局：只能用 ctx.rng 取随机数
  setup(ctx) { /* ctx: { seats, options, rng, now } */ return state; },

  // 出招：引擎先 structuredClone 一份草稿，游戏可以直接改草稿。
  // 返回字符串表示出招非法（i18n 错误键），草稿整份丢弃，所以不会出现"改了一半"的状态。
  moves: {
    play:  { args: { cardIds: 'string[]', target: 'seat?' }, apply(s, seat, args, ctx) {} },
    draw:  { args: {},                                       apply(s, seat, args, ctx) {} },
    nope:  { args: { cardId: 'string' },                      apply(s, seat, args, ctx) {} },
  },

  // 现在谁可以行动（可以有多个人，例如"不要！"的响应窗口）
  actors(s) { return [/* seat */]; },

  // 统一计时：返回下一个截止时间，没有就返回 null。到点后引擎调用 onTimeout。
  deadline(s) { return s.reactionEndsAt ?? null; },
  onTimeout(s, ctx) {},

  // 实时游戏（可选）
  tickHz: undefined,          // 例如厨房小分队设为 15
  tick(s, ctx) {},
  ephemeral: [],              // 高频出招（位置上报、画笔）：只更新状态，跟着下一次广播一起发出

  // 视角：seat 为 null 表示观战
  view(s, seat) {},

  // 对局结束时返回结果，否则返回 null
  result(s) { return null; /* { winners:[seat], ranking?, teams? } */ },

  // 测试用（可选，但建议写）：列出当前所有合法出招、检查不变量
  legalMoves(s, seat) { return [/* { name, args } */]; },
  invariants(s) { /* 不变量被破坏时 throw，例如牌的总数守恒 */ },
};
```

**事件**：`ctx.emit({ type: 'exploded', seat })`。事件跟新视角一起发给客户端，用来驱动动画和音效，也会写进对局记录。事件同样要经过视角过滤：`ctx.emit(evt, { to: seat })` 表示只发给某一个座位。

**bot**：`bot.js` 导出 `decide(view, seat, rng) → { name, args }`，只拿得到自己的视角。引擎在 `actors` 里有 bot 时安排出招，延迟随机 0.6 到 1.5 秒，看起来像真人。bot 的出招和真人出招走完全相同的提交流程，也一样写进记录。

**这样设计解决了旧项目的哪些问题**

| 旧项目 | 新设计 |
|---|---|
| `server.js` 里约 20 处按游戏写死的特例 | 引擎只认 `actors` / `deadline` / `onTimeout` / `tick` 这几个通用钩子 |
| 出招时直接改状态，出错后状态停在一半 | 先改草稿，确认合法后再整份提交 |
| 回合制、阶段制、实时各走一套逻辑 | 统一成"谁能行动 + 截止时间"，实时游戏只是多了 `tick` |
| bot 能看到所有人的手牌 | bot 只拿得到 `view` |
| 出招数据格式只靠约定 | `args` 声明格式，引擎统一校验 |

## 4. 确定性与重放

- 随机数用 `rng.js`（sfc32）。种子在开局时生成并写进记录。**游戏代码里禁止出现 `Math.random` 和 `Date.now`**，用 lint 规则检查。
- **对局记录**：
  ```json
  { "game": "kittens", "rulesVersion": 3, "seed": "9f2c…", "options": {}, "seats": [...],
    "log": [ { "t": 1200, "seat": 0, "move": "play", "args": {} },
             { "t": 4200, "timeout": true },
             { "t": 4266, "tick": true } ] }
  ```
- `replay(record)` 把记录逐条重新执行，得到同样的状态和事件。
- **房间菜单加一个"报告问题"按钮**：导出这局的记录文件。修 bug 时先把这份记录放进 `tests/replays/`，修好之后它就永久成为回归测试。
- 每款游戏有一个 `rulesVersion`。规则变动后，旧版本的记录在测试里会标注为"预期不同"，不会因此误报失败。

## 5. 通信协议

所有消息都是 JSON：`{ "t": "<类型>", ... }`。客户端的请求带 `id`，服务器一定回一条 `ack`：`{ t: 'ack', ref: id, ok: true, data? }` 或 `{ t: 'ack', ref: id, ok: false, code }`，`code` 是 i18n 错误键。

**客户端 → 服务器**

| t | 内容 |
|---|---|
| `hello` | `{ token?, name?, avatar? }`：首次连接或重连；必须是第一条消息 |
| `profile` | `{ name, avatar }`：改名字 / 头像 |
| `room.create` | `{ game, options? }` |
| `room.join` | `{ code }`（不区分大小写） |
| `room.ready` | `{ ready: boolean }` |
| `room.option` | `{ key, value }`（房主，只能在等待房间改；改了之后其他人要重新准备） |
| `room.bot.add` | （房主） |
| `room.kick` | `{ seat }`（房主；也用来移除 bot） |
| `room.start` / `room.rematch` / `room.leave` | |
| `move` | `{ name, args }` |
| `report` | 返回这局的对局记录（`ack.data.record`） |

**服务器 → 客户端**

| t | 内容 |
|---|---|
| `welcome` | `{ token, pid, name, avatar }`：token 存在 localStorage，用于重连；pid 可以公开 |
| `room` | 房间信息：座位、准备状态、选项、房主、阶段；对局中带 `matchSeats`（开局时的座位表） |
| `state` | `{ ver, seat, view, events, deadline, actors, result }`：每次提交后推送 |
| `toast` | `{ key }`：系统提示 |
| `kicked` / `room_closed` | `{ code }` |

**限流**：每条连接每秒最多 60 条消息，超出的丢弃；10 秒内丢弃超过 300 条就断开。单条消息最大 256 KB。

**断线代打**：对局中断线的真人，轮到这个座位行动时等 15 秒（`autoplayMs`），再由该游戏的 bot 代打；本人重连后立刻接回。

**还没做的**：换座位、观战。

每次推送都是完整视角，不发增量。局域网里这样足够快、逻辑也简单，等真的成为瓶颈再改成发增量。

**断线**：断线后保留座位 60 秒。期间回合轮到这个人时，由 bot 代打，代打状态在界面上标注出来。用 token 重连后直接回到座位。

## 6. 房间、快照与部署

- **房间码**：4 位，去掉容易混淆的字符（0/O、1/I）。
- **快照**：每 10 秒和关机时（收到 SIGTERM），把房间连同对局记录写到 `data/rooms.json`。启动时重放记录恢复房间。**这样自动更新可以随时重启，不用再等没人玩。**
- **部署**：沿用你的 Oracle 脚本和自动更新，只改仓库地址和服务名。新版能玩之前，`game.` 继续跑旧版。
- **Android 主机**：M6 再做。外壳和旧项目的思路一样（nodejs-mobile + WebView），但代码重写。

## 7. 前端

- **不需要构建**：浏览器直接加载原生 ES 模块。`preact` 和 `htm` 以 ESM 文件的形式放在 `client/vendor/` 里，约 5 KB，离线可用。这样有组件化，又不用打包。
- **组件库 `client/ui/`** 完全照风格样板实现。各游戏只负责组合这些组件，不重复写样式。
- **设计令牌**：用 CSS 变量定义（`--ink`、`--paper`、`--sun`、`--tomato`、`--stroke: 3px`、`--shadow: 4px 4px 0 var(--ink)`、`--radius: 18px`）。每款游戏的 `theme.css` 只覆盖变量。
- **游戏视图的接口**：`<GameView view seat send events />`。动画由 `events` 驱动，状态由 `view` 决定，两者分开。
- **实时游戏**（厨房小分队）用 Canvas，并在本地做预测和插值。你现有的这部分逻辑可以改造后搬过来。

## 8. 性能预算（手机当主机也要流畅）

| 项目 | 预算 |
|---|---|
| 首次加载（含字体子集） | ≤ 1 MB，之后靠缓存 |
| 中文字体 | 子集化，只保留常用字，≤ 400 KB |
| 动画 | 只动 `transform` / `opacity`；同屏持续动画 ≤ 3 个 |
| 禁用的效果 | `backdrop-filter`、大面积模糊阴影、视频背景 |
| 图片 | 优先用 CSS / SVG，封面图用 WebP 且每张 ≤ 40 KB |
| 主机服务器 | 单个房间出招处理 < 5 ms；实时游戏 15 Hz |
| 省电模式 | 设置里一键关闭装饰动画；遵循系统的"减少动态效果" |

## 9. 测试

1. **规则单元测试**：每款游戏的 `rules.test.js`。
2. **通用随机对局测试**（`tests/fuzz.test.js`）：对每款游戏、每种人数，用 `legalMoves` 随机出招跑 500 局，检查：
   - 不崩溃、一定能结束、`invariants` 始终成立；
   - **不泄露隐藏信息**：A 的视角里不能出现 B 的私密字段（每款游戏用 `secret` 声明哪些字段私密）；
   - 重放一致：把记录重放一遍，必须得到相同的最终状态。
3. **重放回归**：`tests/replays/*.json` 里的每份真人记录都必须正常跑完。
4. **联机集成测试**：起真服务器，用多个 WS 客户端模拟开房、加入、对局、断线重连。
5. **真人试玩清单**：每款游戏上线前，至少和朋友完整玩 3 局，问题记进 issue。

## 10. 里程碑

| 阶段 | 时间（业余） | 交付 |
|---|---|---|
| **M0 骨架** | 第 1 周 | 新 repo、引擎、协议、rng、记录 / 重放、组件库令牌 |
| **M1 爆炸猫** | 第 2–4 周 | 大厅、房间、爆炸猫完整可玩 + bot + 随机对局测试 + 快照；部署到 `play.` 测试 |
| **M2 骗子酒馆** | +2 周 | 验证虚张声势、质疑和淘汰机制 |
| **M3 你猜我画** | +2 周 | 验证高频画笔（`ephemeral`）和猜词 |
| **M4 大富翁** | +3–4 周 | 验证长对局、交易和断线重连 |
| **M5 厨房小分队** | +2–3 周 | 验证实时 `tick`，移植你自己的代码 |
| **M6 上线** | +2 周 | `game.` 切到新版；Android 主机外壳；英文语言包 |

**M0 完成情况**（2026-10-20）：引擎、协议、rng、记录 / 重放、快照恢复、组件库令牌、大厅 / 房间 / 对局外壳都已完成，用演示游戏「抢 21」在浏览器里走通了开房、加 bot、对局、超时、结算、再来一局。还没做：字体子集化、部署脚本搬迁。

**M1 进度**（2026-10-20）：爆炸猫完成（规则、bot、界面、牌面说明），适配手机 / 平板 / 电脑。规则按原版第二版：攻击可叠加；「不要」可以连锁；对子随机抽牌、三条点名要牌；拆除后自己选位置放回。反应窗口里所有活着的人都在 `actors` 里，避免暴露谁手里有「不要」。测试：12 项规则测试、每种人数各 60 局随机对局、160 局全 bot 对局（bot 没出过非法招），并在无头浏览器里当真人完整打完一局。还剩：字体子集化、部署到 `play.` 给朋友试玩。

**M1 的验收标准**：4 个人（2 真人 + 2 bot）在手机上玩完一局爆炸猫，中途有人断线再重连，服务器重启一次，对局都不受影响；导出的记录重放结果和实际完全一致。

## 11. 已定 / 待定

- **已定**：项目名「口袋桌 PocketTable」；开源，MIT 许可证；第一版只做中文，文字集中在 `client/lang/zh.js`。
- **待定**：是否保留 MCP（让 AI 当玩家）？建议 M6 之后再说，新协议本身就适合接 MCP。
