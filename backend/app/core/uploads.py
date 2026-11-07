"""Reading uploaded files with a hard size cap."""

from __future__ import annotations

from fastapi import HTTPException, UploadFile

_CHUNK = 64 * 1024


async def read_upload_capped(file: UploadFile, max_bytes: int) -> bytes:
    """Read an upload in chunks and stop as soon as it exceeds ``max_bytes``.

    ``await file.read()`` would pull the whole body into memory first and only then let the
    caller look at its size. Here an oversize upload is rejected after at most one chunk more
    than the limit, and the declared size (when the parser knows it) is checked up front.
    """
    too_large = HTTPException(
        413,
        f"File exceeds the {max_bytes // (1024 * 1024)} MB limit",
    )
    if file.size is not None and file.size > max_bytes:
        raise too_large
    buf = bytearray()
    while chunk := await file.read(_CHUNK):
        buf.extend(chunk)
        if len(buf) > max_bytes:
            raise too_large
    return bytes(buf)
