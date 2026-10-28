# 宝塔 / OpenCloudOS 9 原生部署

日常操作推荐使用 [Git简化部署](GIT_DEPLOY.md)，首次安装后用 `sudo wildhaven update` 更新，`sudo wildhaven rollback` 回滚；本文保留原生部署细节和手动安装备选。Git安装与手动安装二选一，不要混用进程管理或重复覆盖目录。

目标：腾讯云 2 核 2GB、50GB，已有 Node 静态网站。采用独立 Node 24 运行时和 systemd 管理本项目；不安装 Docker，不新增或修改宝塔反向代理配置。下面是准备好的操作步骤，尚未在目标服务器执行。

## 路径与资源

| 项目 | 值 |
| --- | --- |
| 源码和构建目录 | `/opt/wildhaven/app` |
| 独立 Node 运行时入口 | `/opt/wildhaven/node/bin/node` |
| 配置 | `/etc/wildhaven.env`，root 所有，600 权限 |
| 数据 | `/var/lib/wildhaven/world.sqlite`，服务用户专用 |
| 服务 | `wildhaven.service`，独立用户 `wildhaven` |
| 监听 | `127.0.0.1:3001`，部署前确认空闲 |
| 资源 | CPU 100%（约1核时间），内存软阈值384MB、硬上限512MB，V8老生代堆256MB |

采用512×384地图、800只动物上限、1Hz推送、60秒存档，先用1倍速。硬内存上限可能导致OOM终止，不是稳定性保证；服务会按失败重启策略恢复。高负载时应减小种群或地图。宝塔已有站点照常运行，不要同时用宝塔 Node 项目管理器、PM2 和 systemd 启动本项目，也不要运行多个实例写同一存档。

## 1. 检查环境

在宝塔终端或SSH中执行：

```bash
cat /etc/os-release
uname -m
node -v
command -v node
sudo ss -lntp
free -h
df -h
systemd --version
```

确认3001端口空闲。若占用，修改 `/etc/wildhaven.env` 的 `PORT`，同时调整后续检查URL和现有访问入口。无需停止原网站。

## 2. 准备独立Node运行时

要求Node **24.11或更高的24.x**。优先使用当前受维护的24.x补丁版本。不要替换旧网站使用的全局Node，也不要把服务指向 `/root/.nvm` 等受 `ProtectHome=true` 隔离的目录。

