# 口袋桌 PocketTable

一部手机就是一张桌子。用手机或电脑当主机，朋友们扫码加入，在浏览器里一起玩派对桌游。**全程不需要外网**，开个热点就能玩。

> 开发中（M0 骨架已完成）。首发游戏：爆炸猫、骗子酒馆、你猜我画、大富翁、厨房小分队。路线图见 [docs/DESIGN.md](docs/DESIGN.md)。

## 快速开始

需要 Node.js 22 或更高版本。

```bash
npm install
npm start
```

打开终端里显示的地址（默认 `http://localhost:3000`）。同一 WiFi 或热点下的其他手机，扫房间页上的二维码就能加入。端口被占用时会自动换下一个；也可以用 `PORT=xxxx` 指定。

## 开发

```bash
npm test        # 规则、随机对局、确定性、联机集成测试
npm run check   # 类型检查（tsc，只检查不编译）
```

- **加一款游戏**：在 `games/<id>/` 下写 `rules.js`（游戏模块接口见设计文档第 3 节）、`bot.js`、`view.js`、`theme.css`。实现 `legalMoves` 后，随机对局测试会自动覆盖它。
- **规则代码里不能用** `Math.random`、`Date.now` 和计时器：随机数用 `ctx.rng`，时间用 `ctx.now`。这样每一局都能完整重放。
- **遇到 bug**：对局页右上角的旗子按钮会下载这局的对局记录，用 `Match.replay` 就能原样复现。

## 技术栈

Node.js + `ws`，前端用 Preact + htm（打包在 `client/vendor/`，不需要构建步骤）。服务器权威，每个玩家只收到自己能看的视角。

## 许可证

[MIT](LICENSE)
