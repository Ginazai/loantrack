"""BodySizeLimitMiddleware driven at the raw ASGI level (no DB, no app)."""

import re

import pytest

from app.core.body_limit import BodyLimitRule, BodySizeLimitMiddleware

LIMIT = 10
RULES = [BodyLimitRule("POST", re.compile(r"/upload"), LIMIT)]


def _scope(headers=()):
    return {"type": "http", "method": "POST", "path": "/upload", "headers": list(headers)}


def _receiver(chunks):
    queue = [{"type": "http.request", "body": c, "more_body": True} for c in chunks]
    queue.append({"type": "http.request", "body": b"", "more_body": False})

    async def receive():
        return queue.pop(0)

    return receive


async def _run(app, scope, chunks):
    sent = []

    async def send(message):
        sent.append(message)

    await BodySizeLimitMiddleware(app, RULES)(scope, _receiver(chunks), send)
    return sent


def _status(sent):
    return sent[0]["status"]


async def _drain_and_ok(scope, receive, send):
    while (await receive())["more_body"]:
        pass
    await send({"type": "http.response.start", "status": 200, "headers": []})
    await send({"type": "http.response.body", "body": b"ok"})


async def _drain_and_crash(scope, receive, send):
    while (await receive())["more_body"]:
        pass
    raise ValueError("truncated multipart body")


async def test_body_within_limit_passes_through():
    sent = await _run(_drain_and_ok, _scope(), [b"12345", b"12345"])
    assert _status(sent) == 200


async def test_declared_content_length_over_limit_is_rejected_up_front():
    called = False

    async def app(scope, receive, send):
        nonlocal called
        called = True

    sent = await _run(app, _scope([(b"content-length", b"11")]), [b"x"])
    assert _status(sent) == 413
    assert not called


async def test_chunked_body_over_limit_gets_413_even_if_app_answers_200():
    sent = await _run(_drain_and_ok, _scope(), [b"123456", b"123456"])
    assert _status(sent) == 413
    assert len([m for m in sent if m["type"] == "http.response.start"]) == 1


async def test_chunked_body_over_limit_gets_413_when_app_raises():
    sent = await _run(_drain_and_crash, _scope(), [b"123456", b"123456"])
    assert _status(sent) == 413


async def test_app_errors_within_limit_still_propagate():
    with pytest.raises(ValueError):
        await _run(_drain_and_crash, _scope(), [b"123"])


async def test_unmatched_routes_are_not_limited():
    scope = {**_scope(), "path": "/other"}
    sent = await _run(_drain_and_ok, scope, [b"x" * 100])
    assert _status(sent) == 200
