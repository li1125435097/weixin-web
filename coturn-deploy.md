# WebRTC TURN 中继服务器部署指南（Ubuntu 22.04 + Docker + coturn）

## 一、部署背景

项目使用 WebRTC 实现跨设备音视频通信。

在同一个局域网内，两台设备通常可以通过内网 IP 直接建立 P2P 连接，因此视频通话正常。

但当两台设备处于不同网络时，例如：

- 一台设备连接家庭 Wi-Fi，另一台使用手机 4G/5G。
- 一台设备处于公司网络，另一台处于家庭网络。
- 两台设备分别位于不同地区或不同运营商网络。

由于 NAT、防火墙等网络限制，WebRTC 可能无法通过 STUN 完成 P2P 打洞，导致视频无法正常传输。

为解决这个问题，需要部署 TURN 中继服务器。

本项目使用 **coturn** 作为 TURN/STUN 服务端。

coturn 的作用是：当两端无法直接建立 P2P 连接时，由服务器接收一端的音视频数据，再转发给另一端，从而实现跨网络通信。

## 二、服务器环境

### 2.1 服务器配置

| 项目 | 配置 |
|---|---|
| 操作系统 | Ubuntu 22.04 |
| 容器运行环境 | Docker |
| Docker Engine | 29.1.3 |
| Docker Compose | 1.29.2 |
| TURN 服务 | coturn |
| 公网 IP | 101.37.161.245 |
| 服务器私网 IP | 172.19.127.192 |
| TURN 监听端口 | 3478 |
| UDP 中继端口 | 49152–65535 |

### 2.2 网络结构

服务器使用阿里云 ECS，公网 IP 通过云平台映射到服务器私网 IP。

公网地址：

`101.37.161.245`

服务器网卡 eth0 的私网地址：

`172.19.127.192`

因此 coturn 需要配置公网 IP 与私网 IP 的映射关系：

```ini
external-ip=101.37.161.245/172.19.127.192
```

注意：这里使用的是宿主机 eth0 的私网 IP，不是 Docker 网桥 IP。

## 三、创建 coturn 部署目录

创建独立部署目录：

```bash
mkdir -p /root/www/coturn-server

cd /root/www/coturn-server
```

最终目录结构：

```text
/root/www/coturn-server/
├── docker-compose.yml
└── turnserver.conf
```

coturn 使用独立 Docker 容器运行，不需要修改现有聊天服务的容器结构。

## 四、生成 TURN 认证密钥

coturn 使用 Shared Secret 机制生成临时认证账号和密码。

执行：

```bash
openssl rand -hex 32
```

生成一串随机密钥。

例如：

```text
a1b2c3d4e5f6...
```

这里仅为格式示例，实际部署必须使用命令生成的随机密钥。

该密钥需要在两个地方保持一致：

1. coturn 的 `static-auth-secret`
2. 聊天服务环境变量 `TURN_SECRET`

注意：

- 不要将密钥提交到 Git 仓库。
- 不要将密钥暴露在前端代码中。
- 不要在日志中打印完整密钥。
- 建议将配置文件权限设置为 600。

## 五、创建 coturn 配置文件

创建配置文件：

```bash
nano /root/www/coturn-server/turnserver.conf
```

填写以下内容：

```ini
# TURN 监听端口
listening-port=3478

# 指纹
fingerprint

# 使用长期认证机制
lt-cred-mech

# 使用共享密钥认证
use-auth-secret

# TURN 认证密钥
static-auth-secret=替换成自己的随机密钥

# 服务域名或标识
realm=101.37.161.245

# 公网 IP / 私网 IP 映射
external-ip=101.37.161.245/172.19.127.192

# UDP 中继端口范围
min-port=49152
max-port=65535

# 禁止 CLI 管理接口
no-cli

# 安全限制
no-loopback-peers
no-multicast-peers

# 日志输出
log-file=stdout

# 当前阶段不启用 TLS / DTLS
no-tls
no-dtls
```

保存退出：

```text
Ctrl + O
Enter
Ctrl + X
```

设置配置文件权限：

```bash
chmod 600 /root/www/coturn-server/turnserver.conf
```

## 六、创建 Docker Compose 配置

创建：

```bash
nano /root/www/coturn-server/docker-compose.yml
```

填写：

```yaml
version: '3.8'

services:
  coturn:
    image: coturn/coturn:4.19.2-r0
    container_name: chat-me-coturn
    restart: unless-stopped

    # 使用宿主机网络
    network_mode: host

    volumes:
      - ./turnserver.conf:/etc/coturn/turnserver.conf:ro

    command:
      - -c
      - /etc/coturn/turnserver.conf
      - -n
      - --log-file=stdout
```

