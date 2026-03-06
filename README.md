# Sanguosha 3v3 Web

三国杀 3v3 网页联机版（MVP 起步仓库）。

## 当前已完成（MVP V1）

- Monorepo: `client` + `server` + `shared`
- WebSocket 房间系统：创建 / 加入
- 3v3 人数限制：6 人满员才可开局
- 开局后自动分队（A/B）+ 回合轮转 + 每回合摸牌
- 第一版战斗流：
  - 出【杀】指定敌方目标
  - 目标响应【闪】或吃伤害
  - 濒死后可【桃】自救
  - 阵亡与胜负判定（A/B 阵营）
- V2 规则增强（进行中）：
  - 回合阶段：摸牌 / 出牌 / 弃牌
  - 每回合【杀】次数限制（默认 1 次）
  - 基础距离判定（座次距离 1）
  - 摸牌堆 / 弃牌堆 + 洗牌回填
  - 手动弃牌阶段（超手牌上限时逐张弃置）
- 前端房间页实时展示玩家、手牌、待响应动作与日志

## 技术栈

- Client: React + Vite + TypeScript
- Server: Node.js + TypeScript + ws
- Shared: 前后端共享类型定义

## 本地开发

```bash
npm install
npm run dev
```

若遇到端口占用（EADDRINUSE），使用：

```bash
npm run dev:clean
npm run dev:safe
```

默认地址：
- 前端: http://localhost:5173
- 后端 WS: ws://localhost:3001

## WebSocket 连接说明

前端默认自动连接：
- `ws://<当前页面hostname>:3001`（https 下自动用 `wss://`）

你也可以手动指定：

```bash
# client/.env.local
VITE_WS_URL=ws://127.0.0.1:3001
```

如果你在另一台设备（手机/平板）打开前端页面，`localhost` 不会指向运行后端的机器，
需要把 `VITE_WS_URL` 设置为后端机器可访问的 IP/域名。

## 开发测试后门（仅本地）

为了减少多人联调成本，可开启 2 人测试开局：

```bash
ALLOW_DEV_BYPASS=1 npm run dev
```

开启后，前端开发环境会出现：
- `测试开局（2+人）`
- `补齐机器人到6人`

说明：
- 正常按钮：仍要求 6 人
- 测试按钮：2 人即可开局（仅用于开发联调）
- 机器人按钮：自动补齐 Bot 到 6 人，可与你一起快速跑 6 人局流程

## GitHub 推送

```bash
cd dev/sanguosha-3v3
git branch -M main
git add .
git commit -m "feat: bootstrap sanguosha 3v3 web mvp"
# 把 YOUR_REPO_URL 换成你的 github 仓库地址
git remote add origin YOUR_REPO_URL
git push -u origin main
```

## 下一阶段（我建议按这个顺序）

1. **规则核心**：出牌阶段、响应链（闪/无懈）、伤害结算
2. **牌堆系统**：抽牌/弃牌/洗牌、牌类型（杀闪桃等）
3. **武将系统**：3v3 常用武将 + 技能触发框架
4. **胜负判定**：阵亡、投降、断线重连与托管
5. **对局记录**：操作日志、replay 基础数据结构

