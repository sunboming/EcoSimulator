# Git原生部署：首次安装后，一条命令更新

适用当前仓库：`https://github.com/sunboming/EcoSimulator.git`，默认分支 `main`。使用宝塔已安装且不在root/home目录下的Node 24.11+（24.x），不安装Docker，不修改宝塔反向代理或现有网站。

这份脚本及当前私有访问功能需要先提交并推送到Git仓库，服务器才能下载。本文命令由你在本机或服务器执行，不代表已经推送或安装。

## 本机：提交和上传

在项目目录查看变更，确认没有真实口令、存档或其他不打算上传的文件，再提交：

```powershell
git status
git add .
git commit -m "Add private access and native Git deployment"
git push origin main
```

以后本机开发也是同样的 `add → commit → push` 流程，提交信息改为对应内容。`.env`、数据库目录、构建输出和依赖已在忽略规则中；真实服务器配置保存在仓库外。

在另一台开发电脑下载项目：

```bash
git clone https://github.com/sunboming/EcoSimulator.git
```

更新开发副本可在工作区干净时使用 `git pull --ff-only`。服务器的正在运行目录不执行 `git pull`，统一用下面的部署命令。

## 服务器：首次安装

先在宝塔确认已安装Node 24.11+（24.x），找到该版本的绝对路径。`node -v` 和 `command -v node` 可帮助确认；不要切换旧网站的运行时。若未安装Git，OpenCloudOS终端执行 `sudo dnf install -y git`。

```bash
git clone https://github.com/sunboming/EcoSimulator.git
cd EcoSimulator
sudo bash deploy/wildhaven.sh install /你的Node安装目录/bin/node
```

如果终端的Node已经是正确的24.x版本，最后一行可直接写：

```bash
sudo bash deploy/wildhaven.sh install "$(command -v node)"
```

宝塔root终端也可执行，不要求再次登录root；脚本内构建与测试会以单独的低权限用户运行，CPU限制约1核、内存限制768MB，运行服务则使用512MB硬内存上限和约1核配额。

脚本会生成随机口令，保存在 `/etc/wildhaven.env`，用宝塔文件编辑器或终端查看、修改。浏览器用户名固定为 `admin`。域名通过已有HTTPS入口使用时，填 `PUBLIC_ORIGIN=https://实际域名`，修改后 `sudo systemctl restart wildhaven`。入口接入和SSH隧道方法见 [完整原生部署说明](NATIVE_DEPLOY.md#5-不修改反向代理时如何访问)。未接入HTTPS时不在公网HTTP发送口令。

默认监听 `127.0.0.1:3001`，世界与存档保存在 `/var/lib/wildhaven`。安装前确认3001空闲；若需更换，在配置文件中调整 `PORT`。若首次启动失败，配置和部署工具仍会保留，修复配置后可重试 `sudo wildhaven update`。已有旧式 `/opt/wildhaven/app` 实体目录时脚本拒绝自动覆盖，需要先另行迁移。

## 以后更新：一条命令

先在本机提交、推送，再到服务器执行：

```bash
sudo wildhaven update
```

流程是：下载所选分支 → 在新目录安装依赖、类型检查、构建和测试 → 停旧服务并备份最终存档 → 切换版本 → 启动并验证登录后的健康详情。构建或测试失败时不切换；停服备份失败时尝试重新启动旧服务；新版本启动失败时尝试恢复旧程序。成功后的旧版本仍保留。

配置与存档在Git目录外，更新不覆盖 `/etc/wildhaven.env` 或直接替换数据库文件。但新程序可能升级存档格式，升级前备份位置会输出到终端。世界在旧服务停止至新服务启动期间不会演化。下载和构建阶段旧服务继续运行，但会与它共享主机资源，建议在低峰更新。

## 指定版本、回滚与替换

部署已推送的分支或标签，例如 `v1.0.0`（需先在仓库创建对应标签）：

```bash
sudo wildhaven update v1.0.0
```

该参数会成为以后 `update` 的默认目标；切回持续更新主分支执行 `sudo wildhaven update main`。支持远端可以获取的分支/标签/ref，不承诺服务器能直接获取任意未公开的提交哈希。

立即切回上一个成功版本：

```bash
sudo wildhaven rollback
```

回滚仅切换程序，并为当前数据建立备份，不自动倒退世界进度。若旧程序无法读取已升级的存档，按原生部署说明先停服务，再恢复相应升级前备份。

把服务器改为使用另一个可信、兼容的仓库：

```bash
sudo wildhaven replace https://github.com/你的账号/新仓库.git main
```

只有构建、启动成功后才保存新仓库目标。配置和数据保留；失败时尝试恢复旧程序。新仓库必须保持本项目的npm脚本、`dist/server/index.js`、`dist/server/backup.js`、私有健康接口及存档约定。完全不同的Node项目应另建独立服务和数据目录，不能沿用生态存档。

只使用自己控制或信任的仓库。私有仓库需要给 `wildhaven-build` 用户配置只读deploy key；不要把PAT或密码放入URL，HTTPS凭据URL会被脚本拒绝。初次公开仓库部署不需要在服务器配置Git推送权限。

## 状态、日志与空间

```bash
sudo wildhaven status
sudo wildhaven logs
```

版本位于 `/opt/wildhaven/releases/`；当前与上一个版本分别由 `/opt/wildhaven/app` 和 `/opt/wildhaven/previous` 软链接指向。升级前存档备份在 `/var/lib/wildhaven/backups/`，要另外复制到服务器之外。为了方便排障，失败构建目录也会保留；定期检查50GB磁盘余量，只清理确认未被当前/上一个版本使用的旧目录和已另存的备份。脚本不自动删除历史版本或数据库。

部署工具固定安装于 `/usr/local/sbin/wildhaven`，服务文件位于 `/etc/systemd/system/wildhaven.service`，普通应用更新不会从远程仓库自动替换这两个管理文件。未来管理脚本或资源限制有变更时，先审核对应改动再单独更新，以免远程应用代码借更新取得root权限。

脚本包含并发部署锁；不要用宝塔Node管理器/PM2再启动同一个项目。Git部署不会修改现有网站。实际Linux systemd行为、链接切换和资源限制需要在服务器验证；本地Windows不能完整替代该检查。
