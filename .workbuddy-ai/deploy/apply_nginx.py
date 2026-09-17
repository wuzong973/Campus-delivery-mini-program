#!/usr/bin/env python3
"""
给线上 nginx 的 /uploads/ location 补充安全响应头与脚本后缀拦截。

安全流程：备份 -> 精确替换 -> nginx -t 校验 -> 通过才 reload，失败自动回滚。
只动 /uploads/ 这一个自定义 location，不碰宝塔托管标记（#SSL-START 等）之间的内容。
"""

import os
import sys
import time

import paramiko

HOST = "101.35.46.146"
USER = "root"
CONF = "/www/server/panel/vhost/nginx/wzl136122.cn.conf"

OLD_BLOCK = """    location ^~ /uploads/ {
        alias /www/wwwroot/wzl136122.cn/server/uploads/;
        access_log off;
        expires 7d;
        add_header Cache-Control "public, max-age=604800";
        try_files $uri $uri/ =404;
    }"""

NEW_BLOCK = """    location ^~ /uploads/ {
        alias /www/wwwroot/wzl136122.cn/server/uploads/;
        access_log off;
        expires 7d;
        add_header Cache-Control "public, max-age=604800";
        add_header X-Content-Type-Options "nosniff" always;
        add_header Content-Security-Policy "default-src 'none'; img-src 'self'; sandbox" always;

        # 上传目录不应出现脚本类文件。文件名已由服务端白名单生成，
        # 这里再加一道防线，避免任何可执行/可解析后缀被静态服务直接吐出去。
        location ~* \\.(php|php5|php7|phtml|jsp|asp|aspx|sh|py|rb|pl|cgi|htaccess)$ {
            deny all;
        }

        try_files $uri $uri/ =404;
    }"""


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

    # 1) 读取现有配置
    with sftp.open(CONF, "r") as fh:
        current = fh.read().decode("utf-8")

    if "X-Content-Type-Options" in current:
        print("配置中已存在安全头，无需重复修改。")
        sftp.close()
        client.close()
        return 0

    if OLD_BLOCK not in current:
        print("!! 未匹配到预期的 /uploads/ 配置块，已中止（不做任何修改）")
        print("---- 当前 /uploads/ 片段 ----")
        idx = current.find("location ^~ /uploads/")
        print(current[idx : idx + 400] if idx >= 0 else "(未找到)")
        sftp.close()
        client.close()
        return 1

    # 2) 备份
    stamp = time.strftime("%Y%m%d-%H%M%S")
    backup = f"/root/backup-nginx-wzl136122-{stamp}.conf"
    with sftp.open(backup, "w") as fh:
        fh.write(current)
    print(f"已备份原配置 -> {backup}")

    # 3) 写入新配置
    updated = current.replace(OLD_BLOCK, NEW_BLOCK, 1)
    with sftp.open(CONF, "w") as fh:
        fh.write(updated)
    print("已写入新配置")

    # 4) 语法校验
    out, err = sh("/www/server/nginx/sbin/nginx -t 2>&1")
    print("\n--- nginx -t ---")
    print(out or err)

    if "successful" not in (out + err):
        print("\n!! 语法校验失败，正在回滚 ...")
        with sftp.open(CONF, "w") as fh:
            fh.write(current)
        out2, err2 = sh("/www/server/nginx/sbin/nginx -t 2>&1")
        print("回滚后校验:", (out2 + err2).strip())
        sftp.close()
        client.close()
        return 1

    # 5) reload
    out, err = sh("/www/server/nginx/sbin/nginx -s reload 2>&1; echo reload-done")
    print("\n--- reload ---")
    print(out or err)

    # 6) 验证
    out, _ = sh(
        "curl -s -o /dev/null -w '%{http_code}' -m 10 https://wzl136122.cn/healthz"
        " -k 2>/dev/null; echo; "
        "curl -s -I -k -m 10 https://wzl136122.cn/uploads/ 2>/dev/null | head -12"
    )
    print("\n--- 验证 ---")
    print(out)

    sftp.close()
    client.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
