/* Lulu Island v1.3 - 3D pet (docs/spec_v1.md section 15). three.js 0.160.0, local copy in js/vendor/.
   Loaded only by pet.js (as a module script, only on http/https with WebGL). pet.js decides 3D or 2D;
   this file only draws. It registers itself with LuluPet._module(api).
   Model: assets/model/lulu.glb (Tripo, 17,530 tris, no animation / no bones). Normalised here to
   height 1, feet at y = 0, face towards +z. Moods are body motion + 2D symbols over the head (SVG over the canvas). */
import * as THREE from './vendor/three.module.min.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';

const MODEL_URL = new URL('../assets/model/lulu.glb', import.meta.url).href;
const STAGE_SCALE = { small: 0.8, normal: 1, big: 1.2, crown: 1.2 };
const MOUTH = [0, 0.30, 0.42];   // model units (height 1), read from the front profile (tools/v13_probe.html)
const HEAD = [0, 0.86, 0.05];    // top of the round head, between the ears
// Layout inside the pet box (same feel as the 2D pet): a scale-1 model is BODY of the box height,
// feet at GROUND of the box. The canvas reaches PAD_TOP above the box so jumps and big Lulu are not cut.
const BODY = 0.76, GROUND = 0.95, PAD_TOP = 0.4, FOV = 22;
const FPS_WINDOW = 3000, FPS_MIN = 20;   // spec 15-6: first 3 s of drawing, < 20 frames a second -> 2D
const JUMP_MS = 750;

const NS = 'http://www.w3.org/2000/svg';
const C = { sprout: '#5fae53', gold: '#f3c53d', ruby: '#e2574c', tear: '#4fa9db', ink: '#1d2b3a', heart: '#f2738c' };

let template = null, loading = null, gpuName = '';
let enabled = false, raf = 0, onSlow = null;
const views = [];
const stats = { fps: null, frames: 0, ms: 0, measured: false, framesTotal: 0, drawing: false, renderer: '', loadMs: null };
let meas = null;   // {t0, n, skip}

function slow() { const p = window.LuluPet; return (p && p.timing && p.timing.slow) || 1; }
function ease(p) { return p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; }
function elastic(p) { return p >= 1 ? 1 : 1 - Math.pow(2, -9 * p) * Math.cos(p * Math.PI * 3.2); }

// ---------- CSS for the 2D bits on top of the canvas
let cssDone = false;
function css() {
  if (cssDone) return;
  cssDone = true;
  const st = document.createElement('style');
  st.textContent = [
    '.lp3-root{position:absolute;left:0;top:0;width:100%;height:100%;touch-action:pan-y;cursor:grab;-webkit-user-select:none;user-select:none}',
    '.lp3-root canvas{position:absolute;left:0;width:100%;pointer-events:none}',
    '.lp3-root svg{position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;pointer-events:none}',
    '.lp3-q{animation:lp3-bob 1.4s ease-in-out infinite}',
    '.lp3-drool{animation:lp3-drip 1.8s ease-in infinite}',
    '.lp3-heart{opacity:0;animation:lp3-heart 1.4s ease-out infinite}',
    '.lp3-heart.h2{animation-delay:.5s}',
    '.lp3-sweat{animation:lp3-sweat 1.1s ease-in infinite}',
    '.lp3-z{opacity:0;animation:lp3-z 2.4s ease-in-out infinite}',
    '.lp3-z.z2{animation-delay:.8s}.lp3-z.z3{animation-delay:1.6s}',
    '@keyframes lp3-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}',
    '@keyframes lp3-drip{0%{transform:translateY(0);opacity:.9}80%{opacity:.9}100%{transform:translateY(7px);opacity:0}}',
    '@keyframes lp3-heart{0%{transform:translate(0,4px) scale(.4);opacity:0}25%{opacity:1}100%{transform:translate(4px,-16px) scale(1);opacity:0}}',
    '@keyframes lp3-sweat{0%{transform:translateY(0);opacity:1}100%{transform:translateY(9px);opacity:0}}',
    '@keyframes lp3-z{0%{transform:translate(0,4px);opacity:0}30%{opacity:1}100%{transform:translate(7px,-11px);opacity:0}}',
    '.lp3-fx .lp3-flash{opacity:0;transform-box:fill-box;transform-origin:center}',
    '.lp3-fx.on .lp3-flash{animation:lp3-flash .7s ease-out forwards}',
    '.lp3-fx .lp3-ring{opacity:0;transform-box:fill-box;transform-origin:center}',
    '.lp3-fx.on .lp3-ring{animation:lp3-ring 1s ease-out forwards}',
    '.lp3-fx .lp3-st{opacity:0}',
    '.lp3-fx.on .lp3-st{animation:lp3-st 1.1s ease-out forwards}',
    '@keyframes lp3-flash{0%{opacity:0;transform:scale(.3)}25%{opacity:.95;transform:scale(1)}100%{opacity:0;transform:scale(1.5)}}',
    '@keyframes lp3-ring{0%{opacity:.9;transform:scale(.3)}100%{opacity:0;transform:scale(1.6)}}',
    '@keyframes lp3-st{0%{opacity:1;transform:translate(0,0) rotate(0)}100%{opacity:0;transform:translate(var(--dx),var(--dy)) rotate(260deg)}}'
  ].join('\n');
  document.head.appendChild(st);
}

