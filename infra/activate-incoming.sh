#!/bin/bash
# Switches lockin.hoandat.com to an uploaded release. Root-owned; installed as
# /usr/local/sbin/lockin-activate-incoming by setup-deploy-user.sh (and refreshed
# by every manual deploy.sh setup or release), and the only command the CI user
# `lockin-deploy` may run through sudo.
#   lockin-activate-incoming <release-id>
# The release waits in /var/www/lockin/ci-incoming/<id> (writable by the deploy
# user). It is moved out of the deploy user's reach before any check, must hold
# only plain files and directories with the web app, the server bundle and the
# migrations, then becomes releases/<id> and `current`. lockin-server restarts and
# /healthz (loopback) and https://lockin.hoandat.com/ (origin) are checked; on
# failure `current` goes back to the previous release, the service restarts and
# the script exits 1. The five newest releases stay. The release id is written
# to apps/web/dist/RELEASE, so https://lockin.hoandat.com/RELEASE tells which
# release is served. nginx, the unit and these scripts are never taken from the
# upload: they change only through `deploy.sh setup`.
set -euo pipefail
ROOT=/var/www/lockin
HOST=lockin.hoandat.com
PORT=5310
ID="${1:?usage: lockin-activate-incoming <release-id>}"
[[ "$ID" =~ ^[0-9]{8}-[0-9]{6}-[0-9a-f]{12}$ ]] || { echo "bad release id" >&2; exit 2; }
SRC="$ROOT/ci-incoming/$ID"
STAGE="$ROOT/staging"
DST="$ROOT/releases/$ID"
[ ! -e "$DST" ] || { echo "release $ID already exists" >&2; exit 2; }
[ -d "$SRC" ] && [ ! -L "$SRC" ] || { echo "incoming release $ID missing" >&2; exit 2; }

# Checks run only once the tree is root-owned in a root-only directory, so the
# deploy user cannot swap a checked file for a symlink in between.
install -d -m 700 -o root -g root "$STAGE"
rm -rf "${STAGE:?}/$ID"
mv "$SRC" "$STAGE/$ID"
chown -R root:root "$STAGE/$ID"
reject() {
	rm -rf "${STAGE:?}/$ID"
	echo "incoming release $ID $1" >&2
	exit 2
}
[ -z "$(find "$STAGE/$ID" ! -type f ! -type d -print -quit)" ] || reject "has links or special files"
for f in apps/web/dist/index.html apps/server/dist/server/index.mjs apps/server/drizzle/meta/_journal.json; do
	[ -f "$STAGE/$ID/$f" ] || reject "has no $f"
done
find "$STAGE/$ID" -type d -exec chmod 755 {} +
find "$STAGE/$ID" -type f -exec chmod 644 {} +
printf '%s\n' "$ID" >"$STAGE/$ID/apps/web/dist/RELEASE"
mkdir -p "$ROOT/releases"
mv "$STAGE/$ID" "$DST"

cd "$ROOT"
prev="$(readlink -f current || true)"
ln -sfn "$DST" current.next
mv -T current.next current

healthy() {
	for _ in $(seq 1 20); do
		curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null && return 0
		sleep 1
	done
	return 1
}
origin_ok() {
	local code=""
	# Right after a reload old nginx workers can still answer; give them a moment.
	for _ in 1 2 3 4 5; do
		code="$(curl -sk -o /dev/null -w '%{http_code}' --resolve "$HOST:443:127.0.0.1" "https://$HOST/")"
		[ "$code" = 200 ] && return 0
		sleep 1
	done
	echo "origin https://$HOST/ -> $code" >&2
	return 1
}

systemctl restart lockin-server
if ! healthy || ! origin_ok; then
	journalctl -u lockin-server -n 40 --no-pager || true
	if [ -n "$prev" ] && [ -d "$prev" ] && [ "$prev" != "$DST" ]; then
		echo "release $ID failed: switching back to $prev" >&2
		ln -sfn "$prev" current.next
		mv -T current.next current
		systemctl restart lockin-server
		if healthy; then echo "previous release is back and healthy" >&2; else echo "previous release is not healthy either" >&2; fi
	fi
	exit 1
fi
echo "healthz ok, origin 200: lockin.hoandat.com now serves $ID"
# shellcheck disable=SC2012 # release names are plain stamps
ls -1dt releases/*/ | tail -n +6 | xargs -r rm -rf
