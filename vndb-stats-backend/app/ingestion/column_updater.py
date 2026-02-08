"""
Column Updater - Update specific columns from VNDB dump files.

This utility allows updating specific columns without a full database reimport.
Useful for quick fixes or when you need to populate a new column.

The dump files are tab-separated with a separate .header file containing field names.

Usage:
    # Update title_jp from vn_titles dump (using lang=ja, official=true rows)
    python -m app.ingestion.column_updater --table visual_novels --column title_jp --source-file vn_titles --filter lang=ja,official=t

    # Update any column from a simple dump file
    python -m app.ingestion.column_updater --table visual_novels --column description --source-file vn --source-field desc

    # Force update even if column has a value
    python -m app.ingestion.column_updater --table visual_novels --column title_jp --source-file vn_titles --filter lang=ja,official=t --force

Examples:
    # Populate title_jp for VNs
    docker-compose exec api python -m app.ingestion.column_updater --table visual_novels --column title_jp --source-file vn_titles --filter "lang=ja,official=t" --source-field title

    # Update image_sexual column
    docker-compose exec api python -m app.ingestion.column_updater --table visual_novels --column image_sexual --source-file images --source-field c_sexual_avg
"""

import argparse
import asyncio
import csv
import logging
import re
from pathlib import Path

from sqlalchemy import text

from app.db.database import async_session

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Base path for extracted dump files
DUMP_BASE_PATH = Path('/app/data/db')


def parse_filter(filter_str: str | None) -> dict[str, str]:
    """Parse filter string like 'lang=ja,official=t' into dict."""
    if not filter_str:
        return {}
    filters = {}
    for part in filter_str.split(','):
        if '=' in part:
            key, val = part.split('=', 1)
            filters[key.strip()] = val.strip()
    return filters


def load_dump_data(
    source_file: str,
    source_field: str,
    id_field: str = 'id',
    filters: dict[str, str] | None = None,
) -> dict[str, str]:
    """Load data from a dump file.

    Args:
        source_file: Name of dump file (e.g., 'vn', 'vn_titles', 'images')
        source_field: Field to extract values from
        id_field: Field to use as the key (default: 'id')
        filters: Dict of field=value filters to apply

    Returns:
        Dict mapping id -> value
    """
    dump_path = DUMP_BASE_PATH / source_file
    header_path = DUMP_BASE_PATH / f"{source_file}.header"

    if not dump_path.exists():
        raise FileNotFoundError(f"Dump file not found: {dump_path}")

    # Read header
    if header_path.exists():
        with open(header_path, 'r', encoding='utf-8') as f:
            fieldnames = f.read().strip().split('\t')
    else:
        raise FileNotFoundError(f"Header file not found: {header_path}")

    logger.info(f"Reading from {dump_path}")
    logger.info(f"Fields: {fieldnames}")
    logger.info(f"Extracting: {id_field} -> {source_field}")
    if filters:
        logger.info(f"Filters: {filters}")

    data = {}
    row_count = 0
    match_count = 0

    with open(dump_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f, delimiter='\t', fieldnames=fieldnames)

        for row in reader:
            row_count += 1

            # Apply filters
            if filters:
                matches = True
                for key, expected in filters.items():
                    actual = row.get(key, '')
                    if actual != expected:
                        matches = False
                        break
                if not matches:
                    continue

            match_count += 1

            # Extract id and value
            row_id = row.get(id_field, '')
            if not row_id:
                continue

            # Normalize VN IDs to start with 'v'
            if source_file in ('vn', 'vn_titles') and not row_id.startswith('v'):
                row_id = f'v{row_id}'

            value = row.get(source_field, '')

            # Skip null markers
            if value == '\\N' or not value:
                continue

            # Sanitize: remove null bytes
            value = value.replace('\x00', '')

            data[row_id] = value

    logger.info(f"Read {row_count} rows, {match_count} matched filters, {len(data)} have values")
    return data


