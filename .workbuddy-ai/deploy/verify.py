#!/usr/bin/env python3
"""上线后验证：在服务器本机通过 curl 逐条确认修复是否生效。"""

import os
import sys

import paramiko

HOST = "101.35.46.146"
USER = "root"
LOCAL = "http://127.0.0.1:3000"
DOMAIN = "https://wzl136122.cn"

results = []


def check(name, passed, detail=""):
    results.append((name, passed, detail))
    print(f"  {'PASS' if passed else 'FAIL'}  {name}")
    if detail:
        print(f"        {detail}")


def main():
    password = os.environ.get("SSH_PASS", "")
    if not password:
        print("错误：未设置 SSH_PASS")
        sys.exit(2)

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=password, timeout=20)

    def sh(cmd, timeout=30):
        _, out, _ = client.exec_command(cmd, timeout=timeout)
        return out.read().decode("utf-8", "replace").strip()

    def http(url, method="GET", body=None, headers=None, extra=""):
        """返回 (status, headers文本, body)"""
        parts = [f"curl -s -m 12 -X {method}", "-D /tmp/_h.txt", "-o /tmp/_b.txt"]
        if body is not None:
            parts += ["-H 'Content-Type: application/json'", f"-d '{body}'"]
        for k, v in (headers or {}).items():
            parts.append(f"-H '{k}: {v}'")
        if extra:
            parts.append(extra)
        parts.append(f"'{url}'")
        sh(" ".join(parts))
        status = sh("head -1 /tmp/_h.txt | awk '{print $2}'")
        hdrs = sh("cat /tmp/_h.txt")
        payload = sh("cat /tmp/_b.txt")
        return status, hdrs, payload

    print("=" * 78)
    print("上线后安全验证（在服务器本机执行）")
    print("=" * 78)

    # ── 1. 账号接管链 ──────────────────────────────────────────────
    print("\n[1] 账号接管链（P0-1）")

    status, _, body = http(
        f"{LOCAL}/api/auth/login", "POST", '{"openid":"oFakeOpenidSecurityTest123"}'
    )
    check(
        "裸 openid 登录被拒绝（原漏洞）",
        status not in ("200", ""),
        f"HTTP {status} · {body[:150]}",
    )

    status, _, body = http(f"{LOCAL}/api/auth/login", "POST", "{}")
    check("缺少 code 返回 400", status == "400", f"HTTP {status} · {body[:120]}")

    # ── 2. 会话恢复接口 ────────────────────────────────────────────
    print("\n[2] 会话恢复接口（P0-1 新增）")
    status, _, _ = http(f"{LOCAL}/api/auth/session")
    check("无 token 返回 401", status == "401", f"HTTP {status}")

    status, _, _ = http(
        f"{LOCAL}/api/auth/session",
        headers={"Authorization": "Bearer forged.invalid.token"},
    )
    check("伪造 token 被拒绝", status == "401", f"HTTP {status}")

    # ── 3. 诊断接口关闭 ────────────────────────────────────────────
    print("\n[3] 诊断接口（P2-21 附带）")
    status, _, _ = http(f"{LOCAL}/api/auth/diagnose")
    check("生产环境返回 404", status == "404", f"HTTP {status}")

    # ── 4. 安全响应头 ─────────────────────────────────────────────
    print("\n[4] 安全响应头（P1-10）")
    status, hdrs, _ = http(f"{LOCAL}/healthz")
    low = hdrs.lower()
    check("X-Content-Type-Options: nosniff", "x-content-type-options: nosniff" in low)
    check("X-Frame-Options 已设置", "x-frame-options:" in low)
    check("Referrer-Policy 已设置", "referrer-policy:" in low)
    check("已移除 X-Powered-By", "x-powered-by" not in low)

    # ── 5. 限流 ───────────────────────────────────────────────────
    print("\n[5] 限流（P1-10）")
    status, hdrs, _ = http(f"{LOCAL}/api/auth/session")
    ratelimit = [l for l in hdrs.splitlines() if "ratelimit" in l.lower()]
    check("返回 RateLimit 响应头", bool(ratelimit), " | ".join(ratelimit[:2]))

    # ── 6. 敏感字段脱敏（P0-2）─────────────────────────────────────
    print("\n[6] 敏感字段脱敏（P0-2）")
    # 用无效 token 访问受保护接口，确认不会因为报错泄露内部信息
    status, _, body = http(
        f"{LOCAL}/api/tasks", headers={"Authorization": "Bearer bad.token.here"}
    )
    check("受保护接口拒绝非法 token", status == "401", f"HTTP {status}")
    check(
        "错误响应不含堆栈（P2-21）",
        "stack" not in body.lower() and "at " not in body,
        body[:120],
    )

    # ── 7. 业务可用性 ─────────────────────────────────────────────
    print("\n[7] 业务可用性（确认没有改坏）")
    status, _, body = http(f"{LOCAL}/healthz")
    check("健康检查正常", status == "200" and '"ok":true' in body, body[:80])

    # ── 8. WebSocket 是否保留（线上特有功能）──────────────────────
    print("\n[8] WebSocket 实时通道（确认合并后未丢失）")
    ws_code = sh(
        "curl -s -m 8 -o /dev/null -w '%{http_code}' "
        "-H 'Connection: Upgrade' -H 'Upgrade: websocket' "
        "-H 'Sec-WebSocket-Version: 13' "
        "-H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' "
        f"{LOCAL}/"
    )
    check(
        "WebSocket 升级握手被接受（101）",
        ws_code == "101",
        f"HTTP {ws_code}（101 表示 ws 通道正常）",
    )

    # ── 9. 域名链路 ───────────────────────────────────────────────
    print("\n[9] 域名 / HTTPS / 反向代理")
    status, _, _ = http(f"{DOMAIN}/api/auth/session")
    check("通过域名访问 API 正常", status == "401", f"HTTP {status}")

    # ── 10. 上传目录 ─────────────────────────────────────────────
    print("\n[10] 上传目录（P1-7 nginx 部分）")
    sample = sh(
        "find /www/wwwroot/wzl136122.cn/server/uploads -type f "
        "-name '*.jpg' -o -type f -name '*.png' 2>/dev/null | head -1"
    )
    if sample:
        rel = sample.replace("/www/wwwroot/wzl136122.cn/server", "")
        status, hdrs, _ = http(f"{DOMAIN}{rel}")
        low = hdrs.lower()
        check(
            "已上传图片可正常访问",
            status == "200",
            f"HTTP {status} · {rel[:60]}",
        )
        check(
            "上传目录带 nosniff 头",
            "x-content-type-options: nosniff" in low,
            "有" if "x-content-type-options" in low else "无 —— nginx 配置尚未应用",
        )
    else:
        check("找到示例上传文件", False, "uploads 目录下没有图片文件")

    print("\n" + "=" * 78)
    passed = sum(1 for _, p, _ in results if p)
    print(f"结果：{passed}/{len(results)} 项通过")
    failed = [n for n, p, _ in results if not p]
    if failed:
        print("\n未通过：")
        for n in failed:
            print("  -", n)
    print("=" * 78)

    client.close()
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
