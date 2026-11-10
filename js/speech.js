/* Lulu Island v1 - English speech (Web Speech API) and tiny synthesized sound effects (WebAudio).
   Voice ranking and the SAY table follow the old page (Downloads/小學英檢單字發音.html lines 121-149).
   v1.2: say() silences the background music (LuluAudio.duck) while it reads; the synthesized effects below are now
   only the fallback for an effect file that did not load (js/audio.js). */
(function (root) {
  'use strict';

  var synth = root.speechSynthesis || null;
  var voices = [], enVoices = [], chosen = null, prefer = null, ready = false, subs = [];

  function rankEn(v) {
    var s = 0, n = v.name.toLowerCase();
    if (/^en[-_]us/i.test(v.lang)) s += 30; else if (/^en[-_]gb/i.test(v.lang)) s += 20; else if (/^en/i.test(v.lang)) s += 10;
    if (/natural|neural|enhanced|premium/.test(n)) s += 8;
    if (/samantha|google us english|aria|jenny|ava|allison/.test(n)) s += 6;
    if (v.localService) s += 1;
    return s;
  }

  function status() {
    return {
      supported: !!synth,
      ready: ready,
      hasEnglish: enVoices.length > 0,
      voices: enVoices.map(function (v) { return { name: v.name, lang: v.lang }; }),
      current: chosen ? chosen.name : null
    };
  }

  function refresh() {
    voices = synth ? synth.getVoices() : [];
    enVoices = voices.filter(function (v) { return /^en/i.test(v.lang); })
      .sort(function (a, b) { return rankEn(b) - rankEn(a); });
    chosen = null;
    for (var i = 0; i < enVoices.length; i++) if (enVoices[i].name === prefer) chosen = enVoices[i];
    if (!chosen) chosen = enVoices[0] || null;
    if (voices.length) ready = true;
    var st = status();
    subs.forEach(function (f) { try { f(st); } catch (e) { /* ignore */ } });
  }

  function onChange(f) { subs.push(f); f(status()); }
  function setVoice(name) { prefer = name || null; refresh(); }

  if (synth) {
    refresh();
    if (synth.addEventListener) synth.addEventListener('voiceschanged', refresh);
    else synth.onvoiceschanged = refresh;
    setTimeout(function () { ready = true; refresh(); }, 2500);
  } else {
    ready = true;
  }

  var SAY = { 'Mr.': 'Mister', 'Mrs.': 'Missus', 'PE': 'P.E.', 'MRT': 'M.R.T.', 'USA': 'U.S.A.', 'UK': 'U.K.', 'TV': 'T.V.', 'a': 'a' };
  // "mouse / mice" is read as "mouse, mice".
  function spoken(en) { return SAY[en] || String(en).replace(/\s*\/\s*/g, ', '); }

  // v1.2 (spec 14-3): the background music goes to 0 while English is read and comes back after it, whatever way
  // say() ends. Only the newest say() brings it back (an interrupted one must not, the new one is still talking).
  // No English voice ('none'): nothing is said, but the music stays down for the same 2.5 s window app.js waits.
  var NONE_HOLD = 2500;
  var sayNo = 0, sayOpen = false;
  function duckMusic(down) {
    var A = root.LuluAudio;
    if (!A || !A.duck) return 0;
    try { return A.duck(down) || 0; } catch (e) { return 0; }
  }

  // Resolves with how it finished:
  //   'end'          onend fired: the word was read to the end
  //   'interrupted'  a newer say() / stop() cut it off
  //   'error'        the browser reported an error
  //   'none'         this device cannot speak English (nothing was said)
  //   'timeout'      onend never came (safety timer)
  function say(text) {
    var my = ++sayNo, t0 = Date.now();
    sayOpen = true;
    var lead = duckMusic(true);   // ms until the music is silent (0 when it is not playing)
    return speakNow(text, lead, function () { return my !== sayNo; }).then(function (how) {
      function release() { if (my === sayNo && sayOpen) { sayOpen = false; duckMusic(false); } }
      var rest = how === 'none' ? NONE_HOLD - (Date.now() - t0) : 0;
      if (rest > 0) setTimeout(release, rest); else release();
      return how;
    });
  }
  function speakNow(text, lead, stale) {
    return new Promise(function (res) {
      if (!synth) return res('none');
      if (ready && voices.length && !enVoices.length) return res('none');   // has voices, none English: stay silent
      var u = new SpeechSynthesisUtterance(text);
      if (chosen) u.voice = chosen;
      u.lang = chosen ? chosen.lang : 'en-US';
      u.rate = 0.8;      // v1.2.1 (Tai 261109: louder, clearer): slower than default so each sound is heard
      u.volume = 1;      // 1 is the engine's maximum; the music is at 0 while this plays
      var done = false;
      function fin(how) { if (!done) { done = true; res(how); } }
      u.onend = function () { fin('end'); };
      u.onerror = function (e) {
        var why = e && e.error;
        fin(why === 'interrupted' || why === 'canceled' ? 'interrupted' : 'error');
      };
      setTimeout(function () { fin('timeout'); }, 1500 + text.length * 260);   // some browsers never fire onend
      try {
        synth.cancel();
        // Chrome drops speak() right after cancel(); v1.2: also wait until the music has faded out
        setTimeout(function () {
          if (stale()) { fin('interrupted'); return; }   // a newer say() / stop() came while waiting: never speak late
          try { synth.speak(u); } catch (e) { fin('error'); }
        }, Math.max(40, lead || 0));
      } catch (e) { fin('error'); }
    });
  }
  function sayWord(en) { return say(spoken(en)); }
  function stop() {
    sayNo++;   // a say() still waiting to start is dropped
    if (sayOpen) { sayOpen = false; duckMusic(false); }
    try { if (synth) synth.cancel(); } catch (e) { /* ignore */ }
  }

  // ---------- sound effects (synthesized, no audio files)
  var ac = null;
  function audio() {
    if (!ac) {
      var AC = root.AudioContext || root.webkitAudioContext;
      if (AC) { try { ac = new AC(); } catch (e) { ac = null; } }
    }
    if (ac && ac.state === 'suspended') { try { ac.resume(); } catch (e) { /* ignore */ } }
    return ac;
  }
  function tone(freq, start, dur, type, vol, slideTo) {
    var a = audio();
    if (!a) return;
    var t = a.currentTime + start;
    var o = a.createOscillator(), g = a.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(a.destination);
    o.start(t); o.stop(t + dur + 0.05);
  }
  var sfx = {
    ding: function () { tone(988, 0, 0.18, 'sine', 0.22); tone(1319, 0.09, 0.3, 'sine', 0.2); },
    boop: function () { tone(260, 0, 0.28, 'triangle', 0.22, 150); },
    pop: function () { tone(520, 0, 0.09, 'square', 0.06, 900); },
    tada: function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, i * 0.11, 0.35, 'triangle', 0.16); }); }
  };

  // iOS: sound is only allowed after a tap. The first tap speaks an empty sentence and wakes WebAudio.
  var unlocked = false;
  function unlock() {
    if (unlocked) return;
    unlocked = true;
    try {
      if (synth) { var u = new SpeechSynthesisUtterance(' '); u.volume = 0; synth.speak(u); }
    } catch (e) { /* ignore */ }
    audio();
  }

  root.LuluSpeech = {
    status: status, onChange: onChange, setVoice: setVoice, refresh: refresh,
    spoken: spoken, say: say, sayWord: sayWord, stop: stop, unlock: unlock, sfx: sfx
  };
})(window);
