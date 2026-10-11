/* Counter-build engine. Pure functions, no DOM. Works in browser (window.CounterEngine) and Node (module.exports). */
(function (root) {
  "use strict";

  var LANES = ["exp", "jungle", "mid", "gold", "roam"];
  var LANE_LABEL = { exp: "EXP", jungle: "Jungle", mid: "Mid", gold: "Gold", roam: "Roam" };

  // Item yang saling menggantikan: cukup satu per grup.
  var GROUPS = {
    antiheal: ["sea_halberd", "glowing_wand", "dominance_ice"],
    immune: ["wind_of_nature", "winter_crown"],
    magicdef: ["valkyries_shield", "radiant_armor"]
  };
  function groupOf(id) {
    for (var g in GROUPS) if (GROUPS[g].indexOf(id) >= 0) return g;
    return null;
  }

  // Item defensif (dihitung ke batas slot defensif untuk carry).
  var DEF_ITEMS = ["valkyries_shield", "radiant_armor", "antique_cuirass", "blade_armor", "dominance_ice",
    "brute_force_breastplate", "chastise_pauldron", "oracle", "thunder_belt", "guardian_helmet", "immortality",
    "queens_wings", "wind_of_nature", "winter_crown", "rose_gold_meteor"];

  function profile(enemies) {
    var p = { n: 0, phys: 0, magic: 0, heal: 0, shield: 0, burstP: 0, burstM: 0, dpsP: 0, dpsM: 0,
      crit: 0, tank: 0, cc: 0, dive: 0, trueDmg: 0, poke: 0, fed: 0, physShare: 0, magicShare: 0 };
    enemies.forEach(function (e) {
      if (!e || !e.hero) return;
      var h = e.hero, w = e.fed ? 2 : 1, t = h.tags || [];
      var has = function (x) { return t.indexOf(x) >= 0; };
      var ph = h.dmg === "phys" ? 1 : h.dmg === "mixed" ? 0.5 : 0;
      var mg = 1 - ph;
      // Tank/support menyumbang damage lebih kecil.
      var dw = (h.roles || []).some(function (r) { return r === "Tank" || r === "Support"; }) ? 0.5 : 1;
      p.n += 1; if (e.fed) p.fed += 1;
      p.phys += ph * w * dw; p.magic += mg * w * dw;
      if (has("heal")) p.heal += w;
      if (has("shield")) p.shield += 0.5 * w;
      if (has("burst")) { p.burstP += ph * w; p.burstM += mg * w; }
      if (has("dps")) { p.dpsP += ph * w; p.dpsM += mg * w; }
      if (has("crit") || has("atkspd")) p.crit += (has("crit") && has("atkspd") ? 1.3 : 1) * w;
      if (has("tank")) p.tank += w;
      if (has("cc")) p.cc += w;
      if (has("dive")) p.dive += w;
      if (has("true")) p.trueDmg += w;
      if (has("poke")) p.poke += w;
    });
    var tot = p.phys + p.magic;
    p.physShare = tot ? p.phys / tot : 0.5;
    p.magicShare = tot ? p.magic / tot : 0.5;
    return p;
  }

  // Aturan counter. item: map kind -> item id (atau array prioritas).
  function rules(p) {
    var heal = p.heal + p.shield;
    return [
      { id: "antiheal", score: heal >= 1.5 ? 1 + heal * 0.9 : 0,
        item: { carry_phys: "sea_halberd", bruiser_phys: "sea_halberd", carry_magic: "glowing_wand",
          bruiser_magic: "glowing_wand", frontline: "dominance_ice", support: "dominance_ice" },
        why: "Lawan punya banyak heal/shield/lifesteal. Anti-heal motong sustain mereka." },
      { id: "pen", score: p.tank >= 1.5 ? p.tank * 1.0 : 0,
        item: { carry_phys: ["malefic_roar", "demon_hunter_sword"], bruiser_phys: ["malefic_roar"],
          carry_magic: ["divine_glaive", "wishing_lantern"], bruiser_magic: ["divine_glaive"] },
        why: "Lawan tebal (banyak tank). Butuh penetration atau damage berbasis HP." },
      { id: "magicburst", score: p.burstM >= 1.5 ? p.burstM * 1.1 + p.magicShare : 0,
        item: { all: "valkyries_shield" },
        why: "Banyak burst magic. Valkyrie's Shield motong damage magic 25% pas lagi dikombo." },
      { id: "magicdps", score: p.dpsM >= 1.5 ? p.dpsM * 0.9 + p.magicShare : 0,
        item: { frontline: "radiant_armor", support: "radiant_armor", bruiser_phys: "radiant_armor",
          bruiser_magic: "radiant_armor", carry_phys: "valkyries_shield", carry_magic: "valkyries_shield" },
        why: "Damage magic lawan datang terus-menerus. Magic def yang menumpuk lebih awet." },
      { id: "physburst", score: (p.burstP + p.dive * 0.6) >= 2 ? p.burstP + p.dive * 0.6 : 0,
        item: { carry_phys: "wind_of_nature", carry_phys_nonmm: "rose_gold_meteor", carry_magic: "winter_crown", bruiser_phys: "antique_cuirass",
          bruiser_magic: "antique_cuirass", frontline: "antique_cuirass", support: "antique_cuirass" },
        why: "Banyak assassin/diver fisik. Item aktif kebal atau physical def biar nggak kena one-shot." },
      { id: "crit", score: p.crit >= 1.5 ? p.crit * 1.0 : 0,
        item: { carry_phys: "wind_of_nature", carry_phys_nonmm: "rose_gold_meteor", carry_magic: "winter_crown",
          bruiser_phys: ["chastise_pauldron", "blade_armor"], bruiser_magic: ["chastise_pauldron", "blade_armor"],
          frontline: ["chastise_pauldron", "blade_armor"], support: "dominance_ice" },
        why: "Lawan mengandalkan crit/attack speed. Chastise Pauldron motong attack speed penyerang, Blade Armor mantulin basic attack." },
      { id: "physheavy", score: p.physShare >= 0.62 ? p.physShare * 2.2 : 0,
        item: { frontline: "antique_cuirass", support: "antique_cuirass", bruiser_phys: "antique_cuirass",
          bruiser_magic: "antique_cuirass" },
        why: "Mayoritas damage lawan fisik." },
      { id: "magicheavy", score: p.magicShare >= 0.55 ? p.magicShare * 2.2 : 0,
        item: { frontline: "valkyries_shield", support: "valkyries_shield", bruiser_phys: "valkyries_shield",
          bruiser_magic: "valkyries_shield" },
        why: "Mayoritas damage lawan magic." },
      { id: "fed", score: p.fed > 0 ? 1.4 + p.fed * 1.3 : 0,
        item: { all: "immortality" },
        why: "Ada lawan yang fed. Immortality kasih nyawa kedua buat team fight penentu." }
    ];
  }

  function pickItem(rule, kind, me) {
    // Wind of Nature cuma 1 detik kalau bukan Marksman: carry fisik non-MM pakai alternatif.
    var isMM = me && (me.roles || [])[0] === "Marksman";
    var it = (kind === "carry_phys" && !isMM && rule.item.carry_phys_nonmm) || rule.item[kind] || rule.item.all;
    if (!it) return [];
    return Array.isArray(it) ? it : [it];
  }

  function bootsFor(kind, base, p) {
    var heavyCC = p.cc >= 3, magicHeavy = p.magicShare >= 0.5, physHeavy = p.physShare >= 0.65;
    if (kind === "frontline" || kind === "support" || kind === "bruiser_phys" || kind === "bruiser_magic") {
      if (heavyCC || magicHeavy) return { id: "tough_boots", why: heavyCC ? "CC lawan berat." : "Damage lawan dominan magic." };
      if (physHeavy) return { id: "warrior_boots", why: "Damage lawan dominan fisik." };
      return null;
    }
    if (p.cc >= 3.5) return { id: "tough_boots", why: "CC lawan sangat berat; Tough Boots biar nggak dikunci terus." };
    return null;
  }

  function recommend(opts) {
    var me = opts.me, data = opts.data;
    if (!me || !data.builds[me.arch]) return null;
    var arch = data.builds[me.arch];
    var kind = arch.kind;
    var enemies = (opts.enemies || []).filter(function (e) { return e && e.hero; });
    var p = profile(enemies);

    var slots = arch.items.map(function (id, i) {
      return { id: id, base: id, status: "core", reasons: [], flex: arch.flex.indexOf(i) >= 0 };
    });

    var isCarry = kind === "carry_phys" || kind === "carry_magic";
    var team = teamProfile(opts.allies);
    var noFront = team.n >= 3 && team.front === 0;
    var defCap = isCarry ? (p.fed > 0 || noFront ? 2 : 1) : kind.indexOf("bruiser") === 0 ? 2 : 9;
    var defUsed = 0; // jumlah item defensif yang DITAMBAHKAN lewat swap

    var applied = [];
    var cands = rules(p).filter(function (r) { return r.score >= 1.2; })
      .sort(function (a, b) { return b.score - a.score; });

    function slotWith(id) {
      for (var i = 0; i < slots.length; i++) if (slots[i].id === id) return i;
      return -1;
    }
    function slotWithGroup(g) {
      if (!g) return -1;
      for (var i = 0; i < slots.length; i++) if (groupOf(slots[i].id) === g) return i;
      return -1;
    }
    function freeFlex() {
      for (var i = slots.length - 1; i >= 1; i--) {
        var s = slots[i];
        if (s.flex && s.status === "core") return i;
      }
      return -1;
    }

    // Pass 1: item bawaan yang sudah meng-counter dikunci dulu, supaya tidak tertimpa swap.
    var pending = [];
    cands.forEach(function (r) {
      var list = pickItem(r, kind, me);
      if (!list.length) return;
      for (var k = 0; k < list.length; k++) {
        var at = slotWith(list[k]);
        if (at < 0) at = slotWithGroup(groupOf(list[k]));
        if (at >= 0) {
          var s = slots[at];
          if (s.status === "core") s.status = "fit";
          s.reasons.push(r.why);
          applied.push({ rule: r.id, item: s.id, mode: "kept", score: r.score });
          return;
        }
      }
      pending.push(r);
    });

    // Pass 2: swap slot fleksibel untuk counter yang belum tertutup.
    pending.forEach(function (r) {
      var list = pickItem(r, kind, me);
      var done = false;
      list.forEach(function (id) {
        if (done) return;
        var at = slotWith(id);
        if (at < 0) at = slotWithGroup(groupOf(id));
        if (at >= 0) {
          slots[at].reasons.push(r.why);
          applied.push({ rule: r.id, item: slots[at].id, mode: "kept", score: r.score });
          done = true; return;
        }
        var isDef = DEF_ITEMS.indexOf(id) >= 0;
        if (isDef && defUsed >= defCap) return;
        var free = freeFlex();
        if (free < 0) return;
        slots[free].id = id;
        slots[free].status = "counter";
        slots[free].reasons.push(r.why);
        if (isDef) defUsed += 1;
        applied.push({ rule: r.id, item: id, mode: "swap", replaced: slots[free].base, score: r.score });
        done = true;
      });
    });

    var boots = bootsFor(kind, slots[0].id, p);
    if (boots && boots.id !== slots[0].id) {
      slots[0].id = boots.id; slots[0].status = "counter"; slots[0].reasons.push(boots.why);
    }

    var notes = [];
    var lane = me.lane;
    if (lane === "jungle") notes.push("Jungle: pasang blessing jungle di boots.");
    if (lane === "roam") notes.push("Roam: pasang blessing roam di boots.");
    if (p.trueDmg >= 2) notes.push("Lawan punya banyak true damage; def biasa kurang ngefek, utamakan HP.");
    if (p.poke >= 3) notes.push("Komposisi lawan poke. Main dari semak & cari engage cepat.");
    if (noFront && kind !== "frontline" && kind !== "support")
      notes.push("Tim lu nggak punya frontline. Slot defensif ditambah satu; jangan maju duluan pas war.");
    if (team.n >= 3 && team.heal === 0 && (kind === "frontline" || kind === "bruiser_phys" || kind === "bruiser_magic"))
      notes.push("Tim tanpa healer: item ber-sustain (Oracle, lifesteal) lebih berharga.");
    if (enemies.length < 5) notes.push("Baru " + enemies.length + " dari 5 lawan diisi. Rekomendasi makin akurat kalau lengkap.");

    return { arch: arch, kind: kind, profile: p, slots: slots, applied: applied, notes: notes };
  }

  // Ringkasan ancaman per hero lawan.
  var TAG_LABEL = { heal: "Heal", shield: "Shield", burst: "Burst", dps: "Sustain dmg", crit: "Crit",
    atkspd: "Attack speed", tank: "Tanky", cc: "CC", dive: "Diver", poke: "Poke", "true": "True dmg" };

  function level(v, lo, hi) { return v >= hi ? "tinggi" : v >= lo ? "sedang" : "rendah"; }

  /* ---------- Rekomendasi hero (last pick) ---------- */

  // Selisih win rate (%) hero A saat ketemu B, dari statistik match. Positif = A unggul.
  function matchup(C, a, b, rank) {
    if (!C || !C.heroes) return null;
    function row(id) {
      var h = C.heroes[id];
      return h && (h[rank] || h.all) || null;
    }
    var vals = [];
    var ra = row(a), rb = row(b), i;
    if (ra) {
      for (i = 0; i < ra.s.length; i++) if (ra.s[i][0] === b) vals.push(ra.s[i][1]);
      for (i = 0; i < ra.w.length; i++) if (ra.w[i][0] === b) vals.push(ra.w[i][1]);
    }
    if (rb) {
      for (i = 0; i < rb.s.length; i++) if (rb.s[i][0] === a) vals.push(-rb.s[i][1]);
      for (i = 0; i < rb.w.length; i++) if (rb.w[i][0] === a) vals.push(-rb.w[i][1]);
    }
    if (!vals.length) return null;
    return vals.reduce(function (x, y) { return x + y; }, 0) / vals.length;
  }

  // Sinergi (%) A dan B satu tim. Positif = win rate naik kalau main bareng.
  function synergy(C, a, b, rank) {
    if (!C || !C.heroes) return null;
    function row(id) { var h = C.heroes[id]; return h && (h[rank] || h.all) || null; }
    var vals = [], ra = row(a), rb = row(b), i;
    if (ra && ra.t) for (i = 0; i < ra.t.length; i++) if (ra.t[i][0] === b) vals.push(ra.t[i][1]);
    if (rb && rb.t) for (i = 0; i < rb.t.length; i++) if (rb.t[i][0] === a) vals.push(rb.t[i][1]);
    if (!vals.length) return null;
    return vals.reduce(function (x, y) { return x + y; }, 0) / vals.length;
  }

  // Ringkasan komposisi tim sendiri.
  function teamProfile(allies) {
    var t = { n: 0, phys: 0, magic: 0, front: 0, cc: 0, heal: 0 };
    (allies || []).forEach(function (a) {
      if (!a || !a.hero) return;
      var h = a.hero, tg = h.tags || [], roles = h.roles || [];
      t.n += 1;
      var ph = h.dmg === "phys" ? 1 : h.dmg === "mixed" ? 0.5 : 0;
      var w = roles.indexOf("Tank") >= 0 || roles.indexOf("Support") >= 0 ? 0.5 : 1;
      t.phys += ph * w; t.magic += (1 - ph) * w;
      if (tg.indexOf("tank") >= 0 || roles.indexOf("Tank") >= 0) t.front += 1;
      if (tg.indexOf("cc") >= 0) t.cc += 1;
      if (tg.indexOf("heal") >= 0 && roles.indexOf("Support") >= 0) t.heal += 1;
    });
    var tot = t.phys + t.magic;
    t.physShare = tot ? t.phys / tot : 0.5;
    return t;
  }

  function winRate(C, id, rank) {
    if (!C) return null;
    var h = C.heroes && C.heroes[id];
    var r = h && (h[rank] || h.all);
    if (r && typeof r.wr === "number") return r.wr;
    var x = C.rates && C.rates[id];
    return x && typeof x.wr === "number" ? x.wr : null;
  }

  function recommendPicks(opts) {
    var data = opts.data, C = data.counters, lane = opts.lane, rank = opts.rank || "all";
    var enemies = (opts.enemies || []).filter(function (e) { return e && e.hero; });
    if (!enemies.length) return { picks: [], laneOpp: null };
    var p = profile(enemies);
    var allies = (opts.allies || []).filter(function (a) { return a && a.hero; });
    var team = teamProfile(allies);
    var taken = {};
    enemies.forEach(function (e) { taken[e.hero.id] = true; });
    allies.forEach(function (a) { taken[a.hero.id] = true; });
    var laneOpp = null;
    enemies.forEach(function (e) { if (e.lane === lane) laneOpp = e; });

    var picks = data.heroes.filter(function (h) {
      return h.lanes.indexOf(lane) >= 0 && !taken[h.id];
    }).map(function (h) {
      var t = h.tags || [], has = function (x) { return t.indexOf(x) >= 0; };
      var score = 0, pros = [], cons = [], counterSum = 0, known = 0;

      enemies.forEach(function (e) {
        var adv = matchup(C, h.id, e.hero.id, rank);
        if (adv === null) return;
        known += 1;
        var w = (e === laneOpp ? 2 : 1) * (e.fed ? 1.5 : 1);
        counterSum += adv * w;
        var tag = e === laneOpp ? " (lawan lane)" : "";
        if (adv >= 1) pros.push({ v: adv * w, t: "Unggul vs " + e.hero.name + tag + " +" + adv.toFixed(1) + "%" });
        if (adv <= -1) cons.push({ v: adv * w, t: "Rawan vs " + e.hero.name + tag + " " + adv.toFixed(1) + "%" });
      });
      score += counterSum;

      // Sinergi dengan hero tim sendiri (statistik).
      allies.forEach(function (a) {
        var syn = synergy(C, h.id, a.hero.id, rank);
        if (syn === null) return;
        score += syn;
        if (syn >= 0.8) pros.push({ v: syn, t: "Sinergi sama " + a.hero.name + " +" + syn.toFixed(1) + "%" });
      });

      // Keseimbangan tim sendiri (butuh minimal 2 teman terisi).
      if (team.n >= 2) {
        var cPh = h.dmg === "phys" ? 1 : h.dmg === "mixed" ? 0.5 : 0;
        var isFront = has("tank") || (h.roles || []).indexOf("Tank") >= 0;
        // Tank/support utama damage-nya kecil, jadi tidak ikut aturan keseimbangan damage.
        var lowDmg = ["Tank", "Support"].indexOf((h.roles || [])[0]) >= 0;
        if (lowDmg) { /* lewati */ }
        else if (team.physShare >= 0.75 && cPh <= 0.5) { score += 1.2; pros.push({ v: 1.2, t: "Tim kurang damage magic" }); }
        else if (team.physShare <= 0.25 && cPh >= 0.5) { score += 1.2; pros.push({ v: 1.2, t: "Tim kurang damage fisik" }); }
        else if ((team.physShare >= 0.75 && cPh === 1) || (team.physShare <= 0.25 && cPh === 0)) {
          score -= 0.6; cons.push({ v: -0.6, t: "Damage tim jadi berat sebelah" });
        }
        if (team.front === 0 && isFront) { score += 1.4; pros.push({ v: 1.4, t: "Tim belum punya frontline" }); }
        if (team.front >= 2 && isFront && !has("dps") && !has("burst")) { score -= 0.5; cons.push({ v: -0.5, t: "Tim udah punya 2 frontline" }); }
        if (team.cc === 0 && has("cc")) { score += 0.6; pros.push({ v: 0.6, t: "Tim belum punya CC" }); }
      }

      // Aturan komposisi lawan (bobot setara ~1% selisih win rate).
      if (p.tank >= 2 && (has("dps") || has("true"))) { score += 1; pros.push({ v: 1, t: "Damage konsisten lawan tim tanky" }); }
      if (p.dive >= 2 && has("cc")) { score += 1; pros.push({ v: 1, t: "Punya CC buat ngunci diver lawan" }); }
      if (p.heal + p.shield >= 2 && has("burst")) { score += 0.6; pros.push({ v: 0.6, t: "Burst nembus sustain lawan" }); }
      if (p.poke >= 3 && has("dive")) { score += 0.8; pros.push({ v: 0.8, t: "Bisa langsung masuk ke tim poke" }); }
      if (p.crit >= 2 && has("tank")) { score += 0.4; }
      if (p.cc >= 3 && !has("tank") && has("dive")) { score -= 0.6; cons.push({ v: -0.6, t: "Lawan banyak CC, rawan dikunci" }); }

      var wr = winRate(C, h.id, rank);
      if (wr !== null) score += (wr - 50) * 0.25;

      pros.sort(function (a, b) { return b.v - a.v; });
      cons.sort(function (a, b) { return a.v - b.v; });
      return { hero: h, score: score, wr: wr, known: known,
        pros: pros.slice(0, 3).map(function (x) { return x.t; }),
        cons: cons.slice(0, 2).map(function (x) { return x.t; }) };
    }).sort(function (a, b) { return b.score - a.score; });

    return { picks: picks.slice(0, opts.limit || 6), laneOpp: laneOpp, total: picks.length, team: team };
  }

  var api = { LANES: LANES, LANE_LABEL: LANE_LABEL, TAG_LABEL: TAG_LABEL, profile: profile, recommend: recommend,
    recommendPicks: recommendPicks, matchup: matchup, synergy: synergy, teamProfile: teamProfile, level: level };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CounterEngine = api;
})(this);
