# 德州扑克多人版

多人联机德州扑克游戏，支持 2-6 人同时在线对战。

## 功能特点

- 🏠 创建/加入房间
- 👥 2-6人同时游戏
- 💬 实时同步
- 🎮 简洁界面

## 本地运行

```bash
# 安装依赖
npm install

# 启动服务器
npm start
```

然后访问 http://localhost:3000

## 部署到 Render.com

1. Fork 这个仓库
2. 在 Render.com 创建新的 Web Service
3. 连接你的 GitHub 仓库
4. Render 会自动检测并部署

## 版本说明

- **T0**: 单机版（5个AI对手）- 见 [texas-holdem](../texas-holdem)
- **T1**: 多人联机版（本项目）

## 技术栈

- 前端: HTML + CSS + JavaScript
- 后端: Node.js + Express + Socket.io
