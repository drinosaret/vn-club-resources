#!/usr/bin/env bash
# Run on the VPS via:
#   ssh deploy@host 'bash -s' < scripts/deploy-remote.sh
#
# The companion workflow (.github/workflows/deploy-vps.yml) uploads
# /home/deploy/.deploy-secrets.env (mode 600) just before invoking this.
# Piping via stdin keeps the script body and any sourced secrets out
# of the remote process command line.

set -euo pipefail

ENV_TMP=/home/deploy/.deploy-secrets.env

if [ ! -f "$ENV_TMP" ]; then
  echo "ERROR: $ENV_TMP not found — did the upload step run?" >&2
  exit 1
fi

# Source the secrets, then immediately remove the file so it doesn't linger.
chmod 600 "$ENV_TMP"
set -a
# shellcheck disable=SC1090
. "$ENV_TMP"
set +a
rm -f "$ENV_TMP"

cd ~/vn-club-resources
git pull --ff-only

ENV_FILE=deploy/.env.prod

# Replace or append KEY=VAL in $ENV_FILE without sed escaping pitfalls.
# Uses grep -v + printf so special chars in the value (/, |, &, \) are safe.
update_env() {
  local key="$1" val="${2-}"
  [ -z "$val" ] && return
  local tmp="${ENV_FILE}.tmp"
  if [ -f "$ENV_FILE" ]; then
    grep -v "^${key}=" "$ENV_FILE" > "$tmp" || true
  else
    : > "$tmp"
  fi
  printf '%s=%s\n' "$key" "$val" >> "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$ENV_FILE"
}

update_env DISCORD_BOT_TOKEN              "${DISCORD_BOT_TOKEN-}"
update_env DISCORD_ADMIN_USER_IDS         "${DISCORD_ADMIN_USER_IDS-}"
update_env DISCORD_LOG_WEBHOOK_URL        "${DISCORD_LOG_WEBHOOK_URL-}"
update_env TWITTER_AUTH_TOKEN             "${TWITTER_AUTH_TOKEN-}"
update_env UMAMI_DB_PASSWORD              "${UMAMI_DB_PASSWORD-}"
update_env UMAMI_APP_SECRET               "${UMAMI_APP_SECRET-}"
update_env NEXT_PUBLIC_UMAMI_URL          "${NEXT_PUBLIC_UMAMI_URL-}"
update_env NEXT_PUBLIC_UMAMI_WEBSITE_ID   "${NEXT_PUBLIC_UMAMI_WEBSITE_ID-}"
update_env NEXT_PUBLIC_TURNSTILE_SITE_KEY "${NEXT_PUBLIC_TURNSTILE_SITE_KEY-}"
update_env TURNSTILE_SECRET_KEY           "${TURNSTILE_SECRET_KEY-}"

# Backup env file (sourced by cron, not inline)
if [ -n "${BACKUP_ENCRYPTION_KEY-}" ]; then
  umask 077
  # %q produces a shell-quoted form so values with quotes/backslashes are safe
  printf 'export BACKUP_ENCRYPTION_KEY=%q\n' "$BACKUP_ENCRYPTION_KEY" > ~/.backup-env

  BACKUP_CRON='15 6 * * * . /home/deploy/.backup-env && /home/deploy/backup-to-r2.sh >> /home/deploy/backup.log 2>&1'
  (crontab -l 2>/dev/null | grep -v 'backup-to-r2'; echo "$BACKUP_CRON") | crontab -
fi

# Configure rclone R2 remote if credentials are set
if [ -n "${R2_ACCESS_KEY_ID-}" ] && [ -n "${R2_SECRET_ACCESS_KEY-}" ] && [ -n "${R2_ENDPOINT-}" ]; then
  rclone config create r2 s3 \
    provider=Cloudflare \
    access_key_id="$R2_ACCESS_KEY_ID" \
    secret_access_key="$R2_SECRET_ACCESS_KEY" \
    endpoint="$R2_ENDPOINT" \
    acl=private --quiet 2>/dev/null || true
fi

# Generate git dates for guide pages (Docker has no .git)
node scripts/generate-git-dates.js

docker compose -f docker-compose.prod.yml --env-file deploy/.env.prod up -d --build
# Recreate nginx — git pull creates new file inodes, but Docker bind mounts
# track the old inode. `nginx -s reload` reads the stale mount. Recreating
# the container rebinds to the current inode. --no-deps prevents cascading.
docker compose -f docker-compose.prod.yml --env-file deploy/.env.prod up -d --force-recreate --no-deps nginx
docker image prune -f
