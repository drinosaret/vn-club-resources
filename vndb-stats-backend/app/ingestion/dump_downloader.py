"""Download VNDB database dumps."""

import asyncio
import gzip
import json
import logging
import os
import shutil
import tarfile
import time
from pathlib import Path

import httpx
import zstandard as zstd

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


def is_safe_tar_member(name: str, output_dir: str) -> bool:
    """Return True if a tar member name resolves to a path inside output_dir.

    Drive-letter prefixes and backslash separators are treated as absolute the
    same way POSIX absolute paths are, so a name is judged consistently
    regardless of the platform the archive was built on.
    """
    if not name or os.path.isabs(name) or ".." in name:
        return False
    if "\\" in name or (len(name) > 1 and name[1] == ":" and name[0].isalpha()):
        return False
    dest = os.path.realpath(os.path.join(output_dir, name))
    return dest.startswith(os.path.realpath(output_dir) + os.sep)

# Default max age for dump files (1 week)
# VNDB updates dumps daily, but most changes are minor
# Use longer default to avoid unnecessary re-downloads
DEFAULT_MAX_AGE_HOURS = 168  # 7 days


DUMP_URLS = {
    "db": settings.vndb_dump_url_db,
    "votes": settings.vndb_dump_url_votes,
    "tags": settings.vndb_dump_url_tags,
    "traits": settings.vndb_dump_url_traits,
}


def is_file_stale(filepath: str, max_age_hours: int = DEFAULT_MAX_AGE_HOURS) -> bool:
    """Check if a file is older than max_age_hours.

    Returns True if file doesn't exist or is older than threshold.
    Returns False if file exists and is fresh enough.
    """
    if not os.path.exists(filepath):
        return True

    file_mtime = os.path.getmtime(filepath)
    age_seconds = time.time() - file_mtime
    age_hours = age_seconds / 3600

    if age_hours > max_age_hours:
        logger.info(f"File {filepath} is {age_hours:.1f} hours old (max: {max_age_hours}h)")
        return True

    return False


def get_file_age_hours(filepath: str) -> float | None:
    """Get the age of a file in hours, or None if file doesn't exist."""
    if not os.path.exists(filepath):
        return None

    file_mtime = os.path.getmtime(filepath)
    age_seconds = time.time() - file_mtime
    return age_seconds / 3600


async def download_file(url: str, output_path: str, timeout: int = 600) -> bool:
    """Download a file from URL."""
    logger.info(f"Downloading {url} to {output_path}")

    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            async with client.stream("GET", url) as response:
                response.raise_for_status()

                total_size = int(response.headers.get("content-length", 0))
                downloaded = 0

                with open(output_path, "wb") as f:
                    async for chunk in response.aiter_bytes(chunk_size=8192):
                        f.write(chunk)
                        downloaded += len(chunk)

                        if total_size > 0:
                            progress = (downloaded / total_size) * 100
                            if downloaded % (10 * 1024 * 1024) == 0:  # Log every 10MB
                                logger.info(f"Download progress: {progress:.1f}%")

        logger.info(f"Downloaded {output_path} ({downloaded / 1024 / 1024:.1f} MB)")
        return True

    except Exception as e:
        logger.error(f"Failed to download {url}: {e}")
        return False


async def download_dumps(
    output_dir: str | None = None,
    force_download: bool = False,
    max_age_hours: int = DEFAULT_MAX_AGE_HOURS,
) -> dict[str, str]:
    """Download all VNDB dumps.

    Uses 'latest' suffix instead of date-based filenames so files persist
    across days and don't trigger unnecessary re-downloads.

    Args:
        output_dir: Directory to store downloads (default: settings.dump_storage_path)
        force_download: If True, always download even if file exists
        max_age_hours: Re-download if file is older than this.
            A 1-hour buffer is applied (actual threshold = max_age_hours - 1)
            to prevent race conditions when cron fires at the same interval.

    Returns:
        Dict mapping dump name to file path
    """
    output_dir = output_dir or settings.dump_storage_path
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    paths = {}

    for name, url in DUMP_URLS.items():
        # Determine extension
        if url.endswith(".tar.zst"):
            ext = ".tar.zst"
        elif url.endswith(".json.gz"):
            ext = ".json.gz"
        elif url.endswith(".gz"):
            ext = ".gz"
        else:
            ext = ""

        output_path = os.path.join(output_dir, f"{name}_latest{ext}")

        # Check if we need to download
        # Apply 1-hour buffer to prevent race condition when cron interval == max_age_hours
        # (e.g., 24h cron with 24h max_age means files at 23.99h would be reused)
        effective_max_age = max(max_age_hours - 1, 1)
        if not force_download and os.path.exists(output_path):
            age = get_file_age_hours(output_path)
            if age is not None and age < effective_max_age:
                logger.info(f"Using existing dump: {output_path} ({age:.1f}h old)")
                paths[name] = output_path
                continue
            else:
                logger.info(f"Dump {output_path} is stale ({age:.1f}h old, threshold: {effective_max_age}h), re-downloading")

        success = await download_file(url, output_path)
        if success:
            paths[name] = output_path

    return paths


