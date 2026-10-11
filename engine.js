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
    var defCap = isCarry ? (p.fed > 0 ? 2 : 1) : kind.indexOf("bruiser") === 0 ? 2 : 9;
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
    if (enemies.length < 5) notes.push("Baru " + enemies.length + " dari 5 lawan diisi. Rekomendasi makin akurat kalau lengkap.");

    return { arch: arch, kind: kind, profile: p, slots: slots, applied: applied, notes: notes };
  }

  // Ringkasan ancaman per hero lawan.
  var TAG_LABEL = { heal: "Heal", shield: "Shield", burst: "Burst", dps: "Sustain dmg", crit: "Crit",
    atkspd: "Attack speed", tank: "Tanky", cc: "CC", dive: "Diver", poke: "Poke", "true": "True dmg" };

  function level(v, lo, hi) { return v >= hi ? "tinggi" : v >= lo ? "sedang" : "rendah"; }

  var api = { LANES: LANES, LANE_LABEL: LANE_LABEL, TAG_LABEL: TAG_LABEL, profile: profile, recommend: recommend, level: level };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CounterEngine = api;
})(this);
