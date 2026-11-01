"""Cap request body size per route while the body is still streaming in.

Checking ``len(await file.read())`` after the fact (or trusting Content-Length) leaves two
holes: a client can omit Content-Length and use chunked transfer encoding, and the framework
parses (and spools to disk) the whole multipart body before any handler code runs. This
middleware counts bytes as they arrive and cuts the request off at the limit, answering 413.
"""

from __future__ import annotations

import json
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

Scope = dict
Message = dict
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]


@dataclass(frozen=True)
class BodyLimitRule:
    method: str
    path: re.Pattern[str]
    max_bytes: int


class BodySizeLimitMiddleware:
    def __init__(self, app, rules: list[BodyLimitRule]) -> None:
        self.app = app
        self.rules = rules

    def _limit_for(self, scope: Scope) -> int | None:
        for rule in self.rules:
            if scope["method"] == rule.method and rule.path.fullmatch(scope["path"]):
                return rule.max_bytes
        return None

    @staticmethod
    async def _send_413(send: Send) -> None:
        body = json.dumps({"detail": "Request body too large"}).encode()
        await send(
            {
                "type": "http.response.start",
                "status": 413,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                    (b"connection", b"close"),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        limit = self._limit_for(scope) if scope["type"] == "http" else None
        if limit is None:
            await self.app(scope, receive, send)
            return

        declared = dict(scope["headers"]).get(b"content-length")
        if declared is not None and declared.isdigit() and int(declared) > limit:
            await self._send_413(send)
            return

        received = 0
        exceeded = False
        replied = False

        async def limited_receive() -> Message:
            nonlocal received, exceeded
            if exceeded:
                return {"type": "http.request", "body": b"", "more_body": False}
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    # Stop feeding the app. It sees a truncated body and fails on its own;
                    # whatever it answers is replaced by the 413 below.
                    exceeded = True
                    return {"type": "http.request", "body": b"", "more_body": False}
            return message

        async def limited_send(message: Message) -> None:
            nonlocal replied
            if not exceeded:
                await send(message)
                return
            if not replied:
                replied = True
                await self._send_413(send)

        await self.app(scope, limited_receive, limited_send)
        if exceeded and not replied:
            await self._send_413(send)
