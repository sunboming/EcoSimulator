# 部署检查与低配服务器起步方案

检查日期：2026-10-28。尚未连接目标服务器；以下资源设置为保守起步值，需要在实际主机确认。

最终部署选择：用户选择原生部署，使用宝塔和腾讯云，不要求新增反向代理。当前操作入口为 [原生部署说明](../deploy/NATIVE_DEPLOY.md)，使用独立Node + systemd；下文Docker步骤保留为备选。域名、端口实际占用和现有HTTPS入口仍需目标机确认。

后续调整：根据“只允许单人访问”的要求，项目现已默认开启私有模式。本文原先的 10 人并发建议不再适用，`MAX_CLIENTS` 强制为 1。页面和 WebSocket 均需使用用户名 `admin`、`ADMIN_TOKEN` 登录；口令至少 32 字符且不能使用示例值。匿名 `/health` 仅返回 `{ok}`，性能指标改用 `curl -u admin https://你的域名/health/details` 获取。私有部署和限流的最新规则以 README 开头为准。

挂机策略：默认 `IDLE_TIMEOUT_SECONDS=1800`，30 分钟无页面交互即断开并停止自动重连，手动重新进入后可继续观看，管理操作需重新解锁。世界在下线后继续演化。

## 已确认的目标服务器

用户提供：2 核 CPU、2GB 内存、50GB 磁盘、OpenCloudOS 9，已有域名。带宽、其他服务占用及 Docker/反向代理安装状态尚未确认。

若主机没有其他高负载服务，建议以 512×384 地图、`MAX_ANIMALS=800`、`MAX_CLIENTS=10`、`PUSH_HZ=1`、`TICK_HZ=5`、`SAVE_SECONDS=60`、`MEM_LIMIT=512m`、`NODE_HEAP_MB=256`、`CPU_LIMIT=1.0`、1 倍速起步。运行单实例，为系统、代理和镜像构建预留余量。50GB 总容量还需扣除系统、其他服务、镜像和备份，部署前用 `df -h` 查看实际可用空间。后续是否提高到 1200 只和 2Hz 推送，依据目标机在预计并发下的测量决定。

有域名时建议 `.env` 设置 `BIND_IP=127.0.0.1`、`PUBLIC_ORIGIN=https://实际域名`，通过宿主机 Caddy 或已有 Nginx 提供 HTTPS。已有站点的代理配置应合并，避免占用冲突。

## 本地验证结果

环境：Windows、AMD Ryzen 9 7940HX、Node.js v24.11.1。类型检查、生产构建通过，57 项测试全部通过，包括 HTTP/WebSocket、管理鉴权、无访客演化和 SQLite 重启恢复。本机没有 Docker，未验证镜像构建、Linux 信号退出和容器资源限制。

满载测试使用 `npm run bench:stress`，96×64 地图、最大感知范围，每场预热 20 步并测量 120 步，保持种群数量：

| 种群 | 分布 | 单步 P95 | 单步最大值 | RSS |
| --- | --- | --- | --- | --- |
| 1200 | 分散 | 5.41ms | 7.89ms | 78MB |
| 1200 | 聚集 | 3.94ms | 5.21ms | 81MB |
| 1200 | 纯食草 | 3.82ms | 4.11ms | 98MB |
| 5000 | 分散 | 31.64ms | 45.21ms | 137MB |
| 5000 | 聚集 | 9.63ms | 10.79ms | 141MB |
| 5000 | 纯食草 | 14.56ms | 16.69ms | 144MB |

六场在同一进程依次运行，RSS 包含前场分配和工具开销，不能当作独立场景的内存需求或容器峰值。

大地图使用 `node --max-old-space-size=128 --import tsx scripts/large-benchmark.ts 宽 高`，各运行 3000 步并保存、恢复 SQLite：

| 地图 | 最终动物数 | 单步 P95 | 保存耗时 | 保存后 RSS | 同时保留恢复副本的 RSS |
| --- | --- | --- | --- | --- | --- |
| 512×384 | 183 | 0.829ms | 10ms | 85MB | 87MB |
| 2048×1536 | 202 | 1.254ms | 67ms | 118MB | 145MB |

这些是开发机快进测试，不代表低配 Linux、多访客、大地图满种群或长期运行表现。存档恢复测试的副本内存也不是扩图峰值保证。

## 性能判断

