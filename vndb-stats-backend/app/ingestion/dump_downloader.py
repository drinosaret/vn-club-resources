"""Download VNDB database dumps."""

import asyncio
import gzip
import json
import logging
import os
import tarfile
import time
from pathlib import Path

import httpx
import zstandard as zstd

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

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
        max_age_hours: Re-download if file is older than this (default: 24 hours)

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
        if not force_download and os.path.exists(output_path):
            age = get_file_age_hours(output_path)
            if age is not None and age < max_age_hours:
                logger.info(f"Using existing dump: {output_path} ({age:.1f}h old)")
                paths[name] = output_path
                continue
            else:
                logger.info(f"Dump {output_path} is stale ({age:.1f}h old), re-downloading")

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
                            # Prevent path traversal via malicious tar entries
                            if os.path.isabs(member.name) or ".." in member.name:
                                logger.warning(f"Skipping suspicious tar member: {member.name}")
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


async def cleanup_old_dumps(output_dir: str, keep_days: int = 7):
    """Remove dumps older than keep_days."""
    now = time.time()
    cutoff = now - (keep_days * 24 * 60 * 60)

    for filename in os.listdir(output_dir):
        filepath = os.path.join(output_dir, filename)
        if os.path.isfile(filepath):
            if os.path.getmtime(filepath) < cutoff:
                logger.info(f"Removing old dump: {filename}")
                os.remove(filepath)
