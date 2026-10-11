#!/usr/bin/env bash
# Deploy MLBB Counter Build ke Ubuntu + nginx. Jalankan dari root repo: sudo ./deploy/install.sh
set -euo pipefail
WEB=/var/www/counterbuild
OPT=/opt/counterbuild
cd "$(dirname "$0")/.."

install -d -o www-data -g www-data "$WEB" "$WEB/data" "$WEB/icons"
install -m 644 index.html app.js engine.js sw.js manifest.webmanifest "$WEB/"
install -m 644 icons/* "$WEB/icons/"
# Data seed hanya disalin kalau belum ada, supaya hasil sync tidak tertimpa.
for f in data/*.json; do
  [ -e "$WEB/$f" ] || install -o www-data -g www-data -m 644 "$f" "$WEB/$f"
done
# builds.json & items.json kurasi selalu ikut versi repo.
install -o www-data -g www-data -m 644 data/builds.json data/items.json "$WEB/data/"

install -d "$OPT/sync"
install -m 755 sync/sync.py "$OPT/sync/"
install -m 644 deploy/counterbuild-sync.service deploy/counterbuild-sync.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now counterbuild-sync.timer
systemctl start counterbuild-sync.service || echo "Sync pertama gagal, cek: journalctl -u counterbuild-sync"
echo "Selesai. Pasang deploy/nginx-counterbuild.conf, lalu: nginx -t && systemctl reload nginx"
