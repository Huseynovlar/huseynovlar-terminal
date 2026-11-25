from __future__ import annotations

from fastapi import Request


def extract_client_ip(request: Request) -> str:
    """Extract the real client IP from reverse proxy headers (X-Forwarded-For / X-Real-IP) or socket peer."""
    xff = request.headers.get("x-forwarded-for", "").strip()
    if xff:
        for part in xff.split(","):
            candidate = part.strip()
            if candidate:
                return candidate[:64]

    x_real_ip = request.headers.get("x-real-ip", "").strip()
    if x_real_ip:
        return x_real_ip[:64]

    if request.client and request.client.host:
        return request.client.host[:64]
    return ""
