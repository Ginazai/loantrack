#!/usr/bin/env python3
"""Re-root coverage report paths so SonarQube can match them to source files.

Why this exists
---------------
SonarQube resolves coverage paths relative to the repository root, but each
coverage tool is run from inside its own sub-project:

    backend/   coverage.py  -> <source>app</source> <class filename="core/config.py">
    frontend/  vitest (v8)  -> SF:src/App.tsx

Neither path exists relative to the repo root, and Sonar does not fail when
that happens: it just reports 0% coverage. So besides rewriting the paths,
this script verifies the rewritten paths resolve to real files and exits
non-zero if they do not, turning a silent wrong number into a loud CI failure.

Run from the repository root, after both test jobs have produced their reports:

    python3 scripts/ci/prepare_sonar_reports.py

It is idempotent: running it twice does not double-prefix paths.
"""

from __future__ import annotations

import os
import posixpath
import re
import sys
from pathlib import Path

REPO_ROOT = Path.cwd()
BACKEND_XML = REPO_ROOT / "backend" / "coverage.xml"
FRONTEND_LCOV = REPO_ROOT / "frontend" / "coverage" / "lcov.info"

# Below this share of resolvable paths we assume the mapping is broken.
MIN_RESOLVED_RATIO = 0.95


class UnsafePathError(ValueError):
    """A path read from a coverage report would escape the repository."""


def _safe_repo_path(raw: str) -> str:
    """Return `raw` as a normalised, repo-root-relative POSIX path, or raise.

    Coverage reports are build artifacts (downloaded between jobs), i.e. input we do not
    control. Reject absolute paths and `..` traversal, and confirm the resolved target
    stays inside the repository, before the value is rewritten or touched on disk.
    """
    if not raw or "\x00" in raw or os.path.isabs(raw) or re.match(r"^[A-Za-z]:[\\/]", raw):
        raise UnsafePathError(f"absolute or empty path in coverage report: {raw!r}")
    normalised = posixpath.normpath(raw.replace("\\", "/"))
    if normalised == ".." or normalised.startswith("../"):
        raise UnsafePathError(f"path escapes the repository: {raw!r}")
    root = REPO_ROOT.resolve()
    if not (root / normalised).resolve().is_relative_to(root):
        raise UnsafePathError(f"path resolves outside the repository: {raw!r}")
    return normalised


def _prefix(path: str, prefix: str) -> str:
    path = _safe_repo_path(path)
    return path if path.startswith(prefix + "/") else _safe_repo_path(f"{prefix}/{path}")


def _cobertura_candidates(filename: str, sources: list[str], prefix: str) -> list[str]:
    """Possible repo-root-relative paths for a Cobertura <class filename=...>.

    Cobertura filenames are relative to a <source> entry (coverage.py with
    `relative_files = true` writes `<source>app</source>` + `filename="main.py"`),
    and <source> is itself relative to the directory coverage ran in. The raw
    filename is tried last so re-running on an already-fixed report is a no-op.
    """
    out: list[str] = []
    for src in sources:
        if os.path.isabs(src):
            out.append(Path(os.path.relpath(Path(src) / filename, REPO_ROOT)).as_posix())
        else:
            out.append(posixpath.normpath(f"{prefix}/{src}/{filename}"))
    out.append(filename)
    return out


def fix_cobertura(xml_path: Path, prefix: str) -> list[str]:
    text = xml_path.read_text(encoding="utf-8")
    sources = re.findall(r"<source>([^<]*)</source>", text) or ["."]

    def reroot(match: re.Match[str]) -> str:
        candidates: list[str] = []
        for raw in _cobertura_candidates(match.group(2), sources, prefix):
            try:
                candidates.append(_safe_repo_path(raw))
            except UnsafePathError:
                continue  # an odd <source> must not abort the run; fail only if nothing is safe
        if not candidates:
            raise UnsafePathError(f"no safe path for coverage entry {match.group(2)!r}")
        chosen = next((c for c in candidates if (REPO_ROOT / c).is_file()), candidates[0])
        return match.group(1) + chosen + match.group(3)

    text = re.sub(r'(<class\b[^>]*?\bfilename=")([^"]+)(")', reroot, text)
    # Pin <source> to the repo root. Whether Sonar joins filename onto <source>
    # or onto the project base dir, the result is then the same real file.
    text = re.sub(r"<source>[^<]*</source>", f"<source>{REPO_ROOT}</source>", text)
    xml_path.write_text(text, encoding="utf-8")

    return re.findall(r'<class\b[^>]*?\bfilename="([^"]+)"', text)


def fix_lcov(lcov_path: Path, prefix: str) -> list[str]:
    lines = lcov_path.read_text(encoding="utf-8").splitlines()
    out: list[str] = []
    files: list[str] = []
    for line in lines:
        if line.startswith("SF:"):
            path = _prefix(line[3:], prefix)
            files.append(path)
            line = f"SF:{path}"
        out.append(line)
    lcov_path.write_text("\n".join(out) + "\n", encoding="utf-8")
    return files


def _is_repo_file(rel: str) -> bool:
    try:
        return (REPO_ROOT / _safe_repo_path(rel)).is_file()
    except UnsafePathError:
        return False


def verify(label: str, files: list[str]) -> bool:
    if not files:
        print(f"::error title={label}::report lists no files; coverage would be 0%")
        return False
    missing = [f for f in files if not _is_repo_file(f)]
    ratio = 1 - len(missing) / len(files)
    print(f"{label}: {len(files) - len(missing)}/{len(files)} paths resolve ({ratio:.0%})")
    if ratio < MIN_RESOLVED_RATIO:
        for f in missing[:10]:
            print(f"  missing: {f}")
        print(f"::error title={label}::coverage paths do not resolve; Sonar would show 0%")
        return False
    return True


def main() -> int:
    ok = True
    for path, label in ((BACKEND_XML, "backend"), (FRONTEND_LCOV, "frontend")):
        if not path.is_file():
            print(f"::error title={label}::{path.relative_to(REPO_ROOT)} not found")
            ok = False
    if not ok:
        return 1

    try:
        ok &= verify("backend", fix_cobertura(BACKEND_XML, "backend"))
        ok &= verify("frontend", fix_lcov(FRONTEND_LCOV, "frontend"))
    except UnsafePathError as exc:
        print(f"::error title=coverage report::{exc}")
        return 1
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