// ---------- 2D markup in pet-box units (0..100), drawn around an anchor at (0,0)
function accMarkup(stage) {
  // anchor = top of the head; same shapes as the 2D pet (pet.js sprout / leaf / crown), moved so the base sits on the anchor
  const sprout = '<path d="M2 0 q0 -14 11 -19 q-2 13 -11 19z M2 0 q0 -12 -10 -17 q1 12 10 17z" fill="' + C.sprout + '"/>';
  if (stage === 'normal') return sprout;
  if (stage === 'big') return sprout + '<path d="M-10 4 q-6 -8 -2 -14 q4 8 2 14z" fill="' + C.sprout + '"/>';
  if (stage === 'crown') return '<path d="M-14 2 l28 0 l-3 -12 l-8 6 l-3 -8 l-3 8 l-8 -6z" fill="' + C.gold + '"/><circle cx="0" cy="-3" r="2" fill="' + C.ruby + '"/>';
  return '';
}
function heart(cls) {
  return '<path class="lp3-heart ' + cls + '" d="M0 -2 C-3 -7 -10 -4 -8 1 C-6 5 0 8 0 10 C0 8 6 5 8 1 C10 -4 3 -7 0 -2z" fill="' + C.heart + '"/>';
}
function symMarkup(mood) {   // anchor = upper right of the head
  if (mood === 'hungry') return '<g class="lp3-q"><circle r="9" fill="#fff" stroke="' + C.ink + '" stroke-width="1.6"/>' +
    '<text y="5" text-anchor="middle" font-size="14" font-weight="700" font-family="Arial,sans-serif" fill="' + C.ink + '">?</text></g>';
  if (mood === 'yum') return '<g transform="translate(-4 0)">' + heart('h1') + '</g><g transform="translate(8 6) scale(.75)">' + heart('h2') + '</g>';
  if (mood === 'sad') return '<path class="lp3-sweat" d="M0 0 q5 8 0 12 q-5 -4 0 -12z" fill="' + C.tear + '"/>';
  if (mood === 'sleep') return '<g fill="' + C.tear + '" font-family="Arial,sans-serif" font-weight="700">' +
    '<text class="lp3-z z1" x="-2" y="8" font-size="13">z</text><text class="lp3-z z2" x="6" y="0" font-size="10">z</text><text class="lp3-z z3" x="13" y="-7" font-size="8">z</text></g>';
  return '';
}
function droolMarkup(mood) {   // anchor = mouth
  return mood === 'hungry' ? '<path class="lp3-drool" d="M4 1 q2 4 0 6 q-2 -2 0 -6z" fill="' + C.tear + '" opacity=".85"/>' : '';
}

