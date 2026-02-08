#!/usr/bin/env python
"""Quick CLI tool to check database status.

Run this to see if you actually need to reimport data (you probably don't!).

Usage:
    python scripts/check_db_status.py
    # or via npm:
    npm run api:status
"""

import asyncio
import sys
from pathlib import Path

# Add app to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.db.database import init_db
from app.db.inspector import get_database_status, print_status_report


async def main():
    """Check and print database status."""
    # Initialize database connection
    await init_db()

    # Get status
    status = await get_database_status()

    # Print report
    print_status_report(status)

    # Return exit code based on status
    if status.get("error"):
        return 1
    return 0


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
