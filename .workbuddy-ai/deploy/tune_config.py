#!/usr/bin/env python3
"""
调整线上两处配置：
  1. server/.env 的 NODE_ENV: development -> production
  2. nginx 的 ssl_protocols 去掉已废弃的 TLSv1.1

两者都先备份；nginx 改动经 nginx -t 校验，失败自动回滚。
只做精确的单行替换，不碰其他内容。
"""

import os
import sys
import time

import paramiko

HOST = "101.35.46.146"
USER = "root"
ENV_FILE = "/www/wwwroot/wzl136122.cn/server/.env"
NGINX_CONF = "/www/server/panel/vhost/nginx/wzl136122.cn.conf"


def main():
    password = os.environ.get("SSH_PASS", "")
    if not password:
        print("错误：未设置 SSH_PASS")
        sys.exit(2)

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=password, timeout=20)
    sftp = client.open_sftp()

    def sh(cmd, timeout=60):
        _, out, err = client.exec_command(cmd, timeout=timeout)
        return (
            out.read().decode("utf-8", "replace").strip(),
            err.read().decode("utf-8", "replace").strip(),
        )

    stamp = time.strftime("%Y%m%d-%H%M%S")

    # ── 1. .env 的 NODE_ENV ────────────────────────────────────────
    print("=" * 70)
    print("[1] 调整 .env 的 NODE_ENV")
    print("=" * 70)

    with sftp.open(ENV_FILE, "r") as fh:
        env_text = fh.read().decode("utf-8")

    env_backup = f"/root/backup-env-{stamp}"
    with sftp.open(env_backup, "w") as fh:
        fh.write(env_text)
    print(f"已备份 -> {env_backup}")

    if "NODE_ENV=development" in env_text:
        new_env = env_text.replace("NODE_ENV=development", "NODE_ENV=production", 1)
        with sftp.open(ENV_FILE, "w") as fh:
            fh.write(new_env)
        print("已改为 NODE_ENV=production")
    elif "NODE_ENV=production" in env_text:
        print("当前已是 production，无需修改")
    else:
        print("!! 未找到 NODE_ENV 行，跳过")

    # 确认只有这一行变化
    out, _ = sh(
        f"diff <(sort {env_backup}) <(sort {ENV_FILE}) || true"
    )
    print("变更内容（仅显示差异行）:")
    for line in out.splitlines():
        if line.startswith("<") or line.startswith(">"):
            # 只打印键名，不打印值
            key = line.split("=", 1)[0].replace("<", "").replace(">", "").strip()
            print(f"   {key} = <已变更>")
    print(f"当前 NODE_ENV = {sh(f'grep \"^NODE_ENV=\" {ENV_FILE} | cut -d= -f2-')[0]}")

    # ── 2. nginx ssl_protocols ─────────────────────────────────────
    print()
    print("=" * 70)
    print("[2] 收紧 nginx TLS 协议版本")
    print("=" * 70)

    with sftp.open(NGINX_CONF, "r") as fh:
        conf = fh.read().decode("utf-8")

    conf_backup = f"/root/backup-nginx-ssl-{stamp}.conf"
    with sftp.open(conf_backup, "w") as fh:
        fh.write(conf)
    print(f"已备份 -> {conf_backup}")

    old_line = "ssl_protocols TLSv1.1 TLSv1.2 TLSv1.3;"
    new_line = "ssl_protocols TLSv1.2 TLSv1.3;"

    if old_line in conf:
        with sftp.open(NGINX_CONF, "w") as fh:
            fh.write(conf.replace(old_line, new_line, 1))
        print("已移除 TLSv1.1")
    elif new_line in conf:
        print("当前已不含 TLSv1.1，无需修改")
    else:
        print("!! 未匹配到 ssl_protocols 行，跳过")
        sftp.close()
        client.close()
        return 1

    out, err = sh("/www/server/nginx/sbin/nginx -t 2>&1")
    print("\n--- nginx -t ---")
    print(out or err)

    if "successful" not in (out + err):
        print("\n!! 校验失败，回滚 nginx 配置")
        with sftp.open(NGINX_CONF, "w") as fh:
            fh.write(conf)
        out2, err2 = sh("/www/server/nginx/sbin/nginx -t 2>&1")
        print("回滚后:", (out2 + err2).strip())
        sftp.close()
        client.close()
        return 1

    out, _ = sh("/www/server/nginx/sbin/nginx -s reload 2>&1; echo reloaded")
    print("\n--- reload ---")
    print(out)

    print("\n--- 确认生效 ---")
    print(sh(f"grep -n 'ssl_protocols' {NGINX_CONF}")[0])

    sftp.close()
    client.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