### 为什么使用 Host 网络？

TURN 服务除了监听 3478 端口，还需要动态分配大量 UDP 中继端口。

使用 Docker Host 网络可以：

- 直接使用宿主机网络接口。
- 避免大量 UDP 端口映射。
- 简化公网 IP 与私网 IP 映射配置。
- 减少 Docker NAT 对媒体中继的影响。

使用 Host 网络时，不需要额外配置 Docker `ports`。

## 七、启动 coturn 服务

进入部署目录：

```bash
cd /root/www/coturn-server
```

检查 Compose 配置：

```bash
docker-compose config
```

拉取镜像：

```bash
docker-compose pull
```

启动服务：

```bash
docker-compose up -d
```

查看运行状态：

```bash
docker ps | grep coturn
```

查看日志：

```bash
docker logs --tail 100 chat-me-coturn
```

持续查看日志：

```bash
docker logs -f chat-me-coturn
```

检查监听端口：

```bash
sudo ss -lunp | grep 3478
sudo ss -ltnp | grep 3478
```

正常情况下，应该能看到 UDP 和 TCP 的 3478 端口监听。

## 八、配置阿里云安全组

coturn 部署完成后，需要开放对应的公网端口。

进入：

阿里云控制台 → ECS → 实例 → 安全组 → 配置规则 → 入方向。

增加以下规则：

| 协议 | 端口范围 | 授权对象 | 用途 |
|---|---|---|---|
| UDP | 3478/3478 | 0.0.0.0/0 | TURN/STUN |
| TCP | 3478/3478 | 0.0.0.0/0 | TURN TCP |
| UDP | 49152/65535 | 0.0.0.0/0 | 音视频中继 |

注意：

**只开放 3478 端口是不够的。**

3478 主要用于建立 TURN 会话，49152–65535 UDP 才是实际媒体中继使用的端口范围。

如果没有开放中继端口，即使客户端成功获取 TURN 地址，也可能无法正常传输视频。

如果服务器还配置了其他云防火墙或网络 ACL，也需要允许上述流量。

## 九、配置聊天服务

coturn 启动后，需要让现有聊天服务知道 TURN 服务器的地址和认证密钥。

本项目聊天服务环境文件：

```text
/root/www/chat-me/server/.env
```

增加：

```env
TURN_HOST=101.37.161.245
TURN_SECRET=替换成与 coturn 完全相同的随机密钥
```

注意：

如果聊天服务使用 Docker Compose 部署，必须确保该 `.env` 文件通过 `env_file` 或显式 `environment` 配置传入对应容器。

Compose 项目目录中的 `.env` 仅用于变量插值，不代表容器自动获得其中所有环境变量。

### 9.1 检查 Compose 环境变量配置

检查聊天服务的 Compose 配置，确保对应服务包含：

```yaml
services:
  server:
    env_file:
      - ../server/.env
```

以上仅为配置示意，实际服务名称和路径应以项目现有配置为准。

### 9.2 重建聊天服务容器

由于环境变量发生变化，需要重新创建聊天服务容器。

先查看服务名称：

```bash
docker-compose config --services
```

找到实际负责聊天 API 和信令的服务名称，例如 `server`。

执行：

```bash
docker-compose up -d --no-deps --force-recreate server
```

将 `server` 替换为实际服务名称。

注意：这里使用 Docker Compose，不使用 PM2 重启命令。

### 9.3 检查环境变量

执行：

```bash
docker-compose exec server sh -lc '
  test -n "$TURN_HOST" && echo "TURN_HOST 已加载"
  test -n "$TURN_SECRET" && echo "TURN_SECRET 已加载"
'
```

如果两个变量都显示已加载，说明环境变量已经传入容器。

## 十、WebRTC TURN 配置返回示例

聊天服务的 `turn.service.ts` 负责生成 ICE Server 配置。

当 `TURN_HOST` 和 `TURN_SECRET` 正确配置后，接口应返回 STUN 和 TURN 服务地址。

示例：

```json
{
  "iceServers": [
    {
      "urls": [
        "stun:stun.cloudflare.com:3478",
        "stun:stun.l.google.com:19302"
      ]
    },
    {
      "urls": [
        "turn:101.37.161.245:3478?transport=udp"
      ],
      "username": "过期时间:临时标识",
      "credential": "动态生成的认证密码"
    }
  ]
}
```

注意：

这里的账号和密码是示意值。

实际项目应由服务端根据 Shared Secret 机制动态生成临时凭据，而不是在前端写死。

客户端通过这些 ICE Server 信息进行 WebRTC 连接协商。

## 十一、测试 TURN 是否正常工作

建议分为三个阶段测试。

