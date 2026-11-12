#!/usr/bin/env bash
# Build Lockin locally and release it to the shared server (.65), by hand (every push to main also deploys
# through .github/workflows/deploy.yml).
#
#   SSH_TARGET=<ssh host alias> [SSH_OPTS="-F <ssh_config>"] bash infra/deploy.sh setup     # first time; unit or nginx change
#   SSH_TARGET=<ssh host alias> [SSH_OPTS="-F <ssh_config>"] bash infra/deploy.sh           # release
#
# setup: system user `lockin`, directories, the systemd unit and the nginx site (nginx -t before reload, the
#   previous file restored on failure). /etc/lockin/production.env must already exist (docs/deployment-guide.md).
#   A changed unit restarts the running service.
# release: refuses a dirty working tree; gates + build here, upload to /var/www/lockin/ci-incoming/<release-id>
#   (YYYYMMDD-HHMMSS-<sha12>), then run /usr/local/sbin/lockin-activate-incoming <release-id>
#   (infra/activate-incoming.sh), the same switch every push to main runs through .github/workflows/deploy.yml:
#   releases/<release-id>, `current`, restart lockin-server, /healthz on loopback and https://lockin.hoandat.com/
#   through the origin; on failure `current` goes back to the previous release, the service restarts, and the
#   script exits 1. The five newest releases stay; manual rollback: docs/deployment-guide.md.
# setup and release both upload infra/ and reinstall /usr/local/sbin/lockin-activate-incoming first.
set -euo pipefail

: "${SSH_TARGET:?set SSH_TARGET to the ssh host alias of the server}"
read -r -a ssh_opts <<<"${SSH_OPTS:-}"
mode="${1:-release}"
remote=/var/www/lockin
host=lockin.hoandat.com
# macOS tar would otherwise add AppleDouble `._*` entries that nginx would serve.
export COPYFILE_DISABLE=1

cd "$(dirname "$0")/.."

ssh_run() { ssh "${ssh_opts[@]}" "$SSH_TARGET" "$@"; }

# Upload infra/ (root-owned on the server) and refresh the root command the CI user runs, so it always matches
# the infra/activate-incoming.sh that this run uses.
sync_infra() {
	ssh_run "mkdir -p $remote/infra" </dev/null
	rsync -rlz --exclude "._*" --exclude .DS_Store -e "ssh ${ssh_opts[*]}" infra/ "$SSH_TARGET:$remote/infra/"
	ssh_run "chown -R root:root $remote/infra && install -m 755 -o root -g root $remote/infra/activate-incoming.sh /usr/local/sbin/lockin-activate-incoming" </dev/null
}

setup() {
	sync_infra
	ssh_run bash -s <<EOF
set -euo pipefail
test -f /etc/lockin/production.env || { echo "missing /etc/lockin/production.env (docs/deployment-guide.md)" >&2; exit 1; }
id lockin >/dev/null 2>&1 || useradd --system --no-create-home --shell /sbin/nologin lockin
chown root:lockin /etc/lockin/production.env
chmod 640 /etc/lockin/production.env
mkdir -p $remote/releases
unit=/etc/systemd/system/lockin-server.service
if ! cmp -s $remote/infra/lockin-server.service \$unit; then
	install -m 644 $remote/infra/lockin-server.service \$unit
	systemctl daemon-reload
	# A running service keeps the old limits and ExecStart until restarted (no-op when not running yet).
	systemctl try-restart lockin-server
	echo "unit installed"
fi
systemctl enable lockin-server >/dev/null
conf=/etc/nginx/conf.d/$host.conf
if ! cmp -s $remote/infra/nginx/$host.conf \$conf; then
	if [ -f \$conf ]; then cp \$conf \$conf.prev; fi
	cp $remote/infra/nginx/$host.conf \$conf
	if ! nginx -t; then
		if [ -f \$conf.prev ]; then mv \$conf.prev \$conf; else rm -f \$conf; fi
		echo "nginx -t failed: config restored, nothing reloaded" >&2
		exit 1
	fi
	systemctl reload nginx
	echo "nginx site installed and reloaded"
fi
EOF
}

release() {
	# The release is named after HEAD: it must be exactly HEAD.
	if [ -n "$(git status --porcelain)" ]; then
		echo "working tree is not clean: commit or stash first (git status)" >&2
		exit 1
	fi
	git fetch --quiet origin main
	if ! git merge-base --is-ancestor HEAD origin/main; then
		echo "HEAD $(git rev-parse --short HEAD) is not on origin/main: push it first" >&2
		exit 1
	fi
	pnpm lint
	pnpm typecheck
	pnpm test
	pnpm build
	local id
	id="$(date -u +%Y%m%d-%H%M%S)-$(git rev-parse --short=12 HEAD)"
	sync_infra
	ssh_run "mkdir -p $remote/ci-incoming/$id" </dev/null
	# The server bundle needs only Node and the migrations: no install on the server.
	tar czf - --exclude '._*' --exclude .DS_Store apps/web/dist apps/server/dist apps/server/drizzle |
		ssh_run "tar xzf - --no-same-owner -C $remote/ci-incoming/$id"
	# The same switch CI runs (checks, restart, healthz + origin, previous release back on failure).
	ssh_run "/usr/local/sbin/lockin-activate-incoming $id" </dev/null
}

case "$mode" in
	setup) setup ;;
	release) release ;;
	*)
		echo "usage: infra/deploy.sh [setup|release]" >&2
		exit 2
		;;
esac
