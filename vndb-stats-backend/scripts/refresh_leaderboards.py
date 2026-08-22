#!/usr/bin/env python
"""Rebuild the leaderboards without running a full import.

The daily worker rebuilds them as its last phase, which is the normal path. This exists for
the cases where that is not available: a first deploy against a database that already holds
the dump, or a night the import did not finish. The boards carry a TTL rather than living in
Postgres, so several missed rebuilds empty every ranking page at once, and the alternative
recovery is a full reimport.

Reads the vote dump already in the database and writes the boards, the percentile sketches
and the per-title columns browse sorts on. Nothing is downloaded.

Usage:
    python scripts/refresh_leaderboards.py
    python scripts/refresh_leaderboards.py --dry-run   # build and report, write nothing
    # or via npm:
    npm run api:leaderboards
"""

import argparse
import asyncio
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.leaderboards.compute import refresh_leaderboards


async def main(dry_run: bool) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    stats = await refresh_leaderboards(dry_run=dry_run)

    print()
    print("Dry run, nothing written." if dry_run else "Leaderboards rebuilt.")
    for key, value in sorted(stats.items()):
        if isinstance(value, list):
            value = f"{len(value)} ({', '.join(map(str, value[:5]))}...)" if value else "none"
        print(f"  {key}: {value}")

    # A run that stored no boards has failed even when nothing raised, and a caller scripting
    # a deploy needs to be able to tell. Boards that were computed but not written count as
    # failures here for the same reason: nobody can read them.
    if stats.get("unwritten"):
        print(f"  {len(stats['unwritten'])} boards were not stored")
        return 1
    return 0 if dry_run or stats.get("boards") else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="build the boards and report, without writing them",
    )
    sys.exit(asyncio.run(main(parser.parse_args().dry_run)))
