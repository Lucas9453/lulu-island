/* Lulu Island v1.2 - background music + sound effects (docs/spec_v1.md section 14).
   WebAudio chain:  bgmSource -> bgmGain -> bgmAnalyser -> masterGain -> destination
                    sfxSource -> sfxGain -> sfxAnalyser -> masterGain
   (the two analysers pass the sound through unchanged; tools/ read them to measure RMS)
   - Files are fetched and decoded as soon as the page loads (an OfflineAudioContext decodes them, so nothing
     waits for the first tap); the real AudioContext starts on the first tap / key (iOS rule).
   - While English is read, LuluSpeech.say() calls duck(true) / duck(false): the music goes to 0 but keeps playing.
   - file:// pages cannot fetch(): the music falls back to an <audio loop> element, effects to <audio> clones.
   - An effect whose file did not load falls back to the synthesized sound in speech.js; music that cannot play is
     simply off. Sound never stops the game and never writes a console error. */
(function (root) {
  'use strict';

  var BGM_VOL = 0.35, SFX_VOL = 0.7;
  // seconds (spec 14-3). v1.2.1 after Tai listened (261109): music vanishes faster before a word (0.15 -> 0.05),
  // comes back later and slower after it (hold 0.4 -> 1.0, ramp 0.8 -> 1.5). Effects drop to 0 with the music too.
  var DUCK_OUT = 0.05, DUCK_HOLD = 1.0, DUCK_IN = 1.5, SFX_BACK = 0.03;   // effects return at once (an answer sound follows a stop())
  var FADE_IN = 1.0;       // music appears: loaded, switched on, tab shown again
  var HIDE_OUT = 0.3;      // tab hidden: fade out, then suspend
  var OFF_OUT = 0.03;      // music switched off: "at once", short enough to avoid a click
  // The loop's exact length: art/audio_src/flowerbed_fields/flowerbed_fields.wav = 4,671,559 frames / 44,100 Hz.
  var LOOP_SEC = 4671559 / 44100;   // 105.931 s
  // This mp3 (Lavc encoder) starts with 1105 samples of encoder delay (ffprobe start_time 0.025057 s).
  // Some decoders keep it (Chrome), some cut it; the start is found by scanning, then snapped to 0 or this value.
  var MP3_DELAY = 1105 / 44100;
  var BGM_URL = 'assets/audio/bgm_flowerbed_fields.mp3';
  var SFX_DIR = 'assets/audio/sfx/';
  var ROLES = ['tap', 'type', 'drop', 'nom', 'correct', 'wrong', 'levelup', 'hatch', 'grow', 'meal_done', 'toggle', 'open', 'close'];
  var SYNTH = { correct: 'ding', wrong: 'boop', type: 'pop', hatch: 'tada', grow: 'tada' };   // speech.js fallbacks

  var doc = root.document;
  var AC = root.AudioContext || root.webkitAudioContext || null;
  var OAC = root.OfflineAudioContext || root.webkitOfflineAudioContext || null;
  var isFile = !!(root.location && root.location.protocol === 'file:');
  var mode = AC && !isFile && root.fetch ? 'webaudio' : 'element';

  var on = { music: true, sfx: true };
  var ducked = false, hidden = !!(doc && doc.hidden);
  var ctx = null, dec = null, master = null, bgmGain = null, sfxGain = null, bgmAn = null, sfxAn = null;
  var buf = {}, st = {}, bgmSrc = null, loop = null, activeSfx = 0, duckOutEnd = 0, powerTimer = null;
  var bgmEl = null, sfxEl = {}, elVol = 0, elTimer = null, elVolOk = true;
  var stats = { mode: mode, events: [], plays: [], t0: now() };

  function noop() { /* ignore */ }
  function now() { return root.performance && root.performance.now ? root.performance.now() : Date.now(); }
  function log(kind, a, b) {
    stats.events.push({ t: Math.round(now()), kind: kind, a: a, b: b });
    if (stats.events.length > 400) stats.events.shift();
  }
  function quiet(p) { if (p && typeof p.then === 'function') p.then(noop, noop); return p; }
  ROLES.concat(['bgm']).forEach(function (k) { st[k] = 'idle'; });

  // ---------- loading (webaudio mode)
  function decoder() {
    if (ctx) return ctx;
    if (!dec && OAC) { try { dec = new OAC(2, 1, 48000); } catch (e) { dec = null; } }
    return dec;
  }
  function fetchAll() {
    ROLES.forEach(function (r) { load(r, SFX_DIR + r + '.mp3'); });
    load('bgm', BGM_URL);
  }
  function load(key, url) {
    st[key] = 'loading';
    var p;
    try { p = root.fetch(url); } catch (e) { p = Promise.reject(e); }
    p.then(function (res) {
      if (!res.ok) { var err = new Error('HTTP ' + res.status); err.missing = true; throw err; }
      return res.arrayBuffer();
    }).then(function (ab) {
      st[key] = 'fetched';
      decode(key, ab);
    }).catch(function (e) {
      failed(key, e && e.missing ? 'missing' : 'failed', e && e.message);
    });
  }
  function decode(key, ab) {
    var d = decoder();
    if (!d) { st[key] = 'fetched'; buf['raw_' + key] = ab; return; }   // no decoder yet: wait for the first tap
    st[key] = 'decoding';
    var done = false;
    function ok(b) {
      if (done) return;
      done = true;
      buf[key] = b;
      st[key] = 'ready';
      log('ready', key, Math.round(b.duration * 1000) / 1000);
      if (key === 'bgm') bgmReady();
    }
    function bad(e) { if (done) return; done = true; failed(key, 'failed', e && e.message ? e.message : 'decode'); }
    try { quiet(d.decodeAudioData(ab, ok, bad)); } catch (e) { bad(e); }
  }
  function failed(key, how, why) {
    st[key] = how;
    log('load-' + how, key, why);
    if (key === 'bgm' && how !== 'missing') useBgmElement();   // could not fetch / decode: try the plain <audio> element
  }

  // Loop points: start = first sound (snapped to the known encoder delay), end = start + exact loop length.
  function findLoop(b) {
    var d = b.duration, rate = b.sampleRate;
    var c0 = b.getChannelData(0), c1 = b.numberOfChannels > 1 ? b.getChannelData(1) : c0;
    var lim = Math.min(c0.length, Math.ceil(0.12 * rate)), i = 0;
    while (i < lim && Math.abs(c0[i]) <= 0.001 && Math.abs(c1[i]) <= 0.001) i++;
    var lead = i < lim ? i / rate : 0;
    var start = lead;
    if (Math.abs(lead - MP3_DELAY) < 0.004) start = MP3_DELAY;
    else if (lead < 0.004) start = 0;
    var end = Math.min(d, start + LOOP_SEC);
    return { duration: d, rate: rate, lead: lead, start: start, end: end, extra: d - LOOP_SEC };
  }

  // ---------- the real AudioContext (first tap)
  function unlock() {
    if (mode === 'webaudio' && !ctx) {
      try { ctx = new AC({ sampleRate: 48000 }); } catch (e) { try { ctx = new AC(); } catch (e2) { ctx = null; } }
      if (!ctx) { mode = stats.mode = 'element'; elementSetup(); }
      else {
        master = ctx.createGain(); master.gain.value = 1;
        bgmGain = ctx.createGain(); bgmGain.gain.value = 0;
        sfxGain = ctx.createGain(); sfxGain.gain.value = SFX_VOL;
        bgmAn = ctx.createAnalyser(); bgmAn.fftSize = 512;
        sfxAn = ctx.createAnalyser(); sfxAn.fftSize = 512;
        bgmGain.connect(bgmAn); bgmAn.connect(master);
        sfxGain.connect(sfxAn); sfxAn.connect(master);
        master.connect(ctx.destination);
        log('ctx', ctx.state, ctx.sampleRate);
        if (!dec) Object.keys(buf).forEach(function (k) {   // no OfflineAudioContext: decode now
          if (k.indexOf('raw_') === 0) { var ab = buf[k]; delete buf[k]; decode(k.slice(4), ab); }
        });
        if (buf.bgm) bgmReady();
      }
    }
    if (ctx) {
      if (ctx.state !== 'running') resume();
      power();
    }
    if (bgmEl) elementUnlock();
  }
  function resume() { if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') { quiet(ctx.resume()); log('resume'); } }
  function needRun() { return activeSfx > 0 || (on.music && !hidden && !!bgmSrc); }
  // Keep the context running only while something can be heard (spec 14-4, 14-6: suspend to save power).
  function power(after) {
    if (!ctx) return;
    clearTimeout(powerTimer);
    if (needRun()) { resume(); return; }
    powerTimer = setTimeout(function () {
      if (!needRun() && ctx.state === 'running') { quiet(ctx.suspend()); log('suspend'); }
    }, Math.round((after || 0) * 1000) + 60);
  }

  // ---------- music
  function target() { return on.music && !hidden && !ducked ? BGM_VOL : 0; }
  function bgmReady() {
    if (!ctx || !buf.bgm) return;   // decoded before the first tap: starts in unlock()
    if (!loop) { loop = findLoop(buf.bgm); log('loop', Math.round(loop.start * 1e6) / 1e6, Math.round(loop.end * 1e6) / 1e6); }
    if (on.music && !bgmSrc) { startBgm(loop.start); ramp(target(), FADE_IN); power(); }
  }
  function startBgm(offset) {
    if (bgmSrc) { try { bgmSrc.stop(); bgmSrc.disconnect(); } catch (e) { /* ignore */ } }
    var s = ctx.createBufferSource();
    s.buffer = buf.bgm;
    s.loop = true;
    s.loopStart = loop.start;
    s.loopEnd = loop.end;
    s.connect(bgmGain);
    s.start(0, offset);
    bgmSrc = s;
    st.bgm = 'playing';
    log('bgm-start', Math.round(offset * 1000) / 1000);
  }
  // Ramp bgmGain from where it is now to `to` in `dur` seconds, optionally holding `hold` seconds first.
  // Fade-ins (music appears) rise fast first: exponential approach, 98 % after `dur`, exact at `dur`. A straight ramp
  // is only at 1/3 when the first fruit's word ducks the music 0.45 s after the first tap (V9: heard within 1 s).
  function ramp(to, dur, hold) {
    if (!ctx || !bgmGain) return;
    var g = bgmGain.gain, t = ctx.currentTime, v = g.value;
    g.cancelScheduledValues(t);
    g.setValueAtTime(v, t);
    var t1 = t + (hold || 0);
    if (hold) g.setValueAtTime(v, t1);
    dur = Math.max(0.005, dur);
    if (to > v && dur >= FADE_IN) { g.setTargetAtTime(to, t1, dur / 4); g.setValueAtTime(to, t1 + dur); }
    else g.linearRampToValueAtTime(to, t1 + dur);
  }

  // duck(true): music down to 0 in DUCK_OUT (it keeps playing); returns ms until it is silent, so speech.js can
  // start speaking after that. duck(false): hold DUCK_HOLD, then back up in DUCK_IN.
  function duck(down) {
    ducked = !!down;
    var ms = 0, plan = null;
    if (ctx && bgmGain) {
      var g = bgmGain.gain, t = ctx.currentTime, v = g.value;
      g.cancelScheduledValues(t);
      g.setValueAtTime(v, t);
      if (ducked) {
        g.linearRampToValueAtTime(0, t + DUCK_OUT);
        duckOutEnd = t + DUCK_OUT;
        if (v > 0.0005 && ctx.state === 'running') ms = Math.round(DUCK_OUT * 1000) + 50;
        plan = { ctx: t, from: v, silentAt: duckOutEnd };
      } else {
        if (t < duckOutEnd) { g.linearRampToValueAtTime(0, duckOutEnd); v = 0; }   // finish going down first
        var up = Math.max(t + DUCK_HOLD, duckOutEnd);
        g.setValueAtTime(v, up);
        g.linearRampToValueAtTime(target(), up + DUCK_IN);
        plan = { ctx: t, upFrom: up, fullAt: up + DUCK_IN, to: target() };
      }
      if (sfxGain) {   // v1.2.1: effects go silent with the music so no tail (e.g. the fruit drop) sits under the word
        var sg = sfxGain.gain;
        sg.cancelScheduledValues(t);
        sg.setValueAtTime(sg.value, t);
        if (ducked) sg.linearRampToValueAtTime(0, t + DUCK_OUT);
        else sg.linearRampToValueAtTime(SFX_VOL, t + SFX_BACK);
      }
    }
    log('duck', ducked, plan);   // ctx seconds: when it was called and when the ramp is scheduled to end
    if (bgmEl) {
      if (ducked) {
        if (elVol > 0.0005) ms = Math.max(ms, Math.round(DUCK_OUT * 1000) + 50);
        elRamp(0, DUCK_OUT);
      } else elRamp(target(), DUCK_IN, DUCK_HOLD);
    }
    return ms;
  }

  function setMusic(v) {
    v = v !== false;
    if (v === on.music) return;
    on.music = v;
    log('music', v);
    if (ctx) {
      if (v) {
        if (buf.bgm && !bgmSrc) { if (!loop) loop = findLoop(buf.bgm); startBgm(loop.start); }
        power();
        ramp(target(), FADE_IN);
      } else {
        ramp(0, OFF_OUT);
        power(OFF_OUT);
      }
    }
    if (bgmEl) { if (v) elementUnlock(); else elRamp(0, OFF_OUT); }
  }
  function setSfx(v) { on.sfx = v !== false; log('sfx', on.sfx); }

  // ---------- effects
  // play(role[, delaySeconds]) -> 'file' | 'synth' | 'off' | 'none' | 'wait'
  function play(role, delay) {
    var how = playNow(role, delay || 0);
    stats.plays.push({ t: Math.round(now()), role: role, how: how });
    if (stats.plays.length > 400) stats.plays.shift();
    return how;
  }
  function playNow(role, delay) {
    if (!on.sfx) return 'off';
    if (ducked && bgmEl) return 'ducked';   // <audio> fallback (file://): no effect while a word is being read
    if (hidden) return 'none';
    if (mode === 'webaudio' && ctx && buf[role]) {
      resume();
      clearTimeout(powerTimer);
      var s = ctx.createBufferSource();
      s.buffer = buf[role];
      s.connect(sfxGain);
      activeSfx++;
      s.onended = function () { activeSfx = Math.max(0, activeSfx - 1); try { s.disconnect(); } catch (e) { /* ignore */ } power(); };
      s.start(ctx.currentTime + delay);
      return 'file';
    }
    if (mode === 'element' && sfxEl[role] && st[role] !== 'failed' && st[role] !== 'missing') {
      var el = sfxEl[role];
      setTimeout(function () {
        try { var a = el.cloneNode(true); a.volume = SFX_VOL; quiet(a.play()); } catch (e) { /* ignore */ }
      }, Math.round(delay * 1000));
      return 'file';
    }
    var gone = st[role] === 'failed' || st[role] === 'missing';
    var S = root.LuluSpeech;
    if (gone && SYNTH[role] && S && S.sfx && S.sfx[SYNTH[role]]) {
      var f = S.sfx[SYNTH[role]];
      if (delay) setTimeout(f, Math.round(delay * 1000)); else f();
      return 'synth';
    }
    return gone ? 'none' : 'wait';   // wait = still loading, or before the first tap
  }

  // ---------- <audio> element fallback (file://, or WebAudio could not decode)
  function elementSetup() {
    if (!bgmEl && st.bgm !== 'missing') useBgmElement();
    ROLES.forEach(function (r) {
      if (sfxEl[r]) return;
      try {
        var a = new root.Audio();
        a.preload = 'auto';
        a.addEventListener('error', function () { st[r] = 'failed'; log('load-failed', r, 'element'); });
        a.addEventListener('canplaythrough', function () { if (st[r] !== 'failed') st[r] = 'ready'; });
        st[r] = 'loading';
        a.src = SFX_DIR + r + '.mp3';
        sfxEl[r] = a;
      } catch (e) { st[r] = 'failed'; }
    });
  }
  function useBgmElement() {
    if (bgmEl || !root.Audio) { if (!root.Audio) st.bgm = 'failed'; return; }
    try {
      var a = new root.Audio();
      a.loop = true;
      a.preload = 'auto';
      a.volume = 0.5;
      elVolOk = Math.abs(a.volume - 0.5) < 0.01;   // iOS: volume is read-only, so ducking pauses instead
      a.volume = 0;
      a.addEventListener('error', function () { st.bgm = 'failed'; log('load-failed', 'bgm', 'element'); bgmEl = null; });
      a.src = BGM_URL;
      bgmEl = a;
      st.bgm = 'element';
      log('bgm-element');
    } catch (e) { bgmEl = null; st.bgm = 'failed'; }
  }
  function elementUnlock() {
    if (!bgmEl || !on.music || hidden) return;
    if (bgmEl.paused) {
      var p = bgmEl.play();
      if (p && p.then) p.then(function () { st.bgm = 'playing'; elRamp(target(), FADE_IN); }, noop);
      else elRamp(target(), FADE_IN);
    } else elRamp(target(), FADE_IN);
  }
  function elRamp(to, dur, hold) {
    if (!bgmEl) return;
    clearInterval(elTimer);
    if (!elVolOk) {   // no volume control: pause while down, play again when up
      if (to <= 0) { bgmEl.pause(); elVol = 0; }
      else setTimeout(function () { if (target() > 0 && bgmEl) { quiet(bgmEl.play()); elVol = to; } }, Math.round((hold || 0) * 1000));
      return;
    }
    var from = elVol, t0 = now() + (hold || 0) * 1000, ms = Math.max(1, dur * 1000);
    elTimer = setInterval(function () {
      var k = Math.max(0, Math.min(1, (now() - t0) / ms));
      elVol = from + (to - from) * k;
      try { bgmEl.volume = Math.max(0, Math.min(1, elVol)); } catch (e) { /* ignore */ }
      if (k >= 1) {
        clearInterval(elTimer);
        if (to <= 0 && (!on.music || hidden)) bgmEl.pause();
      }
    }, 20);
  }

  // ---------- tab hidden / shown (spec 14-6)
  if (doc && doc.addEventListener) {
    doc.addEventListener('visibilitychange', function () {
      hidden = !!doc.hidden;
      log('hidden', hidden);
      if (ctx) {
        if (hidden) { ramp(0, HIDE_OUT); power(HIDE_OUT); }
        else { power(); ramp(target(), FADE_IN); }
      }
      if (bgmEl) { if (hidden) elRamp(0, HIDE_OUT); else elementUnlock(); }
    });
    // first tap / key starts sound; several event types because iOS only counts some of them as a "user gesture"
    ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'].forEach(function (type) {
      doc.addEventListener(type, unlock, true);
    });
  }

  // start downloading at once (spec 14-2); file:// cannot fetch, so it uses <audio> elements instead
  if (mode === 'webaudio') fetchAll(); else elementSetup();

  function rms(an) {
    if (!an) return 0;
    var a = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(a);
    var s = 0;
    for (var i = 0; i < a.length; i++) s += a[i] * a[i];
    return Math.sqrt(s / a.length);
  }

  root.LuluAudio = {
    unlock: unlock, play: play, duck: duck, setMusic: setMusic, setSfx: setSfx,
    settings: function () { return { music: on.music, sfx: on.sfx }; },
    ROLES: ROLES,
    VOL: { BGM_VOL: BGM_VOL, SFX_VOL: SFX_VOL, DUCK_OUT: DUCK_OUT, DUCK_HOLD: DUCK_HOLD, DUCK_IN: DUCK_IN, FADE_IN: FADE_IN, LOOP_SEC: LOOP_SEC },
    stats: stats,
    // for tools/ and evidence scripts only
    _debug: {
      ctx: function () { return ctx; },
      bgmGain: function () { return bgmGain; },
      sfxGain: function () { return sfxGain; },
      bgmAnalyser: function () { return bgmAn; },
      sfxAnalyser: function () { return sfxAn; },
      bgmRms: function () { return rms(bgmAn); },
      sfxRms: function () { return rms(sfxAn); },
      buffer: function (k) { return buf[k || 'bgm'] || null; },
      loop: function () { return loop; },
      findLoop: findLoop,
      state: function () {
        var o = {}; Object.keys(st).forEach(function (k) { o[k] = st[k]; });
        return { mode: mode, ctx: ctx ? ctx.state : 'none', rate: ctx ? ctx.sampleRate : 0, ducked: ducked, hidden: hidden,
          music: on.music, sfx: on.sfx, gain: bgmGain ? bgmGain.gain.value : (bgmEl ? elVol : 0), activeSfx: activeSfx, files: o,
          el: bgmEl ? { paused: bgmEl.paused, time: bgmEl.currentTime, volume: bgmEl.volume } : null };
      },
      seek: function (sec) { if (ctx && buf.bgm && loop) startBgm(sec); },
      bgmSource: function () { return bgmSrc; },
      element: function () { return bgmEl; }
    }
  };
})(window);
