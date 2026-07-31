"""Fail if requirements.txt names a package the lock files do not provide.

The Docker image installs from requirements.lock and requirements-vcs.txt, not
from requirements.txt. A dependency added to requirements.txt without running
scripts/lock-requirements.sh would therefore never be installed, and nothing
else would notice. This compares the declared set against the locked set.

Versions are deliberately not compared: the lock is regenerated on purpose, and
upstream releases would otherwise make this fail on unrelated commits.
"""

import io
import re
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parents[2] / "vndb-stats-backend"


def normalize(name: str) -> str:
    """PEP 503 normalization: runs of -_. collapse to a single -."""
    return re.sub(r"[-_.]+", "-", name).lower()


def declared(path: Path) -> set:
    names = set()
    for raw in io.open(path, encoding="utf-8"):
        line = raw.split("#", 1)[0].strip()
        if not line or line.startswith("-"):
            continue
        # "pkg @ git+https://..." or "pkg[extra]>=1.0" or "pkg==1.0"
        name = re.split(r"[\[<>=!~;@ ]", line, maxsplit=1)[0].strip()
        if name:
            names.add(normalize(name))
    return names


def locked(*paths) -> set:
    names = set()
    for path in paths:
        if not path.exists():
            continue
        for raw in io.open(path, encoding="utf-8"):
            if not raw or raw[0] in " \t#\n":
                continue
            name = re.split(r"[\[<>=!~;@ ]", raw.strip(), maxsplit=1)[0].strip()
            if name:
                names.add(normalize(name))
    return names


def main() -> int:
    req = BASE / "requirements.txt"
    lock = BASE / "requirements.lock"
    vcs = BASE / "requirements-vcs.txt"

    for path in (req, lock, vcs):
        if not path.exists():
            print("ERROR: missing %s" % path.name)
            return 1

    want = declared(req)
    have = locked(lock, vcs)
    missing = sorted(want - have)

    if missing:
        print("ERROR: these are in requirements.txt but not in the lock files:")
        for name in missing:
            print("  - %s" % name)
        print("\nRegenerate with: cd vndb-stats-backend && ./scripts/lock-requirements.sh")
        return 1

    print("OK: all %d declared packages are present in the lock (%d locked total)."
          % (len(want), len(have)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
