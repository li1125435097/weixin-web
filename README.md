# WebCall Lite

两人网页视频聊天。账号放在服务器的 `users.json`，密码是 bcrypt 哈希。房间在进程内存里。文字消息只经 Socket.IO 转发，各自浏览器用 localStorage 保存。

## 本地运行

需要 Node.js 20 或更新版本。复制环境文件：

```bash
cp .env.example apps/server/.env
```

把 `apps/server/.env` 改成：

```
NODE_ENV=development
COOKIE_SECURE=false
DATA_DIR=./data
JWT_SECRET=dev-only-change-me-please
TURN_HOST=
TURN_SECRET=
```

`TURN_HOST` 留空时，接口只返回公共 STUN，同一局域网里可以打通。跨运营商通话需要后面的 coturn。

```bash
cd apps/web
npm install
npm run build

cd ../server
npm install
npm run start:dev
```

打开 `http://127.0.0.1:5000`。页面、`/api` 和 `/socket.io` 都在这一个端口上。一个浏览器注册并创建邀请，另一个无痕窗口打开邀请链接。房主要点接听，两边都要允许摄像头和麦克风。

改页面时可以另开终端执行 `cd apps/web && npm run dev`，Vite 会把接口转到 `5000`，页面在 `http://127.0.0.1:5173`。平时不需要开它。

## 服务器部署

在 Ubuntu 上安装 Docker。编辑 `.env`：`JWT_SECRET`、`TURN_SECRET`、`TURN_HOST`（填服务器公网 IP）。`deploy/coturn/turnserver.conf` 里的 `static-auth-secret` 必须和 `TURN_SECRET` 相同，`external-ip` 填同一个公网 IP。

只用 HTTP 时把 `COOKIE_SECURE` 设为 `false`。非本机要开摄像头时，把证书挂进容器并设置 `TLS_CERT`、`TLS_KEY`，同一个 `5000` 端口改为 HTTPS，同时保持 `COOKIE_SECURE=true`。

```bash
cd deploy
docker compose up -d --build
```

浏览器打开 `http://服务器:5000`（启用证书时是 `https://服务器:5000`）。没有单独的网页容器，也没有反向代理。

防火墙放行：

- 5000/tcp
- 3478/tcp、3478/udp
- 49152–65535/udp

摄像头在非本机环境必须走 HTTPS。账号文件在 `apps/server/data/users.json`，容器重建不会丢，但要自己备份。建议 `chmod 600`。不要把 `data` 目录暴露出去。只运行一个 api 容器。

2 核 4 GB 够信令和少量中转。视频中转吃的是带宽，一路大约每个方向 1–3 Mbps。

## 行为说明

- 等待访客时，房主关掉页面不会立刻销毁房间，直到过期（默认 2 小时）。
- 通话或振铃中断线会先等 20 秒。房主超时则房间结束；访客超时则腾出座位，邀请链接还在。
- 聊天记录 key 是 `webcall_messages_<roomId>`，每个房间最多 500 条。换浏览器、清站点数据都会丢。离线期间的消息不会补发。
- 未接听前不转发 WebRTC 信令。

第一版不做图片、文件、屏幕共享、录制、多人会议、服务端聊天记录、Redis 和 PostgreSQL。
