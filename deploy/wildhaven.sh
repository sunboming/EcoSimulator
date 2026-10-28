#!/usr/bin/env bash
set -Eeuo pipefail

BASE=/opt/wildhaven
DEPLOY_CONFIG=/etc/wildhaven-deploy.conf
ENV_FILE=/etc/wildhaven.env
BUILD_USER=wildhaven-build
RUNTIME_USER=wildhaven
SOURCE_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
RECOVER_APP=''
NEED_RECOVERY=false

usage() {
  cat <<'HELP'
首次安装（使用宝塔已安装的 Node 24）：
  sudo bash deploy/wildhaven.sh install /绝对路径/bin/node [仓库URL] [分支或标签]
日常管理：
  sudo wildhaven update [分支或标签]    拉取、构建、备份、切换并检查
  sudo wildhaven rollback             切换到上一个成功运行的版本（保留当前存档）
  sudo wildhaven replace URL [版本]    更换兼容本项目的可信仓库，保留配置和存档
  sudo wildhaven status               查看服务状态
  sudo wildhaven logs                 查看日志
配置 /etc/wildhaven.env；数据 /var/lib/wildhaven；版本 /opt/wildhaven/releases。
HELP
}
die() { printf '%s\n' "错误：$*" >&2; exit 1; }
validate_target() {
  # Reject options, local filesystem repositories and embedded HTTPS credentials.
  [[ $REPO_URL == https://* || $REPO_URL == git@*:* ]] || die '仓库需使用 HTTPS 或 git@host:path SSH 地址。'
  [[ ! $REPO_URL =~ ^https://[^/]*@ ]] || die '不要将令牌或密码嵌入仓库 URL。'
  [[ -n $REF && $REF != -* && $REF != *$'\n'* ]] || die '无效分支或标签。'
}
save_target() {
  local tmp
  tmp=$(mktemp "${DEPLOY_CONFIG}.XXXXXX")
  chmod 600 "$tmp"
  printf 'REPO_URL=%q\nREF=%q\n' "$REPO_URL" "$REF" > "$tmp"
  mv -f -- "$tmp" "$DEPLOY_CONFIG"
}
link_app() {
  local target=$1
  [[ $target == "$BASE"/releases/* && -d $target ]] || die '版本目录不在预期位置。'
  ln -s -- "$target" "$BASE/app.next.$$"
  mv -Tf -- "$BASE/app.next.$$" "$BASE/app"
}
recover_interrupted_deploy() {
  local status=$?
  if [[ $status -ne 0 && $NEED_RECOVERY == true && -n $RECOVER_APP ]]; then
    printf '%s\n' '切换中断，尝试恢复旧程序；数据未自动回退。' >&2
    link_app "$RECOVER_APP" && systemctl start wildhaven || true
  fi
}
health() {
  # Read secrets inside Node, never interpolate them into argv or console output.
  "$BASE/node/bin/node" --env-file="$ENV_FILE" --input-type=module - <<'NODE'
const port = process.env.PORT || '3001';
const authorization = 'Basic ' + Buffer.from('admin:' + process.env.ADMIN_TOKEN).toString('base64');
for (let i = 0; i < 30; i++) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health/details`, { headers: { Authorization: authorization }, signal: AbortSignal.timeout(1000) });
    const body = await response.json();
    if (response.ok && body.ok && Number.isFinite(body.tick)) process.exit(0);
  } catch {}
  await new Promise(resolve => setTimeout(resolve, 500));
}
process.exit(1);
NODE
}
backup() {
  local app=$1
  # The configured database path is read without evaluating the env file as shell code.
  local db destination
  db=$("$BASE/node/bin/node" --env-file="$ENV_FILE" -p 'process.env.DB_PATH || "/var/lib/wildhaven/world.sqlite"')
  [[ -f $db ]] || return 0
  install -d -o "$RUNTIME_USER" -g "$RUNTIME_USER" -m 700 /var/lib/wildhaven/backups
  destination="/var/lib/wildhaven/backups/pre-deploy-$(date +%Y%m%d-%H%M%S)-$$.sqlite"
  runuser -u "$RUNTIME_USER" -- "$BASE/node/bin/node" "$app/dist/server/backup.js" "$db" "$destination"
  printf '升级前备份：%s\n' "$destination"
}
activate() {
  local release=$1 old=''
  if [[ -L $BASE/app ]]; then old=$(readlink -f -- "$BASE/app"); fi
  if [[ -n $old ]]; then
    RECOVER_APP=$old; NEED_RECOVERY=true
    systemctl stop wildhaven
    if ! backup "$old"; then systemctl start wildhaven || true; die '备份失败，已取消切换。'; fi
  fi
  link_app "$release"
  if systemctl restart wildhaven && health && systemctl is-active --quiet wildhaven; then
    if [[ -n $old && $old != "$release" ]]; then
      ln -s -- "$old" "$BASE/previous.next.$$"
      mv -Tf -- "$BASE/previous.next.$$" "$BASE/previous"
    fi
    printf '部署成功：%s\n' "$release"
    NEED_RECOVERY=false
  else
    systemctl stop wildhaven || true
    if [[ -n $old ]]; then
      link_app "$old"
      systemctl start wildhaven || true
      printf '%s\n' '已切回旧程序。数据库未自动回退；格式不兼容时需恢复上面记录的备份。' >&2
    fi
    NEED_RECOVERY=false
    die '新版本启动检查失败，请运行 sudo wildhaven logs。'
  fi
}
build_release() {
  validate_target
  local release
  release=$(mktemp -d "$BASE/releases/release.XXXXXXXX")
  chown "$BUILD_USER:$BUILD_USER" "$release"
  runuser -u "$BUILD_USER" -- git -C "$release" init --quiet
  runuser -u "$BUILD_USER" -- git -C "$release" remote add origin "$REPO_URL"
  runuser -u "$BUILD_USER" -- git -C "$release" fetch --depth=1 origin "$REF"
  runuser -u "$BUILD_USER" -- git -C "$release" checkout --quiet --detach FETCH_HEAD
  # npm scripts and fetched application code never execute as root.
  systemd-run --unit=wildhaven-build --wait --pipe --collect \
    -p "User=$BUILD_USER" -p "Group=$BUILD_USER" -p "WorkingDirectory=$release" \
    -p 'MemoryMax=768M' -p 'CPUQuota=100%' -p 'NoNewPrivileges=true' \
    -p 'Environment=HOME=/var/cache/wildhaven-build' \
    -p "Environment=PATH=$BASE/node/bin:/usr/local/bin:/usr/bin:/bin" \
    /bin/bash -c 'set -e; npm ci; npm run check; npm run build; npm test; npm prune --omit=dev'
  [[ -f $release/dist/server/index.js && -f $release/dist/server/backup.js ]] || die '仓库不符合本项目的服务端/备份入口约定。'
  printf '%s\n' "$REPO_URL" > "$release/.wildhaven-repository"
  printf '%s\n' "$REF" > "$release/.wildhaven-ref"
  chown -R "root:$RUNTIME_USER" "$release"
  chmod -R u=rwX,g=rX,o= "$release"
  activate "$release"
  save_target
}

main() {
local command=${1:-help}
case "$command" in help|--help|-h) usage; return 0;; install|update|rollback|replace|status|logs) shift;; *) usage >&2; return 2;; esac
[[ $EUID -eq 0 ]] || die '请使用 sudo 或在宝塔 root 终端运行。'
for tool in git systemctl runuser flock readlink install; do command -v "$tool" >/dev/null || die "缺少命令：$tool"; done
exec 9>/run/lock/wildhaven-deploy.lock
flock -n 9 || die '另一个部署正在进行，请稍后重试。'
trap recover_interrupted_deploy EXIT
if [[ $command == install ]]; then
  [[ $# -ge 1 && $# -le 3 ]] || die '用法：install /绝对路径/bin/node [仓库URL] [分支或标签]'
  [[ $1 == /* ]] || die 'Node 必须使用绝对路径。'
  node_exe=$(readlink -f -- "$1")
  [[ -x $node_exe ]] || die '找不到可执行的 Node。'
  case "$node_exe" in /root/*|/home/*|/run/user/*) die '请使用 /opt 或宝塔安装目录中的独立 Node，服务无法读取 home/root 下的运行时。';; esac
  "$node_exe" -e 'const [major,minor]=process.versions.node.split(".").map(Number); if(major!==24||minor<11)process.exit(1); require("node:sqlite")' || die '需要支持 node:sqlite 的 Node 24.11+（24.x）。'
  [[ $node_exe == */bin/node ]] || die 'Node 安装目录需保留 bin/node 和 bin/npm 结构。'
  node_root=${node_exe%/bin/node}
  [[ -f $node_root/bin/npm ]] || die '同一 Node 安装目录中找不到 npm。'
  REPO_URL=${2:-https://github.com/sunboming/EcoSimulator.git}
  REF=${3:-main}
  validate_target
  [[ ! -e $BASE/app && ! -L $BASE/app ]] || die '应用目录已存在；请使用 update，旧式手动安装需先单独迁移，不自动覆盖。'
  for tool in openssl systemd-run useradd; do command -v "$tool" >/dev/null || die "缺少命令：$tool"; done
  [[ -f $SOURCE_DIR/wildhaven.service && -f $SOURCE_DIR/native.env.example ]] || die '请从源码 deploy/wildhaven.sh 执行首次安装。'
  for account in "$RUNTIME_USER" "$BUILD_USER"; do
    if id "$account" >/dev/null 2>&1; then
      [[ $(id -u "$account") != 0 ]] || die '服务账户不能是 root。'
    else
      useradd --system --user-group --no-create-home --shell /sbin/nologin "$account"
    fi
  done
  install -d -m 755 "$BASE" "$BASE/releases"
  install -d -o "$BUILD_USER" -g "$BUILD_USER" -m 700 /var/cache/wildhaven-build
  if [[ -e $BASE/node || -L $BASE/node ]]; then
    [[ $(readlink -f -- "$BASE/node") == "$node_root" ]] || die '已有 Node 入口指向其他运行时，不自动替换。'
  else ln -s -- "$node_root" "$BASE/node"; fi
  runuser -u "$BUILD_USER" -- "$BASE/node/bin/node" -v
  runuser -u "$RUNTIME_USER" -- "$BASE/node/bin/node" -v
  if [[ ! -e $ENV_FILE ]]; then
    umask 077
    { sed '/^ADMIN_TOKEN=/d' "$SOURCE_DIR/native.env.example"; printf 'ADMIN_TOKEN=%s\n' "$(openssl rand -hex 32)"; } > "$ENV_FILE"
    printf '已生成随机管理口令，请在 %s 中查看并配置域名。\n' "$ENV_FILE"
  fi
  install -o root -g root -m 600 "$ENV_FILE" "$ENV_FILE.tmp"
  mv -f -- "$ENV_FILE.tmp" "$ENV_FILE"
  install -o root -g root -m 644 "$SOURCE_DIR/wildhaven.service" /etc/systemd/system/wildhaven.service
  install -o root -g root -m 755 "${BASH_SOURCE[0]}" /usr/local/sbin/wildhaven
  systemctl daemon-reload
  systemctl enable wildhaven
  # Keep a retry path even if the first build/start fails before an app exists.
  save_target
  build_release
  exit 0
fi

[[ -f $DEPLOY_CONFIG && $(stat -c %u "$DEPLOY_CONFIG") == 0 ]] || die '尚未完成 Git 安装，或部署配置所有权异常。'
[[ $(stat -c %a "$DEPLOY_CONFIG") == 600 ]] || die '部署配置应为 root 所有且权限 600。'
# This file is written only by the installed root-owned deploy tool, never by the app.
source "$DEPLOY_CONFIG"
case "$command" in
  update) [[ $# -le 1 ]] || die '用法：update [分支或标签]'; REF=${1:-$REF}; build_release;;
  replace) [[ $# -ge 1 && $# -le 2 ]] || die '用法：replace 仓库URL [分支或标签]'; REPO_URL=$1; REF=${2:-main}; build_release;;
  rollback)
    [[ $# -eq 0 && -L $BASE/previous ]] || die '没有可回滚版本。'
    release=$(readlink -f -- "$BASE/previous")
    [[ -f $release/.wildhaven-repository && -f $release/.wildhaven-ref ]] || die '旧版本缺少 Git 部署元数据。'
    REPO_URL=$(cat "$release/.wildhaven-repository"); REF=$(cat "$release/.wildhaven-ref")
    validate_target; activate "$release"; save_target;;
  status) systemctl status wildhaven --no-pager;;
  logs) journalctl -u wildhaven -n 100 --no-pager;;
esac
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then main "$@"; fi
