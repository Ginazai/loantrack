"""SSRF guard for server-side requests to user-supplied URLs (webhooks).

A URL is accepted only if its scheme is allowed, it has no embedded credentials, and
EVERY address its host resolves to is a public (globally routable) one. That rejects
loopback, RFC 1918, link-local (169.254.169.254 cloud metadata), unique-local IPv6,
CGNAT, multicast and reserved ranges, for IPv4 and IPv6 alike.

Known limit: validating at one moment and connecting at another leaves a DNS-rebinding
window. We narrow it by re-validating immediately before every delivery; closing it fully
needs IP pinning or an egress proxy/firewall (recommended: deny the backend container
access to private ranges at the network level as defence in depth).
"""

from __future__ import annotations

import asyncio
import ipaddress
import socket
from urllib.parse import urlsplit

from app.core.config import get_settings


class UnsafeURLError(ValueError):
    """The URL is not allowed as a server-side request target."""


def _is_public(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    # Unwrap ::ffff:a.b.c.d so IPv4-mapped private addresses can't slip through.
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast


def validate_outbound_url(url: str) -> None:
    """Synchronous (does blocking DNS) — call via `avalidate_outbound_url` in async code."""
    parts = urlsplit(url)
    allowed = {"https"} | ({"http"} if get_settings().DEBUG else set())
    if parts.scheme not in allowed:
        raise UnsafeURLError(f"URL scheme must be one of: {', '.join(sorted(allowed))}")
    if parts.username or parts.password:
        raise UnsafeURLError("URLs with embedded credentials are not allowed")
    host = parts.hostname
    if not host:
        raise UnsafeURLError("URL has no host")
    port = parts.port or (443 if parts.scheme == "https" else 80)

    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise UnsafeURLError("Host could not be resolved") from exc
    if not infos:
        raise UnsafeURLError("Host could not be resolved")
    for info in infos:
        addr = ipaddress.ip_address(info[4][0].split("%")[0])
        if not _is_public(addr):
            raise UnsafeURLError("URL resolves to a non-public address")


async def avalidate_outbound_url(url: str) -> None:
    await asyncio.to_thread(validate_outbound_url, url)
