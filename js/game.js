/* Lulu Island v1 - game rules. Pure logic: no DOM, no timers, so tools/test_game.html can test it.
   Fruit state w: 0 gray (never seen) / 1 green (seen + heard) / 2 orange (understands) / 3 gold (can spell).
   Save format: docs/spec_v1.md section 5 (localStorage key lulu_save_v1). */
(function (root) {
  'use strict';

  var SAVE_KEY = 'lulu_save_v1';
  var STAGES = ['egg', 'small', 'normal', 'big', 'crown'];
  // Gold fruits needed per stage (after hatching). v1 ships only island 0 (30 words), so only "normal" is reachable.
  var GROW = [{ stage: 'crown', gold: 246 }, { stage: 'big', gold: 120 }, { stage: 'normal', gold: 30 }];
  var PER_MEAL = { min: 5, max: 15, def: 10 };
  var NEW_PER_MEAL = 3;   // at most 3 new gray fruits per meal, unless nothing else can fill the meal
  var MAX_SHOWS = 2;      // one word appears at most twice in one meal
  var MODES = ['intro', 'choose', 'spell', 'spell'];

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function dayStr(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function isObj(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
  function toInt(x, def, lo, hi) {
    var n = typeof x === 'number' ? x : parseInt(x, 10);
    if (!isFinite(n)) return def;
    n = Math.round(n);
    if (lo !== undefined && n < lo) n = lo;
    if (hi !== undefined && n > hi) n = hi;
    return n;
  }
  function shuffle(arr, rng) {
    rng = rng || Math.random;
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  // ---------- save / load
  function defaults(now) {
    now = now || new Date();
    return {
      ver: 1,
      createdAt: now.toISOString(),
      stage: 'egg',
      words: {},
      feedDays: [],
      today: { date: dayStr(now), fed: 0 },
      settings: { spell: 'type', perMeal: PER_MEAL.def, voice: null }
    };
  }

  function rollToday(s, now) {
    var d = dayStr(now || new Date());
    if (!isObj(s.today) || s.today.date !== d) s.today = { date: d, fed: 0 };
  }

  // Any missing or broken field falls back to its default; never throws.
  function normalize(raw, now) {
    now = now || new Date();
    var s = defaults(now);
    if (!isObj(raw)) return s;
    if (typeof raw.createdAt === 'string' && raw.createdAt) s.createdAt = raw.createdAt;
    if (STAGES.indexOf(raw.stage) >= 0) s.stage = raw.stage;
    if (isObj(raw.words)) {
      Object.keys(raw.words).forEach(function (k) {
        var e = raw.words[k];
        if (!isObj(e)) return;
        s.words[k] = {
          w: toInt(e.w, 0, 0, 3),
          tries: toInt(e.tries, 0, 0),
          wrong: toInt(e.wrong, 0, 0),
          lastAt: toInt(e.lastAt, 0, 0)
        };
      });
    }
    if (Array.isArray(raw.feedDays)) {
      raw.feedDays.forEach(function (x) {
        if (typeof x === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(x) && s.feedDays.indexOf(x) < 0) s.feedDays.push(x);
      });
      s.feedDays.sort();
    }
    if (isObj(raw.today) && typeof raw.today.date === 'string') {
      s.today = { date: raw.today.date, fed: toInt(raw.today.fed, 0, 0) };
    }
    rollToday(s, now);
    if (isObj(raw.settings)) {
      var st = raw.settings;
      if (st.spell === 'type' || st.spell === 'tiles') s.settings.spell = st.spell;
      s.settings.perMeal = toInt(st.perMeal, PER_MEAL.def, PER_MEAL.min, PER_MEAL.max);
      if (typeof st.voice === 'string' && st.voice) s.settings.voice = st.voice;
    }
    return s;
  }

  function load(storage, now) {
    var txt = null, raw = null;
    try { txt = storage ? storage.getItem(SAVE_KEY) : null; } catch (e) { txt = null; }
    if (txt) {
      try { raw = JSON.parse(txt); } catch (e2) {
        raw = null;
        try { storage.setItem(SAVE_KEY + '_broken', txt); } catch (e3) { /* keep going */ }
      }
    }
    return normalize(raw, now);
  }

  function save(storage, s) {
    try { storage.setItem(SAVE_KEY, JSON.stringify(s)); return true; } catch (e) { return false; }
  }

  // Reset progress, keep settings.
  function reset(s, now) {
    var d = defaults(now);
    d.settings = { spell: s.settings.spell, perMeal: s.settings.perMeal, voice: s.settings.voice };
    return d;
  }

  // ---------- word state
  function state(s, en) {
    return s.words[en] || { w: 0, tries: 0, wrong: 0, lastAt: 0 };
  }
  function ensure(s, en) {
    if (!s.words[en]) s.words[en] = { w: 0, tries: 0, wrong: 0, lastAt: 0 };
    return s.words[en];
  }
  function counts(s, words) {
    var c = [0, 0, 0, 0];
    words.forEach(function (wd) { c[state(s, wd.en).w]++; });
    return c;
  }
  function goldCount(s, words) { return counts(s, words)[3]; }
  function fedToday(s, now) { rollToday(s, now); return s.today.fed; }
  function stageForGold(gold) {
    for (var i = 0; i < GROW.length; i++) if (gold >= GROW[i].gold) return GROW[i].stage;
    return 'small';
  }

  // ---------- meal
  // Pick order (spec 3): orange (oldest first), green (oldest first), up to 3 new gray, gold review (oldest first).
  // If that still cannot fill the meal (e.g. the very first meal has no gold), more gray fruits fill it.
  // Play order: gray intro, green choose, orange spell, gold review (easy to hard).
  function pickMeal(s, words, n) {
    n = toInt(n, PER_MEAL.def, 1, words.length);
    var g = [[], [], [], []];
    words.forEach(function (wd, i) { var st = state(s, wd.en); g[st.w].push({ word: wd, i: i, t: st.lastAt, w: st.w }); });
    function oldest(a, b) { return (a.t - b.t) || (a.i - b.i); }
    g[1].sort(oldest); g[2].sort(oldest); g[3].sort(oldest);
    var picked = [];
    function take(arr) { for (var k = 0; k < arr.length && picked.length < n; k++) picked.push(arr[k]); }
    take(g[2]); take(g[1]); take(g[0].slice(0, NEW_PER_MEAL)); take(g[3]); take(g[0].slice(NEW_PER_MEAL));
    picked.forEach(function (p, k) { p.k = k; });
    picked.sort(function (a, b) { return (a.w - b.w) || (a.k - b.k); });
    return picked.map(function (p) { return p.word; });
  }

  function newMeal(s, words, n) {
    var list = pickMeal(s, words, n);
    var info = {};
    list.forEach(function (wd, i) { info[wd.en] = { word: wd, slot: i, from: state(s, wd.en).w, shows: 0 }; });
    return { list: list, queue: list.map(function (wd) { return wd.en; }), pos: 0, info: info };
  }

  function current(s, meal) {
    if (!meal || meal.pos >= meal.queue.length) return null;
    var it = meal.info[meal.queue[meal.pos]];
    var w = state(s, it.word.en).w;
    return { word: it.word, slot: it.slot, w: w, mode: MODES[w], repeat: it.shows > 0 };
  }

  // correct: wrong answers keep the state (gold drops to orange) and go back to the end of the meal once.
  function answer(s, meal, correct, now) {
    now = now || new Date();
    rollToday(s, now);
    var en = meal.queue[meal.pos];
    var it = meal.info[en];
    var e = ensure(s, en);
    var from = e.w;
    if (from === 0) correct = true;   // the intro cannot be answered wrong
    it.shows++;
    e.tries++;
    e.lastAt = now.getTime();
    var requeued = false;
    if (correct) {
      if (e.w < 3) e.w++;
      s.today.fed++;
    } else {
      e.wrong++;
      if (e.w === 3) e.w = 2;
      if (it.shows < MAX_SHOWS) { meal.queue.push(en); requeued = true; }
    }
    meal.pos++;
    return { en: en, correct: correct, from: from, to: e.w, requeued: requeued };
  }

  function isDone(meal) { return meal.pos >= meal.queue.length; }

  // Called once when the meal queue is empty: feed day (once per day), hatch, grow.
  function finishMeal(s, words, now) {
    now = now || new Date();
    rollToday(s, now);
    var day = dayStr(now);
    var before = s.stage;
    var newDay = s.feedDays.indexOf(day) < 0;
    if (newDay) { s.feedDays.push(day); s.feedDays.sort(); }
    if (s.stage === 'egg') s.stage = 'small';
    var afterHatch = s.stage;
    var gold = goldCount(s, words);
    var target = stageForGold(gold);
    if (STAGES.indexOf(target) > STAGES.indexOf(s.stage)) s.stage = target;   // growing never goes back
    return {
      from: before, to: s.stage, gold: gold, newDay: newDay,
      hatched: before === 'egg',
      grew: STAGES.indexOf(s.stage) > STAGES.indexOf(afterHatch)
    };
  }

  function summary(s, meal) {
    var r = { up01: 0, up12: 0, up23: 0, keep3: 0, down32: 0, list: [] };
    meal.list.forEach(function (wd) {
      var from = meal.info[wd.en].from, to = state(s, wd.en).w;
      if (from === 0 && to >= 1) r.up01++;
      else if (from === 1 && to >= 2) r.up12++;
      else if (from === 2 && to === 3) r.up23++;
      else if (from === 3 && to === 3) r.keep3++;
      else if (from === 3 && to < 3) r.down32++;
      r.list.push({ en: wd.en, zh: wd.zh, from: from, to: to });
    });
    return r;
  }

  // ---------- challenges
  // n Chinese options (v1.1: 6): the answer + n-1 others from the same island, no duplicates, none equal to the answer.
  function choices(words, word, rng, n) {
    n = n || 6;
    var pool = [], seen = {};
    seen[word.zh] = true;
    words.forEach(function (w) { if (w.en !== word.en && !seen[w.zh]) { seen[w.zh] = true; pool.push(w.zh); } });
    shuffle(pool, rng);
    var opts = pool.slice(0, n - 1);
    opts.push(word.zh);
    return shuffle(opts, rng);
  }

  function normText(x) { return String(x).toLowerCase().replace(/\s+/g, ' ').trim(); }
  function variants(en) { return String(en).split('/').map(normText).filter(function (x) { return x.length > 0; }); }
  // "mouse / mice": either one counts. Case and outer spaces are ignored.
  function checkSpell(word, typed) { return variants(word.en).indexOf(normText(typed)) >= 0; }
  function spellTarget(word) { return String(word.en).split('/')[0].trim(); }

  // Letter tiles: the word's letters + 2 letters not in the word, shuffled.
  function tiles(word, rng) {
    var target = spellTarget(word).toLowerCase();
    var extra = 'abcdefghijklmnopqrstuvwxyz'.split('').filter(function (c) { return target.indexOf(c) < 0; });
    shuffle(extra, rng);
    return shuffle(target.split('').concat(extra.slice(0, 2)), rng);
  }

  root.LuluGame = {
    SAVE_KEY: SAVE_KEY, STAGES: STAGES, GROW: GROW, PER_MEAL: PER_MEAL, NEW_PER_MEAL: NEW_PER_MEAL, MAX_SHOWS: MAX_SHOWS,
    dayStr: dayStr, shuffle: shuffle,
    defaults: defaults, normalize: normalize, load: load, save: save, reset: reset,
    state: state, counts: counts, goldCount: goldCount, fedToday: fedToday, stageForGold: stageForGold,
    pickMeal: pickMeal, newMeal: newMeal, current: current, answer: answer, isDone: isDone,
    finishMeal: finishMeal, summary: summary,
    choices: choices, checkSpell: checkSpell, spellTarget: spellTarget, tiles: tiles
  };
})(window);
