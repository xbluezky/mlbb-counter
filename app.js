(function () {
  "use strict";
  var E = window.CounterEngine;
  var LANES = E.LANES, LL = E.LANE_LABEL;
  var STORE_KEY = "mlbb-counterbuild:v1";
  var $ = function (id) { return document.getElementById(id); };

  var DATA = null, BY_ID = {};
  var EXAMPLE = {
    me: { lane: "gold", hero: "moskov" },
    enemies: [
      { lane: "exp", hero: "esmeralda", fed: false },
      { lane: "jungle", hero: "lancelot", fed: false },
      { lane: "mid", hero: "valentina", fed: false },
      { lane: "gold", hero: "claude", fed: false },
      { lane: "roam", hero: "estes", fed: false }
    ],
    example: true
  };
  var state = null;

  function blank() {
    return { me: { lane: "gold", hero: null },
      enemies: LANES.map(function (l) { return { lane: l, hero: null, fed: false }; }), example: false };
  }
  function load() {
    try { var s = JSON.parse(localStorage.getItem(STORE_KEY)); if (s && s.me && s.enemies) return s; } catch (e) {}
    return JSON.parse(JSON.stringify(EXAMPLE));
  }
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {} }
  function touch() { state.example = false; save(); render(); }

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function initials(name) {
    var w = name.replace(/[^A-Za-z0-9 .'-]/g, "").split(/[\s.-]+/).filter(Boolean);
    return (w.length > 1 ? w[0][0] + w[1][0] : name.slice(0, 2)).toUpperCase();
  }
  // Gambar di-hotlink; inisial tetap ada di bawahnya sebagai fallback kalau gambar gagal dimuat.
  function pic(src) {
    return src ? '<img class="pic" src="' + esc(src) + '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">' : "";
  }
  function avatar(h) {
    var c = h.dmg === "phys" ? "p" : h.dmg === "magic" ? "m" : "x";
    return '<span class="av ' + c + '" aria-hidden="true">' + esc(initials(h.name)) + pic(h.img) + "</span>";
  }
  function itemIcon(it) {
    var c = { attack: "p", magic: "m", defense: "d", boots: "b" }[it.cat] || "b";
    return '<span class="ic ' + c + '" aria-hidden="true">' + esc(initials(it.name)) + pic(it.img) + "</span>";
  }
  document.addEventListener("error", function (ev) {
    var t = ev.target;
    if (t && t.tagName === "IMG" && t.classList.contains("pic")) t.remove();
  }, true);
  function dmgLabel(h) { return h.dmg === "phys" ? "Fisik" : h.dmg === "magic" ? "Magic" : "Campuran"; }
  function itemName(id) { return (DATA.items[id] && DATA.items[id].name) || id; }

  /* ---------- Draft board ---------- */
  function renderMe() {
    $("me-lanes").innerHTML = LANES.map(function (l) {
      return '<button type="button" class="chip" data-lane="' + l + '" aria-pressed="' + (state.me.lane === l) + '">' + LL[l] + "</button>";
    }).join("");
    var h = BY_ID[state.me.hero];
    var btn = $("me-pick");
    btn.className = "pick" + (h ? " filled" : "");
    btn.innerHTML = h
      ? avatar(h) + '<span class="txt"><span class="nm">' + esc(h.name) + '</span><span class="sub">' + esc(h.roles.join(" / ")) + " · " + dmgLabel(h) + "</span></span>"
      : '<span class="av" aria-hidden="true">+</span><span class="txt"><span class="nm">Pilih hero ' + LL[state.me.lane] + '</span><span class="sub">Tap buat buka daftar hero</span></span>';
    $("me-arch").textContent = h && DATA.builds[h.arch] ? DATA.builds[h.arch].label : "";
  }

  function renderEnemies() {
    $("enemy-rows").innerHTML = state.enemies.map(function (e, i) {
      var h = BY_ID[e.hero];
      var pick = h
        ? avatar(h) + '<span class="txt"><span class="nm">' + esc(h.name) + '</span><span class="sub">' + esc(h.tags.map(function (t) { return E.TAG_LABEL[t] || t; }).join(" · ")) + "</span></span>"
        : '<span class="av" aria-hidden="true">+</span><span class="txt"><span class="nm">Pilih lawan</span><span class="sub">Lane ' + LL[e.lane] + "</span></span>";
      return '<div class="row"><span class="lane-tag">' + LL[e.lane] + '</span>' +
        '<button type="button" class="pick' + (h ? " filled" : "") + '" data-enemy="' + i + '">' + pick + "</button>" +
        '<button type="button" class="fed" data-fed="' + i + '" aria-pressed="' + !!e.fed + '"' + (h ? "" : " disabled") + ' aria-label="Tandai ' + (h ? esc(h.name) : "lawan") + ' fed">FED</button></div>';
    }).join("");
  }

  /* ---------- Result ---------- */
  function renderResult() {
    var me = BY_ID[state.me.hero];
    var box = $("result");
    if (!me) {
      box.innerHTML = '<div class="empty">Pilih hero lu dulu, terus isi hero lawan.<br>Build counter muncul di sini otomatis.</div>';
      return;
    }
    var enemies = state.enemies.map(function (e) { return { hero: BY_ID[e.hero], fed: e.fed, lane: e.lane }; });
    var r = E.recommend({ me: Object.assign({ lane: state.me.lane }, me), enemies: enemies, data: DATA });
    if (!r) { box.innerHTML = '<div class="empty">Build untuk hero ini belum ada di data.</div>'; return; }

    var picked = enemies.filter(function (e) { return e.hero; }).length;
    var head = '<div class="r-head"><div><h2>Build ' + esc(me.name) + "</h2><p>" + esc(r.arch.label) + " · " + LL[state.me.lane] + " · lawan " + picked + "/5</p></div>" +
      (state.example ? '<span class="example">Contoh draft</span>' : "") + "</div>";

    var STL = { core: "Core", fit: "Cocok", counter: "Counter" };
    var slots = '<ol class="build">' + r.slots.map(function (s, i) {
      var it = DATA.items[s.id] || { name: s.id, desc: "" };
      var was = s.status === "counter" && s.base !== s.id ? '<span class="was">ganti <s>' + esc(itemName(s.base)) + "</s></span>" : "";
      return '<li class="slot ' + s.status + '"><span class="no"><span>' + (i + 1) + '</span><span class="st ' + s.status + '">' + STL[s.status] + "</span></span>" +
        '<span class="it-row">' + itemIcon(it) + '<span class="it">' + esc(it.name) + "</span></span>" +
        '<span class="ds">' + esc(it.desc || "") + "</span>" + was + "</li>";
    }).join("") + "</ol>";

    var p = r.profile;
    var meter = "";
    if (picked) {
      var ph = Math.round(p.physShare * 100), mg = 100 - ph;
      meter = '<div class="sec"><h3>Damage lawan</h3><div class="meter" role="img" aria-label="Fisik ' + ph + " persen, magic " + mg + ' persen"><span class="ph" style="width:' + ph + '%"></span><span class="mg" style="width:' + mg + '%"></span></div>' +
        '<div class="meter-lbl"><span class="a">Fisik ' + ph + '%</span><span class="b">Magic ' + mg + "%</span></div></div>";
      var th = [
        ["Heal/shield", p.heal + p.shield, 1.5, 2.5], ["Burst", p.burstP + p.burstM, 1.5, 2.5], ["CC", p.cc, 2, 3],
        ["Tanky", p.tank, 1.5, 2.5], ["Crit/AS", p.crit, 1.5, 2.5], ["Diver", p.dive, 2, 3]
      ];
      meter += '<div class="sec"><h3>Ancaman</h3><div class="threats">' + th.map(function (t) {
        var lv = E.level(t[1], t[2], t[3]);
        return '<span class="th ' + lv + '">' + t[0] + " <b>" + (Math.round(t[1] * 10) / 10) + "</b></span>";
      }).join("") + "</div></div>";
    }

    var reasons = r.slots.filter(function (s) { return s.status !== "core" && s.reasons.length; });
    var why = reasons.length
      ? '<div class="sec"><h3>Kenapa</h3><ul class="why">' + reasons.map(function (s) {
          return "<li><b>" + esc(itemName(s.id)) + "</b>: " + esc(s.reasons.filter(function (x, i, a) { return a.indexOf(x) === i; }).join(" ")) + "</li>";
        }).join("") + "</ul></div>"
      : (picked ? '<div class="sec"><h3>Kenapa</h3><p class="notes">Komposisi lawan belum butuh item counter khusus. Pakai build core.</p></div>' : "");

    var notes = r.notes.length ? '<div class="sec"><h3>Catatan</h3><ul class="notes">' + r.notes.map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("") + "</ul></div>" : "";
    var rev = me.review ? '<div class="sec"><ul class="notes"><li>Data ' + esc(me.name) + " masih perlu dicek ulang setelah patch terbaru.</li></ul></div>" : "";

    box.innerHTML = head + slots + meter + why + notes + rev;
  }

  function render() { renderMe(); renderEnemies(); renderResult(); }

  /* ---------- Picker ---------- */
  var pk = { target: null, lane: "all" };
  function openPicker(target) {
    pk.target = target;
    var lane = target === "me" ? state.me.lane : state.enemies[target].lane;
    pk.lane = lane;
    $("pk-title").textContent = target === "me" ? "Hero lu" : "Lawan · " + LL[lane];
    $("pk-q").value = "";
    renderPicker();
    var d = $("picker");
    if (d.showModal) d.showModal(); else d.setAttribute("open", "");
    // Di HP jangan langsung buka keyboard; tap ikon hero lebih cepat saat draft.
    if (window.matchMedia && window.matchMedia("(pointer: fine)").matches) setTimeout(function () { $("pk-q").focus(); }, 30);
  }
  function closePicker() { var d = $("picker"); if (d.close) d.close(); else d.removeAttribute("open"); }

  function renderPicker() {
    $("pk-lanes").innerHTML = ["all"].concat(LANES).map(function (l) {
      return '<button type="button" class="chip" data-pl="' + l + '" aria-pressed="' + (pk.lane === l) + '">' + (l === "all" ? "Semua" : LL[l]) + "</button>";
    }).join("");
    var q = $("pk-q").value.trim().toLowerCase();
    var taken = {};
    if (state.me.hero) taken[state.me.hero] = "me";
    state.enemies.forEach(function (e, i) { if (e.hero) taken[e.hero] = i; });
    var list = DATA.heroes.filter(function (h) {
      if (q) return h.name.toLowerCase().indexOf(q) >= 0;
      return pk.lane === "all" || h.lanes.indexOf(pk.lane) >= 0;
    });
    // Di draft ranked, hero yang sama tidak bisa dipakai dua kali di satu tim.
    var sameTeam = function (h) {
      var t = taken[h.id];
      if (t === undefined || t === pk.target) return false;
      return pk.target === "me" ? false : t !== "me";
    };
    $("pk-grid").innerHTML = list.length ? list.map(function (h) {
      var dis = sameTeam(h);
      return '<button type="button" class="hb" data-hero="' + h.id + '"' + (dis ? " disabled" : "") + ">" + avatar(h) + "<span>" + esc(h.name) + "</span></button>";
    }).join("") : '<p class="pk-none">Hero tidak ketemu. Coba ketik nama lain atau pilih "Semua".</p>';
  }

  /* ---------- Events ---------- */
  function bind() {
    $("me-lanes").addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-lane]"); if (!b) return;
      state.me.lane = b.dataset.lane;
      var h = BY_ID[state.me.hero];
      if (h && h.lanes.indexOf(state.me.lane) < 0) state.me.hero = null;
      touch();
      if (!state.me.hero) openPicker("me");
    });
    $("me-pick").addEventListener("click", function () { openPicker("me"); });
    $("enemy-rows").addEventListener("click", function (ev) {
      var f = ev.target.closest("[data-fed]");
      if (f) { var e = state.enemies[+f.dataset.fed]; e.fed = !e.fed; touch(); return; }
      var p = ev.target.closest("[data-enemy]");
      if (p) openPicker(+p.dataset.enemy);
    });
    $("pk-lanes").addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-pl]"); if (!b) return;
      pk.lane = b.dataset.pl; $("pk-q").value = ""; renderPicker();
    });
    $("pk-q").addEventListener("input", renderPicker);
    $("pk-grid").addEventListener("click", function (ev) {
      var b = ev.target.closest("[data-hero]"); if (!b || b.disabled) return;
      var id = b.dataset.hero;
      if (pk.target === "me") state.me.hero = id;
      else { state.enemies[pk.target].hero = id; state.enemies[pk.target].fed = false; }
      closePicker();
      touch();
      // Lanjut otomatis ke slot lawan kosong berikutnya biar input draft cepat.
      if (pk.target !== "me") {
        for (var k = pk.target + 1; k < state.enemies.length; k++) if (!state.enemies[k].hero) { openPicker(k); return; }
      }
    });
    $("pk-close").addEventListener("click", closePicker);
    $("picker").addEventListener("click", function (ev) { if (ev.target === ev.currentTarget) closePicker(); });
    $("btn-clear").addEventListener("click", function () {
      // Hero lu dipertahankan (kecuali masih contoh), lawan dikosongkan untuk match berikutnya.
      var lane = state.me.lane, hero = state.example ? null : state.me.hero;
      state = blank();
      state.me.lane = lane; state.me.hero = hero;
      save(); render();
    });
  }

  function renderFoot() {
    var m = DATA.meta || {};
    $("patch").textContent = "Patch " + (m.patch || "?") + (m.synced_at ? " · sync " + m.synced_at.slice(0, 10) : " · data awal");
    $("foot").innerHTML = "Rekomendasi berbasis aturan dari tipe damage dan karakter hero lawan, bukan statistik match. " +
      "Nama & efek item diringkas; cek detail di dalam game. Data roster & item: komunitas (Mobile Legends Wiki, CC BY-SA). " +
      "Mobile Legends: Bang Bang milik Moonton; ini proyek fan, tidak berafiliasi." +
      (m.missing_items && m.missing_items.length ? " <b>Sync terakhir: " + m.missing_items.length + " item di build tidak ada di katalog patch ini, cek data/items.json.</b>" : "");
  }

  function getJSON(p) { return fetch(p, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(p + " " + r.status); return r.json(); }); }

  Promise.all(["data/heroes.json", "data/items.json", "data/builds.json", "data/meta.json"].map(getJSON))
    .then(function (res) {
      DATA = { heroes: res[0].slice().sort(function (a, b) { return a.name.localeCompare(b.name); }), items: res[1], builds: res[2], meta: res[3] };
      DATA.heroes.forEach(function (h) { BY_ID[h.id] = h; });
      state = load();
      bind(); renderFoot(); render();
    })
    .catch(function (err) {
      $("result").innerHTML = '<div class="empty">Data gagal dimuat (' + esc(err.message) + "). Pastikan folder <code>data/</code> ikut ter-deploy.</div>";
    });

  try {
    if ("serviceWorker" in navigator && location.protocol === "https:" && !/claude/.test(location.hostname)) {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    }
  } catch (e) {}
})();