// ---------- model
function load() {
  if (template) return Promise.resolve(stats.loadMs);
  if (loading) return loading;
  const t0 = performance.now();
  loading = new Promise((resolve, reject) => {
    new GLTFLoader().load(MODEL_URL, (gl) => {
      try {
        const src = gl.scene;
        src.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(src);
        const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
        src.traverse((o) => {
          if (!o.isMesh) return;
          const m = o.material;
          // Tripo's retopo bake leaves a bumpy, matte look; without the normal map and with a plain
          // roughness the body reads smoother and softer (evidence/v13_material_front.png, handoff).
          m.normalMap = null; m.roughnessMap = null; m.metalnessMap = null;
          m.roughness = 0.6; m.metalness = 0;
          m.needsUpdate = true;
        });
        src.position.set(-c.x, -box.min.y, -c.z);
        const norm = new THREE.Group();
        norm.add(src);
        norm.scale.setScalar(1 / size.y);
        template = norm;
        stats.loadMs = Math.round(performance.now() - t0);
        resolve(stats.loadMs);
      } catch (e) { reject(e); }
    }, undefined, (err) => { loading = null; reject(err instanceof Error ? err : new Error(String(err && err.message || err))); });
  });
  return loading;
}

// ---------- one view per pet box
function makeView(el) {
  css();
  const root = document.createElement('div');
  root.className = 'lp3-root';
  const under = document.createElementNS(NS, 'svg');
  under.setAttribute('viewBox', '0 0 100 100');
  under.innerHTML = '<ellipse class="lp3-shadow" cx="50" cy="95" rx="28" ry="3.6" fill="#000" opacity=".1"/>';
  const canvas = document.createElement('canvas');
  canvas.style.top = (-PAD_TOP * 100) + '%';
  canvas.style.height = ((1 + PAD_TOP) * 100) + '%';
  const over = document.createElementNS(NS, 'svg');
  over.setAttribute('viewBox', '0 0 100 100');
  over.innerHTML = '<g class="lp3-drool-g"></g><g class="lp3-acc"></g><g class="lp3-sym"></g>';
  root.appendChild(under); root.appendChild(canvas); root.appendChild(over);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(1);
  if (!gpuName) {
    try {
      const g = renderer.getContext(), e = g.getExtension('WEBGL_debug_renderer_info');
      gpuName = e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER);
      stats.renderer = gpuName;
    } catch (e) { /* not important */ }
  }
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(1, 2, 3);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 50);
  const visH = (1 + PAD_TOP) / BODY;                         // world units from canvas top to bottom
  const cy = ((PAD_TOP + GROUND) - (1 + PAD_TOP) / 2) / BODY; // world y at the canvas middle (ground y = 0)
  const dist = (visH / 2) / Math.tan(FOV * Math.PI / 360);
  camera.position.set(0, cy, dist);
  camera.lookAt(0, cy, 0);

  const stageG = new THREE.Group(), moodG = new THREE.Group(), yawG = new THREE.Group();
  stageG.add(moodG); moodG.add(yawG);
  yawG.add(template.clone(true));
  const head = new THREE.Object3D(); head.position.fromArray(HEAD); yawG.add(head);
  const mouth = new THREE.Object3D(); mouth.position.fromArray(MOUTH); yawG.add(mouth);
  scene.add(stageG);

  const v = {
    el, root, canvas, renderer, scene, camera, stageG, moodG, yawG, head, mouth,
    shadow: under.firstChild, acc: over.querySelector('.lp3-acc'), sym: over.querySelector('.lp3-sym'), drool: over.querySelector('.lp3-drool-g'),
    w: 0, h: 0, stage: '', mood: '', moodT0: 0, jumpT0: 0, anim: null, scale: 1,
    userYaw: 0, drag: null, releaseT: 0, releaseYaw: 0, accShown: '', symShown: '',
    last: { x: 50, y: 50 }
  };
  // drag to turn; let go -> back to the front within 2 s (spec 15-3)
  root.addEventListener('pointerdown', (e) => {
    v.drag = { id: e.pointerId, x: e.clientX, yaw: v.userYaw };
    try { root.setPointerCapture(e.pointerId); } catch (er) { /* ok */ }
  });
  root.addEventListener('pointermove', (e) => {
    if (!v.drag || v.drag.id !== e.pointerId) return;
    const w = root.clientWidth || 100;
    v.userYaw = v.drag.yaw + (e.clientX - v.drag.x) / w * Math.PI * 1.6;
    kick();
  });
  const end = (e) => {
    if (!v.drag || v.drag.id !== e.pointerId) return;
    v.drag = null;
    let y = v.userYaw % (Math.PI * 2);
    if (y > Math.PI) y -= Math.PI * 2;
    if (y < -Math.PI) y += Math.PI * 2;
    v.userYaw = y;
    v.releaseYaw = y;
    v.releaseT = performance.now();
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
  views.push(v);
  return v;
}

