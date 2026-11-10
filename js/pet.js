/* Lulu Island v1 - pet view (2D SVG). The only file that knows what Lulu looks like.
   Shapes: art/sketch/lulu_island_sketch.html symbols (#body #face #face-yum #face-sad #face-sleep #egg #pet-sprout
   #pet-crown #form-lion) with the final front colours from art/ref/lulu_front.html.
   Public API (keep it when swapping in a 3D version):
     LuluPet.render(el, stage, mood)   stage: egg|small|normal|big|crown   mood: normal|hungry|yum|sad|sleep
     LuluPet.hatch(el)  -> Promise     egg cracks, small Lulu pops out (el ends showing small/yum)
     LuluPet.grow(el)   -> Promise     small Lulu grows into Lulu (el ends showing normal/yum)
     LuluPet.bounce(el)                one happy hop
     LuluPet.mouth(el)  -> {x, y}      page point where a fruit should fly into
     LuluPet.formArt(name) -> svg      art for transform cards (v1: 'lion' preview card only)
     window.renderPet = LuluPet.render */
(function (root) {
  'use strict';

  var C = {
    body: '#a3dccb', deep: '#78c0a9', belly: '#e6f7f1', cheek: '#f7a8b8', ink: '#1d2b3a',
    ear: '#f7b4c2', tuft: '#8fcdb9', arm: '#9ad6c3', foot: '#79bfa8', tail: '#8fcdb9', tailHi: '#a9ddcd',
    spot: '#a3dccb', sprout: '#5fae53', gold: '#f3c53d', ruby: '#e2574c', tear: '#4fa9db'
  };
  // stage -> scale inside the 100x100 box (feet stay on the ground at y=96)
  var SCALE = { egg: 1, small: 0.78, normal: 1, big: 1, crown: 1 };

  // ---------- one-time defs + styles
  var installed = false;
  function install() {
    if (installed) return;
    installed = true;
    var holder = document.createElement('div');
    holder.innerHTML =
      '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>' +
      '<radialGradient id="lp-g" cx="42%" cy="32%" r="75%"><stop offset="0" stop-color="#bdeadb"/><stop offset=".6" stop-color="#a3dccb"/><stop offset="1" stop-color="#78c0a9"/></radialGradient>' +
      '<radialGradient id="lp-ge" cx="40%" cy="30%" r="80%"><stop offset="0" stop-color="#b4e6d6"/><stop offset="1" stop-color="#7fc4ae"/></radialGradient>' +
      '<radialGradient id="lp-egg" cx="40%" cy="30%" r="80%"><stop offset="0" stop-color="#fff6dc"/><stop offset=".7" stop-color="#f3dfae"/><stop offset="1" stop-color="#e2c784"/></radialGradient>' +
      '<clipPath id="lp-top"><polygon points="0,0 100,0 100,56 90,50 80,58 70,50 60,58 50,50 40,58 30,50 20,58 10,50 0,56"/></clipPath>' +
      '<clipPath id="lp-bot"><polygon points="0,56 10,50 20,58 30,50 40,58 50,50 60,58 70,50 80,58 90,50 100,56 100,100 0,100"/></clipPath>' +
      '</defs></svg>';
    document.body.appendChild(holder.firstChild);
    var st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  var CSS = [
    '.lp-svg{width:100%;height:100%;overflow:visible}',
    '.lp-all{transform-box:view-box;transform-origin:50px 96px;animation:lp-breathe 2.6s ease-in-out infinite}',
    '.lp-m-hungry .lp-all{animation:lp-sway 1.6s ease-in-out infinite}',
    '.lp-m-yum .lp-all{animation:lp-hop .55s cubic-bezier(.3,1.6,.6,1) 2}',
    '.lp-m-sad .lp-all{animation:lp-shiver .25s linear 4}',
    '.lp-m-sleep .lp-all{animation:lp-breathe 4s ease-in-out infinite}',
    '.lp-eyes{transform-box:fill-box;transform-origin:center;animation:lp-blink 4.6s infinite}',
    '.lp-tear{animation:lp-tear 1s ease-in infinite}',
    '.lp-zz text{animation:lp-zz 2.4s ease-in-out infinite}',
    '.lp-zz text:nth-child(2){animation-delay:.8s}',
    '.lp-s-egg.lp-m-hungry .lp-all{animation:lp-wobble 2.2s ease-in-out infinite}',
    '.lp-hop{animation:lp-hop .5s cubic-bezier(.3,1.6,.6,1)}',
    /* hatch */
    '.lp-hatch .lp-shell{transform-box:view-box;transform-origin:50px 94px}',
    '.lp-hatch.p1 .lp-shell{animation:lp-wobble .4s ease-in-out 3}',
    '.lp-crack{opacity:0;transition:opacity .2s}',
    '.lp-hatch.p2 .lp-crack{opacity:1}',
    '.lp-hatch.p3 .lp-crack{opacity:0}',
    '.lp-top,.lp-bot{transform-box:view-box;transition:transform .7s cubic-bezier(.3,.8,.4,1),opacity .7s}',
    '.lp-hatch.p3 .lp-top{transform:translate(-14px,-46px) rotate(-28deg);opacity:0}',
    '.lp-hatch.p3 .lp-bot{transform:translate(0,22px);opacity:0}',
    '.lp-baby{opacity:0;transform-box:view-box;transform-origin:50px 96px;transform:scale(.2)}',
    '.lp-hatch.p3 .lp-baby{opacity:1;transform:scale(1);transition:transform .6s cubic-bezier(.3,1.7,.5,1) .15s,opacity .2s .15s}',
    '.lp-spark{opacity:0;transform-box:fill-box;transform-origin:center}',
    '.lp-hatch.p3 .lp-spark,.lp-growing.p3 .lp-spark{animation:lp-spark .9s ease-out .2s forwards}',
    /* grow */
    '.lp-growing .lp-scale{transition:transform 1s cubic-bezier(.3,1.6,.5,1)}',
    '.lp-growing.p1 .lp-all{animation:lp-pulse .45s ease-in-out 3}',
    '.lp-ring{opacity:0;transform-box:fill-box;transform-origin:center}',
    '.lp-growing.p2 .lp-ring{animation:lp-ring 1s ease-out forwards}',
    '@keyframes lp-breathe{0%,100%{transform:scale(1,1)}50%{transform:scale(1.025,.975)}}',
    '@keyframes lp-sway{0%,100%{transform:rotate(-3deg)}50%{transform:rotate(3deg)}}',
    '@keyframes lp-hop{0%,100%{transform:translateY(0)}40%{transform:translateY(-12px) scale(1.04,.96)}}',
    '@keyframes lp-shiver{0%,100%{transform:translateX(0)}25%{transform:translateX(-2px)}75%{transform:translateX(2px)}}',
    '@keyframes lp-blink{0%,93%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}',
    '@keyframes lp-tear{0%{transform:translateY(0);opacity:1}100%{transform:translateY(10px);opacity:0}}',
    '@keyframes lp-zz{0%{transform:translate(0,4px);opacity:0}30%{opacity:1}100%{transform:translate(6px,-10px);opacity:0}}',
    '@keyframes lp-wobble{0%,100%{transform:rotate(0)}25%{transform:rotate(-7deg)}75%{transform:rotate(7deg)}}',
    '@keyframes lp-pulse{50%{transform:scale(1.08)}}',
    '@keyframes lp-spark{0%{opacity:0;transform:scale(.2)}40%{opacity:1;transform:scale(1.2)}100%{opacity:0;transform:scale(.6)}}',
    '@keyframes lp-ring{0%{opacity:.9;transform:scale(.3)}100%{opacity:0;transform:scale(1.6)}}'
  ].join('\n');

  // ---------- pieces
  function bodyLulu() {
    return '' +
      '<ellipse cx="30" cy="27" rx="9.5" ry="14" fill="url(#lp-ge)" transform="rotate(-18 30 27)"/>' +
      '<ellipse cx="70" cy="27" rx="9.5" ry="14" fill="url(#lp-ge)" transform="rotate(18 70 27)"/>' +
      '<ellipse cx="30" cy="28" rx="5" ry="8.5" fill="' + C.ear + '" transform="rotate(-18 30 28)"/>' +
      '<ellipse cx="70" cy="28" rx="5" ry="8.5" fill="' + C.ear + '" transform="rotate(18 70 28)"/>' +
      '<circle cx="86" cy="82" r="7" fill="' + C.tail + '"/><circle cx="84" cy="80" r="2.5" fill="' + C.tailHi + '"/>' +
      '<ellipse cx="38" cy="91" rx="9" ry="4.5" fill="' + C.foot + '"/><ellipse cx="62" cy="91" rx="9" ry="4.5" fill="' + C.foot + '"/>' +
      '<ellipse cx="50" cy="58" rx="36" ry="33" fill="url(#lp-g)"/>' +
      '<ellipse cx="50" cy="73" rx="20" ry="12" fill="' + C.belly + '"/>' +
      '<ellipse cx="16" cy="68" rx="7" ry="5" fill="' + C.arm + '" transform="rotate(-25 16 68)"/>' +
      '<ellipse cx="84" cy="68" rx="7" ry="5" fill="' + C.arm + '" transform="rotate(25 84 68)"/>' +
      '<path d="M50 26 q-1 -9 7 -12 q-4 5 -2 11z" fill="' + C.tuft + '"/>';
  }

  // flat-colour body for transform cards (sketch #body)
  function bodyFlat(color) {
    return '' +
      '<ellipse cx="29" cy="25" rx="9.5" ry="14" fill="' + color + '" transform="rotate(-18 29 25)"/>' +
      '<ellipse cx="71" cy="25" rx="9.5" ry="14" fill="' + color + '" transform="rotate(18 71 25)"/>' +
      '<ellipse cx="29" cy="26" rx="5" ry="8.5" fill="' + C.cheek + '" opacity=".6" transform="rotate(-18 29 26)"/>' +
      '<ellipse cx="71" cy="26" rx="5" ry="8.5" fill="' + C.cheek + '" opacity=".6" transform="rotate(18 71 26)"/>' +
      '<ellipse cx="38" cy="92" rx="9" ry="4.5" fill="' + color + '"/><ellipse cx="62" cy="92" rx="9" ry="4.5" fill="' + color + '"/>' +
      '<ellipse cx="38" cy="92" rx="9" ry="4.5" fill="#000" opacity=".15"/><ellipse cx="62" cy="92" rx="9" ry="4.5" fill="#000" opacity=".15"/>' +
      '<ellipse cx="50" cy="58" rx="36" ry="33" fill="' + color + '"/>' +
      '<ellipse cx="50" cy="73" rx="20" ry="12" fill="#fff" opacity=".4"/>' +
      '<ellipse cx="16" cy="68" rx="7" ry="5" fill="' + color + '" transform="rotate(-25 16 68)"/>' +
      '<ellipse cx="84" cy="68" rx="7" ry="5" fill="' + color + '" transform="rotate(25 84 68)"/>' +
      '<path d="M50 26 q-1 -9 7 -12 q-4 5 -2 11z" fill="' + color + '"/>';
  }

  function cheeks(r, op) {
    return '<circle cx="25" cy="67" r="' + r + '" fill="' + C.cheek + '" opacity="' + op + '"/>' +
      '<circle cx="75" cy="67" r="' + r + '" fill="' + C.cheek + '" opacity="' + op + '"/>';
  }
  function bigEyes() {
    return '<g class="lp-eyes">' +
      '<circle cx="38" cy="57" r="7.5" fill="' + C.ink + '"/><circle cx="62" cy="57" r="7.5" fill="' + C.ink + '"/>' +
      '<circle cx="40.5" cy="54" r="2.8" fill="#fff"/><circle cx="64.5" cy="54" r="2.8" fill="#fff"/>' +
      '<circle cx="35.5" cy="60" r="1.3" fill="#fff"/><circle cx="59.5" cy="60" r="1.3" fill="#fff"/></g>';
  }

  var FACES = {
    normal: function () {
      return bigEyes() + cheeks(6, 0.8) +
        '<path d="M46 67 q2 3 4 0 q2 3 4 0" fill="none" stroke="' + C.ink + '" stroke-width="1.8" stroke-linecap="round"/>';
    },
    hungry: function () {   // big eyes, worried brows, little open mouth, a drool drop
      return bigEyes() + cheeks(5.5, 0.6) +
        '<path d="M30 48 l9 -3 M70 48 l-9 -3" stroke="' + C.ink + '" stroke-width="2" stroke-linecap="round"/>' +
        '<ellipse cx="50" cy="69" rx="3" ry="3.6" fill="' + C.ink + '"/>' +
        '<path d="M54.5 71 q1.6 3 0 4.4 q-1.6 -1.4 0 -4.4z" fill="' + C.tear + '" opacity=".8"/>';
    },
    yum: function () {
      return '<path d="M31 57 q7 -9 14 0 M55 57 q7 -9 14 0" fill="none" stroke="' + C.ink + '" stroke-width="3" stroke-linecap="round"/>' +
        '<ellipse cx="50" cy="69" rx="6.5" ry="5.5" fill="' + C.ink + '"/><ellipse cx="50" cy="71.5" rx="3.5" ry="2.2" fill="' + C.cheek + '"/>' +
        '<circle cx="24" cy="66" r="6.5" fill="' + C.cheek + '" opacity=".85"/><circle cx="76" cy="66" r="6.5" fill="' + C.cheek + '" opacity=".85"/>';
    },
    sad: function () {
      return '<circle cx="38" cy="58" r="6.5" fill="' + C.ink + '"/><circle cx="62" cy="58" r="6.5" fill="' + C.ink + '"/>' +
        '<circle cx="40" cy="56" r="2.2" fill="#fff"/><circle cx="64" cy="56" r="2.2" fill="#fff"/>' +
        '<path d="M29 50 l11 -4 M71 50 l-11 -4" stroke="' + C.ink + '" stroke-width="2.2" stroke-linecap="round"/>' +
        '<path d="M45 72 q5 -4 10 0" fill="none" stroke="' + C.ink + '" stroke-width="1.8" stroke-linecap="round"/>' +
        '<path class="lp-tear" d="M70 61 q4 7 0 10 q-4 -3 0 -10z" fill="' + C.tear + '"/>' +
        cheeks(5, 0.6);
    },
    sleep: function () {
      return '<path d="M31 58 q7 7 14 0 M55 58 q7 7 14 0" fill="none" stroke="' + C.ink + '" stroke-width="3" stroke-linecap="round"/>' +
        '<circle cx="50" cy="69" r="2.2" fill="' + C.ink + '"/>' + cheeks(6, 0.7) +
        '<g class="lp-zz" fill="' + C.tear + '" font-family="Arial,sans-serif" font-weight="700">' +
        '<text x="80" y="24" font-size="14">z</text><text x="90" y="12" font-size="10">z</text></g>';
    }
  };

  function sprout() {
    return '<path d="M52 18 q0 -14 11 -19 q-2 13 -11 19z M52 18 q0 -12 -10 -17 q1 12 10 17z" fill="' + C.sprout + '"/>';
  }
  function crown() {
    return '<path d="M36 17 l28 0 l-3 -12 l-8 6 l-3 -8 l-3 8 l-8 -6z" fill="' + C.gold + '"/><circle cx="50" cy="12" r="2" fill="' + C.ruby + '"/>';
  }
  function shadow(rx) { return '<ellipse cx="50" cy="96" rx="' + rx + '" ry="3.6" fill="#000" opacity=".1"/>'; }
  function scaleAttr(s) {
    if (s === 1) return '';
    return ' transform="translate(' + (50 * (1 - s)).toFixed(2) + ' ' + (96 * (1 - s)).toFixed(2) + ') scale(' + s + ')"';
  }

  function petMarkup(stage, mood) {
    var face = (FACES[mood] || FACES.normal)();
    var extra = '';
    if (stage === 'normal') extra = sprout();
    if (stage === 'big') extra = sprout() + '<path d="M40 22 q-6 -8 -2 -14 q4 8 2 14z" fill="' + C.sprout + '"/>';
    if (stage === 'crown') extra = crown();
    return '<g class="lp-all">' + bodyLulu() + face + extra +
      '<circle class="lp-mouth" cx="50" cy="69" r=".5" fill="none"/></g>';
  }

  function eggShape() {
    return '<ellipse cx="50" cy="58" rx="28" ry="36" fill="url(#lp-egg)"/>' +
      '<circle cx="40" cy="46" r="5" fill="' + C.spot + '"/><circle cx="60" cy="64" r="6" fill="' + C.spot + '"/><circle cx="50" cy="82" r="4" fill="' + C.spot + '"/>' +
      '<ellipse cx="41" cy="35" rx="5" ry="8.5" fill="#fff" opacity=".5" transform="rotate(-22 41 35)"/>' +
      '<path d="M36 40 l6 6 l-4 6 l6 5" fill="none" stroke="' + C.ink + '" stroke-width="2" opacity=".35" stroke-linecap="round"/>';
  }
  function eggMarkup() {
    return '<g class="lp-all">' + eggShape() + '<circle class="lp-mouth" cx="50" cy="40" r=".5" fill="none"/></g>';
  }

  function svgOpen(stage, mood, extraCls) {
    return '<svg class="lp-svg lp-s-' + stage + ' lp-m-' + mood + (extraCls ? ' ' + extraCls : '') + '" viewBox="0 0 100 100" aria-hidden="true">';
  }

  function render2d(el, stage, mood) {
    install();
    stage = SCALE[stage] ? stage : 'egg';
    mood = FACES[mood] ? mood : 'normal';
    var s = SCALE[stage];
    var html = svgOpen(stage, mood) + shadow(stage === 'egg' ? 22 : 30 * s) +
      '<g class="lp-scale"' + scaleAttr(s) + '>' + (stage === 'egg' ? eggMarkup() : petMarkup(stage, mood)) + '</g></svg>';
    el.innerHTML = html;
    el.setAttribute('data-stage', stage);
    el.setAttribute('data-mood', mood);
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', NAMES[stage] + '・' + MOODS[mood]);
  }
  var NAMES = { egg: '蛋', small: '小嚕', normal: '嚕嚕', big: '大嚕', crown: '皇冠嚕' };
  var MOODS = { normal: '平常', hungry: '餓了', yum: '吃到了', sad: '難過', sleep: '睡著' };

  function sparks() {
    var pts = [[18, 30, 6], [84, 26, 5], [12, 66, 4], [90, 62, 6], [50, 10, 5]];
    return pts.map(function (p) {
      var x = p[0], y = p[1], r = p[2], q = r * 0.28;
      return '<path class="lp-spark" fill="' + C.gold + '" d="M' + x + ' ' + (y - r) + ' L' + (x + q) + ' ' + (y - q) + ' L' + (x + r) + ' ' + y +
        ' L' + (x + q) + ' ' + (y + q) + ' L' + x + ' ' + (y + r) + ' L' + (x - q) + ' ' + (y + q) + ' L' + (x - r) + ' ' + y + ' L' + (x - q) + ' ' + (y - q) + 'z"/>';
    }).join('');
  }

  var timing = { slow: 1 };   // tests set slow > 1 to screenshot the middle of hatch / grow
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms * timing.slow); }); }

  // egg shakes, cracks, the two halves fly apart, small Lulu pops out
  // v1.3: with 3D on, the egg part stays 2D; at the break a flash + streamers, then the 3D baby pops (pet3d.js)
  function hatch2d(el, use3d) {
    install();
    var s = SCALE.small;
    el.innerHTML = svgOpen('egg', 'normal', 'lp-hatch') + shadow(22) +
      (use3d ? '' : '<g class="lp-baby"><g' + scaleAttr(s) + '>' + petMarkup('small', 'yum') + '</g></g>') +
      '<g class="lp-shell">' +
      '<g class="lp-bot" clip-path="url(#lp-bot)">' + eggShape() + '</g>' +
      '<g class="lp-top" clip-path="url(#lp-top)">' + eggShape() + '</g>' +
      '<polyline class="lp-crack" points="22,55 30,50 40,58 50,50 60,58 70,50 78,55" fill="none" stroke="' + C.ink + '" stroke-width="2" stroke-linejoin="round" opacity=".7"/>' +
      '</g>' + sparks() + (use3d ? burst() : '') + '</svg>';
    var svg = el.firstChild;
    return wait(50)
      .then(function () { svg.classList.add('p1'); return wait(1250); })
      .then(function () { svg.classList.add('p2'); return wait(450); })
      .then(function () {
        svg.classList.add('p3');
        if (use3d) {
          svg.classList.add('lp3-fx', 'on');
          try { D3.api.pop(el); } catch (e) { fail('hatch: ' + e.message); }
        }
        return wait(1300);
      })
      .then(function () {
        if (use3d && svg.parentNode === el) el.removeChild(svg);
        render(el, 'small', 'yum', true);
      });
  }

  // flash + streamers for the 3D hatch / grow (styles live in pet3d.js)
  function burst() {
    var cols = ['#f3c53d', '#f0a04b', '#6cc27a', '#ff8a5b', '#74c0fc', '#f7a8b8'], out = '';
    out += '<circle class="lp3-flash" cx="50" cy="60" r="38" fill="#fffbe6"/>';
    for (var i = 0; i < 12; i++) {
      var a = i / 12 * Math.PI * 2, dx = Math.round(Math.cos(a) * 46), dy = Math.round(Math.sin(a) * 40 - 10);
      out += '<rect class="lp3-st" x="48" y="56" width="4" height="9" rx="1" fill="' + cols[i % cols.length] +
        '" style="--dx:' + dx + 'px;--dy:' + dy + 'px;transform-box:fill-box;transform-origin:center;animation-delay:' + (i % 3) * 0.05 + 's"/>';
    }
    return out;
  }

  // small Lulu pulses, a ring flashes, she grows to full size with a sprout
  function grow2d(el) {
    install();
    el.innerHTML = svgOpen('small', 'yum', 'lp-growing') + shadow(24) +
      '<circle class="lp-ring" cx="50" cy="58" r="40" fill="none" stroke="' + C.gold + '" stroke-width="4"/>' +
      '<g class="lp-scale" style="transform-box:view-box;transform-origin:50px 96px;transform:scale(' + SCALE.small + ')">' +
      petMarkup('small', 'yum') + '</g>' + sparks() + '</svg>';
    var svg = el.firstChild;
    return wait(50)
      .then(function () { svg.classList.add('p1'); return wait(1400); })
      .then(function () {
        svg.classList.add('p2');
        svg.querySelector('.lp-scale').style.transform = 'scale(1)';
        return wait(1000);
      })
      .then(function () {
        el.innerHTML = svgOpen('normal', 'yum', 'lp-growing p3') + shadow(30) +
          '<g class="lp-scale">' + petMarkup('normal', 'yum') + '</g>' + sparks() + '</svg>';
        return wait(1100);
      })
      .then(function () { render(el, 'normal', 'yum'); });
  }

  // v1.3 3D grow: spin twice, flash, spring to the new size, the sprout pops out (2D ring / sparks on top)
  function grow3d(el) {
    install();
    D3.api.grow(el, 'small', 'normal');
    var fx = document.createElement('div');
    fx.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none';
    fx.innerHTML = '<svg class="lp-svg lp3-fx" viewBox="0 0 100 100" style="position:absolute;left:0;top:0">' +
      '<circle class="lp3-ring" cx="50" cy="58" r="40" fill="none" stroke="' + C.gold + '" stroke-width="4"/>' + burst() + '</svg>';
    el.appendChild(fx);
    var svg = fx.firstChild;
    return wait(1450)
      .then(function () { svg.classList.add('on'); return wait(1000); })
      .then(function () { svg.classList.add('lp-growing', 'p3'); svg.innerHTML += sparks(); return wait(1100); })
      .then(function () {
        if (fx.parentNode) fx.parentNode.removeChild(fx);
        render(el, 'normal', 'yum', true);
      });
  }

  function bounce2d(el) {
    var svg = el.querySelector('svg');
    if (!svg) return;
    svg.classList.remove('lp-hop');
    void svg.getBoundingClientRect();
    svg.classList.add('lp-hop');
  }

  function mouth2d(el) {
    var m = el.querySelector('.lp-mouth');
    var r = (m || el).getBoundingClientRect();
    if (!m) return { x: r.left + r.width / 2, y: r.top + r.height * 0.7 };
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function formArt(name) {
    if (name !== 'lion') return '';
    install();
    return '<svg viewBox="0 0 100 100" aria-hidden="true">' +
      '<circle cx="50" cy="52" r="41" fill="#f0a24a"/>' +
      '<g fill="#f0a24a"><circle cx="50" cy="12" r="8"/><circle cx="79" cy="23" r="8"/><circle cx="91" cy="52" r="8"/><circle cx="79" cy="81" r="8"/><circle cx="21" cy="81" r="8"/><circle cx="9" cy="52" r="8"/><circle cx="21" cy="23" r="8"/></g>' +
      '<path d="M84 86 q12 -2 10 -14" fill="none" stroke="#f6c98a" stroke-width="5" stroke-linecap="round"/><circle cx="95" cy="71" r="4.5" fill="#f0a24a"/>' +
      bodyFlat('#f6c98a') + FACES.normal() + '</svg>';
  }

  // ---------- v1.3: 3D or 2D (docs/spec_v1.md section 15). The egg and formArt stay 2D.
  // 3D needs http/https (module scripts and the .glb do not load from file://) + WebGL + settings.pet3d 'on'.
  // pet3d.js is injected only then; until it is ready, and whenever it fails, everything is the 2D pet above.
  var SELF = (document.currentScript && document.currentScript.src) || '';
  var LOAD_MAX = 8000;   // spec 15-6: not loaded in 8 s -> 2D this visit (the download goes on into the cache)
  var D3 = { pref: null, state: 'off', reason: 'not configured', api: null, injected: false, timer: 0, t0: 0, onAutoOff: null, waitedMs: null };
  var tracked = [];

  function canTry() {
    if (!/^https?:$/.test(location.protocol)) return 'file';
    if (!SELF) return 'no-script-src';
    if (!('noModule' in document.createElement('script'))) return 'no-module';
    try {
      var c = document.createElement('canvas');
      if (!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')))) return 'no-webgl';
    } catch (e) { return 'no-webgl'; }
    return '';
  }
  function config(o) {
    o = o || {};
    D3.onAutoOff = o.onAutoOff || null;
    setPref(o.pref || 'on');
  }
  function setPref(p) {
    D3.pref = p;
    if (p !== 'on') { D3.reason = p; to2d('off'); return; }
    try3d();
  }
  function try3d() {
    var why = canTry();
    if (why) { D3.state = 'off'; D3.reason = why; return; }
    if (D3.state === 'on' || D3.state === 'loading') return;
    if (D3.api && D3.api.stats.loadMs !== null) { go3d(); return; }
    D3.state = 'loading'; D3.reason = 'loading'; D3.t0 = Date.now();
    clearTimeout(D3.timer);
    D3.timer = setTimeout(function () {
      if (D3.state === 'loading') { D3.state = 'late'; D3.reason = 'late: model not ready in ' + LOAD_MAX + ' ms, 2D this visit'; }
    }, LOAD_MAX);
    if (D3.api) { startLoad(); return; }
    if (D3.injected) return;
    D3.injected = true;
    var s = document.createElement('script');
    s.type = 'module';
    s.src = SELF.replace(/pet\.js(\?.*)?$/, 'pet3d.js');
    s.onerror = function () { fail('module did not load'); };
    document.head.appendChild(s);
  }
  function startLoad() {
    D3.api.load().then(function () {
      D3.waitedMs = Date.now() - D3.t0;
      if (D3.state === 'loading' && D3.pref === 'on') go3d();
    }, function (e) { fail('model: ' + ((e && e.message) || e)); });
  }
  function go3d() {
    clearTimeout(D3.timer);
    D3.state = 'on'; D3.reason = '';
    D3.api.setEnabled(true);
    D3.api.measure();
    redraw();
  }
  function to2d(state) {
    clearTimeout(D3.timer);
    var was = D3.state;
    D3.state = state;
    if (D3.api) D3.api.setEnabled(false);
    if (was === 'on') redraw();
  }
  function fail(why) {
    D3.reason = why;
    to2d('failed');
  }
  function onSlow(fps) {
    D3.reason = 'slow: ' + fps + ' fps in the first 3 s';
    D3.pref = 'auto-off';
    to2d('auto-off');
    if (D3.api) D3.api.disposeAll();
    if (D3.onAutoOff) { try { D3.onAutoOff(fps); } catch (e) { /* the save is the app's business */ } }
  }
  // called by pet3d.js when its module has run
  function _module(api) {
    D3.api = api;
    api.onSlow = onSlow;
    if (D3.state === 'loading') startLoad();
  }
  // show the pets that are on the page again with the current mode (not the ones in the middle of hatch / grow)
  function redraw() {
    tracked.forEach(function (el) {
      if (el.isConnected && el._lp && !el._lpBusy) render(el, el._lp.stage, el._lp.mood, true);
    });
  }
  function on3d(el) { return D3.state === 'on' && D3.api && D3.api.attached(el); }

  function render(el, stage, mood, noJump) {
    stage = SCALE[stage] ? stage : 'egg';
    mood = FACES[mood] ? mood : 'normal';
    el._lp = { stage: stage, mood: mood };
    if (tracked.indexOf(el) < 0) tracked.push(el);
    if (stage !== 'egg' && D3.state === 'on') {
      try {
        D3.api.show(el, stage, mood, { noJump: !!noJump });
        el.setAttribute('data-stage', stage);
        el.setAttribute('data-mood', mood);
        el.setAttribute('data-pet', '3d');
        el.setAttribute('role', 'img');
        el.setAttribute('aria-label', NAMES[stage] + '・' + MOODS[mood]);
        return;
      } catch (e) { fail('render: ' + e.message); }
    }
    el.setAttribute('data-pet', '2d');
    render2d(el, stage, mood);
  }
  function busy(el, p) {
    el._lpBusy = true;
    return p.then(function (v) { el._lpBusy = false; return v; }, function (e) { el._lpBusy = false; throw e; });
  }
  function hatch(el) {
    el._lp = { stage: 'small', mood: 'yum' };
    if (tracked.indexOf(el) < 0) tracked.push(el);
    return busy(el, hatch2d(el, D3.state === 'on'));
  }
  function grow(el) {
    el._lp = { stage: 'normal', mood: 'yum' };
    if (tracked.indexOf(el) < 0) tracked.push(el);
    if (D3.state === 'on') {
      if (!on3d(el)) render(el, 'small', 'yum', true);
      if (on3d(el)) return busy(el, grow3d(el));
    }
    return busy(el, grow2d(el));
  }
  function bounce(el) { if (on3d(el)) D3.api.bounce(el); else bounce2d(el); }
  function mouth(el) { return (on3d(el) && D3.api.mouth(el)) || mouth2d(el); }
  function info() {
    var st = D3.api ? D3.api.stats : null;
    return { pref: D3.pref, state: D3.state, reason: D3.reason, waitedMs: D3.waitedMs,
      stats: st ? JSON.parse(JSON.stringify(st)) : null };
  }

  root.LuluPet = { render: render, hatch: hatch, grow: grow, bounce: bounce, mouth: mouth, formArt: formArt, timing: timing,
    config: config, setPref: setPref, info: info, _module: _module, is3d: on3d };
  root.renderPet = render;
})(window);
