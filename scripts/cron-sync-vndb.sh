#!/bin/bash
# VNDB Cover Sync - Cron Script
#
# For VPS Docker deployment, add to crontab:
#   0 3 * * 0 /home/deploy/vn-club-resources/scripts/cron-sync-vndb.sh >> /var/log/vndb-sync.log 2>&1
#
# This syncs VNDB covers weekly (Sundays at 3 AM UTC):
#   1. rsync ~190K JPG cover images from VNDB
#   2. Convert new JPGs to full-size WebP (quality 80)
#   3. Generate resized variants (w256, w512) for all covers
#
# The web container's /img/ route serves pre-generated files from the shared vndb-cache volume.
# On-demand generation only happens for edge cases (new VNs added between syncs).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

log "Starting VNDB cover sync..."

cd "$PROJECT_DIR" || exit 1

# Use Docker sync service (writes to vndb-cache volume shared with web container)
if docker compose -f docker-compose.prod.yml --profile tools run --rm sync; then
  log "Sync completed successfully."
else
  EXIT_CODE=$?
  log "WARNING: Sync exited with code $EXIT_CODE"
  # Don't fail hard — partial syncs are acceptable
fi

log "Sync complete!"