function viewOf(el) { for (let i = 0; i < views.length; i++) if (views[i].el === el) return views[i]; return null; }
function attached(el) { const v = viewOf(el); return !!(v && v.root.parentNode === el); }
function active(v) { return v.root.parentNode === v.el && v.el.isConnected && v.el.getClientRects().length > 0; }

function mount(el, keepOld) {
  let v = viewOf(el);
  if (!v) v = makeView(el);
  if (v.root.parentNode !== el) {
    if (!keepOld) el.innerHTML = '';
    el.appendChild(v.root);
  }
  return v;
}

function setAcc(v, stage) {
  if (v.accShown === stage) return;
  v.accShown = stage;
  v.acc.innerHTML = '<g class="lp3-acc-in">' + accMarkup(stage) + '</g>';
}
function setSym(v, mood) {
  if (v.symShown === mood) return;
  v.symShown = mood;
  v.sym.innerHTML = symMarkup(mood);
  v.drool.innerHTML = droolMarkup(mood);
}

// show(el, stage, mood, {noJump}) - mount the 3D view and set what it shows
function show(el, stage, mood, opt) {
  if (!template) throw new Error('model not loaded');
  const v = mount(el, opt && opt.keepOld);
  const moodChanged = v.mood !== mood;
  if (v.stage !== stage && !(v.anim && v.anim.type === 'grow')) { v.scale = STAGE_SCALE[stage] || 1; setAcc(v, stage); }
  v.stage = stage;
  if (moodChanged) { v.mood = mood; v.moodT0 = performance.now(); setSym(v, mood); }
  if (mood === 'yum' && !(opt && opt.noJump)) v.jumpT0 = performance.now();
  kick();
  return v;
}
function bounce(el) { const v = viewOf(el); if (v && attached(el)) { v.jumpT0 = performance.now(); kick(); } }

function project(v, obj) {
  const p = obj.getWorldPosition(new THREE.Vector3()).project(v.camera);
  // canvas: same width as the box, PAD_TOP taller above it -> box units 0..100
  return { x: (p.x + 1) / 2 * 100, y: ((1 - p.y) / 2 * (1 + PAD_TOP) - PAD_TOP) * 100 };
}
function mouthAt(el) {
  const v = viewOf(el);
  if (!v || !attached(el)) return null;
  v.scene.updateMatrixWorld(true);
  const m = project(v, v.mouth), r = el.getBoundingClientRect();
  return { x: r.left + m.x / 100 * r.width, y: r.top + m.y / 100 * r.height };
}

// hatch: the egg part is 2D (pet.js); at the break, small Lulu pops from 0 and lands with two hops
function pop(el) {
  const v = show(el, 'small', 'yum', { noJump: true, keepOld: true });
  v.anim = { type: 'pop', t0: performance.now() };
  kick();
}
// grow: spin twice, flash, spring from the old size to the new one, head piece pops out
function grow(el, from, to) {
  const v = show(el, from, 'yum', { noJump: true });
  v.anim = { type: 'grow', t0: performance.now(), from: STAGE_SCALE[from], to: STAGE_SCALE[to], toStage: to, switched: false };
  kick();
  return v;
}

