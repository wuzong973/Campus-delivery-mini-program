#!/usr/bin/env python3
"""
校园代拿服务端部署工具

用法：
    set SSH_PASS=<密码>
    python deploy.py probe                 # 只做环境勘察，不改动任何东西
    python deploy.py backup                # 备份远端 server/src
    python deploy.py upload                # 上传变更文件
    python deploy.py restart               # 重启服务
    python deploy.py health                # 健康检查
    python deploy.py rollback <备份目录>    # 回滚

密码通过环境变量 SSH_PASS 传入，不写入任何文件。
"""

import os
import sys
import posixpath
import time

import paramiko

HOST = "101.35.46.146"
PORT = 22
USER = "root"
LOCAL_ROOT = r"D:\runner"

# 远端部署根目录（与 nginx 配置中的 alias 保持一致）
REMOTE_SERVER_DIR = "/www/wwwroot/wzl136122.cn/server"

# 需要上传的文件：本地相对路径 -> 远端相对 server/ 的路径
FILES = [
    "src/app.js",
    "src/config/env.js",
    "src/middleware/auth.js",
    "src/middleware/error.js",
    "src/middleware/security.js",
    "src/routes/api.js",
    "src/services/adminService.js",
    "src/services/authService.js",
    "src/services/orderService.js",
    "src/services/paymentService.js",
    "src/services/shared.js",
    "src/services/userService.js",
    "src/services/walletService.js",
    "src/utils/validate.js",
    ".env.example",
]


def get_password():
    password = os.environ.get("SSH_PASS", "")
    if not password:
        print("错误：未设置 SSH_PASS 环境变量")
        sys.exit(2)
    return password


def connect():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        hostname=HOST,
        port=PORT,
        username=USER,
        password=get_password(),
        timeout=20,
        banner_timeout=30,
        auth_timeout=30,
    )
    return client


def run(client, command, timeout=60):
    """执行远端命令，返回 (exit_code, stdout, stderr)"""
    stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    code = stdout.channel.recv_exit_status()
    return code, out, err


def show(title, code, out, err):
    print(f"\n--- {title} (exit={code}) ---")
    if out.strip():
        print(out.rstrip())
    if err.strip():
        print("[stderr]", err.rstrip())


def probe(client):
    checks = [
        ("系统信息", "uname -a; echo; cat /etc/os-release 2>/dev/null | head -3"),
        ("部署目录是否存在", f"ls -la {REMOTE_SERVER_DIR} 2>&1 | head -20"),
        ("server/src 现状", f"ls -la {REMOTE_SERVER_DIR}/src 2>&1 | head -20"),
        ("Node 版本", "node -v 2>&1; which node"),
        ("进程管理", "pm2 list 2>&1 | head -20 || echo 'pm2 未安装'"),
        ("systemd 服务", "systemctl list-units --type=service 2>/dev/null | grep -iE 'campus|runner|node' || echo '无匹配的 systemd 服务'"),
        ("监听端口 3000", "ss -lntp 2>/dev/null | grep -E ':3000|:80|:443' || netstat -lntp 2>/dev/null | grep -E ':3000'"),
        ("node 进程", "ps aux | grep -E 'node.*server' | grep -v grep || echo '未发现 node 进程'"),
        ("磁盘空间", "df -h / | tail -2"),
        ("nginx 配置目录", "ls -la /www/server/panel/vhost/nginx/ 2>/dev/null | head -10 || ls -la /etc/nginx/conf.d/ 2>/dev/null | head -10"),
    ]

    for title, cmd in checks:
        code, out, err = run(client, cmd)
        show(title, code, out, err)


def backup(client):
    stamp = time.strftime("%Y%m%d-%H%M%S")
    backup_dir = f"/root/backup-campus-server-{stamp}"

    cmd = (
        f"set -e; "
        f"mkdir -p {backup_dir}; "
        f"cp -a {REMOTE_SERVER_DIR}/src {backup_dir}/src; "
        f"cp -a {REMOTE_SERVER_DIR}/.env {backup_dir}/.env 2>/dev/null || true; "
        f"cp -a {REMOTE_SERVER_DIR}/package.json {backup_dir}/package.json 2>/dev/null || true; "
        f"echo '{backup_dir}' > /root/.campus-last-backup; "
        f"echo '备份完成: {backup_dir}'; "
        f"du -sh {backup_dir}"
    )

    code, out, err = run(client, cmd, timeout=180)
    show("备份", code, out, err)

    if code == 0:
        print(f"\n>>> 备份目录：{backup_dir}")
        print(f">>> 回滚命令：cp -a {backup_dir}/src/. {REMOTE_SERVER_DIR}/src/")
    return code, backup_dir