- 动物逐个模拟，倍速增加每秒计算量。1 倍速每秒 5 个生物步，8 倍速需 40 步；低配先用 1 倍速和较小种群。调度超预算会丢弃追赶步骤，实际演化慢于设定速度。
- `TICK_HZ` 仅控制调度唤醒，不能通过降低它减少每模拟秒所需的生物步，建议保留 5。
- 地图数值数组随面积增长。保存压缩和 SQLite 写入在主线程同步完成，扩图还会创建世界副本，可能造成响应停顿和内存突增。
- 推送按每个访客的视野构建和 JSON 编码，成本随访客数增长；WebSocket 没有启用消息压缩。静态文件的 gzip 不会压缩这些 WebSocket 帧。低带宽主机先设置 `PUSH_HZ=1`、`MAX_CLIENTS=10`，容量需做实际多连接测试。
- 服务器只运行一个共享世界。不要用 PM2 cluster、多个容器副本或多进程同时写同一数据库；当前架构没有多实例状态同步。
- Compose 的 CPU/内存限制约束运行容器，不代表镜像构建也受同样配额保护。小内存机器可在同架构其他机器构建镜像，再导入服务器。
- 128MB 的 V8 堆上限不是进程总内存上限，数组缓冲、SQLite 和运行时还需要额外内存。容器外也应为系统、Docker、代理及其他服务留余量。

## 建议起步配置

未获得服务器配置前，可用以下参数进行小规模试运行；这是调参起点，不是容量承诺。1 核 1GB 的空闲主机比 512MB 主机更有余量。

复制 `.env.example` 为 `.env`，修改对应行，其他行保留：

```dotenv
BIND_IP=127.0.0.1
PUBLIC_ORIGIN=https://eco.example.com
WORLD_WIDTH=256
WORLD_HEIGHT=192
MAX_ANIMALS=400
MAX_CLIENTS=10
TICK_HZ=5
PUSH_HZ=1
SAVE_SECONDS=60
MEM_LIMIT=256m
NODE_HEAP_MB=128
CPU_LIMIT=0.50
```

将域名换为实际域名，使用 `openssl rand -hex 32` 生成口令填入 `ADMIN_TOKEN`。60 秒存档间隔降低写入频率，异常退出最多损失约 60 秒进度。

`WORLD_WIDTH/WORLD_HEIGHT` 只影响新世界和重置，不会缩小旧存档；降低 `MAX_ANIMALS` 会在恢复时截断超额动物。如果需要保留本地世界，先通过备份 API 导出，再按 README 恢复流程迁入；不要直接复制运行中的 SQLite 主文件。

## 在服务器部署

1. 准备 Linux、Docker Engine 和 Compose v2，将项目上传到固定目录，保留 `package-lock.json`，排除 `node_modules`、`dist`、`.git`、`.env` 和本地运行中的 `data`。服务器单独建立 `.env`。
2. 按上面配置填入口令和域名。在项目目录执行：

   ```bash
   docker compose config --quiet
   docker compose up -d --build
   docker compose ps
   docker compose logs --tail=100 eco
   curl -fsS http://127.0.0.1:3000/health
   ```

3. 域名 A/AAAA 指向服务器，为宿主机 Caddy 建立站点；已有代理时合并到原配置，不覆盖其他站点：

   ```caddyfile
   eco.example.com {
       encode zstd gzip
       reverse_proxy 127.0.0.1:3000
   }
   ```

   放行 80/443，验证 Caddy 配置并重载，浏览器访问 `https://实际域名`。上游只绑定回环地址，不需要公网开放 3000。Caddy 原生支持 WebSocket 转发。

4. 检查页面连接、管理员解锁、控制同步及重启后的进度恢复。保持 1 倍速，在预计访客和动物数量下观察至少 30–60 分钟；这属于初步运行验证，后续仍需监控：

   ```bash
   docker stats
   watch -n 5 'curl -fsS http://127.0.0.1:3000/health'
   docker inspect --format '{{.State.OOMKilled}}' "$(docker compose ps -q eco)"
   df -h
   ```

   `/health` 的 `stepMs` 是最近一次调度批次耗时，`droppedSteps` 是最近批次丢弃步骤数，均不是历史 P95 或累计值。短时采样为 0 不能证明从未过载。持续丢步、页面控制延迟、CPU 长期触及配额或内存持续接近上限时，应降低种群/倍速/推送/人数或增加资源。

5. 上线前做一次在线备份并在隔离环境验证恢复；具体命令见 README“存档、备份与恢复”。不要执行 `docker compose down -v`，它会删除世界数据卷。健康检查不会仅凭 unhealthy 自动重启容器，需要外部监控。

官方参考：[Docker 安装](https://docs.docker.com/engine/install/)、[Compose 资源与健康检查配置](https://docs.docker.com/reference/compose-file/services/)、[Caddy 反向代理与 WebSocket](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)。