// ---------- per frame
function step(v, now) {
  const W = v.el.clientWidth, H = v.el.clientHeight;
  if (!W || !H) return;
  const cw = Math.round(W * Math.min(2, window.devicePixelRatio || 1)), ch = Math.round(cw / W * H * (1 + PAD_TOP));
  if (cw !== v.w || ch !== v.h) {
    v.w = cw; v.h = ch;
    v.renderer.setSize(cw, ch, false);
    v.camera.aspect = W / (H * (1 + PAD_TOP));
    v.camera.updateProjectionMatrix();
  }
  const sl = slow(), t = now / 1000, mt = (now - v.moodT0) / 1000 / sl;
  let y = 0, rx = 0, rz = 0, spin = 0, sy = 1, sxz = 1, idle = 0, popS = 1, accS = 1;
  switch (v.mood) {
    case 'hungry': {          // sinks down, sways slowly
      const b = Math.sin(t * Math.PI * 2 / 2.2) * 0.015;
      sy = 0.9 + b; sxz = 1.05 - b / 2; rz = Math.sin(t * Math.PI * 2 / 1.8) * 0.09; idle = Math.sin(t * 0.9) * 0.12;
      break;
    }
    case 'sad': {             // a bit flatter, shakes the head (strong at first, then small)
      sy = 0.9; sxz = 1.06;
      idle = Math.sin(mt * Math.PI * 2 * 2.2) * (0.12 + 0.3 * Math.exp(-mt * 1.5));
      break;
    }
    case 'sleep': {           // leans forward, breathes slowly
      const b = Math.sin(t * Math.PI * 2 / 4) * 0.03;
      rx = 0.22; sy = 1 + b; sxz = 1 - b / 2;
      break;
    }
    default: {                // normal / yum: breathing, now and then a small turn
      const b = Math.sin(t * Math.PI * 2 / 2.6) * 0.022;
      sy = 1 + b; sxz = 1 - b / 2;
      idle = Math.sin(t * 0.7) * Math.max(0, Math.sin(t * 0.23)) * 0.35;
    }
  }
  if (v.jumpT0) {           // yum: jump and turn once in the air
    const p = Math.max(0, now - v.jumpT0) / (JUMP_MS * sl);
    if (p >= 1) v.jumpT0 = 0;
    else {
      y += 0.3 * Math.sin(Math.PI * Math.min(1, Math.max(0, (p - 0.12) / 0.8)));
      spin += Math.PI * 2 * ease(Math.min(1, Math.max(0, (p - 0.15) / 0.7)));
      if (p < 0.12) { sy *= 1 - 0.12 * Math.sin(p / 0.12 * Math.PI); sxz *= 1 + 0.06 * Math.sin(p / 0.12 * Math.PI); }
      if (p > 0.92) { const q = (p - 0.92) / 0.08; sy *= 1 - 0.08 * Math.sin(q * Math.PI); }
    }
  }
  let scale = v.scale;
  if (v.anim) {
    const a = v.anim, at = Math.max(0, now - a.t0) / 1000 / sl;   // the frame time can be a hair before t0
    if (a.type === 'pop') {
      popS = elastic(Math.min(1, at / 0.55));
      const h1 = (at - 0.6) / 0.35, h2 = (at - 0.98) / 0.3;
      if (h1 > 0 && h1 < 1) y += 0.16 * Math.sin(Math.PI * h1);
      if (h2 > 0 && h2 < 1) y += 0.09 * Math.sin(Math.PI * h2);
      if (at > 1.3) v.anim = null;
    } else if (a.type === 'grow') {
      spin += Math.PI * 4 * ease(Math.min(1, at / 1.4));
      if (at < 1.45) { scale = a.from; accS = 0; }
      else {
        const g = elastic(Math.min(1, (at - 1.45) / 1.0));
        scale = a.from + (a.to - a.from) * g;
        accS = g;
        if (!a.switched) { a.switched = true; v.accShown = ''; setAcc(v, a.toStage); }
      }
      if (at > 2.5) { v.scale = a.to; v.stage = a.toStage; v.anim = null; }
    }
  }
  // drag: hold 0.8 s after letting go, then ease back to the front in 1.2 s
  if (!v.drag && v.userYaw !== 0) {
    const p = (now - v.releaseT) / 1000 - 0.8;
    if (p > 0) v.userYaw = p >= 1.2 ? 0 : v.releaseYaw * (1 - ease(p / 1.2));
  }
  if (v.drag) idle = 0;
  v.stageG.scale.setScalar(scale * popS);
  v.moodG.position.y = y;
  v.moodG.rotation.set(rx, spin, rz);
  v.moodG.scale.set(sxz, sy, sxz);
  v.yawG.rotation.y = v.userYaw + idle;
  v.renderer.render(v.scene, v.camera);

  // 2D bits follow the head (always facing the screen)
  const s = scale * popS;
  const hp = project(v, v.head), mp = project(v, v.mouth);
  const k = s * 0.95;
  v.acc.setAttribute('transform', 'translate(' + hp.x.toFixed(2) + ' ' + (hp.y + 2 * k).toFixed(2) + ') scale(' + (k * accS).toFixed(3) + ')');
  v.sym.setAttribute('transform', 'translate(' + (hp.x + 26 * k).toFixed(2) + ' ' + (hp.y + 2 * k).toFixed(2) + ') scale(' + Math.max(0.6, k).toFixed(3) + ')');
  v.drool.setAttribute('transform', 'translate(' + mp.x.toFixed(2) + ' ' + mp.y.toFixed(2) + ') scale(' + k.toFixed(3) + ')');
  v.shadow.setAttribute('rx', Math.max(0, 30 * s * Math.max(0.5, 1 - y * 1.6)).toFixed(2));
  v.last = hp;
}

