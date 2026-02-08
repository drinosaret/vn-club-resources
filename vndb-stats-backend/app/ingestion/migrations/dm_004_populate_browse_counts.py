"""
Data Migration 004: Populate precomputed browse counts for staff and producers.

Computes vn_count, roles, seiyuu counts on staff table and vn_count variants
on producers table using aggregation queries against the join tables.
These precomputed columns eliminate expensive subquery joins in browse endpoints.
"""

import logging

from sqlalchemy import text

from app.db.database import async_session
from app.ingestion.data_migrations import data_migration

logger = logging.getLogger(__name__)


@data_migration('004', 'Populate precomputed browse counts for staff and producers')
async def populate_browse_counts():
    """Populate vn_count, roles, seiyuu counts on staff; vn_count variants on producers."""
    async with async_session() as db:
        # Staff vn_count from vn_staff
        logger.info("Computing staff vn_count...")
        result = await db.execute(text("""
            UPDATE staff SET vn_count = sub.cnt
            FROM (
                SELECT staff_id, COUNT(DISTINCT vn_id) AS cnt
                FROM vn_staff
                GROUP BY staff_id
            ) sub
            WHERE staff.id = sub.staff_id
        """))
        logger.info(f"Updated vn_count for {result.rowcount} staff members")

        # Staff roles array from vn_staff
        logger.info("Computing staff roles...")
        result = await db.execute(text("""
            UPDATE staff SET roles = sub.role_list
            FROM (
                SELECT staff_id, ARRAY_AGG(DISTINCT role ORDER BY role) AS role_list
                FROM vn_staff
                GROUP BY staff_id
            ) sub
            WHERE staff.id = sub.staff_id
        """))
        logger.info(f"Updated roles for {result.rowcount} staff members")

        # Staff seiyuu counts from vn_seiyuu
        logger.info("Computing staff seiyuu counts...")
        result = await db.execute(text("""
            UPDATE staff SET seiyuu_vn_count = sub.vn_cnt, seiyuu_char_count = sub.char_cnt
            FROM (
                SELECT staff_id,
                       COUNT(DISTINCT vn_id) AS vn_cnt,
                       COUNT(DISTINCT character_id) AS char_cnt
                FROM vn_seiyuu
                GROUP BY staff_id
            ) sub
            WHERE staff.id = sub.staff_id
        """))
        logger.info(f"Updated seiyuu counts for {result.rowcount} staff members")

        await db.commit()
        logger.info("Staff counts committed")

        # Producer total vn_count
        logger.info("Computing producer vn_count...")
        result = await db.execute(text("""
            UPDATE producers SET vn_count = sub.cnt
            FROM (
                SELECT rp.producer_id, COUNT(DISTINCT rv.vn_id) AS cnt
                FROM release_producers rp
                JOIN release_vn rv ON rp.release_id = rv.release_id
                GROUP BY rp.producer_id
            ) sub
            WHERE producers.id = sub.producer_id
        """))
        logger.info(f"Updated vn_count for {result.rowcount} producers")

        # Producer dev_vn_count
        logger.info("Computing producer dev_vn_count...")
        result = await db.execute(text("""
            UPDATE producers SET dev_vn_count = sub.cnt
            FROM (
                SELECT rp.producer_id, COUNT(DISTINCT rv.vn_id) AS cnt
                FROM release_producers rp
                JOIN release_vn rv ON rp.release_id = rv.release_id
                WHERE rp.developer = true
                GROUP BY rp.producer_id
            ) sub
            WHERE producers.id = sub.producer_id
        """))
        logger.info(f"Updated dev_vn_count for {result.rowcount} producers")

        # Producer pub_vn_count
        logger.info("Computing producer pub_vn_count...")
        result = await db.execute(text("""
            UPDATE producers SET pub_vn_count = sub.cnt
            FROM (
                SELECT rp.producer_id, COUNT(DISTINCT rv.vn_id) AS cnt
                FROM release_producers rp
                JOIN release_vn rv ON rp.release_id = rv.release_id
                WHERE rp.publisher = true
                GROUP BY rp.producer_id
            ) sub
            WHERE producers.id = sub.producer_id
        """))
        logger.info(f"Updated pub_vn_count for {result.rowcount} producers")

        await db.commit()
        logger.info("Producer counts committed")

    logger.info("Completed: All browse counts populated")
