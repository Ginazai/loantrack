"""Real client address behind a reverse proxy, without letting clients choose it.

Behind nginx the TCP peer is always the proxy, so keying a rate limit on it puts every user
in one bucket. The fix is to read X-Forwarded-For, but only from peers we trust, and only
the part of it a trusted proxy wrote:

- Peer not in TRUSTED_PROXIES  -> the peer itself; the header is ignored (a client talking
  to the backend directly cannot claim another address).
- Peer trusted -> walk X-Forwarded-For from the RIGHT (the end the proxy appended to) and
  stop at the first address that is not itself a trusted proxy. Entries further left were
  supplied by the client and are never believed, so ``X-Forwarded-For: 1.1.1.1`` sent by an
  attacker just becomes ``1.1.1.1, <attacker's real address>`` and the real one wins.
"""

from __future__ import annotations

import ipaddress
from functools import lru_cache

from starlette.requests import Request

from app.core.config import get_settings

_IP = ipaddress.IPv4Address | ipaddress.IPv6Address


@lru_cache
def _trusted_networks(
    entries: tuple[str, ...],
) -> tuple[ipaddress.IPv4Network | ipaddress.IPv6Network, ...]:
    return tuple(ipaddress.ip_network(e, strict=False) for e in entries)


def _is_trusted(ip: _IP) -> bool:
    nets = _trusted_networks(tuple(get_settings().TRUSTED_PROXIES))
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return any(ip in net for net in nets if net.version == ip.version)


def client_ip(request: Request) -> str | None:
    peer = request.client.host if request.client else None
    if not peer:
        return None
    try:
        peer_ip = ipaddress.ip_address(peer)
    except ValueError:
        return peer  # not an IP (e.g. a unix socket name): nothing to trust
    if not _is_trusted(peer_ip):
        return peer

    forwarded = ",".join(request.headers.getlist("x-forwarded-for"))
    candidate = peer
    for raw in reversed([p.strip() for p in forwarded.split(",") if p.strip()]):
        try:
            hop = ipaddress.ip_address(raw)
        except ValueError:
            break  # garbage from the client side of the chain: keep what we have
        candidate = str(hop)
        if not _is_trusted(hop):
            break
    return candidate


def rate_limit_key(request: Request) -> str:
    """slowapi key function."""
    return client_ip(request) or "unknown"
