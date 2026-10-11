# MLBB Counter Build

Web app statis buat nentuin build item counter di Mobile Legends: pilih role + hero lu, isi 5 hero lawan per lane, dan build langsung menyesuaikan. Bisa dibuka di laptop atau di-install ke HP sebagai PWA (Add to Home Screen) supaya cepat diakses pas draft pick.

## Cara kerja

1. Tiap hero punya **tipe damage** (fisik / magic / campuran), **tag** karakter (heal, shield, burst, dps, crit, atkspd, tank, cc, dive, poke, true) dan **archetype build** (mis. `mm_crit`, `mage_burst`, `tank_roam`).
2. Archetype memberi 6 item core + slot mana yang boleh diganti (`flex`).
3. `engine.js` menghitung profil ancaman tim lawan (porsi damage fisik/magic, jumlah heal, burst, CC, tank, dsb.). Tombol **FED** menggandakan bobot hero itu.
4. Aturan counter dipilih berdasarkan skor, lalu:
   - item core yang sudah meng-counter ditandai **Cocok**,
   - slot flex diganti item **Counter** (dengan batas slot defensif untuk carry: 1, atau 2 kalau ada lawan fed),
   - boots ikut menyesuaikan (Tough Boots vs CC/magic berat, Warrior Boots vs fisik berat).

Build item ini rule-based, bukan statistik win rate.

### Rekomendasi pick (last pick)

Begitu hero lawan diisi, panel **Rekomendasi pick** menampilkan 6 hero terbaik untuk lane lu:

- **Counter statistik** dari `data/counters.json`: selisih win rate hero kandidat saat ketemu tiap lawan (per rank: Semua, Epic, Legend, Mythic, Honor, Glory). Lawan di lane yang sama dengan lu dihitung **dobel**, lawan FED ×1,5.
- **Aturan komposisi**: misalnya hero ber-CC dapat nilai tambah lawan tim diver, hero damage konsisten lawan tim tanky.
- **Win rate patch** hero itu sebagai pemberat kecil.

Tap kandidat untuk langsung pakai hero itu; build item ikut menyesuaikan.

### Tim lu

Panel **Tim lu** (opsional) berisi 4 teman di lane selain lane lu. Dipakai untuk:

- **Sinergi statistik**: kandidat yang win rate-nya naik kalau main bareng teman lu dapat nilai tambah (data `t` di `counters.json`).
- **Keseimbangan tim** (minimal 2 teman terisi): tim berat fisik → kandidat magic dinaikkan (dan sebaliknya), tim tanpa frontline → tank dinaikkan, tim tanpa CC → hero ber-CC dinaikkan.
- **Build**: kalau 3+ teman terisi dan tidak ada frontline, carry dapat satu slot defensif tambahan.
- Hero yang sudah dipakai teman tidak muncul di rekomendasi dan tidak bisa dipilih lagi.

## Struktur

```
index.html            UI
app.js                state, picker, render
engine.js             rule engine (murni, bisa dites di Node)
sw.js                 service worker (offline + cache)
manifest.webmanifest  PWA
data/heroes.json      roster + tag + archetype  (diperbarui sync untuk hero baru)
data/items.json       item kurasi (nama, kategori, efek ringkas)
data/builds.json      archetype build
data/meta.json        versi patch, waktu sync, hero baru, item hilang
data/counters.json    counter & win rate per rank (statistik match)
sync/sync.py          tarik data dari API komunitas (stdlib saja)
deploy/               systemd unit + timer, config nginx, install.sh
```

## Deploy ke GitHub Pages (paling gampang)

```bash
git init && git add . && git commit -m "init counter build"
git branch -M main
git remote add origin git@github.com:<user>/mlbb-counter.git
git push -u origin main
```

Di GitHub:

1. **Settings → Pages** → Source: *Deploy from a branch* → `main` / `(root)` → Save. Situs jadi di `https://<user>.github.io/mlbb-counter/`.
2. **Settings → Actions → General → Workflow permissions** → *Read and write permissions* (supaya workflow sync boleh commit).
3. **Actions → Sync data MLBB → Run workflow** sekali buat tes. Setelah itu jalan otomatis tiap hari 04:17 WIB.

