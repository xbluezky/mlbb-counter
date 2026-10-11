#!/usr/bin/env python3
"""
Sync roster hero, katalog item, dan versi patch MLBB dari API komunitas (MLBBDex)
ke data/*.json milik Counter Build.

- Hanya stdlib Python 3.8+.
- Data kurasi (tags, archetype, tipe damage) TIDAK ditimpa. Sync cuma:
    * menambah hero baru (ditandai review=true, tags default dari role),
    * mengisi role/lane kalau kosong,
    * menandai item kurasi yang sudah tidak ada di katalog (kemungkinan dihapus/di-rename patch),
    * mencatat versi patch & waktu sync di meta.json.
- Tulis atomik + backup .bak, jadi web tidak pernah membaca file setengah jadi.

Pakai:
  python3 sync.py --data-dir /var/www/counterbuild/data
  python3 sync.py --data-dir ./data --dry-run
"""
import argparse
import datetime as dt
import json
import os
import re
import shutil
import sys
import tempfile
import time
import urllib.error
import urllib.request

BASE = os.environ.get("MLBBDEX_BASE", "https://mlbbdex.com")
UA = "CounterBuild-sync/1.0 (+personal fan project)"

# Nama route EN dulu, fallback ke nama lama (FR).
ROUTES = {
    "heroes": ["/api/v1/heroes", "/api/v1/heros"],
    "items": ["/api/v1/items", "/api/v1/objets"],
    "patches": ["/api/v1/patches", "/api/v1/patchs"],
}

LANE_MAP = {
    "gold": "gold", "or": "gold", "gold lane": "gold",
    "jungle": "jungle", "jungler": "jungle",
    "mid": "mid", "milieu": "mid", "mid lane": "mid",
    "exp": "exp", "experience": "exp", "exp lane": "exp",
    "roam": "roam", "roamer": "roam",
}
ROLE_NAMES = {"tank": "Tank", "fighter": "Fighter", "assassin": "Assassin", "mage": "Mage",
              "marksman": "Marksman", "support": "Support"}

# Default untuk hero baru, berdasarkan role utama. Dicek manual setelahnya (review=true).
ROLE_DEFAULTS = {
    "Marksman": ("phys", ["dps", "atkspd"], "mm_crit"),
    "Mage": ("magic", ["burst", "poke"], "mage_burst"),
    "Assassin": ("phys", ["burst", "dive"], "phys_assassin"),
    "Fighter": ("phys", ["dps"], "fighter_phys"),
    "Tank": ("phys", ["tank", "cc"], "tank_roam"),
    "Support": ("magic", ["heal"], "support_heal"),
}


def log(*a):
    print("[sync]", *a, file=sys.stderr)


def norm(s):
    return re.sub(r"[^a-z0-9]", "", str(s).lower())


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", str(s).lower()).strip("-")


def get_json(path, retries=3):
    url = BASE + path
    for attempt in range(retries):
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code == 429:
                wait = int(e.headers.get("Retry-After") or 30)
                log(f"429 rate-limited, tunggu {wait}s")
                time.sleep(min(wait, 120))
                continue
            log(f"HTTP {e.code} di {url}")
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            log(f"gagal {url}: {e}")
        time.sleep(2 * (attempt + 1))
    return None


def fetch(kind):
    for path in ROUTES[kind]:
        body = get_json(path)
        if body is None:
            continue
        data = body.get("data") if isinstance(body, dict) else body
        total = body.get("total") if isinstance(body, dict) else None
        if isinstance(data, list) and isinstance(total, int) and total > len(data):
            # Respons terpotong: coba minta semua sekaligus.
            more = get_json(f"{path}?limit={total}")
            if isinstance(more, dict) and isinstance(more.get("data"), list) and len(more["data"]) > len(data):
                data = more["data"]
            else:
                log(f"PERINGATAN {kind}: cuma {len(data)} dari {total} entri terbaca")
        if isinstance(data, list):
            log(f"{kind}: {len(data)} entri dari {path}")
            return data
    raise RuntimeError(f"tidak bisa ambil {kind} dari {BASE}")


def pick(obj, *keys):
    for k in keys:
        if isinstance(obj, dict) and obj.get(k) not in (None, "", []):
            return obj[k]
    return None


def as_list(v):
    if v is None:
        return []
    if isinstance(v, (str, dict)):
        v = [v]
    out = []
    for x in v:
        if isinstance(x, dict):
            x = pick(x, "name", "label", "nom", "slug", "id")
        if x:
            out.append(str(x))
    return out