def decompress_zstd_tar(input_path: str, output_dir: str) -> list[str]:
    """Decompress a .tar.zst file and extract contents."""
    logger.info(f"Decompressing {input_path}")

    Path(output_dir).mkdir(parents=True, exist_ok=True)
    extracted_files = []

    try:
        # Decompress zstd
        dctx = zstd.ZstdDecompressor()

        with open(input_path, "rb") as compressed:
            with dctx.stream_reader(compressed) as reader:
                # Extract tar
                with tarfile.open(fileobj=reader, mode="r|") as tar:
                    for member in tar:
                        if member.isfile():
                            # Only extract entries that land inside output_dir.
                            if not is_safe_tar_member(member.name, output_dir):
                                logger.warning(f"Skipping tar member: {member.name}")
                                continue
                            tar.extract(member, output_dir)
                            extracted_files.append(
                                os.path.join(output_dir, member.name)
                            )
                            logger.info(f"Extracted: {member.name}")

        return extracted_files

    except Exception as e:
        logger.error(f"Failed to decompress {input_path}: {e}")
        return []


def load_gzipped_json(path: str) -> list | dict:
    """Load a gzipped JSON file."""
    with gzip.open(path, "rt", encoding="utf-8") as f:
        return json.load(f)


def iter_gzipped_lines(path: str):
    """Iterate over lines in a gzipped text file."""
    with gzip.open(path, "rt", encoding="utf-8") as f:
        for line in f:
            yield line.strip()


def _tree_stats(path: str) -> tuple[float, int]:
    """Return the newest mtime and total byte size under a path.

    A directory is judged by its contents rather than by its own mtime, which on most
    filesystems only reflects the last entry added to it directly.
    """
    if os.path.isfile(path):
        stat = os.stat(path)
        return stat.st_mtime, stat.st_size

    newest = os.path.getmtime(path)
    total = 0
    for root, _dirs, files in os.walk(path):
        for name in files:
            try:
                stat = os.stat(os.path.join(root, name))
            except OSError:
                continue
            newest = max(newest, stat.st_mtime)
            total += stat.st_size
    return newest, total


async def cleanup_old_dumps(output_dir: str, keep_days: int = 7):
    """Remove downloaded dump archives older than keep_days.

    Scoped to the archive filenames this module writes. The dump directory is a shared
    volume, so anything else living beside them is left alone.
    """
    if not os.path.isdir(output_dir):
        return 0

    cutoff = time.time() - (keep_days * 24 * 60 * 60)
    prefixes = tuple(f"{name}_latest" for name in DUMP_URLS)
    freed = 0

    for filename in os.listdir(output_dir):
        if not filename.startswith(prefixes):
            continue
        filepath = os.path.join(output_dir, filename)
        if not os.path.isfile(filepath):
            continue
        try:
            stat = os.stat(filepath)
            if stat.st_mtime >= cutoff:
                continue
            os.remove(filepath)
        except OSError as e:
            logger.warning(f"Could not remove old dump {filename}: {e}")
            continue
        logger.info(f"Removed old dump archive: {filename}")
        freed += stat.st_size

    return freed


async def cleanup_extracted_dumps(extract_dir: str, keep_days: int = 7):
    """Remove entries under the extracted dump tree that no import still refreshes.

    Every import re-extracts the archive over the same paths, so anything in the tree that
    has gone untouched for keep_days belongs to a layout the dump no longer ships or to an
    extraction path the importer has moved off. The most recently refreshed entry is always
    retained, whatever its age: an import that reuses an existing extraction leaves the tree
    untouched, and the readers that look up single dump files between imports need it.
    """
    if not os.path.isdir(extract_dir):
        return 0

    cutoff = time.time() - (keep_days * 24 * 60 * 60)
    entries = []
    for name in os.listdir(extract_dir):
        path = os.path.join(extract_dir, name)
        try:
            entries.append((path, name) + _tree_stats(path))
        except OSError as e:
            logger.warning(f"Could not inspect extracted dump entry {name}: {e}")

    if not entries:
        return 0

    newest_path = max(entries, key=lambda entry: entry[2])[0]
    freed = 0

    for path, name, mtime, size in entries:
        if path == newest_path or mtime >= cutoff:
            continue
        try:
            if os.path.isdir(path):
                shutil.rmtree(path)
            else:
                os.remove(path)
        except OSError as e:
            logger.warning(f"Could not remove extracted dump entry {name}: {e}")
            continue
        logger.info(f"Removed stale extracted dump entry: {name} ({size / 1024 / 1024:.1f} MB)")
        freed += size

    return freed


async def cleanup_dump_storage(dump_dir: str, keep_days: int = 7):
    """Sweep both the downloaded archives and the extracted tree.

    Call only once an import has finished successfully. A run that failed part-way may still
    need every file it extracted, and the archives are the only copy on disk.
    """
    freed = await cleanup_old_dumps(dump_dir, keep_days=keep_days)
    freed += await cleanup_extracted_dumps(
        os.path.join(dump_dir, "extracted"), keep_days=keep_days
    )

    if freed:
        logger.info(f"Dump storage cleanup reclaimed {freed / 1024 / 1024:.1f} MB")
    return freed
