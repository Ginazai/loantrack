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


def reroot_cobertura(text: str, prefix: str) -> tuple[str, list[str]]:
    """Pure text transform: return (rewritten XML, list of repo-relative file paths)."""
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
    return text, re.findall(r'<class\b[^>]*?\bfilename="([^"]+)"', text)


def fix_cobertura() -> list[str]:
    # The file location is a module constant; report *content* never influences which file
    # is read or written (only the pure transform above sees untrusted data).
    text, files = reroot_cobertura(BACKEND_XML.read_text(encoding="utf-8"), "backend")
    BACKEND_XML.write_text(text, encoding="utf-8")
    return files


# Directories never worth indexing (large, generated, or not source).
_PRUNE_DIRS = frozenset({"node_modules", "coverage", "dist", ".git", "__pycache__", ".venv"})

# Count-style lcov summary records. Mapping to a literal means the tag we write back is
# a constant from this table, never the string that was read from the report.
_COUNT_TAGS = {
    "LF": "LF",
    "LH": "LH",
    "FNF": "FNF",
    "FNH": "FNH",
    "BRF": "BRF",
    "BRH": "BRH",
}


def _index_repo_files(subdir: str) -> dict[str, str]:
    """Map every real file under `subdir` to its repo-root-relative POSIX path.

    The strings come from the filesystem listing, not from the coverage report. Looking a
    reported path up here and writing back the *value* means the report never supplies the
    text that ends up in `SF:` lines. A path that is not in the index is not written at all.
    """
    index: dict[str, str] = {}
    for dirpath, dirnames, filenames in os.walk(REPO_ROOT / subdir):
        dirnames[:] = [d for d in dirnames if d not in _PRUNE_DIRS]
        for name in filenames:
            rel = Path(dirpath, name).relative_to(REPO_ROOT).as_posix()
            index[rel] = rel
    return index


def _ints(value: str, count: int) -> list[int]:
    """Parse the first `count` comma-separated fields as integers (ValueError otherwise)."""
    parts = value.split(",")
    if len(parts) < count:
        raise ValueError(f"malformed lcov record: expected {count} fields, got {value!r}")
    return [int(p) for p in parts[:count]]


def reroot_lcov(text: str, prefix: str, known_files: dict[str, str]) -> tuple[str, list[str]]:
    """Pure transform: return (rebuilt lcov, every repo-relative path the report listed).

    The output is *rebuilt*, not edited in place. Each record is re-emitted from typed
    values: integers are parsed and re-formatted, `SF:` paths are taken from `known_files`
    (the filesystem index), tags come from fixed literals, and function names are replaced
    by synthetic ids (SonarQube only uses line and branch coverage). Nothing read from the
    report is copied through verbatim.

    Records whose file is not in `known_files` are dropped from the output but still
    returned in the path list, so `verify()` counts them as unresolved.
    """
    out: list[str] = []
    files: list[str] = []
    current: list[str] | None = None  # lines of the record being built; None = skipping
    fn_ids: dict[str, int] = {}

    def fn_id(name: str) -> int:
        return fn_ids.setdefault(name, len(fn_ids))

    for raw in text.splitlines():
        tag, _, value = raw.partition(":")
        if tag == "SF":
            path = _prefix(value, prefix)
            files.append(path)
            trusted = known_files.get(path)
            fn_ids = {}
            current = ["TN:", f"SF:{trusted}"] if trusted is not None else None
        elif current is None:
            continue
        elif tag == "end_of_record":
            current.append("end_of_record")
            out.extend(current)
            current = None
        elif tag == "DA":
            line_no, hits = _ints(value, 2)
            current.append(f"DA:{line_no},{hits}")
        elif tag == "BRDA":
            parts = value.split(",")
            line_no, block, branch = _ints(value, 3)
            if len(parts) < 4:
                raise ValueError(f"malformed lcov BRDA record: {value!r}")
            taken = "-" if parts[3].strip() == "-" else str(int(parts[3]))
            current.append(f"BRDA:{line_no},{block},{branch},{taken}")
        elif tag == "FN":
            # `FN:<start>,<name>` or `FN:<start>,<end>,<name>`
            parts = value.split(",", 2)
            if len(parts) == 3 and parts[1].strip().lstrip("-").isdigit():
                start, end = int(parts[0]), int(parts[1])
                current.append(f"FN:{start},{end},fn_{fn_id(parts[2])}")
            else:
                start = int(parts[0])
                name = value.partition(",")[2]
                current.append(f"FN:{start},fn_{fn_id(name)}")
        elif tag == "FNDA":
            hits = _ints(value, 1)[0]
            current.append(f"FNDA:{hits},fn_{fn_id(value.partition(',')[2])}")
        elif tag in _COUNT_TAGS:
            current.append(f"{_COUNT_TAGS[tag]}:{int(value)}")
        # Anything else (TN, VER, FNL, FNA, comments, ...) is intentionally not carried over.
    return ("\n".join(out) + "\n" if out else ""), files


def fix_lcov() -> list[str]:
    text, files = reroot_lcov(
        FRONTEND_LCOV.read_text(encoding="utf-8"),
        "frontend",
        _index_repo_files("frontend"),
    )
    FRONTEND_LCOV.write_text(text, encoding="utf-8")
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
            print(f"  missing: {f!r}")
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
        ok &= verify("backend", fix_cobertura())
        ok &= verify("frontend", fix_lcov())
    except ValueError as exc:  # includes UnsafePathError
        print(f"::error title=coverage report::{exc}")
        return 1
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())