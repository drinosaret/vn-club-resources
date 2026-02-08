#!/usr/bin/env python3
"""
Quick script to update average_rating from VNDB dump's c_average field.
Much faster than a full import - only downloads and processes the vn table.
"""

import asyncio
import csv
import io
import os
import sys
import tempfile
import zstandard as zstd
import tarfile
import httpx

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from app.db.database import async_session_maker

DUMP_URL = "https://dl.vndb.org/dump/vndb-db-latest.tar.zst"


async def download_and_extract_vn_table():
    """Download dump and extract just the vn table."""
    print("Downloading VNDB dump (this may take a moment)...")

    # Download to temp file (too large for memory)
    with tempfile.NamedTemporaryFile(delete=False, suffix='.tar.zst') as tmp:
        tmp_path = tmp.name

        async with httpx.AsyncClient(timeout=600, follow_redirects=True) as client:
            async with client.stream('GET', DUMP_URL) as response:
                response.raise_for_status()
                total = 0
                async for chunk in response.aiter_bytes(chunk_size=1024*1024):
                    tmp.write(chunk)
                    total += len(chunk)
                    print(f"\r  Downloaded {total / 1024 / 1024:.1f} MB", end='', flush=True)
                print()

    print(f"Downloaded to {tmp_path}")

    # Decompress to tar file first
    tar_path = tmp_path.replace('.tar.zst', '.tar')
    print("Decompressing archive...")

    dctx = zstd.ZstdDecompressor()
    with open(tmp_path, 'rb') as ifh:
        with open(tar_path, 'wb') as ofh:
            dctx.copy_stream(ifh, ofh)

    os.unlink(tmp_path)  # Remove compressed file
    print(f"Decompressed to {tar_path}")

    # Extract from tar
    print("Extracting vn table from archive...")
    vn_data = None
    vn_header = None

    with tarfile.open(tar_path, mode='r') as tar:
        # List a few members to debug
        members = tar.getnames()
        print(f"  Archive contains {len(members)} files")

        # Find vn files
        for name in members:
            if name.endswith('/db/vn') or name == 'db/vn':
                print(f"  Found: {name}")
                member = tar.getmember(name)
                f = tar.extractfile(member)
                if f:
                    vn_data = f.read().decode('utf-8')
                    print(f"  Loaded vn table ({len(vn_data) / 1024 / 1024:.1f} MB)")

            elif name.endswith('/db/vn.header') or name == 'db/vn.header':
                print(f"  Found: {name}")
                member = tar.getmember(name)
                f = tar.extractfile(member)
                if f:
                    vn_header = f.read().decode('utf-8').strip()
                    print(f"  Loaded vn.header")

    # Cleanup tar file
    os.unlink(tar_path)

    if not vn_data or not vn_header:
        # Debug: show some file names
        print("Could not find vn table. Sample file names:")
        for name in members[:20]:
            print(f"    {name}")
        raise Exception("Could not find vn table in dump")

    return vn_header, vn_data


def parse_vn_averages(header: str, data: str) -> dict[str, float]:
    """Parse c_average values from VN table."""
    print("Parsing c_average values...")

    columns = header.split('\t')
    print(f"  Columns: {columns}")

    # Find indices
    try:
        id_idx = columns.index('id')
        avg_idx = columns.index('c_average')
    except ValueError as e:
        print(f"Available columns: {columns}")
        raise Exception(f"Required column not found: {e}")

    averages = {}
    lines = data.strip().split('\n')

    # Debug: show first few lines
    print(f"  First line sample: {lines[0][:100]}...")

    for line in lines:
        if not line:
            continue
        parts = line.split('\t')
        if len(parts) <= max(id_idx, avg_idx):
            continue

        vn_id = parts[id_idx]
        avg_raw = parts[avg_idx]

        if avg_raw and avg_raw != '\\N':
            try:
                # c_average is stored as integer (e.g., 719 = 7.19)
                # vn_id already has 'v' prefix in the dump
                averages[vn_id] = float(avg_raw) / 100
            except ValueError:
                pass

    print(f"Parsed {len(averages)} average ratings")

    # Debug: show specific VNs
    for test_id in ['v5711', 'v2002', 'v23221']:
        if test_id in averages:
            print(f"  {test_id}: {averages[test_id]}")

    return averages


async def update_database(averages: dict[str, float]):
    """Update average_rating in database."""
    print("Updating database...")

    async with async_session_maker() as session:
        # Update in batches using VALUES join
        batch_size = 500
        items = list(averages.items())
        updated = 0

        for i in range(0, len(items), batch_size):
            batch = items[i:i + batch_size]

            # Build VALUES list
            values = ", ".join([f"('{vn_id}', {avg})" for vn_id, avg in batch])

            sql = f"""
                UPDATE visual_novels AS v
                SET average_rating = data.avg
                FROM (VALUES {values}) AS data(id, avg)
                WHERE v.id = data.id
            """

            result = await session.execute(text(sql))
            updated += result.rowcount

            if (i + batch_size) % 5000 == 0 or i + batch_size >= len(items):
                print(f"  Updated {min(i + batch_size, len(items))} / {len(items)}...")

        await session.commit()
        print(f"Updated {updated} VNs with c_average values")


async def verify_update():
    """Verify some known values."""
    async with async_session_maker() as session:
        result = await session.execute(text("""
            SELECT id, title, rating, average_rating
            FROM visual_novels
            WHERE id IN ('v5711', 'v2002', 'v23221')
            ORDER BY id
        """))

        print("\nVerification (sample VNs):")
        print("-" * 60)
        for row in result.all():
            print(f"{row.id}: {row.title[:30]:30} | Bayesian: {row.rating:.2f} | Average: {row.average_rating:.2f}")


async def main():
    print("=" * 60)
    print("VNDB Average Rating Updater")
    print("=" * 60)

    # Download and extract
    header, data = await download_and_extract_vn_table()

    # Parse averages
    averages = parse_vn_averages(header, data)

    # Update database
    await update_database(averages)

    # Verify
    await verify_update()

    print("\nDone!")


if __name__ == "__main__":
    asyncio.run(main())