// ---------- drawing loop: only while the page is visible and a 3D pet is on screen
function frame(now) {
  raf = 0;
  stats.drawing = false;
  if (!enabled || document.hidden) { meas = null; return; }
  let n = 0;
  for (let i = 0; i < views.length; i++) if (active(views[i])) { step(views[i], now); n++; }
  if (!n) { meas = null; return; }
  stats.framesTotal++;
  if (!stats.measured) {
    if (!meas) meas = { skip: 2, t0: 0, n: 0 };
    if (meas.skip > 0) { meas.skip--; if (!meas.skip) meas.t0 = now; }
    else {
      meas.n++;
      const ms = now - meas.t0;
      if (ms >= FPS_WINDOW) {
        stats.measured = true;
        stats.frames = meas.n; stats.ms = Math.round(ms);
        stats.fps = Math.round(meas.n / ms * 10000) / 10;
        meas = null;
        if (stats.fps < FPS_MIN && onSlow) { onSlow(stats.fps); return; }
      }
    }
  }
  stats.drawing = true;
  raf = requestAnimationFrame(frame);
}
function kick() {
  if (!raf && enabled && !document.hidden) { raf = requestAnimationFrame(frame); stats.drawing = true; }
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (raf) cancelAnimationFrame(raf); raf = 0; stats.drawing = false; meas = null; } else kick();
});
// screens switch without telling the pet; a cheap check restarts the loop when a 3D pet shows up again
setInterval(() => { if (!raf && enabled && !document.hidden && views.some(active)) kick(); }, 500);

function setEnabled(on) {
  enabled = !!on;
  if (!enabled && raf) { cancelAnimationFrame(raf); raf = 0; stats.drawing = false; }
  if (enabled) kick();
}
function measure() { stats.measured = false; stats.fps = null; meas = null; kick(); }
function disposeAll() {
  setEnabled(false);
  views.splice(0).forEach((v) => {
    if (v.root.parentNode) v.root.parentNode.removeChild(v.root);
    v.renderer.dispose();
  });
}

const api = {
  load, show, bounce, mouth: mouthAt, attached, pop, grow, setEnabled, measure, disposeAll, stats,
  set onSlow(f) { onSlow = f; },
  view: viewOf,
  STAGE_SCALE,
  scaleOf(el) { const v = viewOf(el); return v ? { stage: v.stage, scale: v.scale, actual: v.stageG.scale.x } : null; }
};
window.LuluPet3D = api;
if (window.LuluPet && window.LuluPet._module) window.LuluPet._module(api);
