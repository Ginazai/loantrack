"""Helpers for building safe HTTP response headers."""

from __future__ import annotations

import re
import unicodedata
from urllib.parse import quote

_SAFE_ASCII = re.compile(r"[^A-Za-z0-9._ -]")


def sanitize_filename(name: str | None, default: str = "download", max_len: int = 200) -> str:
    """A user-supplied filename reduced to something harmless to store, show and send.

    - drops any directory part (``/`` and ``\\``), so ``../../etc/passwd`` -> ``passwd``
    - drops control and format characters: CR/LF (header injection), NUL, and bidi overrides
      such as U+202E that make ``evil\\u202egpj.exe`` display as ``evilexe.jpg``
    - strips leading dots/spaces (no hidden files, no ``..``) and trailing dots/spaces
    - caps the length but keeps the extension
    """
    value = unicodedata.normalize("NFC", name or "")
    value = value.replace("\\", "/").rsplit("/", 1)[-1]
    value = "".join(ch for ch in value if unicodedata.category(ch) not in ("Cc", "Cf"))
    value = value.strip(" .")
    if not value:
        return default
    if len(value) > max_len:
        stem, dot, ext = value.rpartition(".")
        if dot and 0 < len(ext) <= 10:
            value = stem[: max_len - len(ext) - 1] + "." + ext
        else:
            value = value[:max_len]
    return value


def content_disposition(filename: str | None, disposition: str = "attachment") -> str:
    """RFC 6266 ``Content-Disposition`` that cannot be broken out of.

    The plain ``filename=`` is an ASCII-only, quote-free fallback (so no ``"``, ``;``, ``\\`` or
    line breaks can end the value early or inject a parameter/header); the real name travels
    percent-encoded in ``filename*`` (RFC 5987) when it is not already plain ASCII.
    """
    if disposition not in ("attachment", "inline"):
        raise ValueError("disposition must be 'attachment' or 'inline'")
    clean = sanitize_filename(filename)
    fallback = _SAFE_ASCII.sub("_", clean.encode("ascii", "replace").decode("ascii"))
    if not fallback.strip("_ .-"):
        fallback = "download"
    header = f'{disposition}; filename="{fallback}"'
    if fallback != clean:
        header += f"; filename*=UTF-8''{quote(clean, safe='')}"
    return header