def upload(client):
    sftp = client.open_sftp()
    remote_tmp = "/tmp/campus-deploy"
    run(client, f"mkdir -p {remote_tmp}")

    uploaded = []
    for rel in FILES:
        local = os.path.join(LOCAL_ROOT, "server", rel.replace("/", os.sep))
        if not os.path.exists(local):
            print(f"!! 本地文件不存在，跳过: {local}")
            continue

        remote_dir = posixpath.dirname(posixpath.join(remote_tmp, rel))
        run(client, f"mkdir -p {remote_dir}")

        remote = posixpath.join(remote_tmp, rel)
        sftp.put(local, remote)
        size = os.path.getsize(local)
        print(f"  上传 {rel}  ({size} bytes)")
        uploaded.append(rel)

    sftp.close()
    print(f"\n共上传 {len(uploaded)} 个文件到 {remote_tmp}")
    return uploaded


def install_files(client):
    """把 /tmp 中的文件安装到部署目录（保持原有属主与权限）"""
    print("\n=== 语法预检（在 /tmp 中先跑 node --check）===")
    code, out, err = run(
        client,
        "cd /tmp/campus-deploy && for f in $(find src -name '*.js'); do "
        "node --check \"$f\" || echo \"SYNTAX-ERR: $f\"; done; echo '预检完成'",
        timeout=120,
    )
    show("语法预检", code, out, err)

    if "SYNTAX-ERR" in out:
        print("\n!! 存在语法错误，已中止安装")
        return False

    print("\n=== 安装到部署目录 ===")
    code, out, err = run(
        client,
        f"set -e; cd /tmp/campus-deploy && "
        f"cp -a src/. {REMOTE_SERVER_DIR}/src/ && "
        f"cp -a .env.example {REMOTE_SERVER_DIR}/.env.example && "
        f"echo '文件已安装'",
        timeout=120,
    )
    show("安装", code, out, err)

    print("\n=== 校验安装结果 ===")
    code, out, err = run(
        client,
        f"ls -la {REMOTE_SERVER_DIR}/src/middleware/ {REMOTE_SERVER_DIR}/src/utils/",
    )
    show("中间件与工具目录", code, out, err)
    return code == 0


def restart(client):
    """重启服务：优先 pm2，其次 systemd，最后按进程手动重启"""
    code, out, _ = run(client, "command -v pm2 >/dev/null && echo yes || echo no")
    has_pm2 = out.strip() == "yes"

    if has_pm2:
        code, out, err = run(
            client,
            "pm2 list 2>&1 | head -20; echo '---'; "
            "pm2 restart all --update-env 2>&1 | tail -20",
            timeout=120,
        )
        show("pm2 重启", code, out, err)
        return

    code, out, _ = run(client, "systemctl list-units --type=service 2>/dev/null | grep -iE 'campus|runner' || true")
    if out.strip():
        show("发现 systemd 服务", 0, out, "")
        return

    print("\n!! 未发现 pm2 或 systemd 服务，请手动确认启动方式")


def health(client):
    cmd = (
        "echo '--- 本机健康检查 ---'; "
        "curl -s -m 8 http://127.0.0.1:3000/healthz; echo; "
        "echo '--- 通过域名检查 ---'; "
        "curl -s -m 8 https://wzl136122.cn/api/auth/session | head -c 300; echo; "
        "echo '--- 最近日志 ---'; "
        "(pm2 logs --nostream --lines 30 2>/dev/null || journalctl -u $(systemctl list-units --type=service --plain --no-legend 2>/dev/null | grep -iE 'campus|runner' | awk '{print $1}' | head -1) -n 30 --no-pager 2>/dev/null) | tail -35"
    )
    code, out, err = run(client, cmd, timeout=90)
    show("健康检查", code, out, err)


def main():
    action = sys.argv[1] if len(sys.argv) > 1 else "probe"

    print(f"连接 {USER}@{HOST}:{PORT} ...")
    client = connect()
    print("连接成功\n")

    try:
        if action == "probe":
            probe(client)
        elif action == "backup":
            backup(client)
        elif action == "upload":
            upload(client)
            install_files(client)
        elif action == "install":
            install_files(client)
        elif action == "restart":
            restart(client)
        elif action == "health":
            health(client)
        else:
            print(f"未知动作: {action}")
            sys.exit(1)
    finally:
        client.close()


if __name__ == "__main__":
    main()
