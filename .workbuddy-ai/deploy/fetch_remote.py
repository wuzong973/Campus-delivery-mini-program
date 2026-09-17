#!/usr/bin/env python3
"""下载远端指定文件到本地临时目录，便于与本地版本做 diff。"""

import os
import sys

import paramiko

HOST = "101.35.46.146"
USER = "root"
REMOTE_SERVER_DIR = "/www/wwwroot/wzl136122.cn/server"
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "remote-snapshot")


def main():
    password = os.environ.get("SSH_PASS", "")
    if not password:
        print("错误：未设置 SSH_PASS")
        sys.exit(2)

    files = sys.argv[1:] or ["src/app.js", "src/config/env.js", ".env.example"]

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=password, timeout=20)
    sftp = client.open_sftp()

    for rel in files:
        remote = f"{REMOTE_SERVER_DIR}/{rel}"
        local = os.path.join(OUT_DIR, rel.replace("/", os.sep))
        os.makedirs(os.path.dirname(local), exist_ok=True)
        try:
            sftp.get(remote, local)
            print(f"已下载 {rel} -> {local}  ({os.path.getsize(local)} bytes)")
        except IOError as exc:
            print(f"下载失败 {rel}: {exc}")

    sftp.close()
    client.close()


if __name__ == "__main__":
    main()
