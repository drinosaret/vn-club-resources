#!/bin/bash
# VNDB Cover Sync - Cron Script
#
# Add to crontab on your VPS:
#   0 3 * * 0 /path/to/vn-club-resources/scripts/cron-sync-vndb.sh >> /var/log/vndb-sync.log 2>&1
#
# This syncs VNDB covers weekly (Sundays at 3 AM)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CACHE_DIR="$PROJECT_DIR/public/cache/vndb/cv"
LOG_PREFIX="[$(date '+%Y-%m-%d %H:%M:%S')]"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

log "Starting VNDB cover sync..."

# Ensure cache directory exists
mkdir -p "$CACHE_DIR"

# Sync covers from VNDB
log "Running rsync..."
rsync -rtpv --del \
  rsync://dl.vndb.org/vndb-img/cv/ \
  "$CACHE_DIR/"

RSYNC_EXIT=$?

# Handle rsync exit codes:
# 0 = success
# 23 = partial transfer (some files/attrs not transferred)
# 24 = partial transfer due to vanished source files
if [ $RSYNC_EXIT -eq 0 ]; then
  log "Rsync completed successfully."
elif [ $RSYNC_EXIT -eq 23 ] || [ $RSYNC_EXIT -eq 24 ]; then
  log "Rsync completed with warnings (exit code $RSYNC_EXIT). This is normal - continuing with WebP conversion."
else
  log "ERROR: Rsync failed with exit code $RSYNC_EXIT"
  exit 1
fi

log "Converting to WebP..."

# Run the Node script for WebP conversion (skip rsync since we just did it)
cd "$PROJECT_DIR"
if npx tsx scripts/sync-vndb-covers.ts --skip-sync; then
  log "WebP conversion completed successfully."
else
  log "WARNING: WebP conversion had some failures, but sync is complete."
fi

log "Sync complete!"