Workflow cuma commit kalau datanya beneran berubah, dan tiap commit otomatis bikin Pages rebuild. GitHub bisa menonaktifkan workflow terjadwal di repo publik yang 60 hari tanpa aktivitas; kalau itu terjadi, aktifkan lagi dari tab Actions.

## Deploy (Ubuntu + nginx)

```bash
sudo ./deploy/install.sh
sudo cp deploy/nginx-counterbuild.conf /etc/nginx/sites-available/counterbuild
# edit server_name + path sertifikat, lalu:
sudo ln -s /etc/nginx/sites-available/counterbuild /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

PWA dan service worker butuh HTTPS.

## Sync data

```bash
python3 sync/sync.py --data-dir /var/www/counterbuild/data --dry-run   # lihat perubahan
systemctl list-timers counterbuild-sync.timer                          # jadwal harian 04:17 + jitter
journalctl -u counterbuild-sync -n 50                                  # log
```

Sumber counter: `statistics.json` dari repo publik MLBBDex (dikumpulkan dari stats API arena.rone.dev, diperbarui mereka sekitar mingguan). URL bisa diganti lewat env `STATS_URL`.

Sumber roster & item: API publik MLBBDex (`https://mlbbdex.com/api/v1/...`), yang datanya berasal dari Mobile Legends Wiki (CC BY-SA). Limit 90 request/menit; sync cuma butuh 3 request. Base URL bisa diganti lewat env `MLBBDEX_BASE`.

Yang dilakukan sync:

- Hero baru ditambahkan dengan tag default dari role dan `review: true`. **Cek dan perbaiki tag/archetype-nya manual** (lihat `meta.json` → `new_heroes`).
- Item kurasi yang namanya tidak lagi ada di katalog dicatat di `meta.json` → `missing_items`, dan web menampilkan peringatan di footer.
- Data kurasi yang sudah ada tidak pernah ditimpa. Tiap tulis ada backup `.bak`.
- Kalau API down, sync keluar dengan kode 2 dan data lama tetap dipakai.

## Gambar hero & item

Ikon hero dan item di-hotlink dari MLBBDex (`https://mlbbdex.com/visuels/...`) lewat field `img` di `data/heroes.json` dan `data/items.json`. Sync otomatis mengisi `img` untuk hero/item baru. Kalau gambar gagal dimuat, UI balik ke avatar inisial.

Gambar-gambar itu aset milik Moonton (diambil MLBBDex dari wiki komunitas). Pakai untuk proyek fan non-komersial, dan hapus kalau pemegang hak meminta. Mau pakai sumber lain? Ganti saja URL di field `img`.

## Edit data manual

- Tag/archetype hero: `data/heroes.json`. Hero dengan `"review": true` ditandai di UI.
- Build per archetype: `data/builds.json`. `flex` = indeks slot (0 = boots) yang boleh diganti counter.
- Aturan counter: fungsi `rules()` di `engine.js`.

Catatan: `install.sh` tidak menimpa `heroes.json` di server (supaya hasil sync aman). Kalau lu ubah tag di repo, salin manual ke `/var/www/counterbuild/data/`.

Tes engine cepat:

```bash
node -e "const E=require('./engine.js');const d=f=>require('./data/'+f);const data={heroes:d('heroes.json'),items:d('items.json'),builds:d('builds.json')};const H=n=>data.heroes.find(h=>h.name===n);console.log(E.recommend({me:{...H('Layla'),lane:'gold'},enemies:['Esmeralda','Lancelot','Valentina','Claude','Estes'].map(n=>({hero:H(n)})),data}).slots.map(s=>s.id))"
```

---
Proyek fan, tidak berafiliasi dengan Moonton. Mobile Legends: Bang Bang adalah merek dagang Shanghai Moonton Technology.