def text_of(v):
    if isinstance(v, dict):
        return pick(v, "en", "name", "label", "nom") or ""
    return v or ""


def load(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def write_atomic(path, obj):
    d = os.path.dirname(os.path.abspath(path))
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".tmp-", suffix=".json")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    os.chmod(tmp, 0o644)
    if os.path.exists(path):
        shutil.copy2(path, path + ".bak")
    os.replace(tmp, path)


def merge_heroes(local, remote):
    by_norm = {norm(h["name"]): h for h in local}
    added, updated = [], []
    for r in remote:
        name = text_of(pick(r, "name", "nom", "title"))
        if not name:
            continue
        roles = [ROLE_NAMES[x.lower()] for x in as_list(pick(r, "roles", "role", "classes")) if x.lower() in ROLE_NAMES]
        lanes = [LANE_MAP[x.lower()] for x in as_list(pick(r, "lanes", "lane", "voies", "positions")) if x.lower() in LANE_MAP]
        h = by_norm.get(norm(name))
        if h:
            changed = False
            if roles and not h.get("roles"):
                h["roles"] = roles; changed = True
            if lanes and not h.get("lanes"):
                h["lanes"] = sorted(set(lanes), key=lanes.index); changed = True
            if changed:
                updated.append(name)
            continue
        main = roles[0] if roles else "Fighter"
        dmg, tags, arch = ROLE_DEFAULTS.get(main, ROLE_DEFAULTS["Fighter"])
        new = {
            "id": slug(name), "name": name,
            "lanes": lanes or ["exp"], "roles": roles or ["Fighter"],
            "dmg": dmg, "tags": list(tags), "arch": arch,
            "source": "sync", "review": True,
        }
        local.append(new)
        by_norm[norm(name)] = new
        added.append(name)
    local.sort(key=lambda h: h["name"].lower())
    return added, updated


def check_items(items, remote):
    names = {norm(text_of(pick(r, "name", "nom", "title"))) for r in remote}
    names.discard("")
    if len(names) < 30:
        # Katalog terlalu kecil = kemungkinan respons parsial; jangan tandai item hilang.
        log(f"katalog item cuma {len(names)} entri, cek item dilewati")
        return []
    return [iid for iid, it in items.items() if norm(it["name"]) not in names]


def latest_patch(remote):
    best = None
    for p in remote or []:
        ver = text_of(pick(p, "version", "name", "numero", "title", "slug"))
        date = text_of(pick(p, "date", "releaseDate", "release_date", "publishedAt"))
        m = re.search(r"\d+\.\d+\.\d+[a-z]?", str(ver))
        if not m:
            continue
        key = (str(date)[:10], tuple(int(x) for x in re.findall(r"\d+", m.group(0))))
        if best is None or key > best[0]:
            best = (key, m.group(0), str(date)[:10] or None)
    return (best[1], best[2]) if best else (None, None)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", default=os.path.join(os.path.dirname(__file__), "..", "data"))
    ap.add_argument("--dry-run", action="store_true", help="tampilkan perubahan tanpa menulis file")
    a = ap.parse_args()
    d = a.data_dir

    heroes = load(os.path.join(d, "heroes.json"), [])
    items = load(os.path.join(d, "items.json"), {})
    meta = load(os.path.join(d, "meta.json"), {})

    try:
        r_heroes = fetch("heroes")
        r_items = fetch("items")
    except RuntimeError as e:
        log(str(e), "- data lama dipertahankan")
        return 2
    try:
        r_patches = fetch("patches")
    except RuntimeError:
        r_patches = []

    added, updated = merge_heroes(heroes, r_heroes)
    missing = check_items(items, r_items)
    patch, pdate = latest_patch(r_patches)

    meta.update({
        "synced_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "source": BASE + " (Mobile Legends Wiki, CC BY-SA)",
        "new_heroes": sorted(set(meta.get("new_heroes", []) + added)),
        "missing_items": missing,
    })
    if patch:
        meta["patch"], meta["patch_date"] = patch, pdate

    log(f"hero baru: {added or '-'}")
    log(f"hero dilengkapi: {updated or '-'}")
    log(f"item kurasi tidak ditemukan di katalog: {missing or '-'}")
    log(f"patch: {meta.get('patch')} ({meta.get('patch_date')})")

    if a.dry_run:
        log("dry-run: tidak ada file ditulis")
        return 0
    write_atomic(os.path.join(d, "heroes.json"), heroes)
    write_atomic(os.path.join(d, "meta.json"), meta)
    log("selesai")
    return 0


if __name__ == "__main__":
    sys.exit(main())