从[Node官方24.x下载目录](https://nodejs.org/dist/latest-v24.x/)下载与 `uname -m` 对应的Linux压缩包（x86_64选linux-x64，aarch64选linux-arm64），同时获取官方 `SHASUMS256.txt` 并用 `sha256sum` 校验该包。以普通用户下载和解压到新的临时目录，再将完整运行时安装到 `/opt/wildhaven/` 下的版本目录，创建指向它的 `/opt/wildhaven/node` 软链接。使用宝塔已安装的合适Node版本时，也可将此软链接指向那个版本的安装根目录；该目录必须不位于 `/root`、`/home` 或 `/run/user`，并且服务用户有读取和执行权限。不要改宝塔的默认Node版本。

最终确认：

```bash
/opt/wildhaven/node/bin/node -v
/opt/wildhaven/node/bin/node -e "require('node:sqlite'); console.log('SQLite available')"
```

Node需要随安全更新维护；版本目录与旧网站分开，便于独立切换。

## 3. 上传与构建

### 推荐：上传已构建的原生部署包

本次本地构建生成 `output/wildhaven-native.zip`。将包通过宝塔上传、解压，使 `/opt/wildhaven/app/dist/server/index.js` 与 `/opt/wildhaven/app/package.json` 直接存在，避免多套一层目录。包包含编译后的服务端和静态页面、锁文件及部署模板，不含真实口令、数据库或Windows依赖。

以拥有应用目录写权限的普通部署用户执行：

```bash
(
  set -e
  cd /opt/wildhaven/app
  export PATH=/opt/wildhaven/node/bin:$PATH
  node -v
  npm ci --omit=dev
)
```

然后直接进行第4步。这种方式无需在2GB服务器运行TypeScript/Vite构建。Node运行时和生产依赖仍须在服务器安装；包内JS与静态资源可跨Windows/Linux运行，但它不是包含Node本身的自包含程序。

### 备选：上传源码后在服务器构建

使用宝塔文件管理器，将源码上传到 `/opt/wildhaven/app`。包含 `package-lock.json`、`package.json`、tsconfig、vite配置以及 `client/`、`server/`、`shared/`、`tests/` 和 `deploy/`。

排除Windows的 `node_modules`、`dist`、本地 `.env`、运行中的 `data`、`.git` 和输出目录。不要通过宝塔把整个源码目录作为静态站点目录公开。

在拥有此源码目录写权限的普通部署用户下构建。下面的PATH仅在子Shell中生效，不切换原网站的Node：

```bash
(
  set -e
  cd /opt/wildhaven/app
  export PATH=/opt/wildhaven/node/bin:$PATH
  node -v
  npm ci
  npm run check
  npm run build
  npm test
  npm prune --omit=dev
)
```

不要用root执行npm安装脚本。若只有宝塔root终端，可使用临时构建用户：先由管理员创建该用户并仅授予本项目目录写权限，再用 `sudo -u 用户名` 执行上述构建；完成后收回写权限。构建发生在服务外，不受服务的512MB配额限制，建议低峰操作。以后每次更新先 `npm ci`，再构建和测试，最后裁剪开发依赖。

## 4. 安装独立服务

创建无登录权限的系统用户，已有用户时跳过创建，先确认其确为本项目专用：

```bash
sudo useradd --system --user-group --home-dir /var/lib/wildhaven --no-create-home --shell /sbin/nologin wildhaven
```

源码和运行时应由管理员/部署用户管理，`wildhaven`只需读取源码和执行Node。可由root收紧应用目录：

```bash
sudo chown -R root:wildhaven /opt/wildhaven/app
sudo chmod -R u=rwX,g=rX,o= /opt/wildhaven/app
sudo install -o root -g root -m 600 /opt/wildhaven/app/deploy/native.env.example /etc/wildhaven.env
sudo install -o root -g root -m 644 /opt/wildhaven/app/deploy/wildhaven.service /etc/systemd/system/wildhaven.service
```

仅首次安装时复制配置，更新时保留 `/etc/wildhaven.env`。用宝塔终端编辑配置，填入 `openssl rand -hex 32` 生成的口令；不把真实口令写进源码、命令历史或发送到聊天。运行时用户名是 `admin`，密码是配置中的 `ADMIN_TOKEN`。

确认服务用户能运行Node和读取构建产物：

```bash
sudo -u wildhaven /opt/wildhaven/node/bin/node -v
sudo -u wildhaven test -r /opt/wildhaven/app/dist/server/index.js
sudo systemd-analyze verify /etc/systemd/system/wildhaven.service
sudo systemctl daemon-reload
sudo systemctl enable --now wildhaven
sudo systemctl status wildhaven --no-pager
sudo journalctl -u wildhaven -n 80 --no-pager
curl -fsS http://127.0.0.1:3001/health
```

`StateDirectory`会创建并保留专用数据目录。服务直接启动Node，不使用 `npm start`，环境由systemd读取 `/etc/wildhaven.env`。修改环境文件后执行 `sudo systemctl restart wildhaven`；修改service文件还需要先 `daemon-reload`。

## 5. 不修改反向代理时如何访问

本项目Node入口只提供HTTP。若宝塔已为此域名提供HTTPS访问入口，保留现有配置，将 `/etc/wildhaven.env` 的 `PUBLIC_ORIGIN` 填成实际完整源（如 `https://eco.example.com`），确认入口支持WebSocket、保留Host与Authorization。不要把HTTPS域名直接解析到只会HTTP的3001端口。

如果还没有HTTPS入口，又不配置反向代理，先通过SSH隧道安全地使用。保持 `HOST=127.0.0.1`、`PUBLIC_ORIGIN=`，在自己的电脑运行（替换用户名与IP）：

```bash
ssh -N -L 13001:127.0.0.1:3001 用户名@服务器IP
```

保持隧道窗口开启，浏览器访问 `http://127.0.0.1:13001`。用户名 `admin`，密码为管理口令；公网段由SSH加密。无需在腾讯云安全组或宝塔防火墙开放3001端口，SSH应只允许可信来源。

直接开放公网HTTP会暴露Basic口令，不用于正式登录。若不采用HTTPS入口或SSH隧道，需要另外实现直接TLS后再上线，本部署材料没有替你配置或假定存在TLS。

## 6. 运行、性能和备份

```bash
sudo systemctl restart wildhaven
sudo systemctl stop wildhaven
sudo systemctl start wildhaven
sudo journalctl -u wildhaven -f
sudo systemctl show wildhaven -p MemoryCurrent -p MemoryHigh -p MemoryMax -p CPUQuotaPerSecUSec -p NRestarts
df -h
```

访问登录后只允许一个实时连接，30分钟无页面交互自动下线，可用 `IDLE_TIMEOUT_SECONDS` 调整。下线后生态继续运行。健康探针只返回 `{ok}`；通过隧道查看详细性能：

```bash
curl -u admin http://127.0.0.1:13001/health/details
```

curl会提示输入密码。观察实际控制延迟、CPU、内存和持续丢步；单次健康采样不是历史峰值。systemd限制只在cgroup控制器正常工作时生效，以上 `systemctl show` 与实际资源监控须在目标机核实。journald日志由主机现有策略轮转，不为本项目修改全局日志策略。

在线备份使用SQLite backup API，先创建私有备份目录：

```bash
sudo install -d -o wildhaven -g wildhaven -m 700 /var/lib/wildhaven/backups
sudo -u wildhaven /opt/wildhaven/node/bin/node /opt/wildhaven/app/dist/server/backup.js /var/lib/wildhaven/world.sqlite /var/lib/wildhaven/backups/world-$(date +%Y%m%d-%H%M%S).sqlite
```

备份以最近提交的存档为准，最多落后约60秒。将备份另外复制到本机或其他存储，定期清理旧备份。不要直接复制活动数据库主文件来替代在线备份。

恢复前停止 `wildhaven`、将整个 `/var/lib/wildhaven`（包括可能存在的WAL/SHM）备份到另一个目录，再按README的原生恢复流程替换数据库、清除与被替换数据库对应的旧WAL/SHM并设置 `wildhaven:wildhaven` 所有权。不要在主进程运行中替换数据库。

更新时先备份数据和保留旧版程序，停止服务，在独立暂存目录以普通部署用户构建测试后再替换应用目录，保留独立配置和数据库，再启动并验证。旧版不兼容新存档格式时，回滚需同时恢复升级前备份。

## 宝塔和SELinux排障

- 不要在宝塔Node项目管理器再次启动本项目；systemd是本方案唯一进程管理器。
- `ProtectHome=true`导致root/home目录下Node不可见时，将独立Node运行时放在 `/opt/wildhaven` 或选择宝塔已安装且可被服务读取的版本目录。
- 端口占用时查看 `sudo ss -lntp`，更换本项目端口，不停止原站点。
- SELinux拒绝访问时查看 `sudo journalctl -u wildhaven` 与审计日志，由实际拒绝记录决定最小调整；不要直接关闭SELinux或执行 `chmod 777`。
- 反复启动失败触发频率限制时，先修复配置/权限，再 `sudo systemctl reset-failed wildhaven` 和 `sudo systemctl start wildhaven`。

本地Windows环境已验证应用逻辑，但无法运行Linux systemd，目标主机需要执行服务语法检查、启停/重启保存恢复、实际资源限制和HTTPS/隧道连接验证。

参考：[systemd资源限制](https://www.freedesktop.org/software/systemd/man/latest/systemd.resource-control.html)、[服务用户和持久化目录](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html)。