### 11.1 检查容器运行状态

```bash
docker ps | grep coturn
```

查看日志：

```bash
docker logs --tail 100 chat-me-coturn
```

确认没有启动错误、配置错误和端口绑定冲突。

### 11.2 检查 TURN 接口

调用项目原本的通话配置接口。

确认返回：

- STUN 地址。
- TURN 地址。
- 临时 username。
- 临时 credential。

TURN 地址应包含：

```text
turn:101.37.161.245:3478?transport=udp
```

### 11.3 使用 WebRTC 官方测试工具

测试地址：

https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/

配置：

| 项目 | 内容 |
|---|---|
| TURN URI | turn:101.37.161.245:3478?transport=udp |
| Username | 服务端接口返回的 username |
| Password | 服务端接口返回的 credential |

点击 Add Server，再点击 Gather candidates。

如果正常获取到：

```text
candidateType: relay
```

说明 TURN Relay Candidate 已经成功获取。

注意：

- `host` 表示本地地址候选。
- `srflx` 表示 STUN 获取的公网映射候选。
- `relay` 表示 TURN 中继候选。

真正验证跨网络视频中继时，建议两台设备处于不同网络，并临时设置：

```javascript
const configuration = {
  iceServers,
  iceTransportPolicy: 'relay'
}
```

如果强制使用 relay 后仍然能够正常通话，说明媒体中继链路已经打通。

测试完成后恢复：

```javascript
iceTransportPolicy: 'all'
```

正常业务应优先尝试 P2P，只有直连失败时才使用 TURN 中继。

## 十二、常用运维命令

### 查看 coturn 状态

```bash
docker ps | grep coturn
```

### 查看实时日志

```bash
docker logs -f chat-me-coturn
```

### 重启 coturn

```bash
cd /root/www/coturn-server
docker-compose restart coturn
```

### 停止 coturn

```bash
docker-compose stop coturn
```

### 启动 coturn

```bash
docker-compose start coturn
```

### 更新镜像

```bash
docker-compose pull coturn
docker-compose up -d coturn
```

### 查看端口监听

```bash
ss -lunp | grep 3478
ss -ltnp | grep 3478
```

## 十三、常见故障排查

| 问题 | 排查方向 |
|---|---|
| 容器启动失败 | 检查 turnserver.conf 和 Docker 日志 |
| 3478 端口没有监听 | 检查容器运行状态和端口占用 |
| 接口没有返回 TURN 地址 | 检查 TURN_HOST、TURN_SECRET |
| 有 TURN 地址但没有 relay candidate | 检查认证信息、安全组和中继端口 |
| 有 relay candidate 但视频不通 | 检查 external-ip 映射、媒体链路和 NAT |
| 局域网正常，跨网失败 | 检查 TURN 认证、UDP 端口和公网映射 |
| UDP 不通 | 检查阿里云安全组和客户端网络限制 |

## 十四、最终部署架构

部署完成后，系统架构如下：

```text
                  WebRTC 客户端 A
                         |
                         |
                  聊天信令服务
                         |
                         |
                  WebRTC 客户端 B

       客户端 A ---------------- 客户端 B
                    P2P 直连
                       |
                  直连失败时
                       |
                       v
               coturn TURN 服务
                101.37.161.245
                       |
                  UDP 3478
                       |
                UDP 49152-65535
                       |
                  媒体数据转发
```

### 最终效果

1. 同一局域网设备继续使用内网 P2P 连接。
2. 不同网络设备优先尝试 STUN 打洞。
3. STUN 打洞失败时，通过 coturn 进行媒体中继。
4. 支持家庭 Wi-Fi、手机 4G/5G、不同运营商网络等跨网络通信场景。
5. coturn 独立运行在 Docker 容器中，不影响原有聊天服务架构。

## 十五、部署注意事项

1. TURN 的 Shared Secret 必须与聊天服务的 `TURN_SECRET` 完全一致。
2. 阿里云安全组必须放行 3478 TCP/UDP 和 49152–65535 UDP。
3. `external-ip` 必须正确映射服务器公网 IP 与宿主机私网 IP。
4. Docker Host 网络模式下不需要配置端口映射。
5. TURN 中继会消耗服务器公网带宽，应关注流量和带宽成本。
6. TURN 临时凭据应设置合理的过期时间。
7. 不建议长期强制所有媒体走 TURN，应优先 P2P，失败后再中继。
8. 正式上线后建议进一步配置 TURN/TLS，以提高受限网络环境下的兼容性。

---

**部署目标：在不改变原有聊天信令服务架构的情况下，增加 coturn 中继能力，解决 WebRTC 跨网络音视频无法连接的问题。**