# Allowlisted table/column names to prevent SQL injection via CLI args
_ALLOWED_TABLES = {
    "visual_novels", "tags", "traits", "staff", "characters",
    "releases", "producers", "vn_tags", "vn_staff", "vn_seiyuu",
    "character_vns", "character_traits", "release_vn", "release_producers",
}
_ALLOWED_ID_COLUMNS = {"id", "vn_id", "tag_id", "trait_id", "staff_id", "char_id", "release_id"}


def _validate_identifier(value: str, allowed: set[str], label: str) -> str:
    """Validate that a SQL identifier is in the allowlist."""
    if value not in allowed:
        raise ValueError(f"Invalid {label}: '{value}'. Allowed: {', '.join(sorted(allowed))}")
    return value


async def update_column(
    table: str,
    column: str,
    data: dict[str, str],
    where_null: bool = True,
    id_column: str = 'id',
):
    """Update a column in the database.

    Args:
        table: Target table name (must be in allowlist)
        column: Column to update (validated as identifier)
        data: Dict mapping id -> new_value
        where_null: Only update where column is NULL/empty
        id_column: Name of ID column in table (must be in allowlist)
    """
    if not data:
        logger.warning("No data to update")
        return

    # Validate identifiers against allowlist to prevent SQL injection
    _validate_identifier(table, _ALLOWED_TABLES, "table")
    _validate_identifier(id_column, _ALLOWED_ID_COLUMNS, "id_column")
    # Validate column name: must be alphanumeric/underscores only
    if not re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', column):
        raise ValueError(f"Invalid column name: '{column}'")

    async with async_session() as db:
        batch_size = 1000
        items = list(data.items())
        total_updated = 0

        where_clause = f"AND ({column} IS NULL OR {column} = '')" if where_null else ""

        for i in range(0, len(items), batch_size):
            batch = items[i:i + batch_size]

            for row_id, new_val in batch:
                result = await db.execute(
                    text(f"UPDATE {table} SET {column} = :val WHERE {id_column} = :id {where_clause}"),
                    {'id': row_id, 'val': new_val}
                )
                total_updated += result.rowcount

            await db.commit()

            if (i + batch_size) % 10000 == 0 or (i + batch_size) >= len(items):
                logger.info(f"Processed {min(i + batch_size, len(items))}/{len(items)}, updated {total_updated}")

    logger.info(f"Completed: Updated {total_updated} rows in {table}.{column}")


async def main():
    parser = argparse.ArgumentParser(
        description='Update a database column from VNDB dump file',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    parser.add_argument('--table', required=True, help='Database table name (e.g., visual_novels)')
    parser.add_argument('--column', required=True, help='Column to update (e.g., title_jp)')
    parser.add_argument('--source-file', required=True, help='Dump file name (e.g., vn_titles)')
    parser.add_argument('--source-field', default=None, help='Field in dump file (default: same as column)')
    parser.add_argument('--id-field', default='id', help='ID field in dump file (default: id)')
    parser.add_argument('--filter', default=None, help='Filter rows, e.g., "lang=ja,official=t"')
    parser.add_argument('--force', action='store_true', help='Update even if column already has value')

    args = parser.parse_args()

    source_field = args.source_field or args.column
    filters = parse_filter(args.filter)

    try:
        # Load data from dump
        data = load_dump_data(
            source_file=args.source_file,
            source_field=source_field,
            id_field=args.id_field,
            filters=filters,
        )

        # Update database
        await update_column(
            table=args.table,
            column=args.column,
            data=data,
            where_null=not args.force,
        )

    except FileNotFoundError as e:
        logger.error(str(e))
        logger.info("Make sure the dump files have been downloaded and extracted.")
        logger.info("Run 'npm run api:import' first if needed.")
        raise SystemExit(1)


if __name__ == '__main__':
    asyncio.run(main())
