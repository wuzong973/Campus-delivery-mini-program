#!/usr/bin/env python3
"""
在覆盖生产文件之前，比对「远端现有文件」与「本地 git 基线(HEAD)」是否一致。

目的：确认远端就是我从 git HEAD 出发的那份代码。
若远端与基线不一致，说明服务器上存在仓库里没有的改动，
直接上传会把这些改动覆盖掉 —— 必须先人工确认。

输出三种状态：
  SAME      远端 == git 基线（安全，可覆盖）
  DIFF      远端 != git 基线（有服务器独有改动，需人工确认）
  MISSING   远端不存在该文件
  NEW       本地新增文件，远端本就不该有
"""

import os
import subprocess
import sys

import paramiko

HOST = "101.35.46.146"
USER = "root"
LOCAL_ROOT = r"D:\runner"
REMOTE_SERVER_DIR = "/www/wwwroot/wzl136122.cn/server"

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
    "src/services/shared.js",
    "src/utils/validate.js",
    ".env.example",
]


def git_blob_hash(rel_path):
    """取 git HEAD 中该文件的 blob hash（用 git hash-object 对内容计算）"""
    full = f"server/{rel_path}"
    try:
        content = subprocess.run(
            ["git", "show", f"HEAD:{full}"],
            cwd=LOCAL_ROOT,
            capture_output=True,
            check=True,
        ).stdout
    except subprocess.CalledProcessError:
        return None

    # git hash-object --stdin 计算 blob hash
    proc = subprocess.run(
        ["git", "hash-object", "--stdin"],
        cwd=LOCAL_ROOT,
        input=content,
        capture_output=True,
        check=True,
    )
    return proc.stdout.decode().strip()


def main():
    password = os.environ.get("SSH_PASS", "")
    if not password:
        print("错误：未设置 SSH_PASS")
        sys.exit(2)

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=password, timeout=20)
    sftp = client.open_sftp()

    # 远端统一用 git hash-object 计算，保证与本地同一套算法
    print(f"{'状态':<9} {'文件':<38} 说明")
    print("-" * 92)

    problems = []

    for rel in FILES:
        remote = f"{REMOTE_SERVER_DIR}/{rel}"
        local_blob = git_blob_hash(rel)

        try:
            # 让远端用 git hash-object 计算同一文件的 blob hash
            stdin, stdout, stderr = client.exec_command(
                f"git hash-object {remote} 2>/dev/null || md5sum {remote} 2>/dev/null | awk '{{print $1}}'"
            )
            remote_hash = stdout.read().decode().strip()
            err = stderr.read().decode().strip()
            exists = bool(remote_hash)
        except IOError:
            exists = False
            remote_hash = ""

        if not exists:
            if local_blob is None:
                status, note = "NEW", "本地新增，远端不存在（预期）"
            else:
                status, note = "MISSING", "远端缺失，需上传"
                problems.append(rel)
        elif local_blob is None:
            status, note = "??", "远端存在但 git 基线中没有"
            problems.append(rel)
        elif remote_hash == local_blob:
            status, note = "SAME", "与 git 基线一致，可安全覆盖"
        else:
            status, note = "DIFF", "!! 与基线不一致，远端可能有独有改动"
            problems.append(rel)

        print(f"{status:<9} {rel:<38} {note}")

    print("-" * 92)
    if problems:
        print("\n需要人工确认的文件：")
        for p in problems:
            print("  -", p)
    else:
        print("\n全部一致：远端就是 git HEAD 那份代码，可以安全上传。")

    sftp.close()
    client.close()


if __name__ == "__main__":
    main()
