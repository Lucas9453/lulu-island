/* Lulu Island v1 - screens and flow.
   Rules: game.js (LuluGame). Voice: speech.js (LuluSpeech). Music + effects (v1.2): audio.js (LuluAudio).
   Pet drawing: pet.js (LuluPet). */
(function () {
  'use strict';
  var G = window.LuluGame, S = window.LuluSpeech, P = window.LuluPet, A = window.LuluAudio || null;
  var ISLAND = window.LULU_WORDS_A.topics[0];
  var WORDS = ISLAND.words;
  var ISLAND_NAME = '動物島';
  var COLORS = ['#b8c0c8', '#6cc27a', '#f0a04b', '#f3c53d'];
  var STAGE_NAMES = { egg: '蛋', small: '小嚕', normal: '嚕嚕', big: '大嚕', crown: '皇冠嚕' };
  // ms: sad face, correct answer on screen (spell), eat animation, longest wait for the voice (v1.1), pause after it
  var T = { sad: 1000, answer: 2000, eat: 1350, listenMax: 2500, afterVoice: 300 };

  // ---------- storage (falls back to memory when localStorage is blocked)
  var storage = (function () {
    try {
      var ls = window.localStorage, k = '__lulu_probe';
      ls.setItem(k, '1'); ls.removeItem(k);
      return ls;
    } catch (e) {
      var mem = {};
      return { getItem: function (k) { return mem[k] || null; }, setItem: function (k, v) { mem[k] = String(v); } };
    }
  })();
  var save = G.load(storage);
  function persist() { G.save(storage, save); }
  persist();
  if (save.settings.voice) S.setVoice(save.settings.voice);
  if (A) { A.setMusic(save.settings.music); A.setSfx(save.settings.sfx); }

  // ---------- helpers
  function $(id) { return document.getElementById(id); }
  // v1.2 sound effect by role (spec 14 table); sound never breaks the game
  function sfx(role, delay) { if (A) { try { A.play(role, delay); } catch (e) { /* ignore */ } } }
  function make(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function fruitEl(w, cls) {
    var s = make('span', 'fruit ' + (cls || ''));
    s.innerHTML = '<svg viewBox="0 0 40 40"><use href="#i-fruit"/></svg>';
    s.style.color = COLORS[w];
    return s;
  }

  var cur = 'home';
  function show(name) {
    ['home', 'play', 'result'].forEach(function (n) { $('scr-' + n).classList.toggle('on', n === name); });
    cur = name;
    window.scrollTo(0, 0);
  }

  // ---------- voice banner
  var hasEnglish = true;
  S.onChange(function (st) {
    hasEnglish = !st.ready || st.hasEnglish;
    $('novoice').hidden = hasEnglish;
    document.body.classList.toggle('novoice', !hasEnglish);
    if (item && item.mode === 'choose') $('choose-word').hidden = hasEnglish;
    fillVoices(st);
  });
  function unlockOnce() { S.unlock(); if (A) A.unlock(); }
  document.addEventListener('pointerdown', unlockOnce, { once: true });
  document.addEventListener('keydown', unlockOnce, { once: true });

  // ---------- A: home
  function renderHome() {
    var fed = G.fedToday(save);
    var gold = G.goldCount(save, WORDS);
    $('home-gold').textContent = gold + '／' + WORDS.length;
    $('home-fed').textContent = fed ? ('今天已餵 ' + fed + ' 顆') : '今天還沒餵';
    $('home-stage').textContent = STAGE_NAMES[save.stage] || save.stage;
    $('home-days').textContent = '一共餵了 ' + save.feedDays.length + ' 天';
    var bubble = $('home-bubble');
    bubble.hidden = !!fed;
    bubble.textContent = save.stage === 'egg' ? '蛋在動…肚子餓？' : '我餓了！';
    P.render($('home-pet'), save.stage, fed ? 'normal' : 'hungry');
    show('home');
  }
  $('btn-feed').addEventListener('click', function () { sfx('tap'); startMeal(); });
  $('btn-settings').addEventListener('click', openSettings);

  // v1.2: speaker button = all sound off (slashed icon) / all on again; the two settings switches follow it
  function syncSound() {
    var m = save.settings.music !== false, f = save.settings.sfx !== false, off = !m && !f, b = $('btn-sound');
    $('sw-music').setAttribute('aria-checked', m ? 'true' : 'false');
    $('sw-sfx').setAttribute('aria-checked', f ? 'true' : 'false');
    b.classList.toggle('off', off);
    b.setAttribute('aria-pressed', off ? 'true' : 'false');
    b.setAttribute('aria-label', off ? '聲音全開' : '聲音全關');
    b.querySelector('use').setAttribute('href', off ? '#i-snd-off' : '#i-snd');
  }
  function setSound(music, fx) {
    save.settings.music = !!music;
    save.settings.sfx = !!fx;
    persist();
    if (A) { A.setMusic(save.settings.music); A.setSfx(save.settings.sfx); }
    syncSound();
    sfx('toggle');   // heard only when effects are on after the change
  }
  $('btn-sound').addEventListener('click', function () {
    var allOff = !save.settings.music && !save.settings.sfx;
    setSound(allOff, allOff);
  });
  $('sw-music').addEventListener('click', function () { setSound(!save.settings.music, save.settings.sfx); });
  $('sw-sfx').addEventListener('click', function () { setSound(save.settings.music, !save.settings.sfx); });
  syncSound();

  // ---------- one meal
  var meal = null, item = null, busy = false, spell = null;
  var stats = { lastMeal: null };

  function startMeal() {
    S.stop();
    meal = G.newMeal(save, WORDS, save.settings.perMeal);
    meal.t0 = Date.now();
    show('play');
    nextItem();
  }

  $('btn-quit').addEventListener('click', function () { sfx('tap'); S.stop(); meal = null; item = null; renderHome(); });

  function petStage() { return save.stage; }

  function renderDots() {
    var box = $('play-dots');
    box.innerHTML = '';
    meal.list.forEach(function (wd, i) {
      var d = make('span', 'dot' + (item && i === item.slot ? ' now' : ''));
      d.style.background = COLORS[G.state(save, wd.en).w];
      box.appendChild(d);
    });
  }

  function nextItem() {
    $('feedback').hidden = true;
    item = G.current(save, meal);
    if (!item) { endMeal(); return; }
    busy = false;
    $('play-title').textContent = ISLAND_NAME + '・第 ' + (item.slot + 1) + ' / ' + meal.list.length + ' 顆';
    $('play-again').hidden = !item.repeat;
    renderDots();
    P.render($('play-pet'), petStage(), 'normal');
    var f = $('play-fruit');
    f.innerHTML = '';
    var fr = fruitEl(item.w, 'drop-in');
    f.appendChild(fr);
    sfx('drop');
    ['intro', 'choose', 'spell'].forEach(function (m) { $('p-' + m).classList.toggle('on', m === item.mode); });
    var it = item;
    if (item.mode === 'intro') {
      setupIntro();
      setTimeout(function () { if (item === it) introListen(); }, 450);   // 餵嚕嚕 stays grey until the word is read
    } else {
      if (item.mode === 'choose') setupChoose(); else setupSpell();
      setTimeout(function () { if (item === it) S.sayWord(item.word.en); }, 450);
    }
  }

  // v1.1: wait until the English word has been read (onend). No English voice, an error, or no onend:
  // let the child go on after T.listenMax (2.5 s) at most. Only the newest wait counts (再聽一次 starts a new one).
  var listenNo = 0;
  stats.listens = [];
  function listenGate(en) {
    var my = ++listenNo, t0 = Date.now();
    var cap = wait(T.listenMax).then(function () { return 'max ' + T.listenMax + 'ms'; });
    var spoken = S.sayWord(en).then(function (how) { return how === 'end' ? 'onend' : cap.then(function (c) { return how + ' -> ' + c; }); });
    return Promise.race([spoken, cap]).then(function (why) {
      var g = { en: en, why: why, ms: Date.now() - t0, latest: my === listenNo };
      stats.listens.push(g);
      return g;
    });
  }

  function setFruitColor(w) {
    var fr = $('play-fruit').querySelector('.fruit');
    if (fr) fr.style.color = COLORS[w];
  }

  // fruit flies into the pet's mouth
  function flyFruit() {
    var fr = $('play-fruit').querySelector('.fruit');
    if (!fr) return;
    var a = fr.getBoundingClientRect();
    var m = P.mouth($('play-pet'));
    var c = fr.cloneNode(true);
    c.classList.remove('drop-in');
    c.classList.add('flying');
    c.style.left = a.left + 'px'; c.style.top = a.top + 'px';
    c.style.width = a.width + 'px'; c.style.height = a.height + 'px';
    $('fx').appendChild(c);
    fr.style.visibility = 'hidden';
    var dx = m.x - (a.left + a.width / 2), dy = m.y - (a.top + a.height / 2);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        c.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(.25)';
        c.style.opacity = '0.2';
      });
    });
    setTimeout(function () { if (c.parentNode) c.parentNode.removeChild(c); }, Math.max(800, T.eat));
  }

  function onAnswer(correct, showWrong) {
    if (busy) return;
    busy = true;
    S.stop();   // v1.2.1: answering ends the reading and lifts the duck, so the answer sound is heard
    var it = item, t0 = Date.now();   // every timer below checks item === it, so going home mid-way stops them
    var res = G.answer(save, meal, correct);
    persist();
    if (res.correct) {
      if (it.mode !== 'intro') sfx('correct');                       // the intro's 餵嚕嚕 already went "tap"
      if (res.from >= 1 && res.to > res.from) sfx('levelup', 0.25);   // green -> orange, orange -> gold
      setFruitColor(res.to);
      renderDots();
      setTimeout(function () {
        if (item !== it) return;
        flyFruit();
        P.render($('play-pet'), petStage(), 'yum');
        P.bounce($('play-pet'));
      }, 250);
      setTimeout(function () { if (item === it) sfx('nom'); }, 800);   // the fruit reaches the mouth (.6 s flight)
      setTimeout(function () { if (item === it) nextItem(); }, T.eat);
    } else {
      sfx('wrong');
      P.render($('play-pet'), petStage(), 'sad');
      setFruitColor(res.to);
      renderDots();
      if (showWrong) showWrong();
      setTimeout(function () { if (item === it) P.render($('play-pet'), petStage(), 'normal'); }, T.sad);
      if (it.mode === 'choose') {
        // v1.1: read the right answer, go on only after it was read (2.5 s at most), never before the sad face is over
        wait(T.afterVoice).then(function () { return item === it ? listenGate(it.word.en) : null; }).then(function (g) {
          if (!g || item !== it) return null;
          return wait(Math.max(T.afterVoice, T.sad - (Date.now() - t0)));
        }).then(function () { if (item === it && cur === 'play') nextItem(); });
      } else {
        setTimeout(function () { if (item === it) S.sayWord(it.word.en); }, 300);
        setTimeout(function () { if (item === it) nextItem(); }, T.answer + 200);
      }
    }
  }

  function feedback(nodes) {
    var fb = $('feedback');
    fb.innerHTML = '';
    nodes.forEach(function (n) { fb.appendChild(n); });
    fb.hidden = false;
  }

  // ---------- intro (gray -> green)
  function setupIntro() {
    $('intro-en').textContent = item.word.en;
    $('intro-zh').textContent = item.word.zh;
    lockFeed(true);
  }
  function lockFeed(on) {
    var b = $('intro-feed');
    b.disabled = on;
    b.classList.toggle('waiting', on);
  }
  function introListen() {
    var it = item;
    lockFeed(true);
    listenGate(it.word.en).then(function (g) { if (g.latest && item === it && !busy) lockFeed(false); });
  }
  $('intro-again').addEventListener('click', function () { if (item && item.mode === 'intro' && !busy) { sfx('tap'); introListen(); } });
  $('intro-feed').addEventListener('click', function () {
    if (!item || item.mode !== 'intro' || $('intro-feed').disabled) return;   // grey = still listening: nothing happens
    if (!busy) sfx('tap');
    onAnswer(true);
  });

  // ---------- C: choose Chinese (green -> orange)
  function setupChoose() {
    var box = $('choose-opts');
    box.innerHTML = '';
    var q = $('choose-q');
    q.textContent = '這顆果子是什麼？';
    q.classList.remove('answer');
    $('choose-word').textContent = item.word.en;
    $('choose-word').hidden = hasEnglish;
    G.choices(WORDS, item.word, null, 6).forEach(function (zh) {
      var b = make('button', 'opt', zh);
      b.addEventListener('click', function () {
        if (busy) return;
        var ok = zh === item.word.zh;
        b.classList.add(ok ? 'good' : 'bad');
        Array.prototype.forEach.call(box.children, function (x) { x.disabled = true; });   // v1.1: no more taps until the next fruit
        if (!ok) {
          Array.prototype.forEach.call(box.children, function (x) { if (x.textContent === item.word.zh) x.classList.add('good'); });
        }
        onAnswer(ok, function () {   // v1.1: the answer goes in the question line, so it does not cover the 6 options
          q.textContent = '答案是 ' + item.word.zh + '  ' + item.word.en;
          q.classList.add('answer');
        });
      });
      box.appendChild(b);
    });
  }
  $('choose-spk').addEventListener('click', function () { if (item && !busy) { sfx('tap'); S.sayWord(item.word.en); } });

  // ---------- D / D2: spell (orange -> gold, gold review)
  var KEY_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
  function setupSpell() {
    var target = G.spellTarget(item.word);
    var tilesMode = save.settings.spell === 'tiles';
    spell = { target: target, typed: '', tiles: null, filled: [] };
    $('spell-zh').textContent = item.word.zh;
    $('spell-note').hidden = item.word.en.indexOf('/') < 0;
    $('kbd').hidden = tilesMode;
    $('tiles').hidden = !tilesMode;
    $('tiles-back').hidden = !tilesMode;
    if (tilesMode) {
      spell.tiles = G.tiles(item.word).map(function (ch) { return { ch: ch, used: false }; });
      renderTiles();
    } else {
      buildKeyboard(target);
    }
    renderSlots();
  }

  function buildKeyboard(target) {
    var kbd = $('kbd');
    kbd.innerHTML = '';
    KEY_ROWS.forEach(function (row, r) {
      var line = make('div', 'kbd-row r' + r);
      row.split('').forEach(function (ch) {
        var k = make('button', 'key', ch);
        k.setAttribute('data-k', ch);
        line.appendChild(k);
      });
      if (r === 2) {
        var bk = make('button', 'key wide');
        bk.setAttribute('data-k', 'back');
        bk.setAttribute('aria-label', '退格');
        bk.innerHTML = '<svg><use href="#i-back"/></svg>';
        line.appendChild(bk);
      }
      kbd.appendChild(line);
    });
    // words with a space, hyphen, apostrophe or dot (other islands) get those keys too
    var extra = [];
    [[' ', '空白'], ['-', '-'], ["'", "'"], ['.', '.']].forEach(function (p) { if (target.indexOf(p[0]) >= 0) extra.push(p); });
    if (extra.length) {
      var line = make('div', 'kbd-row r3');
      extra.forEach(function (p) {
        var k = make('button', 'key wide', p[1]);
        k.setAttribute('data-k', p[0]);
        line.appendChild(k);
      });
      kbd.appendChild(line);
    }
  }
  $('kbd').addEventListener('click', function (e) {
    var k = e.target.closest ? e.target.closest('.key') : null;
    if (!k) return;
    var v = k.getAttribute('data-k');
    if (v === 'back') spellBack(); else spellType(v);
  });

  function maxLen() {
    var longest = 0;
    item.word.en.split('/').forEach(function (x) { longest = Math.max(longest, x.trim().length); });
    return longest + 2;
  }
  function currentText() {
    return spell.tiles ? spell.filled.map(function (f) { return f.ch; }).join('') : spell.typed;
  }
  function spellType(ch) {
    if (busy || !spell) return;
    if (spell.tiles) {
      for (var i = 0; i < spell.tiles.length; i++) {
        if (!spell.tiles[i].used && spell.tiles[i].ch === ch) { useTile(i); return; }
      }
      return;
    }
    if (spell.typed.length >= maxLen()) return;
    spell.typed += ch;
    sfx('type');
    renderSlots();
  }
  function spellBack() {
    if (busy || !spell) return;
    sfx('type');
    if (spell.tiles) {
      var last = spell.filled.pop();
      if (last) spell.tiles[last.tile].used = false;
      renderTiles();
    } else {
      spell.typed = spell.typed.slice(0, -1);
    }
    renderSlots();
  }
  function useTile(i) {
    if (busy || spell.tiles[i].used) return;
    spell.tiles[i].used = true;
    spell.filled.push({ ch: spell.tiles[i].ch, tile: i });
    sfx('type');
    renderTiles();
    renderSlots();
  }
  function renderTiles() {
    var box = $('tiles');
    box.innerHTML = '';
    spell.tiles.forEach(function (t, i) {
      var b = make('button', 'tile' + (t.used ? ' used' : ''), t.ch);
      b.disabled = t.used;
      b.addEventListener('click', function () { useTile(i); });
      box.appendChild(b);
    });
  }
  function renderSlots() {
    var box = $('spell-slots');
    box.innerHTML = '';
    var text = currentText();
    var n = Math.max(spell.target.length, text.length);
    for (var i = 0; i < n; i++) {
      var ch = text.charAt(i);
      var s = make('span', 'slot' + (ch ? ' filled' : '') + (i === text.length ? ' caret' : ''), ch === ' ' ? '␣' : ch);
      if (spell.tiles && ch) {
        (function (k) {
          s.addEventListener('click', function () {   // tap a filled letter to send it back
            if (busy) return;
            sfx('type');
            var f = spell.filled.splice(k, 1)[0];
            if (f) spell.tiles[f.tile].used = false;
            renderTiles();
            renderSlots();
          });
        })(i);
      }
      box.appendChild(s);
    }
  }
  $('tiles-back').addEventListener('click', spellBack);
  $('spell-ok').addEventListener('click', spellSubmit);
  $('spell-spk').addEventListener('click', function () { if (item) { sfx('tap'); S.sayWord(item.word.en); } });

  function spellSubmit() {
    if (busy || !spell) return;
    sfx('tap');   // 好了！ (and Enter); correct / wrong follows at once
    var text = currentText();
    if (!text.trim()) {
      var box = $('spell-slots');
      box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake');
      return;
    }
    var ok = G.checkSpell(item.word, text);
    onAnswer(ok, function () {
      var right = make('div', 'fb-big');
      var want = spell.target;
      for (var i = 0; i < want.length; i++) {
        var c = make('span', text.charAt(i).toLowerCase() === want.charAt(i).toLowerCase() ? '' : 'diff', want.charAt(i));
        right.appendChild(c);
      }
      feedback([make('div', 'fb-label', '你打的'), make('div', 'fb-big bad', text), make('div', 'fb-label', '正確是'), right]);
    });
  }

  document.addEventListener('keydown', function (e) {
    if (cur !== 'play' || !item || item.mode !== 'spell' || !$('settings').hidden) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key;
    if (k === 'Backspace') { e.preventDefault(); spellBack(); }
    else if (k === 'Enter') { e.preventDefault(); spellSubmit(); }
    else if (k && k.length === 1 && /[a-zA-Z' .-]/.test(k)) { e.preventDefault(); spellType(k.toLowerCase()); }
  });

  // ---------- end of meal -> hatch / grow show -> E
  function endMeal() {
    item = null;
    var res = G.finishMeal(save, WORDS);
    persist();
    var sum = G.summary(save, meal);
    stats.lastMeal = { ms: Date.now() - meal.t0, fruits: meal.list.length, shown: meal.queue.length, sum: sum, res: res };
    var chain = Promise.resolve();
    if (res.hatched) chain = chain.then(showHatch);
    if (res.grew) chain = chain.then(showGrow);
    chain.then(function () { renderResult(sum); });
  }

  function overlay(title, text) {
    $('ov-title').textContent = title;
    $('ov-text').textContent = text;
    $('ov-card').hidden = true;
    $('ov-ok').hidden = true;
    $('overlay').hidden = false;
  }
  function waitOk() {
    return new Promise(function (res) {
      var b = $('ov-ok');
      b.hidden = false;
      b.onclick = function () { b.onclick = null; sfx('tap'); $('overlay').hidden = true; clearConfetti(); res(); };
    });
  }

  function showHatch() {
    overlay('蛋要破殼了！', '');
    P.render($('ov-pet'), 'egg', 'normal');
    return P.hatch($('ov-pet')).then(function () {
      sfx('hatch');
      confetti(30);
      $('ov-title').textContent = '破殼了！是小嚕！';
      $('ov-text').textContent = '每天餵嚕嚕吃果子，牠會慢慢長大。';
      return waitOk();
    });
  }

  function showGrow() {
    overlay('動物島 30 顆全變金果子！', '');
    P.render($('ov-pet'), 'small', 'yum');
    return P.grow($('ov-pet')).then(function () {
      sfx('grow');
      confetti(70);
      $('ov-title').textContent = '小嚕長大了，變成嚕嚕！';
      $('ov-text').textContent = '你把動物島 30 個單字都學會拼了！';
      var card = $('ov-card');
      card.innerHTML = '';
      var art = make('div', 'card-art');
      if (P.formArt) art.innerHTML = P.formArt('lion');
      card.appendChild(art);
      card.appendChild(make('div', 'card-name', '小獅嚕變身卡'));
      card.appendChild(make('div', 'card-sub', '第二版開放'));
      card.hidden = false;
      return waitOk();
    });
  }

  var CONFETTI = ['#f3c53d', '#f0a04b', '#6cc27a', '#ff8a5b', '#74c0fc', '#f7a8b8'];
  function confetti(n) {
    var fx = $('fx');
    for (var i = 0; i < n; i++) {
      var c = make('i', 'confetti');
      c.style.left = (Math.random() * 100) + 'vw';
      c.style.background = CONFETTI[i % CONFETTI.length];
      c.style.animationDelay = (Math.random() * 0.8) + 's';
      c.style.animationDuration = (2.2 + Math.random() * 1.6) + 's';
      c.style.transform = 'rotate(' + Math.floor(Math.random() * 360) + 'deg)';
      fx.appendChild(c);
    }
    setTimeout(clearConfetti, 4500);
  }
  function clearConfetti() {
    Array.prototype.slice.call($('fx').querySelectorAll('.confetti')).forEach(function (c) { c.parentNode.removeChild(c); });
  }

  // ---------- E: result
  function renderResult(sum) {
    $('res-01').textContent = sum.up01 + ' 顆';
    $('res-12').textContent = sum.up12 + ' 顆';
    $('res-23').textContent = sum.up23 + ' 顆';
    Array.prototype.forEach.call(document.querySelectorAll('#scr-result .pair'), function (p) {
      p.innerHTML = '';
      p.appendChild(fruitEl(+p.getAttribute('data-from'), 'sm'));
      p.appendChild(make('span', 'arrow', '→'));
      p.appendChild(fruitEl(+p.getAttribute('data-to'), 'sm'));
    });
    var extra = [];
    if (sum.keep3) extra.push('金果子複習答對 ' + sum.keep3 + ' 顆');
    if (sum.down32) extra.push('金果子掉回橘 ' + sum.down32 + ' 顆');
    $('res-extra').textContent = extra.join('・');
    $('res-extra').hidden = !extra.length;
    var row = $('res-fruits');
    row.innerHTML = '';
    sum.list.forEach(function (x) {
      var f = fruitEl(x.to, 'sm' + (x.to > x.from ? ' up' : ''));
      f.title = x.en;
      row.appendChild(f);
    });
    P.render($('res-pet'), save.stage, 'sleep');
    show('result');
    sfx('meal_done');
  }
  $('res-home').addEventListener('click', function () { sfx('tap'); renderHome(); });
  $('res-more').addEventListener('click', function () { sfx('tap'); startMeal(); });

  // ---------- settings
  function openSettings() { sfx('open'); syncSettings(); $('settings').hidden = false; }
  function closeSettings() { sfx('close'); $('settings').hidden = true; resetArm(false); renderHome(); }
  function syncSettings() {
    syncSound();
    Array.prototype.forEach.call(document.querySelectorAll('[data-spell]'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-spell') === save.settings.spell);
    });
    $('pm-val').textContent = save.settings.perMeal;
    fillVoices(S.status());
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-spell]'), function (b) {
    b.addEventListener('click', function () { sfx('toggle'); save.settings.spell = b.getAttribute('data-spell'); persist(); syncSettings(); });
  });
  function stepMeal(d) {
    var p = G.PER_MEAL;
    sfx('toggle');
    save.settings.perMeal = Math.max(p.min, Math.min(p.max, save.settings.perMeal + d));
    persist();
    syncSettings();
  }
  $('pm-minus').addEventListener('click', function () { stepMeal(-1); });
  $('pm-plus').addEventListener('click', function () { stepMeal(1); });
  function fillVoices(st) {
    var sel = $('voice-sel');
    if (!sel) return;
    sel.innerHTML = '';
    st.voices.forEach(function (v) {
      var o = make('option', '', v.name + '（' + v.lang + '）');
      o.value = v.name;
      sel.appendChild(o);
    });
    if (st.current) sel.value = st.current;
    sel.hidden = !st.voices.length;
    $('voice-test').hidden = !st.voices.length;
    $('voice-none').hidden = !!st.voices.length || !st.ready;
  }
  $('voice-sel').addEventListener('change', function (e) {
    save.settings.voice = e.target.value;
    S.setVoice(e.target.value);
    persist();
  });
  $('voice-test').addEventListener('click', function () { sfx('tap'); S.sayWord('Hello, I am Lulu.'); });
  var resetTimer = null;
  function resetArm(on) {
    var b = $('reset-btn');
    b.classList.toggle('armed', on);
    b.textContent = on ? '再按一次確定' : '重置';
    clearTimeout(resetTimer);
    if (on) resetTimer = setTimeout(function () { resetArm(false); }, 4000);
  }
  $('reset-btn').addEventListener('click', function () {
    sfx('tap');
    if (!$('reset-btn').classList.contains('armed')) { resetArm(true); return; }
    save = G.reset(save);
    persist();
    resetArm(false);
    $('reset-btn').textContent = '已重置';
  });
  $('settings-close').addEventListener('click', closeSettings);
  $('settings').addEventListener('click', function (e) { if (e.target === $('settings')) closeSettings(); });

  // for tools/ and evidence scripts: peeks + the timing table (tests stretch it to screenshot the wrong-answer view)
  window.LuluApp = {
    save: function () { return save; },
    item: function () { return item; },
    meal: function () { return meal; },
    stats: stats,
    T: T,
    screen: function () { return cur; }
  };

  renderHome();
})();
