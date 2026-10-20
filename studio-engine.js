/* video-engine.js — wordless activity video engine for the prompt-builder page.
   Draws the same cartoon characters as the Claude Code videos (video/anim.js) onto a <canvas>,
   from a JSON "spec" of the activity card, and synthesizes original background music.
   API: VideoEngine.create(canvas, spec) → { DUR, render(t), music() → {sr, L, R} } */
(function (global) {
'use strict';
const TAU = Math.PI * 2;

// ───────────── tiny SVG-like scene graph rendered to canvas ─────────────
class V {
  constructor(tag) { this.tag = tag; this.a = {}; this.children = []; this.parent = null; this.style = {}; }
  setAttribute(k, v) { this.a[k] = v; }
  getAttribute(k) { return this.a[k]; }
  appendChild(c) { if (c.parent) c.parent.removeChild(c); c.parent = this; this.children.push(c); return c; }
  insertBefore(c, ref) { if (c.parent) c.parent.removeChild(c); c.parent = this; const i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parent = null; return c; }
  get firstChild() { return this.children[0] || null; }
  set textContent(v) { this.text = v; }
  get textContent() { return this.text; }
}
function el(tag, attrs = {}, parent) { const n = new V(tag); for (const k in attrs) n.a[k] = attrs[k]; if (parent) parent.appendChild(n); return n; }
// ───────────── helpers & character builders (same as video/anim.js) ─────────────
const set = (e, a) => { for (const k in a) e.setAttribute(k, a[k]); };
const clamp = (x, a = 0, b = 1) => x < a ? a : x > b ? b : x;
const P = (t, a, b) => clamp((t - a) / (b - a));
const lerp = (a, b, k) => a + (b - a) * k;
const E = {
  io: k => k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2,
  out: k => 1 - Math.pow(1 - k, 3),
  in: k => k * k * k,
  lin: k => k,
  back: k => { const c1 = 2.2, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); },
  elastic: k => k === 0 ? 0 : k === 1 ? 1 : Math.pow(2, -10 * k) * Math.sin((k * 10 - .75) * (2 * Math.PI) / 3) + 1,
};
function K(t, keys) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1, e] = keys[i];
    if (t <= t1) {
      const [t0, v0] = keys[i - 1];
      const k = E[e || 'io'](t1 === t0 ? 1 : (t - t0) / (t1 - t0));
      return Array.isArray(v0) ? v0.map((x, j) => lerp(x, v1[j], k)) : lerp(v0, v1, k);
    }
  }
  return keys[keys.length - 1][1];
}
const pop = (t, t0, d = .5) => E.back(P(t, t0, t0 + d));          // 0 → 1 with overshoot
const fade = (t, a, b, f = .3) => clamp(Math.min((t - a) / f, (b - t) / f));
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const D2R = Math.PI / 180;
const show = (e, v) => { e.style.display = v ? '' : 'none'; };
const wob = (t, t0, amp, f, dec) => t < t0 ? 0 : amp * Math.sin(2 * Math.PI * f * (t - t0)) * Math.exp(-dec * (t - t0));

const C = { navy: '#1d2a6e', orange: '#ff7a1a', blue: '#2f6fe0', yellow: '#ffd21f', red: '#e53935', green: '#20a35a', bagRed: '#e0313b', bagBlue: '#2450c8' };

// ───────────────────────── builders ─────────────────────────
function ik(sx, sy, tx, ty, L1, L2, bend) {
  const dx = tx - sx, dy = ty - sy;
  const d = clamp(Math.hypot(dx, dy), Math.abs(L1 - L2) + 1, L1 + L2 - .5);
  const base = Math.atan2(dx, dy) / D2R;
  const A = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1)) / D2R;
  const B = Math.acos(clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1)) / D2R;
  return [base + bend * A, -bend * (180 - B)];
}
const dir = a => [Math.sin(a * D2R), Math.cos(a * D2R)];

const KID = { kid: 1, leg: 150, torso: 125, hipW: 16, shW: 36, upper: 60, fore: 56, headR: 48, legW: 30, armW: 19, neckW: 24,
  shirt: '#7d1d2c', trim: '#f2c230', pants: '#3d6fb8', shoe: '#f6f6f6', skin: '#f3c6a5', hair: '#3b2416' };
const TEACHER = { kid: 0, leg: 232, torso: 172, hipW: 20, shW: 44, upper: 92, fore: 86, headR: 44, legW: 34, armW: 21, neckW: 22,
  shirt: '#22252f', trim: '#22252f', pants: '#1b1d25', shoe: '#d9dde4', skin: '#eebd98', hair: '#3a2318' };
const FRIEND = Object.assign({}, KID, { shirt: '#1f8a4c', trim: '#ffd21f', hair: '#1c120c', pants: '#2c4f8e' });

function makePerson(parent, o) {
  const g = el('g', {}, parent);
  const shadow = el('ellipse', { cx: 0, cy: 0, rx: o.shW * 1.9, ry: 12, fill: '#000', opacity: .16 }, g);
  const legs = [0, 1].map(() => el('path', { fill: 'none', stroke: o.pants, 'stroke-width': o.legW, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g));
  const shoes = [0, 1].map(() => el('ellipse', { rx: o.legW * .95, ry: o.legW * .45, fill: o.shoe, stroke: '#9aa3ae', 'stroke-width': 3 }, g));
  const ub = el('g', {}, g);
  const top = -o.leg - o.torso, hip = -o.leg;
  if (!o.kid) el('rect', { x: -o.shW + 4, y: hip - 30, width: o.shW * 2 - 8, height: 50, rx: 14, fill: o.pants }, ub);
  el('path', { fill: o.shirt, d: `M ${-o.shW - 4} ${top + 24} Q ${-o.shW - 4} ${top} ${-o.shW + 18} ${top} L ${o.shW - 18} ${top} Q ${o.shW + 4} ${top} ${o.shW + 4} ${top + 24} L ${o.shW} ${hip + 6} Q ${o.shW} ${hip + 16} ${o.shW - 12} ${hip + 16} L ${-o.shW + 12} ${hip + 16} Q ${-o.shW} ${hip + 16} ${-o.shW} ${hip + 6} Z` }, ub);
  if (o.kid) {
    el('path', { d: `M ${-o.shW} ${hip + 8} L ${o.shW} ${hip + 8}`, stroke: 'rgba(0,0,0,.15)', 'stroke-width': 6 }, ub);
    el('path', { d: `M -20 ${top + 2} L 0 ${top + 26} L 20 ${top + 2}`, fill: 'none', stroke: o.trim, 'stroke-width': 8, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, ub);
    el('path', { d: `M 0 ${top + 26} L 0 ${top + 52}`, stroke: 'rgba(0,0,0,.25)', 'stroke-width': 4 }, ub);
    el('circle', { cx: 0, cy: top + 36, r: 3, fill: '#fff' }, ub);
  } else {
    el('path', { d: `M -16 ${top + 2} Q 0 ${top + 18} 16 ${top + 2}`, fill: o.skin }, ub);
  }
  el('rect', { x: -o.neckW / 2, y: top - 18, width: o.neckW, height: 24, rx: 8, fill: o.skin }, ub);
  const r = o.headR, hy = top - r + 4;
  const head = el('g', {}, ub);
  const hs = o.hairStyle || (o.kid ? 'kid' : 'ponytail');
  let pony = null;
  // hair / scarf parts behind the face
  if (hs === 'ponytail') pony = el('path', { fill: o.hair, d: `M ${r * .45} ${-r * .75} C ${r * 1.55} ${-r * .7} ${r * 1.6} ${r * .7} ${r * 1.1} ${r * 1.55} C ${r * .95} ${r * .8} ${r * .95} ${-r * .05} ${r * .45} ${-r * .15} Z` }, head);
  if (hs === 'long') pony = el('path', { fill: o.hair, d: `M ${-r * 1.06} ${-r * .2} C ${-r * 1.35} ${r * 1.1} ${-r * 1.05} ${r * 1.95} ${-r * .55} ${r * 1.85} L ${r * .55} ${r * 1.85} C ${r * 1.05} ${r * 1.95} ${r * 1.35} ${r * 1.1} ${r * 1.06} ${-r * .2} Z` }, head);
  if (hs === 'bun') el('circle', { cx: 0, cy: -r * 1.02, r: r * .42, fill: o.hair }, head);
  if (hs === 'pigtails') [-1, 1].forEach(sg => { el('ellipse', { cx: sg * r * 1.12, cy: r * .25, rx: r * .32, ry: r * .48, fill: o.hair }, head); el('circle', { cx: sg * r * .98, cy: -r * .12, r: r * .12, fill: o.trim || '#ff5fa2' }, head); });
  if (hs === 'hijab') el('path', { fill: o.scarf || o.hair, d: `M ${-r * 1.28} ${r * .1} C ${-r * 1.38} ${-r * 1.5} ${r * 1.38} ${-r * 1.5} ${r * 1.28} ${r * .1} L ${r * 1.55} ${r * 2.05} Q 0 ${r * 2.35} ${-r * 1.55} ${r * 2.05} Z` }, head);
  if (hs !== 'hijab') [-1, 1].forEach(s2 => el('circle', { cx: s2 * r * .97, cy: r * .1, r: r * .2, fill: o.skin }, head));
  el('circle', { cx: 0, cy: 0, r, fill: o.skin }, head);
  // hair / scarf parts in front
  if (hs === 'kid') el('path', { fill: o.hair, d: `M ${-r - 3} ${r * .1} C ${-r - 5} ${-r * 1.35} ${r + 5} ${-r * 1.35} ${r + 3} ${r * .1} L ${r * .78} ${-r * .3} L ${r * .5} ${-r * .14} L ${r * .25} ${-r * .4} L ${-r * .05} ${-r * .18} L ${-r * .35} ${-r * .45} L ${-r * .65} ${-r * .18} L ${-r * .85} ${-r * .3} Z` }, head);
  else if (hs === 'short') el('path', { fill: o.hair, d: `M ${-r - 3} ${r * .05} C ${-r - 5} ${-r * 1.32} ${r + 5} ${-r * 1.32} ${r + 3} ${r * .05} C ${r * .75} ${-r * .55} ${-r * .75} ${-r * .55} ${-r - 3} ${r * .05} Z` }, head);
  else if (hs === 'hijab') el('path', { fill: o.scarf || o.hair, 'fill-rule': 'evenodd', d: `M ${-r * 1.22} 0 A ${r * 1.22} ${r * 1.25} 0 1 1 ${r * 1.22} 0 L ${r * 1.22} ${r * .6} Q ${r * .9} ${r * 1.25} 0 ${r * 1.3} Q ${-r * .9} ${r * 1.25} ${-r * 1.22} ${r * .6} Z M ${-r * .8} ${r * .08} A ${r * .8} ${r * .9} 0 1 0 ${r * .8} ${r * .08} A ${r * .8} ${r * .9} 0 1 0 ${-r * .8} ${r * .08} Z` }, head);
  else el('path', { fill: o.hair, d: `M ${-r - 3} ${r * .3} C ${-r - 7} ${-r * 1.4} ${r + 7} ${-r * 1.4} ${r + 3} ${r * .3} C ${r * .8} ${-r * .45} ${-r * .15} ${-r * .8} ${-r * .9} ${-r * .15} Z` }, head);
  const cheeks = [-1, 1].map(s => el('ellipse', { cx: s * r * .55, cy: r * .36, rx: r * .16, ry: r * .1, fill: '#ff8a80', opacity: .45 }, head));
  const eyes = [-1, 1].map(s => el('ellipse', { cx: s * r * .34, cy: r * .02, rx: r * .1, ry: r * .14, fill: '#2b1d16' }, head));
  const shines = [-1, 1].map(s => el('circle', { cx: s * r * .34, cy: 0, r: r * .035, fill: '#fff' }, head));
  [-1, 1].forEach(s => el('path', { d: `M ${s * r * .22} ${-r * .24} Q ${s * r * .36} ${-r * .32} ${s * r * .5} ${-r * .24}`, stroke: o.hair, 'stroke-width': 4, fill: 'none', 'stroke-linecap': 'round' }, head));
  const smile = el('path', { fill: 'none', stroke: '#8a3b2b', 'stroke-width': 5, 'stroke-linecap': 'round' }, head);
  const mouthO = el('path', { fill: '#8a2a2a' }, head);
  head.setAttribute('transform', `translate(0 ${hy})`);
  const arms = [0, 1].map(i => {
    const sgn = i ? 1 : -1;
    const sh = [sgn * o.shW, top + 18];
    const upper = el('line', { stroke: o.kid ? o.skin : o.shirt, 'stroke-width': o.armW + (o.kid ? 0 : 3), 'stroke-linecap': 'round' }, ub);
    const sleeve = o.kid ? el('line', { stroke: o.shirt, 'stroke-width': o.armW + 12, 'stroke-linecap': 'round' }, ub) : null;
    const trim = o.kid ? el('line', { stroke: o.trim, 'stroke-width': 5, 'stroke-linecap': 'round' }, ub) : null;
    const fore = el('line', { stroke: o.kid ? o.skin : o.shirt, 'stroke-width': o.armW - (o.kid ? 1 : -1), 'stroke-linecap': 'round' }, ub);
    const hand = el('circle', { r: o.armW * .72, fill: o.skin }, ub);
    return { sh, upper, sleeve, trim, fore, hand, sgn };
  });
  const api = { g, o, handW: [[0, 0], [0, 0]], headW: [0, 0], shoulderW: [[0, 0], [0, 0]] };
  api.update = p => {
    const s = p.s || 1, lean = p.lean || 0, c = p.crouch || 0, sq = p.sq || 1, bd = (p.bend || 0) * D2R, bc = Math.cos(bd), bs = Math.sin(bd), HY = -o.leg;
    const sx = s / Math.sqrt(sq), sy = s * sq;
    g.setAttribute('transform', `translate(${p.x} ${p.y}) rotate(${lean}) scale(${sx} ${sy})`);
    g.setAttribute('opacity', p.op == null ? 1 : p.op);
    set(shadow, { rx: o.shW * 1.9 * (p.shadow == null ? 1 : p.shadow), opacity: .16 * (p.shadow == null ? 1 : p.shadow) });
    const sp = p.spread == null ? 22 : p.spread, kb = p.knee || 6;
    [0, 1].forEach(i => {
      const lf = (p.lift && p.lift[i]) || 0;   // 0 = foot on the ground → 1 = knee raised
      const sg = i ? 1 : -1, hx = sg * o.hipW, hy2 = -o.leg + c, fx = sg * sp * (1 - .4 * lf), fy = -o.legW * .45 - lf * o.leg * .45;
      const kx = (hx + fx) / 2 + sg * (kb + c * .5 + lf * 40), ky = (hy2 + fy) / 2 - lf * 10;
      legs[i].setAttribute('d', `M ${hx} ${hy2} Q ${kx} ${ky} ${fx} ${fy}`);
      set(shoes[i], { cx: fx + sg * 6, cy: fy + o.legW * .1 });
    });
    ub.setAttribute('transform', `translate(0 ${c}) rotate(${p.bend || 0} 0 ${HY})`);
    const cos = Math.cos(lean * D2R), sin = Math.sin(lean * D2R);
    const toLocal = (wx, wy) => { const dx = wx - p.x, dy = wy - p.y; const bx = (dx * cos + dy * sin) / sx, by = ((-dx * sin + dy * cos) / sy) - c - HY; return [bx * bc + by * bs, -bx * bs + by * bc + HY]; };
    const toWorld = (lx0, ly0) => { const ry = ly0 - HY, lx = lx0 * bc - ry * bs, ly = lx0 * bs + ry * bc + HY; const X = lx * sx, Y = (ly + c) * sy; return [p.x + X * cos - Y * sin, p.y + X * sin + Y * cos]; };
    arms.forEach((a, i) => {
      const spec = i ? p.ra : p.la;
      let ang = spec || [i ? 12 : -12, i ? -8 : 8];
      if (spec && spec.t) { const L = toLocal(spec.t[0], spec.t[1]); ang = ik(a.sh[0], a.sh[1], L[0], L[1], o.upper, o.fore, spec.b || 1); if (spec.mix != null) { const base = spec.from || [i ? 12 : -12, i ? -8 : 8]; ang = [lerp(base[0], ang[0], spec.mix), lerp(base[1], ang[1], spec.mix)]; } }
      const d1 = dir(ang[0]), d2 = dir(ang[0] + ang[1]);
      const el1 = [a.sh[0] + d1[0] * o.upper, a.sh[1] + d1[1] * o.upper];
      const hd = [el1[0] + d2[0] * o.fore, el1[1] + d2[1] * o.fore];
      set(a.upper, { x1: a.sh[0], y1: a.sh[1], x2: el1[0], y2: el1[1] });
      if (a.sleeve) {
        const m = [a.sh[0] + d1[0] * o.upper * .5, a.sh[1] + d1[1] * o.upper * .5];
        set(a.sleeve, { x1: a.sh[0] - a.sgn * 4, y1: a.sh[1] + 2, x2: m[0], y2: m[1] });
        const pr = [-d1[1], d1[0]], w = (o.armW + 12) / 2;
        set(a.trim, { x1: m[0] + pr[0] * w, y1: m[1] + pr[1] * w, x2: m[0] - pr[0] * w, y2: m[1] - pr[1] * w });
      }
      set(a.fore, { x1: el1[0], y1: el1[1], x2: hd[0], y2: hd[1] });
      set(a.hand, { cx: hd[0], cy: hd[1] });
      api.handW[i] = toWorld(hd[0], hd[1]);
      api.shoulderW[i] = toWorld(a.sh[0], a.sh[1]);
    });
    api.headW = toWorld(0, hy);
    head.setAttribute('transform', `translate(0 ${hy}) rotate(${p.tilt || 0})`);
    if (pony) pony.setAttribute('transform', `rotate(${(p.pony || 0)} ${r * .5} ${-r * .5})`);
    const tt = p.t || 0, ph = (tt * .29 + (o.kid ? .3 : .7)) % 1;
    const blink = ph < .025 ? .12 : 1;
    const lk = p.look || [0, 0];
    eyes.forEach((e, i) => set(e, { cx: (i ? 1 : -1) * r * .34 + lk[0] * r * .1, cy: r * .02 + lk[1] * r * .08, ry: r * .14 * blink }));
    shines.forEach((e, i) => set(e, { cx: (i ? 1 : -1) * r * .34 + lk[0] * r * .1 + r * .03, cy: -r * .03 + lk[1] * r * .08, opacity: blink < 1 ? 0 : 1 }));
    const mo = p.mouth || 0; // 0 smile → 1 open
    set(smile, { d: `M ${-r * .3} ${r * .42} Q 0 ${r * .62} ${r * .3} ${r * .42}`, opacity: 1 - mo });
    set(mouthO, { d: `M ${-r * .3} ${r * .38} Q 0 ${r * .38 + r * .55 * mo} ${r * .3} ${r * .38} Z`, opacity: mo });
  };
  return api;
}

function makeBoard(parent) {
  const g = el('g', {}, parent);
  const sh = el('ellipse', { cx: 0, cy: 2, rx: 125, ry: 13, fill: '#000', opacity: .18 }, parent);
  parent.insertBefore(sh, g);
  const body = el('g', {}, g);
  el('path', { d: 'M -138 -48 Q 0 14 138 -48 L 138 -30 Q 0 30 -138 -30 Z', fill: '#e3262f' }, body);
  el('path', { d: 'M -138 -30 Q 0 30 138 -30', fill: 'none', stroke: '#a3121a', 'stroke-width': 7 }, body);
  el('path', { d: 'M -134 -46 Q 0 14 134 -46', fill: 'none', stroke: '#ff7b7b', 'stroke-width': 5 }, body);
  [-1, 1].forEach(s => el('path', { d: `M ${s * 138} -48 L ${s * 138} -30`, stroke: '#a3121a', 'stroke-width': 6, 'stroke-linecap': 'round' }, body));
  return {
    g, update(x, y, ang, s = 1, op = 1) {
      g.setAttribute('transform', `translate(${x} ${y}) rotate(${ang}) scale(${s})`);
      set(sh, { cx: x, cy: y + 2 * s, rx: 125 * s, ry: 13 * s, opacity: .18 * op }); g.setAttribute('opacity', op);
    },
    // world point where a rider stands
    base(x, y, ang, s = 1) { return [x + 18 * s * Math.sin(ang * D2R), y - 18 * s * Math.cos(ang * D2R)]; },
  };
}
function makeHoop(parent, color) {
  const g = el('g', {}, parent);
  el('ellipse', { cx: 0, cy: 6, rx: 124, ry: 36, fill: 'none', stroke: 'rgba(0,0,0,.18)', 'stroke-width': 14 }, g);
  el('ellipse', { cx: 0, cy: 0, rx: 122, ry: 34, fill: 'none', stroke: color, 'stroke-width': 15 }, g);
  el('ellipse', { cx: 0, cy: -3, rx: 120, ry: 31, fill: 'none', stroke: '#fff', 'stroke-width': 3, opacity: .45, 'stroke-dasharray': '120 260' }, g);
  return { g, update(x, y, s = 1, op = 1, sy = 1) { g.setAttribute('transform', `translate(${x} ${y}) scale(${s} ${s * sy})`); g.setAttribute('opacity', op); } };
}
function makeBag(parent, color, dark) {
  const g = el('g', {}, parent);
  el('path', { d: 'M -26 -19 Q 0 -27 26 -19 Q 33 0 26 19 Q 0 27 -26 19 Q -33 0 -26 -19 Z', fill: color, stroke: dark, 'stroke-width': 3 }, g);
  el('path', { d: 'M -19 -13 Q 0 -19 19 -13 Q 24 0 19 13 Q 0 19 -19 13 Q -24 0 -19 -13 Z', fill: 'none', stroke: 'rgba(255,255,255,.35)', 'stroke-width': 2, 'stroke-dasharray': '5 5' }, g);
  el('ellipse', { cx: -9, cy: -9, rx: 9, ry: 5, fill: '#fff', opacity: .3 }, g);
  return { g, update(x, y, rot = 0, s = 1, op = 1, sy = 1) { g.setAttribute('transform', `translate(${x} ${y}) rotate(${rot}) scale(${s} ${s * sy})`); g.setAttribute('opacity', op); } };
}
function makeTable(parent) {
  const g = el('g', {}, parent);
  [[-100, 652, 178], [100, 652, 178]].forEach(([x, y, h]) => el('rect', { x: x - 7, y, width: 14, height: h, fill: '#8f98a6' }, g));
  [[-118, 662, 190], [118, 662, 190]].forEach(([x, y, h]) => el('rect', { x: x - 8, y, width: 16, height: h, rx: 3, fill: '#aab3bf' }, g));
  el('path', { d: 'M -114 628 L 114 628 L 130 642 L -130 642 Z', fill: '#ffffff', stroke: '#cfd5dd', 'stroke-width': 3 }, g);
  el('rect', { x: -130, y: 642, width: 260, height: 22, rx: 4, fill: '#e9edf2', stroke: '#c3cad3', 'stroke-width': 3 }, g);
  return { g, update(x, y, s = 1, op = 1) { g.setAttribute('transform', `translate(${x} ${y}) scale(${s})`); g.setAttribute('opacity', op); } };
}
function star(parent, r, color) {
  let d = ''; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * .45 : r; d += (i ? 'L' : 'M') + (Math.cos(a) * rr).toFixed(1) + ' ' + (Math.sin(a) * rr).toFixed(1) + ' '; }
  return el('path', { d: d + 'Z', fill: color, stroke: '#fff', 'stroke-width': r * .12, 'stroke-linejoin': 'round' }, parent);
}
function gearPath(r, teeth = 8) {
  let d = ''; const n = teeth * 4;
  for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2, rr = (i % 4 < 2) ? r : r * .76; d += (i ? 'L' : 'M') + (Math.cos(a) * rr).toFixed(1) + ' ' + (Math.sin(a) * rr).toFixed(1) + ' '; }
  return d + 'Z';
}
// confetti bursts
function makeBurst(parent, seed, n, opts = {}) {
  const R = rng(seed), g = el('g', {}, parent), parts = [];
  const cols = [C.orange, C.blue, C.yellow, C.red, C.green, '#ff5fa2', '#8e5bff'];
  for (let i = 0; i < n; i++) {
    const ang = (opts.dir || -90) + (R() - .5) * (opts.spread || 140), sp = (opts.power || 900) * (.45 + R() * .7);
    const shape = R() < .5 ? el('rect', { x: -9, y: -5, width: 18, height: 10, rx: 2, fill: cols[i % cols.length] }, g) : el('circle', { r: 7, fill: cols[i % cols.length] }, g);
    parts.push({ e: shape, vx: Math.cos(ang * D2R) * sp, vy: Math.sin(ang * D2R) * sp, rot: R() * 360, vr: (R() - .5) * 900, ox: (R() - .5) * (opts.w || 0) });
  }
  return {
    update(t, t0, x, y, life = 2.2) {
      const dt = t - t0;
      if (dt < 0 || dt > life) { g.setAttribute('display', 'none'); return; }
      g.setAttribute('display', '');
      const op = clamp((life - dt) / .5);
      parts.forEach(p => {
        const drag = Math.exp(-1.2 * dt);
        const px = x + p.ox + p.vx * (1 - drag) / 1.2, py = y + p.vy * (1 - drag) / 1.2 + 700 * dt * dt * .5;
        p.e.setAttribute('transform', `translate(${px} ${py}) rotate(${p.rot + p.vr * dt}) scale(${1 - dt / life * .3} ${Math.cos((p.rot + dt * 600) * D2R)})`);
        p.e.setAttribute('opacity', op);
      });
    }
  };
}
function makeStars(parent, n, seed) {
  const R = rng(seed), g = el('g', {}, parent), st = [];
  for (let i = 0; i < n; i++) st.push({ e: star(g, 16 + R() * 18, [C.yellow, C.orange, '#fff'][i % 3]), a: i / n * 360 + R() * 20, d: 120 + R() * 80, dl: R() * .15 });
  return { update(t, t0, x, y, life = 1.3) {
    const dt = t - t0; if (dt < 0 || dt > life + .3) { g.setAttribute('display', 'none'); return; } g.setAttribute('display', '');
    st.forEach(s => { const k = E.out(P(dt, s.dl, s.dl + .6)), o = 1 - P(dt, life - .3, life); const px = x + Math.cos(s.a * D2R) * s.d * k, py = y + Math.sin(s.a * D2R) * s.d * k;
      s.e.setAttribute('transform', `translate(${px} ${py}) rotate(${dt * 200}) scale(${E.back(P(dt, s.dl, s.dl + .35)) * (1 - .3 * P(dt, .6, life))})`); s.e.setAttribute('opacity', o); });
  } };
}

// ───────────── canvas renderer for the scene graph ─────────────
const pathCache = new Map();
function P2(d) { let p = pathCache.get(d); if (!p) { if (pathCache.size > 6000) pathCache.clear(); p = new Path2D(d); pathCache.set(d, p); } return p; }
const TF_RE = /(translate|rotate|scale|skewX)\s*\(([^)]*)\)/g;
function applyTf(ctx, s) {
  if (!s) return true;
  TF_RE.lastIndex = 0; let m;
  while ((m = TF_RE.exec(s))) {
    const v = m[2].split(/[\s,]+/).filter(Boolean).map(Number);
    if (v.some(x => !isFinite(x))) return false;
    if (m[1] === 'translate') ctx.translate(v[0], v[1] || 0);
    else if (m[1] === 'rotate') { if (v.length > 2) { ctx.translate(v[1], v[2]); ctx.rotate(v[0] * D2R); ctx.translate(-v[1], -v[2]); } else ctx.rotate(v[0] * D2R); }
    else if (m[1] === 'scale') { const sx = v[0], sy = v.length > 1 ? v[1] : v[0]; if (Math.abs(sx) < 1e-4 || Math.abs(sy) < 1e-4) return false; ctx.scale(sx, sy); }
    else if (m[1] === 'skewX') ctx.transform(1, 0, Math.tan(v[0] * D2R), 1, 0, 0);
  }
  return true;
}
function rrPath(p, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  p.moveTo(x + r, y); p.lineTo(x + w - r, y); p.arcTo(x + w, y, x + w, y + r, r); p.lineTo(x + w, y + h - r); p.arcTo(x + w, y + h, x + w - r, y + h, r);
  p.lineTo(x + r, y + h); p.arcTo(x, y + h, x, y + h - r, r); p.lineTo(x, y + r); p.arcTo(x, y, x + r, y, r); p.closePath(); return p;
}
const GRAD = {
  glow: (ctx, b) => { const r = Math.max(b.rx, b.ry, 1), g = ctx.createRadialGradient(b.cx, b.cy, 0, b.cx, b.cy, r); g.addColorStop(0, 'rgba(255,246,168,.95)'); g.addColorStop(1, 'rgba(255,246,168,0)'); return g; },
  coneGrad: ctx => { const g = ctx.createLinearGradient(-60, 0, 60, 0); g.addColorStop(0, '#ffe14d'); g.addColorStop(.55, '#ffd21f'); g.addColorStop(1, '#e9b400'); return g; },
  wallGrad: ctx => { const g = ctx.createLinearGradient(0, -500, 0, 570); g.addColorStop(0, '#ffe07a'); g.addColorStop(1, '#ffc93f'); return g; },
};
function paint(ctx, v, b) { if (v.startsWith('url(#')) { const f = GRAD[v.slice(5, -1)]; return f ? f(ctx, b || { cx: 0, cy: 0, rx: 50, ry: 50 }) : '#000'; } return v; }
function drawNode(ctx, n, alpha) {
  if (n.style.display === 'none' || n.a.display === 'none') return;
  const op = n.a.opacity == null ? 1 : +n.a.opacity;
  if (!(op > 0)) return;
  ctx.save();
  if (applyTf(ctx, n.a.transform)) {
    const A = alpha * op;
    if (n.tag === 'g') for (const c of n.children) drawNode(ctx, c, A);
    else drawShape(ctx, n, A);
  }
  ctx.restore();
}
function drawShape(ctx, n, A) {
  const a = n.a; let p, b = null;
  if (n.tag === 'rect') { const x = +a.x || 0, y = +a.y || 0, w = +a.width, h = +a.height; p = rrPath(new Path2D(), x, y, w, h, +a.rx || 0); b = { cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2 }; }
  else if (n.tag === 'circle') { const r = Math.abs(+a.r || 0); p = new Path2D(); p.arc(+a.cx || 0, +a.cy || 0, r, 0, TAU); b = { cx: +a.cx || 0, cy: +a.cy || 0, rx: r, ry: r }; }
  else if (n.tag === 'ellipse') { const rx = Math.abs(+a.rx || 0), ry = Math.abs(+a.ry || 0); p = new Path2D(); p.ellipse(+a.cx || 0, +a.cy || 0, rx, ry, 0, 0, TAU); b = { cx: +a.cx || 0, cy: +a.cy || 0, rx, ry }; }
  else if (n.tag === 'path') { if (!a.d) return; p = P2(a.d); }
  else if (n.tag === 'line') { p = new Path2D(); p.moveTo(+a.x1 || 0, +a.y1 || 0); p.lineTo(+a.x2 || 0, +a.y2 || 0); }
  else if (n.tag === 'image') { ctx.globalAlpha = A; drawMedia(ctx, a.img, a.src, +a.x || 0, +a.y || 0, +a.w, +a.h, 'contain'); return; }
  else if (n.tag === 'text') { ctx.globalAlpha = A; text(ctx, a.text, +a.x || 0, +a.y || 0, { size: +a.size || 40, w: +a.weight || 900, color: a.fill || '#1d2a6e', maxW: +a.maxw || 0 }); return; }
  else return;
  const fill = a.fill == null ? (n.tag === 'line' ? 'none' : '#000') : a.fill;
  if (fill !== 'none') { ctx.globalAlpha = A; ctx.fillStyle = paint(ctx, fill, b); if (a['fill-rule'] === 'evenodd') ctx.fill(p, 'evenodd'); else ctx.fill(p); }
  if (a.stroke && a.stroke !== 'none') {
    ctx.globalAlpha = A; ctx.strokeStyle = paint(ctx, a.stroke, b); ctx.lineWidth = +a['stroke-width'] || 1;
    ctx.lineCap = a['stroke-linecap'] || 'butt'; ctx.lineJoin = a['stroke-linejoin'] || 'miter';
    if (a['stroke-dasharray']) { ctx.setLineDash(String(a['stroke-dasharray']).split(/[\s,]+/).map(Number)); ctx.lineDashOffset = +a['stroke-dashoffset'] || 0; } else ctx.setLineDash([]);
    ctx.stroke(p);
  }
}

// ───────────── canvas text & box helpers (overlays) ─────────────
const FONT = "'Cairo', Tahoma, sans-serif";
const isAr = s => /[؀-ۿ]/.test(s || '');
function font(ctx, size, w = 900) { ctx.font = `${w} ${size}px ${FONT}`; }
function fitSize(ctx, s, maxW, size, w = 900, min = 18) { font(ctx, size, w); const m = ctx.measureText(s).width; return m <= maxW ? size : Math.max(min, Math.floor(size * maxW / m)); }
function text(ctx, s, x, y, { size = 40, w = 900, color = '#1d2a6e', align = 'center', maxW = 0, min = 18, base = 'middle' } = {}) {
  if (!s) return 0;
  const sz = maxW ? fitSize(ctx, s, maxW, size, w, min) : size;
  font(ctx, sz, w); ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = base;
  ctx.direction = isAr(s) ? 'rtl' : 'ltr';
  ctx.fillText(s, x, y); return sz;
}
const BOX_G = (...a) => box(...a);
function box(ctx, x, y, w, h, r, fill, stroke, sw, shadow = 10) {
  if (shadow) { ctx.fillStyle = 'rgba(0,0,0,.12)'; ctx.fill(rrPath(new Path2D(), x, y + shadow, w, h, r)); }
  const p = rrPath(new Path2D(), x, y, w, h, r);
  ctx.fillStyle = fill; ctx.fill(p);
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = sw; ctx.setLineDash([]); ctx.stroke(p); }
}
function svgIcon(ctx, svgInner, cx, cy, size) {          // icons are drawn with tiny scene graphs
  ctx.save(); ctx.translate(cx, cy); ctx.scale(size / 100, size / 100); for (const n of svgInner.children) drawNode(ctx, n, 1); ctx.restore();
}

// ───────────── extra builders (props) ─────────────
function makeWobble(parent) {
  const sh = el('ellipse', { rx: 150, ry: 16, fill: '#000', opacity: .2 }, parent);
  const g = el('g', {}, parent);
  el('ellipse', { cx: 0, cy: -4, rx: 56, ry: 14, fill: '#111318' }, g);
  el('path', { d: 'M -150 -30 L -150 -16 Q 0 28 150 -16 L 150 -30 Z', fill: '#16181e' }, g);
  el('ellipse', { cx: 0, cy: -30, rx: 150, ry: 36, fill: '#2b2f38' }, g);
  el('ellipse', { cx: 0, cy: -30, rx: 134, ry: 30, fill: 'none', stroke: '#3f4552', 'stroke-width': 4 }, g);
  for (let i = 0; i < 10; i++) { const a = i / 10 * TAU; el('ellipse', { cx: Math.cos(a) * 104, cy: -30 + Math.sin(a) * 21, rx: 6, ry: 3, fill: '#5d6472' }, g); }
  el('ellipse', { cx: 0, cy: -30, rx: 30, ry: 8, fill: C.blue }, g);
  return {
    g, update(x, y, ang = 0, s = 1, op = 1) { g.setAttribute('transform', `translate(${x} ${y}) rotate(${ang}) scale(${s})`); g.setAttribute('opacity', op); set(sh, { cx: x, cy: y + 4 * s, rx: 150 * s, ry: 16 * s, opacity: .2 * op }); },
    base(x, y, ang = 0, s = 1) { return [x + 30 * s * Math.sin(ang * D2R), y - 30 * s * Math.cos(ang * D2R)]; },
  };
}
function makeBeam(parent) {
  const g = el('g', {}, parent);
  el('ellipse', { cx: 0, cy: 6, rx: 300, ry: 16, fill: '#000', opacity: .18 }, g);
  [-220, 220].forEach(x => el('path', { d: `M ${x - 40} 4 L ${x + 40} 4 L ${x + 30} -18 L ${x - 30} -18 Z`, fill: '#2f6fe0', stroke: '#1d47a8', 'stroke-width': 3 }, g));
  el('rect', { x: -290, y: -40, width: 580, height: 24, rx: 6, fill: '#f29a2e', stroke: '#c46a0c', 'stroke-width': 3 }, g);
  el('path', { d: 'M -284 -36 L 284 -36', stroke: '#ffc070', 'stroke-width': 4 }, g);
  return { g, update(x, y, ang = 0, s = 1, op = 1) { g.setAttribute('transform', `translate(${x} ${y}) scale(${s})`); g.setAttribute('opacity', op); }, base: (x, y, ang = 0, s = 1) => [x, y - 40 * s] };
}
function makeSpot(parent) {
  const g = el('g', {}, parent);
  el('ellipse', { cx: 0, cy: 0, rx: 120, ry: 28, fill: '#ffd21f', stroke: '#fff', 'stroke-width': 6 }, g);
  el('ellipse', { cx: 0, cy: 0, rx: 70, ry: 15, fill: 'none', stroke: '#ff7a1a', 'stroke-width': 5, 'stroke-dasharray': '14 10' }, g);
  return { g, update(x, y, ang = 0, s = 1, op = 1) { g.setAttribute('transform', `translate(${x} ${y}) scale(${s})`); g.setAttribute('opacity', op); }, base: (x, y) => [x, y - 4] };
}
const DISC = [[C.red, '#a3121a'], [C.blue, '#1d47a8'], [C.orange, '#c4560a'], [C.green, '#137a3f']];
function makeDisc(parent, i) {
  const [c, dark] = DISC[i % 4], g = el('g', {}, parent);
  const sh = el('ellipse', { cx: 0, cy: 2, rx: 52, ry: 9, fill: '#000', opacity: .18 }, g);
  el('path', { d: 'M -50 -2 Q 0 14 50 -2 L 22 -20 Q 0 -13 -22 -20 Z', fill: c, stroke: dark, 'stroke-width': 3, 'stroke-linejoin': 'round' }, g);
  el('ellipse', { cx: 0, cy: -20, rx: 27, ry: 8, fill: c, stroke: dark, 'stroke-width': 2.5 }, g);
  const hole = el('ellipse', { cx: 0, cy: -20, rx: 15, ry: 4.5, fill: dark }, g);
  el('path', { d: 'M -40 -5 Q -30 -4 -19 -16', stroke: 'rgba(255,255,255,.5)', 'stroke-width': 5, fill: 'none', 'stroke-linecap': 'round' }, g);
  return { g, update(x, y, rot = 0, s = 1, op = 1, onCone = false, sy = 1) { g.setAttribute('transform', `translate(${x} ${y}) rotate(${rot}) scale(${s} ${s * sy})`); g.setAttribute('opacity', op); hole.setAttribute('fill', onCone ? '#f2c200' : dark); sh.setAttribute('opacity', onCone ? 0 : .18); } };
}
const BAGC = [[C.bagRed, '#8f1018'], [C.bagBlue, '#142f80'], ['#20a35a', '#0d6633'], ['#ff9d2e', '#b85d00']];
function makeBagItem(parent, i) {
  const b = makeBag(parent, ...BAGC[i % 4]);
  return { g: b.g, update(x, y, rot = 0, s = 1, op = 1, flag = false, sy = 1) { b.update(x, y, rot, s * 1.3, op, sy); } };
}
function makeBall(parent, i) {
  const c = [C.red, C.blue, '#20a35a', C.orange][i % 4], g = el('g', {}, parent), sp = el('g', {}, g);
  el('circle', { r: 26, fill: c, stroke: 'rgba(0,0,0,.25)', 'stroke-width': 3 }, sp);
  el('path', { d: 'M -26 0 Q 0 -14 26 0 M 0 -26 Q 12 0 0 26', stroke: '#fff', 'stroke-width': 4, fill: 'none', opacity: .8 }, sp);
  el('ellipse', { cx: -9, cy: -11, rx: 8, ry: 5, fill: '#fff', opacity: .45 }, g);
  return { g, update(x, y, rot = 0, s = 1, op = 1) { g.setAttribute('transform', `translate(${x} ${y}) scale(${s})`); g.setAttribute('opacity', op); sp.setAttribute('transform', `rotate(${rot})`); } };
}
function makeItem(parent, kind, i) { return kind === 'disc' ? makeDisc(parent, i) : kind === 'ball' ? makeBall(parent, i) : makeBagItem(parent, i); }
function makeTallCone(parent) {
  const g = el('g', {}, parent);
  el('ellipse', { cx: 0, cy: 4, rx: 92, ry: 14, fill: '#000', opacity: .18 }, g);
  el('path', { d: 'M -82 -2 L 82 -2 L 70 -24 L -70 -24 Z', fill: '#efbd00', stroke: '#b98d00', 'stroke-width': 3, 'stroke-linejoin': 'round' }, g);
  el('path', { d: 'M -60 -20 L -13 -250 Q 0 -258 13 -250 L 60 -20 Q 0 -8 -60 -20 Z', fill: 'url(#coneGrad)', stroke: '#c99a00', 'stroke-width': 3, 'stroke-linejoin': 'round' }, g);
  [[-22, -58], [24, -66], [0, -108], [-16, -146], [14, -176], [-36, -36], [38, -34]].forEach(([x, y]) => el('ellipse', { cx: x, cy: y, rx: 7, ry: 9, fill: '#c99a00' }, g));
  el('path', { d: 'M -40 -40 L -8 -236', stroke: 'rgba(255,255,255,.45)', 'stroke-width': 6, 'stroke-linecap': 'round' }, g);
  return { g, update(x, y, s = 1, op = 1, rot = 0) { g.setAttribute('transform', `translate(${x} ${y}) rotate(${rot}) scale(${s})`); g.setAttribute('opacity', op); } };
}
const slotDy = k => -191 - 12 * k;
function makeBasket(parent) {               // back + front so items can drop "inside"
  const back = el('g', {}, parent), front = el('g', {}, parent);
  el('ellipse', { cx: 0, cy: 4, rx: 86, ry: 14, fill: '#000', opacity: .18 }, back);
  el('ellipse', { cx: 0, cy: -120, rx: 76, ry: 20, fill: '#7a4416' }, back);
  el('path', { d: 'M -76 -120 L -60 0 Q 0 12 60 0 L 76 -120 Q 0 -100 -76 -120 Z', fill: '#e08d3c', stroke: '#9c5513', 'stroke-width': 4, 'stroke-linejoin': 'round' }, front);
  for (let i = 1; i < 4; i++) { const y = -120 + i * 30; el('path', { d: `M ${-76 + i * 4} ${y} Q 0 ${y + 18} ${76 - i * 4} ${y}`, stroke: '#b5651d', 'stroke-width': 4, fill: 'none' }, front); }
  [-40, 0, 40].forEach(x => el('path', { d: `M ${x * 1.1} -114 L ${x * .85} 4`, stroke: '#b5651d', 'stroke-width': 4 }, front));
  el('path', { d: 'M -76 -120 Q 0 -100 76 -120', stroke: '#9c5513', 'stroke-width': 9, fill: 'none', 'stroke-linecap': 'round' }, front);
  return { back, front, update(x, y, s = 1, op = 1, rot = 0) { [back, front].forEach(g => { g.setAttribute('transform', `translate(${x} ${y}) rotate(${rot}) scale(${s})`); g.setAttribute('opacity', op); }); } };
}
function makeTongs(parent) {
  const g = el('g', {}, parent);
  const arms = [-1, 1].map(s => { const a = el('g', {}, g); const b = el('g', { transform: `scale(1 ${s})` }, a); el('path', { d: 'M 0 -6 L 100 -5 Q 110 -5 112 4 L 112 10 L 103 10 L 101 5 L 0 5 Z', fill: '#ffd21f', stroke: '#c99a00', 'stroke-width': 2.5, 'stroke-linejoin': 'round' }, b); return a; });
  el('circle', { r: 11, fill: '#ffd21f', stroke: '#c99a00', 'stroke-width': 2.5 }, g);
  return {
    g, update(x, y, ang, open, s = 1, op = 1) { g.setAttribute('transform', `translate(${x} ${y}) rotate(${ang}) scale(${s})`); g.setAttribute('opacity', op); arms.forEach((a, i) => a.setAttribute('transform', `rotate(${(i ? 1 : -1) * open})`)); },
    tip: (x, y, ang, s = 1) => [x + Math.cos(ang * D2R) * 108 * s, y + Math.sin(ang * D2R) * 108 * s],
  };
}
function makeMat(parent, w, h, rows, cols) {
  const g = el('g', {}, parent);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x0 = -w / 2 + c * w / cols, y0 = -h / 2 + r * h / rows, sk = 30;
    el('path', { d: `M ${x0 + sk * (1 - r / rows)} ${y0} l ${w / cols} 0 l ${-sk / rows} ${h / rows} l ${-w / cols} 0 Z`, fill: (r + c) % 2 ? '#e94b6b' : '#3a6ee0', stroke: 'rgba(255,255,255,.35)', 'stroke-width': 2 }, g);
  }
  return g;
}
function iconBubble(parent, color) { const g = el('g', {}, parent); el('circle', { r: 62, fill: color, stroke: '#fff', 'stroke-width': 9 }, g); return g; }
const arrowIcon = (g, up) => el('path', { d: up ? 'M 0 -36 L 30 0 L 12 0 L 12 32 L -12 32 L -12 0 L -30 0 Z' : 'M 0 36 L 30 0 L 12 0 L 12 -32 L -12 -32 L -12 0 L -30 0 Z', fill: '#fff' }, g);


// ───────────── characters from the card analysis ─────────────
const hexOr = (v, d) => /^#[0-9a-f]{6}$/i.test(v || '') ? v : d;
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16), f = v => Math.max(0, Math.min(255, Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k)));
  return '#' + [n >> 16, n >> 8 & 255, n & 255].map(f).map(v => v.toString(16).padStart(2, '0')).join('');
}
const HAIR_STYLES = ['kid', 'short', 'ponytail', 'long', 'bun', 'pigtails'];
function normChar(c, role) {
  c = c || {};
  const age = ['child', 'teen', 'adult'].includes(c.age) ? c.age : (role === 'helper' ? 'adult' : 'child');
  const gender = c.gender === 'female' ? 'female' : c.gender === 'male' ? 'male' : (role === 'helper' ? 'female' : 'male');
  const def = role === 'helper' ? TEACHER : KID;
  return { role, age, gender, hijab: !!c.hijab, hairStyle: HAIR_STYLES.includes(c.hairStyle) ? c.hairStyle : '',
    hair: hexOr(c.hair, def.hair), scarf: hexOr(c.scarf, '#e85d9e'), skin: hexOr(c.skin, def.skin),
    top: hexOr(c.top, def.shirt), bottom: hexOr(c.bottom, def.pants), shoes: hexOr(c.shoes, def.shoe),
    sleeves: ['long', 'short', 'none'].includes(c.sleeves) ? c.sleeves : (age === 'child' ? 'short' : 'long') };
}
function personOpts(c) {
  const child = c.age === 'child', base = Object.assign({}, child ? KID : TEACHER);
  const hs = c.hijab ? 'hijab' : (c.hairStyle || (child ? (c.gender === 'female' ? 'pigtails' : 'kid') : (c.gender === 'female' ? 'ponytail' : 'short')));
  return Object.assign(base, { kid: child ? 1 : 0, shirt: c.top, trim: child ? shade(c.top, .5) : c.top, pants: c.bottom, shoe: c.shoes, skin: c.skin, hair: c.hair, scarf: c.scarf, hairStyle: hs, sleeves: c.sleeves,
    sc: child ? 1 : c.age === 'teen' ? .72 : .8 });
}

// ───────────── side-view body (floor exercises) ─────────────
const toTheta = a => 90 - a;                           // lib ik() angles → screen angles (0 = right, 90 = down)
const ptAt = (P, ang, len) => [P[0] + Math.cos(ang * D2R) * len, P[1] + Math.sin(ang * D2R) * len];
function makeSide(parent, o) {
  const kid = !!o.kid, k = kid ? .74 : 1, R = kid ? 38 : 31;
  const L = { T: 150 * k, TH: 118 * k, SH: 112 * k, UA: 82 * k, FA: 78 * k, N: 16 * k, tw: 46 * k, lw: 30 * k, sw: 24 * k, aw: 18 * k };
  const g = el('g', {}, parent);
  const shadow = el('ellipse', { rx: 120, ry: 12, fill: '#000', opacity: .14 }, g);
  const SL = o.sleeves || (kid ? 'short' : 'long');
  const uaCol = SL === 'none' ? o.skin : o.shirt, faCol = SL === 'long' ? o.shirt : o.skin;
  const line = (col, w) => el('line', { stroke: col, 'stroke-width': w, 'stroke-linecap': 'round' }, g);
  const limb = dk => ({
    th: line(shade(o.pants, dk), L.lw), sh: line(shade(o.pants, dk), L.sw), shoe: el('ellipse', { rx: L.sw * 1.05, ry: L.sw * .5, fill: shade(o.shoe, dk), stroke: 'rgba(0,0,0,.18)', 'stroke-width': 2 }, g) });
  const arm = dk => ({ ua: line(shade(uaCol, dk), L.aw + 2), fa: line(shade(faCol, dk), L.aw), hand: el('circle', { r: L.aw * .62, fill: shade(o.skin, dk) }, g) });
  const farArm = arm(-.22), farLeg = limb(-.25);
  const waist = line(o.pants, L.tw * .95), torso = line(o.shirt, L.tw), neck = line(o.skin, L.aw);
  const head = el('g', {}, g), r = R, hs = o.hairStyle || (kid ? 'kid' : 'ponytail'), hc = hs === 'hijab' ? (o.scarf || o.hair) : o.hair;
  let pony = null;
  if (hs === 'ponytail') pony = el('path', { fill: hc, d: `M ${-r * .45} ${-r * .8} C ${-r * 1.7} ${-r * .7} ${-r * 1.8} ${r * .7} ${-r * 1.25} ${r * 1.45} C ${-r * 1.05} ${r * .7} ${-r * .95} ${-r * .05} ${-r * .45} ${-r * .2} Z` }, head);
  if (hs === 'long') pony = el('path', { fill: hc, d: `M ${-r * .95} ${-r * .55} C ${-r * 1.45} ${r * .4} ${-r * 1.25} ${r * 1.6} ${-r * .55} ${r * 1.85} L ${r * .05} ${r * 1.15} C ${-r * .1} ${r * .5} ${-r * .3} 0 0 ${-r * .3} Z` }, head);
  if (hs === 'bun') el('circle', { cx: -r * .72, cy: -r * .78, r: r * .4, fill: hc }, head);
  if (hs === 'pigtails') el('ellipse', { cx: -r * 1.02, cy: r * .2, rx: r * .32, ry: r * .5, fill: hc }, head);
  if (hs === 'hijab') el('path', { fill: hc, d: `M ${-r * 1.25} ${-r * .1} C ${-r * 1.3} ${-r * 1.5} ${r * 1.15} ${-r * 1.55} ${r * 1.18} ${-r * .05} L ${r * .85} ${r * 1.9} L ${-r * 1.45} ${r * 1.95} Z` }, head);
  el('circle', { r, fill: o.skin }, head);
  el('circle', { cx: r * .98, cy: r * .14, r: r * .15, fill: o.skin }, head);
  if (hs !== 'hijab') el('circle', { cx: -r * .12, cy: r * .06, r: r * .2, fill: shade(o.skin, -.1) }, head);
  if (hs === 'kid') el('path', { fill: hc, d: `M ${-r * 1.03} ${r * .18} C ${-r * 1.15} ${-r * 1.25} ${r * .8} ${-r * 1.38} ${r * 1.03} ${-r * .22} L ${r * .62} ${-r * .38} L ${r * .38} ${-r * .2} L ${r * .12} ${-r * .46} L ${-r * .2} ${-r * .24} L ${-r * .45} ${-r * .42} L ${-r * .62} 0 Z` }, head);
  else if (hs === 'short') el('path', { fill: hc, d: `M ${-r * 1.04} ${r * .22} C ${-r * 1.16} ${-r * 1.26} ${r * .85} ${-r * 1.36} ${r * 1.04} ${-r * .28} C ${r * .62} ${-r * .58} ${-r * .3} ${-r * .52} ${-r * .55} ${r * .32} Z` }, head);
  else if (hs === 'hijab') el('path', { fill: hc, 'fill-rule': 'evenodd', d: `M ${-r * 1.2} 0 A ${r * 1.2} ${r * 1.22} 0 1 1 ${r * 1.2} 0 A ${r * 1.2} ${r * 1.22} 0 1 1 ${-r * 1.2} 0 Z M ${r * -.25} ${r * .1} A ${r * .62} ${r * .8} 0 1 0 ${r * .99} ${r * .1} A ${r * .62} ${r * .8} 0 1 0 ${r * -.25} ${r * .1} Z` }, head);
  else el('path', { fill: hc, d: `M ${-r * 1.05} ${r * .28} C ${-r * 1.22} ${-r * 1.3} ${r * .9} ${-r * 1.42} ${r * 1.05} ${-r * .22} C ${r * .72} ${-r * .62} 0 ${-r * .8} ${-r * .5} ${-r * .12} Z` }, head);
  el('ellipse', { cx: r * .45, cy: r * .32, rx: r * .16, ry: r * .1, fill: '#ff8a80', opacity: .45 }, head);
  const eye = el('ellipse', { cx: r * .52, cy: -r * .05, rx: r * .1, ry: r * .14, fill: '#2b1d16' }, head);
  el('path', { d: `M ${r * .35} ${-r * .3} Q ${r * .52} ${-r * .38} ${r * .7} ${-r * .3}`, stroke: hs === 'hijab' ? '#2b1d16' : o.hair, 'stroke-width': 3.5, fill: 'none', 'stroke-linecap': 'round' }, head);
  const mouth = el('path', { fill: 'none', stroke: '#8a3b2b', 'stroke-width': 4, 'stroke-linecap': 'round' }, head);
  const nearLeg = limb(0), nearArm = arm(0);
  const ball = el('g', {}, g); el('circle', { r: 30 * k, fill: '#2f6fe0', stroke: '#1d47a8', 'stroke-width': 3 }, ball); el('path', { d: `M ${-30 * k} 0 Q 0 ${-14 * k} ${30 * k} 0`, stroke: '#fff', 'stroke-width': 3, fill: 'none', opacity: .7 }, ball);
  const api = { g, k, L, hipW: [0, 0] };
  api.update = (p, x0, gy, t = 0) => {
    const S = p.scale || 1, P = ([x, y]) => [x0 + x * k * S, gy + y * k * S];
    const H = P(p.hip), Sh = ptAt(H, p.t, L.T * S), front = ptAt([0, 0], p.t + 90, 1);
    const seg = (a, b, w) => set(a, { x1: b[0][0], y1: b[0][1], x2: b[1][0], y2: b[1][1] });
    const solve = (from, spec, i, L1, L2, bend) => {
      if (spec.to) { const T2 = P(spec.to[i]); const [a1, a2] = ik(from[0], from[1], T2[0], T2[1], L1, L2, (spec.b || [1, 1])[i] * bend); return [toTheta(a1), toTheta(a1 + a2)]; }
      return [spec.a1[i], spec.a2[i]];
    };
    const legs = p.feet ? { to: p.feet, b: p.kb } : { a1: p.th, a2: p.sh };
    const arms = p.hands ? { to: p.hands, b: p.eb } : { a1: p.ua, a2: p.fa };
    const xs = [H[0], Sh[0]];
    [[farLeg, 1], [nearLeg, 0]].forEach(([lg, i]) => {
      const [a, b] = solve(H, legs, i, L.TH * S, L.SH * S, 1);
      const Kn = ptAt(H, a, L.TH * S), F = ptAt(Kn, b, L.SH * S);
      set(lg.th, { x1: H[0], y1: H[1], x2: Kn[0], y2: Kn[1] }); set(lg.sh, { x1: Kn[0], y1: Kn[1], x2: F[0], y2: F[1] });
      const c1 = b - 90, c2 = b + 90, fd = Math.cos((c1 - (p.t + 90)) * D2R) > Math.cos((c2 - (p.t + 90)) * D2R) ? c1 : c2;
      const sc = ptAt(F, fd, L.sw * .45);
      set(lg.shoe, { cx: sc[0], cy: sc[1], transform: `rotate(${fd} ${sc[0]} ${sc[1]})` }); xs.push(F[0]);
    });
    let handNear = null;
    [[farArm, 1], [nearArm, 0]].forEach(([am, i]) => {
      const [a, b] = solve(Sh, arms, i, L.UA * S, L.FA * S, -1);
      const E1 = ptAt(Sh, a, L.UA * S), Hd = ptAt(E1, b, L.FA * S);
      set(am.ua, { x1: Sh[0], y1: Sh[1], x2: E1[0], y2: E1[1] }); set(am.fa, { x1: E1[0], y1: E1[1], x2: Hd[0], y2: Hd[1] }); set(am.hand, { cx: Hd[0], cy: Hd[1] });
      if (!i) handNear = Hd; xs.push(Hd[0]);
    });
    const W1 = ptAt(H, p.t, L.T * S * .3), T1 = ptAt(H, p.t, L.T * S * .2);
    set(waist, { x1: H[0], y1: H[1], x2: W1[0], y2: W1[1] }); set(torso, { x1: T1[0], y1: T1[1], x2: Sh[0], y2: Sh[1] });
    const nd = p.t + (p.nod || 0), N2 = ptAt(Sh, nd, L.N * S), Hc = ptAt(Sh, nd, (L.N + r * .85) * S);
    set(neck, { x1: Sh[0], y1: Sh[1], x2: N2[0], y2: N2[1] });
    head.setAttribute('transform', `translate(${Hc[0]} ${Hc[1]}) rotate(${nd + 90}) scale(${S})`);
    if (pony) pony.setAttribute('transform', `rotate(${Math.sin(t * 4) * 4})`);
    const blink = ((t * .29 + .5) % 1) < .025 ? .15 : 1; set(eye, { ry: r * .14 * blink });
    const mo = p.mouth || 0;
    set(mouth, { d: mo > .3 ? `M ${r * .4} ${r * .42} Q ${r * .62} ${r * .7} ${r * .82} ${r * .42} Z` : `M ${r * .42} ${r * .44} Q ${r * .62} ${r * .58} ${r * .82} ${r * .42}`, fill: mo > .3 ? '#8a2a2a' : 'none' });
    const mn = Math.min(...xs), mx = Math.max(...xs);
    set(shadow, { cx: (mn + mx) / 2, cy: gy + 4, rx: (mx - mn) / 2 + 30, ry: 12 });
    ball.setAttribute('opacity', p.ball ? 1 : 0);
    if (p.ball && handNear) ball.setAttribute('transform', `translate(${handNear[0] + 10 * k} ${handNear[1] - 4}) scale(${p.ballS || 1})`);
    api.hipW = H; api.headW = Hc;
  };
  return api;
}

// ───────────── exercise moves (side view, facing right; units = adult, origin = mat centre on the floor) ─────────────
// type: cycle (A→B→A), alt (alternating sides A↔B), hold (A with breathing), front (frontal body)
const SUPINE_ARMS = [[40, -10], [30, -10]];
const MOVES = {
  plank: { type: 'hold', rep: 2.4, floor: 1, A: { hip: [-5, -72], t: -7, hands: [[222, -8], [214, -8]], eb: [1, 1], feet: [[-222, -4], [-208, -4]], kb: [1, 1] }, B: { hip: [-5, -77], t: -9 } },
  leg_raise: { type: 'cycle', rep: 2.2, floor: 1, A: { hip: [60, -24], t: 180, hands: SUPINE_ARMS, eb: [1, 1], th: [-8, -6], sh: [-8, -6] }, B: { th: [-86, -84], sh: [-86, -84] } },
  crunch: { type: 'cycle', rep: 2.0, floor: 1, A: { hip: [40, -24], t: 180, feet: [[168, -4], [178, -4]], kb: [1, 1], hands: [[-142, -52], [-136, -50]], eb: [-1, -1] }, B: { t: 214, hands: [[-112, -160], [-106, -156]], mouth: .5 } },
  bicycle: { type: 'alt', rep: 1.6, floor: 1, A: { hip: [40, -24], t: 205, hands: [[-128, -126], [-122, -122]], eb: [-1, -1], th: [-105, -18], sh: [-10, -18] }, B: { th: [-18, -105], sh: [-18, -10] } },
  russian_twist: { type: 'cycle', rep: 1.4, floor: 1, A: { hip: [0, -20], t: -125, th: [-45, -42], sh: [15, 18], hands: [[90, -92], [80, -90]], eb: [1, 1], ball: 1, ballS: 1.12 }, B: { hands: [[50, -128], [42, -126]], ballS: .86 } },
  mountain_climber: { type: 'alt', rep: .9, floor: 1, A: { hip: [-20, -120], t: -18, hands: [[123, -6], [116, -6]], eb: [1, 1], th: [40, 148.6], sh: [175, 148.6] }, B: { th: [148.6, 40], sh: [148.6, 175] } },
  push_up: { type: 'cycle', rep: 1.8, floor: 1, A: { hip: [-20, -120], t: -18, hands: [[123, -6], [116, -6]], eb: [1, 1], th: [148.6, 150], sh: [148.6, 150] }, B: { hip: [-20, -64], t: -7, th: [163.8, 164.5], sh: [163.8, 164.5] } },
  glute_bridge: { type: 'cycle', rep: 2.0, floor: 1, A: { hip: [30, -24], t: 180, feet: [[150, -4], [160, -4]], kb: [1, 1], hands: [[-20, -8], [-30, -8]], eb: [1, 1] }, B: { hip: [30, -100], t: 153 } },
  squat: { type: 'cycle', rep: 2.0, A: { hip: [0, -226], t: -90, feet: [[8, -4], [-6, -4]], kb: [1, 1], hands: [[10, -70], [0, -70]], eb: [1, 1] }, B: { hip: [-70, -120], t: -55, hands: [[150, -262], [140, -258]] } },
  lunge: { type: 'cycle', rep: 2.2, A: { hip: [0, -222], t: -90, feet: [[70, -4], [-70, -4]], kb: [1, 1], hands: [[25, -226], [18, -224]], eb: [-1, -1] }, B: { hip: [0, -130], feet: [[110, -4], [-120, -4]], hands: [[25, -134], [18, -132]] } },
  superman: { type: 'cycle', rep: 2.2, floor: 1, A: { hip: [-30, -24], t: 0, nod: -8, hands: [[260, -20], [250, -20]], eb: [1, 1], th: [180, 180], sh: [180, 180] }, B: { t: -12, nod: -18, hands: [[255, -72], [245, -70]], th: [190, 190], sh: [193, 193], mouth: .5 } },
  flutter: { type: 'alt', rep: .8, floor: 1, A: { hip: [60, -24], t: 180, hands: SUPINE_ARMS, eb: [1, 1], th: [-18, -36], sh: [-18, -36] }, B: { th: [-36, -18], sh: [-36, -18] } },
  jumping_jack: { type: 'front', rep: 1.0 }, high_knees: { type: 'front', rep: .8 }, stretch: { type: 'front', rep: 3.0 },
};
const MOVE_LIST = Object.keys(MOVES);
const mixPose = (A, B, k) => { const o = {}; for (const key in A) { const a = A[key], b = B[key] === undefined ? a : B[key]; o[key] = Array.isArray(a) ? a.map((v, i) => Array.isArray(v) ? v.map((w, j) => lerp(w, b[i][j], k)) : lerp(v, b[i], k)) : typeof a === 'number' ? lerp(a, b, k) : a; } return o; };
function movePose(name, tl) {             // tl = seconds since the move started
  const m = MOVES[name] || MOVES.stretch, A = m.A, B = Object.assign({}, A, m.B);
  const ph = Math.max(0, tl) / m.rep, k = m.type === 'hold' ? (1 - Math.cos(ph * TAU)) / 2 : (1 - Math.cos(ph * TAU)) / 2;
  return mixPose(A, B, m.type === 'alt' ? (Math.floor(ph) % 2 ? 1 - E.io(Math.min(1, (ph % 1) * 2)) : E.io(Math.min(1, (ph % 1) * 2))) : k);
}
function frontPose(name, tl, x, y, s) {    // frontal moves use the standing body
  const m = MOVES[name], ph = Math.max(0, tl) / m.rep;
  if (name === 'jumping_jack') { const k = (1 - Math.cos(ph * TAU)) / 2; return { x, y: y - Math.sin(ph * TAU * 2) * 18 * k, s, spread: lerp(20, 70, k), la: [lerp(-12, -165, k), lerp(8, -10, k)], ra: [lerp(12, 165, k), lerp(-8, 10, k)], mouth: .3 }; }
  if (name === 'high_knees') { const a = Math.sin(ph * Math.PI); return { x, y: y - Math.abs(a) * 10, s, lift: [Math.max(0, a) * .95, Math.max(0, -a) * .95], la: [-12 - a * 40, 60 * Math.max(0, a)], ra: [12 - a * 40, -60 * Math.max(0, -a)], mouth: .3 }; }
  const k = Math.sin(ph * TAU);
  return { x, y, s, lean: k * 10, la: [-170, -5], ra: [170, 5], mouth: .2 };
}

// ───────────── rooms ─────────────
GRAD.studioWall = ctx => { const g = ctx.createLinearGradient(0, -500, 0, 570); g.addColorStop(0, '#efe4ff'); g.addColorStop(1, '#ffe3ee'); return g; };
function buildKidsRoom(cam) {
  el('rect', { x: -900, y: -500, width: 3720, height: 1070, fill: 'url(#wallGrad)' }, cam);
  el('rect', { x: -900, y: 520, width: 3720, height: 26, fill: '#ff9d2e' }, cam);
  el('rect', { x: -900, y: 546, width: 3720, height: 16, fill: '#e07a12' }, cam);
  const bg = el('g', {}, cam), cols = [C.orange, C.blue, C.red, C.green, '#8e5bff'];
  el('path', { d: 'M -300 70 Q 960 230 2220 70', fill: 'none', stroke: '#8c7a66', 'stroke-width': 4 }, bg);
  for (let i = 0; i < 28; i++) { const k = i / 27, x = lerp(-300, 2220, k), y = 70 + 4 * k * (1 - k) * 160; el('path', { d: `M ${x - 30} ${y} L ${x + 30} ${y} L ${x} ${y + 60} Z`, fill: cols[i % 5] }, bg); }
  [[200, 230], [1720, 230]].forEach(([x, y]) => { el('rect', { x: x - 130, y, width: 260, height: 190, rx: 24, fill: '#d6ecff', stroke: '#fff', 'stroke-width': 10 }, bg); el('path', { d: `M ${x} ${y} L ${x} ${y + 190} M ${x - 130} ${y + 95} L ${x + 130} ${y + 95}`, stroke: '#fff', 'stroke-width': 8 }, bg); });
  const fl = el('g', {}, cam), HZ = 300, rows = [560];
  for (let i = 1; i < 7; i++) rows.push(HZ + 2600 / (10 - i * 1.4));
  const X = (j, y) => 960 + j * 130 * (y - HZ) / 260;
  for (let r = 0; r < rows.length - 1; r++) for (let j = -22; j < 22; j++) {
    const y0 = rows[r], y1 = rows[r + 1];
    el('path', { d: `M ${X(j, y0)} ${y0} L ${X(j + 1, y0)} ${y0} L ${X(j + 1, y1)} ${y1} L ${X(j, y1)} ${y1} Z`, fill: (r + j) % 2 ? '#e94b6b' : '#3a6ee0', stroke: 'rgba(255,255,255,.28)', 'stroke-width': 3 }, fl);
  }
}
function buildStudio(cam) {
  el('rect', { x: -900, y: -500, width: 3720, height: 1070, fill: 'url(#studioWall)' }, cam);
  // big windows with soft light
  [[330, 120], [1590, 120]].forEach(([x, y]) => {
    el('rect', { x: x - 170, y, width: 340, height: 300, rx: 18, fill: '#d9f0ff', stroke: '#fff', 'stroke-width': 12 }, cam);
    el('path', { d: `M ${x} ${y} L ${x} ${y + 300} M ${x - 170} ${y + 150} L ${x + 170} ${y + 150}`, stroke: '#fff', 'stroke-width': 9 }, cam);
    el('path', { d: `M ${x - 120} ${y + 30} L ${x - 60} ${y + 30} L ${x - 140} ${y + 130} L ${x - 160} ${y + 130} Z`, fill: '#fff', opacity: .5 }, cam);
  });
  // wall stripe + clock
  el('rect', { x: -900, y: 470, width: 3720, height: 14, fill: '#c9a8ff', opacity: .6 }, cam);
  el('circle', { cx: 960, cy: 150, r: 62, fill: '#fff', stroke: '#8e5bff', 'stroke-width': 8 }, cam);
  el('path', { d: 'M 960 150 L 960 108 M 960 150 L 990 162', stroke: C.navy, 'stroke-width': 7, 'stroke-linecap': 'round' }, cam);
  // floor: light wood in perspective
  el('rect', { x: -900, y: 540, width: 3720, height: 900, fill: '#e9c79c' }, cam);
  el('rect', { x: -900, y: 532, width: 3720, height: 16, fill: '#fff' }, cam);
  const fl = el('g', { stroke: '#d4ab78', 'stroke-width': 3 }, cam);
  for (let i = -16; i <= 16; i++) el('line', { x1: 960 + i * 110, y1: 548, x2: 960 + i * 380, y2: 1400 }, fl);
  [610, 690, 800, 960, 1180].forEach(y => el('line', { x1: -900, y1: y, x2: 2820, y2: y, opacity: .5 }, fl));
  // plant + dumbbell rack
  el('path', { d: 'M 120 560 L 220 560 L 205 660 L 135 660 Z', fill: '#e07a12' }, cam);
  [[-40, -90], [0, -130], [40, -95], [-20, -60], [25, -60]].forEach(([dx, dy], i) => el('ellipse', { cx: 170 + dx, cy: 560 + dy, rx: 26, ry: 58, fill: i % 2 ? '#2e9e5b' : '#3cb96a', transform: `rotate(${dx * .8} ${170 + dx} ${560 + dy})` }, cam));
  el('rect', { x: 1640, y: 470, width: 220, height: 16, rx: 6, fill: '#5d6472' }, cam);
  el('rect', { x: 1650, y: 486, width: 12, height: 130, fill: '#5d6472' }, cam); el('rect', { x: 1838, y: 486, width: 12, height: 130, fill: '#5d6472' }, cam);
  el('rect', { x: 1640, y: 540, width: 220, height: 14, rx: 6, fill: '#5d6472' }, cam);
  [[1680, 455, '#ff5fa2'], [1750, 455, '#2f6fe0'], [1820, 455, '#ffd21f'], [1690, 525, '#20a35a'], [1780, 525, '#ff7a1a']].forEach(([x, y, c]) => { el('rect', { x: x - 26, y: y - 10, width: 52, height: 20, rx: 6, fill: '#3d424e' }, cam); [-1, 1].forEach(sg => el('rect', { x: x + sg * 22 - 9, y: y - 18, width: 18, height: 36, rx: 6, fill: c }, cam)); });
}
function buildPark(cam) {
  const sky = el('g', {}, cam);
  el('rect', { x: -900, y: -500, width: 3720, height: 1080, fill: '#8fd3ff' }, sky);
  el('rect', { x: -900, y: 200, width: 3720, height: 380, fill: '#bfe8ff' }, sky);
  el('circle', { cx: 1650, cy: 140, r: 90, fill: '#ffe066' }, sky); el('circle', { cx: 1650, cy: 140, r: 130, fill: '#ffe066', opacity: .25 }, sky);
  [[260, 120], [700, 70], [1200, 150]].forEach(([x, y]) => { const c = el('g', { opacity: .95 }, sky); [[-60, 10, 50], [0, -10, 64], [60, 10, 48]].forEach(([dx, dy, r]) => el('circle', { cx: x + dx, cy: y + dy, r, fill: '#fff' }, c)); });
  [-200, 160, 520, 1450, 1800, 2150].forEach((x, i) => { el('rect', { x: x - 16, y: 380, width: 32, height: 190, fill: '#8a5a33' }, cam); el('circle', { cx: x, cy: 360, r: 110 + (i % 2) * 20, fill: i % 2 ? '#3cb96a' : '#2e9e5b' }, cam); el('circle', { cx: x - 50, cy: 400, r: 70, fill: '#46c776' }, cam); });
  for (let x = -900; x < 2820; x += 46) el('rect', { x, y: 470, width: 14, height: 100, rx: 5, fill: '#fff6e0', stroke: '#e6d3a8', 'stroke-width': 2 }, cam);
  el('rect', { x: -900, y: 500, width: 3720, height: 12, fill: '#e6d3a8' }, cam);
  el('rect', { x: -900, y: 560, width: 3720, height: 900, fill: '#7ccf5b' }, cam);
  const st = el('g', { opacity: .35 }, cam); for (let i = -16; i <= 16; i++) el('path', { d: `M ${960 + i * 110} 560 L ${960 + i * 110 + 55} 560 L ${960 + i * 380 + 190} 1500 L ${960 + i * 380} 1500 Z`, fill: '#69bd4a' }, st);
  [[300, 640], [1500, 700], [700, 980], [1750, 1000]].forEach(([x, y]) => [0, 1, 2, 3, 4].forEach(k => el('circle', { cx: x + Math.cos(k * 1.26) * 12, cy: y + Math.sin(k * 1.26) * 12, r: 9, fill: ['#ff5fa2', '#ffd21f', '#fff'][k % 3] }, cam)));
}
function buildClassroom(cam) {
  el('rect', { x: -900, y: -500, width: 3720, height: 1070, fill: '#fdf1d8' }, cam);
  el('rect', { x: -900, y: 420, width: 3720, height: 140, fill: '#f6dfb0' }, cam);
  el('rect', { x: 640, y: 110, width: 640, height: 290, rx: 14, fill: '#2f6b4f', stroke: '#8a5a33', 'stroke-width': 16 }, cam);
  [['M 700 180 Q 760 150 820 180', '#fff'], ['M 700 240 L 900 240', '#ffd21f'], ['M 980 170 L 1040 260 L 1100 170 Z', '#ff9db5'], ['M 1140 300 a 40 40 0 1 0 1 0', '#9fe3ff']].forEach(([d, c]) => el('path', { d, stroke: c, 'stroke-width': 6, fill: 'none', 'stroke-linecap': 'round' }, cam));
  const ab = 'أبتثجحخدذر'; for (let i = 0; i < 10; i++) { const x = 1220 - i * 52; el('rect', { x: x - 22, y: 40, width: 44, height: 50, rx: 8, fill: [C.orange, C.blue, C.yellow, C.red, C.green][i % 5] }, cam); el('text', { x, y: 68, size: 30, weight: 900, fill: '#fff', text: ab[i] }, cam); }
  [[1600, 150], [260, 200]].forEach(([x, y]) => { el('rect', { x: x - 140, y, width: 280, height: 210, rx: 18, fill: '#cfeeff', stroke: '#fff', 'stroke-width': 10 }, cam); el('path', { d: `M ${x} ${y} L ${x} ${y + 210} M ${x - 140} ${y + 105} L ${x + 140} ${y + 105}`, stroke: '#fff', 'stroke-width': 8 }, cam); });
  el('rect', { x: -900, y: 540, width: 3720, height: 900, fill: '#d9b48a' }, cam);
  el('rect', { x: -900, y: 532, width: 3720, height: 14, fill: '#a87b4f' }, cam);
  const fl = el('g', { stroke: '#c49c70', 'stroke-width': 3 }, cam); for (let i = -16; i <= 16; i++) el('line', { x1: 960 + i * 110, y1: 546, x2: 960 + i * 380, y2: 1400 }, fl);
  el('rect', { x: 1420, y: 470, width: 240, height: 22, rx: 6, fill: '#ff9d2e' }, cam); el('rect', { x: 1440, y: 492, width: 14, height: 70, fill: '#8a5a33' }, cam); el('rect', { x: 1626, y: 492, width: 14, height: 70, fill: '#8a5a33' }, cam);
  el('rect', { x: 1470, y: 430, width: 60, height: 40, rx: 6, fill: C.blue }, cam); el('rect', { x: 1545, y: 440, width: 70, height: 30, rx: 6, fill: C.red }, cam);
}
const buildRoom = (cam, setting) => setting === 'fitness_studio' ? buildStudio(cam) : setting === 'park' ? buildPark(cam) : setting === 'classroom' ? buildClassroom(cam) : buildKidsRoom(cam);
function makeYogaMat(parent, color = '#8e5bff') {
  const g = el('g', {}, parent);
  el('ellipse', { cx: 0, cy: 6, rx: 440, ry: 26, fill: '#000', opacity: .12 }, g);
  el('path', { d: 'M -430 -18 L 430 -18 Q 452 -18 456 0 L 458 10 L -458 10 L -456 0 Q -452 -18 -430 -18 Z', fill: color }, g);
  el('path', { d: 'M -458 10 L 458 10 L 458 20 L -458 20 Z', fill: shade(color, -.3) }, g);
  el('path', { d: 'M -420 -12 L 420 -12', stroke: shade(color, .35), 'stroke-width': 4 }, g);
  return { g, update(x, y, ang = 0, s = 1, op = 1) { g.setAttribute('transform', `translate(${x} ${y}) scale(${s})`); g.setAttribute('opacity', op); }, base: (x, y, ang = 0, s = 1) => [x, y - 14 * s] };
}

// ───────────── workout plan: one exercise per step ─────────────
function planWorkout(S) {
  const T = { S, intro: [0, 8] };
  const nT = S.tools.length;
  let t = 8;
  T.cardT = S.tools.map((_, i) => t + 1.6 + i * 1.4);
  T.helpT = S.help.ar ? t + 1.6 + nT * 1.4 + .3 : null;
  T.tools = [8, nT || T.helpT ? t + 1.6 + nT * 1.4 + (S.help.ar ? 2.9 : .4) + 1.0 : 8];
  if (!nT && !T.helpT) T.cardT = [];
  const g0 = T.tools[1];
  T.steps = []; let st0 = g0 - .35;
  S.exercises.forEach((x, k) => {
    const m = MOVES[x.move] || MOVES.stretch, ts = st0 + .45, a = ts + 1.35;
    const hold = x.hold || m.type === 'hold';
    const n = hold ? 1 : Math.max(3, Math.min(8, Math.round(6.5 / m.rep)));
    const dur = Math.max(hold ? 7 : Math.max(6.5, n * m.rep), S.voiceDur && S.voiceDur[k] ? S.voiceDur[k] + .4 : 0);
    const end = a + dur + .7;
    T.steps.push(Object.assign({}, S.steps[k], { n: k, ts, te: ts + .8, end, a, dur, reps: n, hold, move: x.move }));
    st0 = end;
  });
  const cheer = st0 + .1; st0 += 1.8;
  T.gym = [g0, st0 + .5];
  const nB = S.benefits.length;
  T.benT = S.benefits.map((_, i) => T.gym[1] + 1.2 + i * 3);
  T.ben = [T.gym[1], nB ? T.gym[1] + 1.2 + nB * 3 + 1.6 : T.gym[1]];
  T.outro = [T.ben[1], T.ben[1] + 8];
  T.DUR = T.outro[1];
  T.ev = { pops: [], dings: [], bursts: [cheer], stars: [], items: [], icons: [], wob: [], jumps: [], throws: [], glowItem: [], glowTarget: [] };
  T.cheer = cheer;
  return T;
}


// ───────────── card-pictures plan: works for ANY card (each step shows its own picture from the card) ─────────────
function planCards(S) {
  const T = { S, intro: [0, 8] };
  const nT = S.tools.length;
  let t = 8;
  T.cardT = S.tools.map((_, i) => t + 1.6 + i * 1.4);
  T.helpT = S.help.ar ? t + 1.6 + nT * 1.4 + .3 : null;
  T.tools = [8, nT || T.helpT ? t + 1.6 + nT * 1.4 + (S.help.ar ? 2.9 : .4) + 1.0 : 8];
  const g0 = T.tools[1];
  T.steps = []; let st0 = g0 - .35;
  S.steps.forEach((x, k) => {
    const ts = st0 + .45, a = ts + 1.35, words = (x.capAr + ' ' + x.ar).split(/\s+/).length;
    const dur = Math.max(Math.max(4.6, Math.min(8.5, 3.2 + words * .32)), S.voiceDur && S.voiceDur[k] ? S.voiceDur[k] + .4 : 0);
    const end = a + dur + .5;
    T.steps.push(Object.assign({}, x, { n: k, ts, te: ts + .8, end, a, dur }));
    st0 = end;
  });
  const cheer = st0 + .1; st0 += 1.6;
  T.gym = [g0, st0 + .5];
  const nB = S.benefits.length;
  T.benT = S.benefits.map((_, i) => T.gym[1] + 1.2 + i * 3);
  T.ben = [T.gym[1], nB ? T.gym[1] + 1.2 + nB * 3 + 1.6 : T.gym[1]];
  T.outro = [T.ben[1], T.ben[1] + 8];
  T.DUR = T.outro[1];
  T.ev = { pops: S.steps.map((_, i) => 3.6 + i * .35).filter(x => x < 7.4), dings: [], bursts: [cheer], stars: [], items: [], icons: [], wob: [], jumps: [], throws: [], glowItem: [], glowTarget: [] };
  T.cheer = cheer;
  return T;
}
// crop rectangle (pixels) of a Gemini box [ymin, xmin, ymax, xmax] on a 0–1000 scale, with a little padding
function boxRect(box, IW, IH, pad = .02) {
  if (!Array.isArray(box) || box.length !== 4 || box.some(v => !isFinite(+v))) return null;
  let [y0, x0, y1, x1] = box.map(v => clamp(+v / 1000, 0, 1));
  if (y1 - y0 < .03 || x1 - x0 < .03) return null;
  x0 = clamp(x0 - pad); y0 = clamp(y0 - pad); x1 = clamp(x1 + pad); y1 = clamp(y1 + pad);
  return { sx: x0 * IW, sy: y0 * IH, sw: (x1 - x0) * IW, sh: (y1 - y0) * IH };
}
// draw an image (or the current frame of a video) into a rect: "cover" crops, "contain" letterboxes
function drawMedia(ctx, img, src, dx, dy, dw, dh, fit = 'cover', zoom = 1, px = 0, py = 0) {
  const isVid = typeof HTMLVideoElement !== 'undefined' && img instanceof HTMLVideoElement;
  const IW = isVid ? img.videoWidth : (img.naturalWidth || img.width), IH = isVid ? img.videoHeight : (img.naturalHeight || img.height);
  if (!IW || !IH) return;
  let { sx, sy, sw, sh } = src && !isVid ? src : { sx: 0, sy: 0, sw: IW, sh: IH };
  const ra = dw / dh;
  if (fit === 'cover') { if (sw / sh > ra) { const n = sh * ra; sx += (sw - n) / 2; sw = n; } else { const n = sw / ra; sy += (sh - n) / 2; sh = n; } }
  else { const a = sw / sh; if (a > ra) { const h = dw / a; dy += (dh - h) / 2; dh = h; } else { const w = dh * a; dx += (dw - w) / 2; dw = w; } }
  const zw = sw / zoom, zh = sh / zoom; sx += (sw - zw) * (.5 + px); sy += (sh - zh) * (.5 + py);
  try { ctx.drawImage(img, sx, sy, zw, zh, dx, dy, dw, dh); } catch (e) {}
}

// ───────────── spec normalisation ─────────────
const ACTIONS = ['ready', 'balance', 'squat', 'pick', 'stand', 'place', 'throw', 'repeat', 'walk', 'jump', 'oneleg'];
const TOOL_KINDS = ['board', 'beam', 'discs', 'cone', 'tongs', 'mat', 'bags', 'hoop', 'ball', 'basket', 'table', 'helper', 'other'];
const BEN_ICONS = ['balance', 'weight', 'eye', 'focus', 'heart', 'brain', 'hand', 'star'];
const str = v => (v == null ? '' : String(v)).trim();
function pair(v) { return typeof v === 'string' ? { ar: str(v), en: '' } : { ar: str(v && v.ar), en: str(v && v.en) }; }
function normalize(s) {
  s = s || {};
  const su = s.setup || {};
  const steps = (Array.isArray(s.steps) ? s.steps : []).slice(0, 6).map(x => ({
    ar: str(x.ar || x.title), en: str(x.en), capAr: str(x.capAr), capEn: str(x.capEn), action: ACTIONS.includes(x.action) ? x.action : 'balance', box: Array.isArray(x.box) ? x.box.map(Number) : null }));
  if (!steps.length) steps.push({ ar: 'استعد', en: 'Get ready', capAr: '', capEn: '', action: 'ready' }, { ar: 'حافظ على توازنك', en: 'Keep your balance', capAr: '', capEn: '', action: 'balance' });
  let surface = ['board', 'beam', 'floor'].includes(su.surface) ? su.surface : 'board';
  if (steps.some(x => x.action === 'walk') && surface === 'board') surface = 'beam';
  let item = ['disc', 'bag', 'ball'].includes(su.item) ? su.item : 'bag';
  let target = ['cone', 'hoop', 'basket'].includes(su.target) ? su.target : 'hoop';
  if (target === 'cone') item = 'disc';
  const template = ['workout', 'activity', 'other'].includes(s.template) ? s.template : 'activity';
  const chars = Array.isArray(s.characters) ? s.characters : [];
  const mainC = normChar(chars.find(c => c && c.role === 'main') || chars[0], 'main'), helpC = normChar(chars.find(c => c && c.role === 'helper'), 'helper');
  const exercises = (Array.isArray(s.exercises) ? s.exercises : []).slice(0, 8).map(x => ({ ar: str(x.ar), en: str(x.en), move: MOVE_LIST.includes(x.move) ? x.move : 'stretch', known: MOVE_LIST.includes(x.move), reps: pair(x.reps), target: pair(x.target), hold: !!x.hold, box: Array.isArray(x.box) ? x.box.map(Number) : null }));
  if (template === 'workout') {
    if (!exercises.length) exercises.push({ ar: 'تمرين', en: 'Exercise', move: 'stretch', reps: pair(''), target: pair(''), hold: false });
    steps.length = 0;
    exercises.forEach(x => steps.push({ ar: x.ar, en: x.en, capAr: [x.reps.ar, x.target.ar].filter(Boolean).join('  •  '), capEn: [x.reps.en, x.target.en].filter(Boolean).join('  •  '), action: 'exercise', box: x.box }));
  }
  return {
    template, setting: ['kids_gym', 'fitness_studio', 'park', 'classroom'].includes(s.setting) ? s.setting : (template === 'workout' ? 'fitness_studio' : 'kids_gym'),
    chars: { main: mainC, helper: helpC }, exercises,
    title: pair(s.title), desc: pair(s.desc), level: pair(s.level), help: pair(s.help), credit: str(s.credit),
    surface, item, target, tongs: !!su.tongs, helper: su.helper !== false,
    steps,
    tools: (Array.isArray(s.tools) ? s.tools : []).slice(0, 6).map(x => ({ ar: str(x.ar || x), en: str(x.en), kind: TOOL_KINDS.includes(x.kind) ? x.kind : 'other', box: Array.isArray(x.box) ? x.box.map(Number) : null })),
    mode: ['auto', 'cards', 'cartoon'].includes(s.mode) ? s.mode : 'auto', animatable: s.animatable !== false,
    voiceDur: Array.isArray(s.voiceDur) ? s.voiceDur.map(v => +v || 0) : null,
    benefits: (Array.isArray(s.benefits) ? s.benefits : []).slice(0, 5).map(x => ({ ar: str(x.ar || x), en: str(x.en), icon: BEN_ICONS.includes(x.icon) ? x.icon : 'star' })),
  };
}

// ───────────── timeline planning ─────────────
function Chan(v0) { this.k = [[-1e9, v0]]; }
Chan.prototype.at = function (t) { return K(t, this.k); };
Chan.prototype.to = function (t0, t1, v, e) { const L = this.k[this.k.length - 1]; if (t0 < L[0]) t0 = L[0]; if (t1 < t0) t1 = t0; this.k.push([t0, L[1]], [t1, v, e]); return t1; };

const G = { SX: 880, SY: 800, KID0: [640, 790], CONE: [1190, 762], BASK: [1215, 815], HOOP: [1310, 880] };
const CAM = { wide: [1, 960, 560], close: [1.3, 1000, 640], pick: [1.42, 1050, 680], place: [1.25, 1010, 600], hoop: [1.05, 1060, 600], mid: [1.12, 990, 610] };

function plan(S) {
  const T = { S, intro: [0, 8] };
  const nT = S.tools.length;
  let t = 8;
  T.cardT = S.tools.map((_, i) => t + 1.6 + i * 1.4);
  T.helpT = S.help.ar ? t + 1.6 + nT * 1.4 + .3 : null;
  t += 1.6 + nT * 1.4 + (S.help.ar ? 2.9 : .4) + 1.0;
  T.tools = [8, t];
  const g0 = t;
  const tongs = S.tongs;
  const hasReady = S.steps.some(x => x.action === 'ready');
  const C = T.C = {
    crouch: new Chan(0), bend: new Chan(0), mix: new Chan(0), tip: new Chan([1000, 800]), tAng: new Chan(72), open: new Chan(12),
    bal: new Chan(0), show: new Chan(0), cheer: new Chan(0), lift: new Chan(0), kx: new Chan(0), cam: new Chan(CAM.wide),
    tx: new Chan(hasReady ? 470 : 700), tcrouch: new Chan(hasReady ? 0 : 70), spot: new Chan(hasReady ? 0 : 1),
  };
  const ev = T.ev = { hop: hasReady ? null : [-10, -9.5], wob: [], icons: [], glowItem: [], glowTarget: [], stars: [], bursts: [], jumps: [], throws: [], arrows: null, tongsT: hasReady ? null : -1, pops: [], dings: [],
    items: [0, 1, 2, 3].map(() => ({ grab: null, rel: null, mode: null, slot: 0 })) };
  const INT = tongs ? [[1085, 842], [1040, 860], [1112, 820], [1000, 868]] : [[1060, 750], [1048, 768], [1075, 732], [1035, 782]];
  const off = T.off = S.item === 'disc' ? (tongs ? [46, 4] : [40, 10]) : S.item === 'ball' ? [0, 26] : [0, 20];
  T.INT = INT;
  T.slotPos = k => S.target === 'cone' ? [G.CONE[0], G.CONE[1] + slotDy(k)] : S.target === 'basket' ? [G.BASK[0] + (k - 1.5) * 24, G.BASK[1] - 106 - (k % 2) * 6] : [G.HOOP[0] + [-40, 34, -6, 48][k], G.HOOP[1] + [-6, 8, 12, -4][k]];
  const deliverMode = S.target === 'cone' ? 'place' : S.target === 'hoop' ? 'throw' : (S.steps.some(x => x.action === 'throw') ? 'throw' : 'place');
  let crouched = false, holding = -1, cur = -1, next = 0, slot = 0;
  const BENDDOWN = tongs ? 28 : 40;
  const CARRY = [G.SX + 140, G.SY - 250];

  function squat(a, d = 1.4) {
    if (next > 3) return a;
    const i = cur = next++;
    C.crouch.to(a, a + d, 96); C.bend.to(a, a + d, BENDDOWN);
    C.mix.to(a - .1, a + d, 1); C.tip.to(a, a + d, INT[i]); C.tAng.to(a, a + d, tongs ? 64 : 80); C.bal.to(a, a + .5, 1);
    if (d > 1) ev.icons.push(['down', a - .2, a + d + .5]);
    ev.glowItem.push([i, a - .4, null]); ev.wob.push([a + .2, 2.5]);
    crouched = true; return a + d;
  }
  function grab(a, fast) {
    if (cur < 0 || holding >= 0) return a;
    const i = cur, d = fast ? .3 : .45, g = a + d;
    C.open.to(a, g, 3); ev.items[i].grab = g; holding = i;
    C.tip.to(g + .1, g + (fast ? .3 : .8), [INT[i][0], INT[i][1] - 34]);
    if (!fast) ev.icons.push(['ok', g, g + 1.4]);
    ev.glowItem[ev.glowItem.length - 1][2] = g + .3;
    return g + (fast ? .35 : 1.0);
  }
  function stand(a, d = 1.6, fast) {
    C.crouch.to(a, a + d, 0); C.bend.to(a, a + d, 0);
    if (holding >= 0) { C.tip.to(a, a + d, CARRY); C.tAng.to(a, a + d, tongs ? 40 : 70); }
    if (!fast) ev.icons.push(['up', a - .2, a + d + .4]);
    ev.wob.push([a + .3, 3]); crouched = false; return a + d;
  }
  function relaxArm(r0, r1) { C.mix.to(r0, r1, 0); C.tAng.to(r0, r1, 72); C.bend.to(r0, r1, 0); C.bal.to(r0, r1 + .3, 0); C.open.to(r1, r1 + .1, 12); }
  function place(a, fast) {
    if (holding < 0) return a;
    const i = holding, k = slot++, d1 = fast ? .6 : 1.3, sp = T.slotPos(k);
    const PT = [sp[0] - off[0], sp[1] - off[1] - (S.target === 'basket' ? 60 : 22)];
    C.tip.to(a, a + d1, PT); C.tAng.to(a, a + d1, tongs ? 12 : 70); C.bend.to(a, a + d1, 10);
    const rel = a + d1 + (fast ? .15 : .35);
    ev.glowTarget.push([a - .2, rel + .4]);
    C.open.to(rel, rel + .15, 14);
    Object.assign(ev.items[i], { rel, mode: 'place', slot: k }); ev.stars.push([rel + .3, k]); ev.dings.push(rel + .3); ev.wob.push([rel, 3.5]);
    const r0 = rel + (fast ? .15 : .5), r1 = r0 + (fast ? .6 : .8);
    relaxArm(r0, r1); holding = -1; cur = -1; return r1 + .1;
  }
  function toss(a) {
    if (holding < 0) return a;
    const i = holding, k = slot++, rel = a + .9;
    C.mix.to(a, a + .3, 0); C.bal.to(a, a + .3, 0); C.bend.to(a, a + .3, 0);
    ev.throws.push([a, rel]); ev.glowTarget.push([a - .6, rel + 1]);
    Object.assign(ev.items[i], { rel, mode: 'throw', slot: k }); ev.dings.push(rel + .8); ev.stars.push([rel + .8, k]);
    C.open.to(rel, rel + .15, 14); C.open.to(rel + 1, rel + 1.1, 12); C.tAng.to(rel, rel + 1, 72);
    ev.wob.push([rel, 3.5]); holding = -1; cur = -1; return rel + 1.3;
  }
  const deliver = (a, fast, mode) => (mode || deliverMode) === 'place' && S.target !== 'hoop' ? place(a, fast) : toss(a);
  function cycle(a, fast) { let e = squat(a, fast ? .9 : 1.4); e = grab(e, fast); e = stand(e, fast ? .9 : 1.6, fast); return deliver(e, fast); }
  function enter(a) {
    if (S.helper) { C.tx.to(a + .2, a + 1.4, 700); C.tcrouch.to(a + 1.2, a + 1.9, 70); C.spot.to(a + 1.8, a + 2.6, 1); }
    ev.hop = [a + .4, a + .9]; ev.wob.push([a + .9, 9]);
    C.bal.to(a + 1.0, a + 1.3, 1); ev.arrows = [a + 1.4, a + 2.8]; C.bal.to(a + 2.8, a + 3.2, 0);
    if (tongs) { ev.tongsT = a + 3.3; ev.pops.push(a + 3.3); C.show.to(a + 3.4, a + 3.8, 1); C.show.to(a + 4.6, a + 5.0, 0); return a + 5.4; }
    return a + 3.8;
  }
  function balance(a) {
    if (crouched) a = stand(a, 1.2, true);
    C.bal.to(a, a + .4, 1); ev.wob.push([a + .3, 6], [a + 1.6, 5], [a + 2.9, 4]);
    ev.icons.push(['level', a + .2, a + 2.0], ['ok', a + 2.2, a + 3.6]); C.bal.to(a + 3.8, a + 4.2, 0); return a + 4.4;
  }
  function jump(a) {
    if (crouched) a = stand(a, 1.2, true);
    [0, 1, 2].forEach(j => ev.jumps.push([a + .3 + j * 1.0, .6, 110])); ev.icons.push(['up', a, a + 1.2]); return a + 3.4;
  }
  function oneleg(a) {
    if (crouched) a = stand(a, 1.2, true);
    C.bal.to(a, a + .4, 1); C.lift.to(a + .4, a + .9, 1); ev.wob.push([a + 1, 4], [a + 2.2, 3]);
    ev.icons.push(['level', a + .5, a + 3.4]); C.lift.to(a + 3.4, a + 3.9, 0); C.bal.to(a + 3.9, a + 4.3, 0); return a + 4.5;
  }
  function walk(a) {
    if (crouched) a = stand(a, 1.2, true);
    C.bal.to(a, a + .4, 1); C.kx.to(a + .4, a + 3.0, 220, 'lin'); C.kx.to(a + 3.4, a + 6.0, 0, 'lin'); C.bal.to(a + 6.0, a + 6.4, 0); return a + 6.6;
  }
  function celebrate(a) { C.mix.to(a, a + .3, 0); C.cheer.to(a, a + .3, 1); C.cheer.to(a + 1.3, a + 1.6, 0); ev.bursts.push(a); return a + 1.8; }

  const camFor = act => ({ squat: tongs ? CAM.pick : CAM.close, pick: tongs ? CAM.pick : CAM.close, stand: S.target === 'hoop' ? CAM.hoop : CAM.place, place: S.target === 'hoop' ? CAM.hoop : CAM.place, throw: CAM.hoop, repeat: S.target === 'hoop' ? CAM.hoop : CAM.mid })[act] || CAM.wide;
  T.steps = [];
  let st0 = g0 - .35;
  S.steps.forEach((st, k) => {
    const ts = st0 + .45, a = ts + 1.35;
    C.cam.to(a - .6, a + .3, camFor(st.action));
    let e = a;
    switch (st.action) {
      case 'ready': e = ev.hop ? balance(a) : enter(a); break;
      case 'balance': e = balance(a); break;
      case 'squat': e = holding >= 0 || next > 3 ? balance(a) : squat(a); break;
      case 'pick': if (holding < 0) { if (!crouched || cur < 0) e = squat(a, 1.1) + .1; e = grab(e, false); } break;
      case 'stand': e = crouched ? stand(a) : balance(a); break;
      case 'place': case 'throw':
        if (holding < 0 && next <= 3) { e = squat(e, 1.0); e = grab(e, true); }
        if (crouched) e = stand(e, 1.3);
        e = deliver(e, false, st.action === 'throw' ? 'throw' : 'place'); break;
      case 'repeat': {
        if (crouched) e = stand(e, 1.2, true);
        ev.icons.push(['ok', e, e + 1.1], ['loop', e + 1.1, e + 2.2]); e += 1.2;
        let n = 0; while (next <= 3 && n < 3) { e = cycle(e, true) + .15; n++; }
        if (!n) e = balance(e);
        e = celebrate(e + .1); break;
      }
      case 'walk': e = walk(a); break;
      case 'jump': e = jump(a); break;
      case 'oneleg': e = oneleg(a); break;
    }
    if (k === S.steps.length - 1 && st.action !== 'repeat') { if (crouched) e = stand(e, 1.2, true); e = celebrate(e + .2); }
    const end = Math.max(e + .6, ts + 4.5, S.voiceDur && S.voiceDur[k] ? a + S.voiceDur[k] + .6 : 0);
    T.steps.push(Object.assign({}, st, { n: k, ts, te: ts + .8, end, a }));
    st0 = end;
  });
  C.cam.to(st0 - 1.4, st0 - .4, CAM.wide);
  T.gym = [g0, st0 + .5];
  const nB = S.benefits.length;
  T.benT = S.benefits.map((_, i) => T.gym[1] + 1.2 + i * 3);
  T.ben = [T.gym[1], T.gym[1] + 1.2 + nB * 3 + (nB ? 1.6 : 0)];
  if (!nB) T.ben[1] = T.ben[0];
  T.outro = [T.ben[1], T.ben[1] + 8];
  T.DUR = T.outro[1];
  T.cheer = T.ev.bursts.length ? T.ev.bursts[T.ev.bursts.length - 1] : null;
  return T;
}

// ───────────── icons (small scene graphs, viewBox -50..50) ─────────────
function iconG(kind, color) {
  const g = el('g');
  el('circle', { r: 47, fill: color, stroke: '#fff', 'stroke-width': 4 }, g);
  const w = { stroke: '#fff', 'stroke-linecap': 'round', fill: 'none' };
  switch (kind) {
    case 'balance': el('circle', { cx: 0, cy: -26, r: 11, fill: '#fff' }, g); el('path', Object.assign({ d: 'M -36 -6 L 36 -6 M 0 -12 L 0 14 M 0 12 L -18 40 M 0 12 L 18 40', 'stroke-width': 10 }, w), g); break;
    case 'weight': el('path', { d: 'M -38 0 L -20 -16 L -20 -6 L 20 -6 L 20 -16 L 38 0 L 20 16 L 20 6 L -20 6 L -20 16 Z', fill: '#fff' }, g); el('circle', { cx: 0, cy: -27, r: 9, fill: '#fff' }, g); el('circle', { cx: 0, cy: 28, r: 7, fill: '#fff' }, g); break;
    case 'eye': el('path', { d: 'M -36 0 Q 0 -32 36 0 Q 0 32 -36 0 Z', fill: '#fff' }, g); el('circle', { r: 12, fill: C.navy }, g); break;
    case 'focus': el('circle', { r: 34, fill: '#fff' }, g); el('circle', { r: 23, fill: color }, g); el('circle', { r: 12, fill: '#fff' }, g); el('circle', { r: 5, fill: color }, g); break;
    case 'heart': el('path', { d: 'M 0 30 C -50 -4 -32 -46 0 -20 C 32 -46 50 -4 0 30 Z', fill: '#fff' }, g); break;
    case 'brain': el('path', { d: 'M -6 -30 C -26 -36 -40 -20 -34 -6 C -46 2 -38 22 -22 22 C -18 34 -2 32 0 24 C 2 32 18 34 22 22 C 38 22 46 2 34 -6 C 40 -20 26 -36 6 -30 Z', fill: '#fff' }, g); el('path', Object.assign({ d: 'M 0 -28 L 0 22 M -20 -8 Q -10 0 -20 10 M 20 -8 Q 10 0 20 10', 'stroke-width': 4, stroke: color }, { fill: 'none' }), g); break;
    case 'hand': el('path', { d: 'M -18 30 L -24 -4 Q -26 -12 -18 -12 L -14 0 L -14 -30 Q -14 -36 -8 -36 Q -2 -36 -2 -30 L -2 -6 L -2 -34 Q -2 -40 4 -40 Q 10 -40 10 -34 L 10 -6 L 10 -28 Q 10 -34 16 -34 Q 22 -34 22 -28 L 22 10 Q 22 30 4 32 Z', fill: '#fff' }, g); break;
    case 'tools': el('path', { d: 'M0 -28 L8 -9 L28 -8 L13 6 L18 26 L0 15 L-18 26 L-13 6 L-28 -8 L-8 -9 Z', fill: '#fff' }, g); break;
    case 'dumbbell': { const d = el('g', { fill: '#fff' }, g); [['-30', '-4', 60, 8], ['-30', '-18', 10, 36], ['20', '-18', 10, 36], ['-40', '-12', 8, 24], ['32', '-12', 8, 24]].forEach(([x, y, w2, h]) => el('rect', { x, y, width: w2, height: h, rx: 3 }, d)); break; }
    case 'help': el('circle', { cx: -14, cy: -20, r: 9, fill: '#fff' }, g); el('path', Object.assign({ d: 'M -14 -8 L -14 18 M -28 0 L -2 0', 'stroke-width': 8 }, w), g); el('circle', { cx: 16, cy: -6, r: 7, fill: '#fff' }, g); el('path', Object.assign({ d: 'M 16 4 L 16 24 M 4 12 L -4 4', 'stroke-width': 7 }, w), g); break;
    default: { const s = star(g, 30, '#fff'); s.setAttribute('stroke', 'none'); }
  }
  return g;
}


// ───────────── TEXT EXPLAINER: motion graphics from a text (no characters) ─────────────
const XTYPES = ['title', 'icon_text', 'list', 'steps', 'number', 'compare', 'quote', 'kinetic', 'question'];
function normExplainer(s) {
  const scenes = (Array.isArray(s.scenes) ? s.scenes : []).slice(0, 14).map(x => ({
    type: XTYPES.includes(x.type) ? x.type : 'icon_text', emoji: str(x.emoji).slice(0, 8),
    heading: str(x.heading), headingEn: str(x.headingEn), text: str(x.text), textEn: str(x.textEn), number: str(x.number), say: str(x.say),
    items: (Array.isArray(x.items) ? x.items : []).slice(0, 6).map(i => ({ emoji: str(i.emoji).slice(0, 8), text: str(i.text), en: str(i.en), side: i.side === 'bad' ? 'bad' : 'good' })),
    img: x.img || null,
  }));
  const textMode = ['ar', 'bi', 'none'].includes(s.textMode) ? s.textMode : 'bi';
  if (textMode === 'ar') scenes.forEach(x => { x.headingEn = ''; x.textEn = ''; x.items.forEach(i => { i.en = ''; }); });
  if (!scenes.length) scenes.push({ type: 'title', emoji: '✨', heading: str(s.title && s.title.ar) || 'عنوان', headingEn: '', text: '', textEn: '', number: '', say: '', items: [] });
  const presenter = s.presenter ? normChar(Object.assign({ age: 'adult', sleeves: 'long' }, s.presenter), 'helper') : null;
  return { kind: 'explainer', presenter, logo: s.logo || null, cinematic: !!s.cinematic, look: s.look || {}, music: s.music || {}, title: pair(s.title), credit: str(s.credit), scenes, textMode, voice: s.voice && isFinite(s.voice.duration) ? s.voice : null };
}
// scene timing: by reading length, or snapped to the pauses of the recorded voice
function planExplainer(X) {
  const wts = X.scenes.map(x => Math.max(8, (x.say || [x.heading, x.text, ...x.items.map(i => i.text)].join(' ')).length));
  const T = { X, scenes: [] };
  if (X.voice && Array.isArray(X.voice.marks) && X.voice.marks.length === X.scenes.length) {
    X.scenes.forEach((x, i) => { const [a, b] = X.voice.marks[i]; T.scenes.push(Object.assign({}, x, { n: i, a: i ? a : 0, b })); });
    const last = T.scenes[T.scenes.length - 1].b; T.outro = [last, Math.max(last + 4.5, X.voice.duration + 1)];
  } else if (X.voice) {
    const v = X.voice, s0 = Math.max(0, v.s0 || 0), s1 = Math.max(s0 + 1, v.s1 || v.duration), tot = wts.reduce((a, b) => a + b, 0);
    let acc = 0, prev = 0;
    X.scenes.forEach((x, i) => {
      acc += wts[i];
      let b = i === X.scenes.length - 1 ? s1 + .4 : s0 + (s1 - s0) * acc / tot;
      if (i < X.scenes.length - 1 && v.gaps && v.gaps.length) {           // snap to the nearest pause (within 2.5 s)
        const g = v.gaps.reduce((best, m) => Math.abs(m - b) < Math.abs(best - b) ? m : best, v.gaps[0]);
        if (Math.abs(g - b) < 2.5 && g > prev + 1.2) b = g;
      }
      b = Math.max(b, prev + 1.2);
      T.scenes.push(Object.assign({}, x, { n: i, a: prev, b }));
      prev = b;
    });
    T.outro = [prev, Math.max(prev + 4.5, v.duration + 1)];
  } else {
    let t = 0;
    X.scenes.forEach((x, i) => {
      const words = (x.say || [x.heading, x.text, ...x.items.map(it => it.text)].join(' ')).split(/\s+/).filter(Boolean).length;
      const d = Math.max(3.6, Math.min(10, 2.4 + words * .34 + (x.items.length ? .6 * x.items.length : 0)));
      T.scenes.push(Object.assign({}, x, { n: i, a: t, b: t + d })); t += d;
    });
    T.outro = [t, t + 5];
  }
  T.DUR = T.outro[1];
  // fields used by synthMusic()
  const first = T.scenes[0];
  Object.assign(T, { S: { benefits: [], steps: [] }, items: false, intro: [0, first.b], tools: [first.b, first.b], gym: [first.b, T.outro[0]], ben: [T.outro[0], T.outro[0]], cardT: [], helpT: null, benT: [],
    steps: T.scenes.slice(1).map(s => ({ ts: s.a })), cheer: T.outro[0], ev: { pops: [], dings: [], bursts: [T.outro[0] + .2] } });
  T.scenes.forEach(s => s.items.forEach((_, j) => T.ev.pops.push(s.a + .6 + j * Math.min(1.2, (s.b - s.a) * .55 / Math.max(1, s.items.length)))));
  return T;
}
function wrapText(ctx, s, maxW, size, w = 900) {
  font(ctx, size, w); const words = String(s).split(/\s+/).filter(Boolean), lines = []; let cur = '';
  for (const wd of words) { const t = cur ? cur + ' ' + wd : wd; if (cur && ctx.measureText(t).width > maxW) { lines.push(cur); cur = wd; } else cur = t; }
  if (cur) lines.push(cur); return lines;
}
function fitWrap(ctx, s, maxW, maxLines, size, min, w = 900) {
  let sz = size, lines = wrapText(ctx, s, maxW, sz, w);
  while ((lines.length > maxLines || lines.some(l => (font(ctx, sz, w), ctx.measureText(l).width > maxW))) && sz > min) { sz -= 2; lines = wrapText(ctx, s, maxW, sz, w); }
  return { lines, size: sz };
}
function createExplainer(canvas, spec) {
  const X = normExplainer(spec), T = planExplainer(X), ctx = canvas.getContext('2d');
  const lr = rng(((X.look.seed || 1) >>> 0) || 1);
  const PALSETS = [
    [['#ff7a1a', '#fff1e3'], ['#2f6fe0', '#e7f0ff'], ['#e8a400', '#fff8d6'], ['#e53935', '#ffe9e8'], ['#20a35a', '#e4f8ec'], ['#8e5bff', '#f1eaff'], ['#ff5fa2', '#ffeaf3'], ['#00a6c8', '#e2f8fd']],
    [['#7c6cf0', '#f3f0ff'], ['#3fb6a8', '#e6f7f5'], ['#f08a7e', '#fff0ee'], ['#e2a93b', '#fff6e3'], ['#5b9bd5', '#eaf3fc'], ['#c06fd3', '#f8ecfb']],
    [['#ff6b35', '#fff0e8'], ['#d7263d', '#ffe9ec'], ['#f4a259', '#fff5ea'], ['#8e3b8f', '#f7ebf7'], ['#ffb100', '#fff8e0'], ['#3a506b', '#e9eef4']],
    [['#0077b6', '#e3f3fb'], ['#00b4d8', '#e2f8fc'], ['#2a9d8f', '#e4f5f3'], ['#264653', '#e6ecef'], ['#48cae4', '#e8f9fc'], ['#f4a261', '#fff3e8']],
    [['#06d6a0', '#e6fbf5'], ['#118ab2', '#e5f4fa'], ['#ef476f', '#fdeaf0'], ['#ffd166', '#fff8e6'], ['#073b4c', '#e6eef1']],
    [['#ff9f1c', '#121426'], ['#2ec4b6', '#0f1a24'], ['#e71d36', '#1a1020'], ['#7b61ff', '#140f2a'], ['#ffbf69', '#1a1512']],
    [['#00f5d4', '#0b1020'], ['#f15bb5', '#160b1f'], ['#fee440', '#12120a'], ['#00bbf9', '#08131f'], ['#9b5de5', '#120c22']],
    [['#ffb703', '#0d1b2a'], ['#fb8500', '#101820'], ['#8ecae6', '#0b1a26'], ['#219ebc', '#06141f']],
  ];
  const DARK_FROM = 5;
  const PI = X.look.seed ? Math.floor(lr() * PALSETS.length) : 0, PAL = PALSETS[PI], DARK = PI >= DARK_FROM;
  const INK = DARK ? '#ffffff' : C.navy, INK2 = DARK ? 'rgba(255,255,255,.86)' : '#33406f', INK3 = DARK ? 'rgba(255,255,255,.62)' : '#6a76a8';
  const BGS = ['shapes', 'stripes', 'dots', 'bokeh', 'waves', 'rays', 'blobs', 'grid', 'mesh', 'rings', 'split', 'confetti'];
  // per-video choices: transitions, entrances and layout variants all come from the look seed → every video looks different
  const TRS = ['sweep', 'bands', 'blinds', 'zoom', 'doors', 'diamond', 'tiles', 'ink'];
  // shape language of this video: corner roundness, bubble shape, outro design
  const RADK = X.look.seed ? [1, .45, .12][Math.floor(lr() * 3)] : 1, BSH = X.look.seed ? ['circle', 'squircle', 'hex'][Math.floor(lr() * 3)] : 'circle', OUT = X.look.seed ? Math.floor(lr() * 3) : 0;
  const box = (c, x, y, w, h, r, ...a) => BOX_G(c, x, y, w, h, r * RADK, ...a);
  const shapePath = r => { ctx.beginPath(); if (BSH === 'circle') ctx.arc(0, 0, r, 0, TAU); else if (BSH === 'hex') { for (let i = 0; i < 6; i++) { const a = i / 6 * TAU + TAU / 12; i ? ctx.lineTo(Math.cos(a) * r * 1.08, Math.sin(a) * r * 1.08) : ctx.moveTo(Math.cos(a) * r * 1.08, Math.sin(a) * r * 1.08); } ctx.closePath(); } else ctx.roundRect(-r, -r, r * 2, r * 2, r * .42); };
  const ENTR = ['pop', 'up', 'side', 'zoomout', 'tilt', 'drop'];
  if (X.look.seed) for (const A of [TRS, ENTR]) for (let i = A.length - 1; i > 0; i--) { const j = Math.floor(lr() * (i + 1)); [A[i], A[j]] = [A[j], A[i]]; }
  if (X.look.seed) for (let i = BGS.length - 1; i > 0; i--) { const j = Math.floor(lr() * (i + 1)); [BGS[i], BGS[j]] = [BGS[j], BGS[i]]; }
  const BOKEH = Array.from({ length: 14 }, () => ({ x: lr() * 1920, y: lr() * 1080, r: 60 + lr() * 160, ph: lr() * 6 }));
  const BLOBS = Array.from({ length: 5 }, () => ({ x: 200 + lr() * 1520, y: 150 + lr() * 780, r: 140 + lr() * 180, ph: lr() * 6 }));
  const CONF = Array.from({ length: 60 }, () => ({ x: lr() * 1920, y: lr() * 1080, w: 10 + lr() * 18, h: 6 + lr() * 10, v: 40 + lr() * 90, r: lr() * 6, vr: (lr() - .5) * 4 }));
  const VAR = T.scenes.map(() => Math.floor(lr() * 1000));            // layout variant per scene
  const INK_DROPS = Array.from({ length: 6 }, () => ({ x: 200 + lr() * 1520, y: 120 + lr() * 840, d: lr() * .25 }));
  // film grain for the cinematic style
  const GRAIN = typeof document !== 'undefined' ? (() => { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'), d = g.createImageData(256, 256); for (let i = 0; i < d.data.length; i += 4) { const v = Math.random() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; } g.putImageData(d, 0, 0); return c; })() : null;
  const shapes = el('g'), fl = []; {
    const R = rng(11);
    for (let i = 0; i < 22; i++) { const g = el('g', { opacity: .12 + R() * .1 }, shapes), k = R(); if (k < .35) el('circle', { r: 26 + R() * 46 }, g); else if (k < .6) el('rect', { x: -36, y: -36, width: 72, height: 72, rx: 16 }, g); else if (k < .85) star(g, 34 + R() * 26, '#000'); else el('circle', { r: 36 + R() * 24, fill: 'none', 'stroke-width': 12 }, g);
      fl.push({ g, x: R() * 1920, y: R() * 1080, vx: (R() - .5) * 26, vy: -8 - R() * 20, vr: (R() - .5) * 30, ph: R() * 6 }); }
  }
  const burst = makeBurst(shapes, 41, 160, { power: 1300, spread: 170, w: 600 }), rain = makeBurst(shapes, 43, 120, { dir: 90, power: 200, spread: 40, w: 1900 });
  const AR_N = ['١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  const toArabicDigits = s => String(s).replace(/\d/g, d => AR_N[+d - 1] || '٠');
  function bgDraw(kind, col, tint, t) {
    const g = ctx.createLinearGradient(0, 0, 1920, 1080); g.addColorStop(0, tint); g.addColorStop(1, DARK ? '#05070f' : '#ffffff'); ctx.fillStyle = g; ctx.fillRect(0, 0, 1920, 1080);
    ctx.save(); ctx.fillStyle = col; ctx.strokeStyle = col;
    if (kind === 'shapes') {
      fl.forEach(f => { const x = ((f.x + f.vx * t) % 2100 + 2100) % 2100 - 90, y = ((f.y + f.vy * t + Math.sin(t + f.ph) * 20) % 1250 + 1250) % 1250 - 85; f.g.setAttribute('transform', `translate(${x} ${y}) rotate(${f.vr * t})`); const n0 = f.g.children[0]; n0.setAttribute(n0.getAttribute('fill') === 'none' ? 'stroke' : 'fill', col); });
      drawNode(ctx, shapes, 1);
    } else if (kind === 'stripes') {
      ctx.globalAlpha = .09; ctx.translate(960, 540); ctx.rotate(-28 * D2R); const off = (t * 26) % 180;
      for (let i = -14; i < 14; i++) ctx.fillRect(i * 180 + off, -1400, 80, 2800);
    } else if (kind === 'dots') {
      for (let y = 30; y < 1080; y += 64) for (let x = 30 + (y / 64 % 2) * 32; x < 1920; x += 64) { const r = 4 + 3 * Math.sin(t * 1.4 + (x + y) * .012); ctx.globalAlpha = .16; ctx.beginPath(); ctx.arc(x, y, Math.max(1, r), 0, TAU); ctx.fill(); }
    } else if (kind === 'bokeh') {
      BOKEH.forEach(b => { const x = b.x + Math.sin(t * .3 + b.ph) * 40, y = b.y + Math.cos(t * .25 + b.ph) * 30, rg = ctx.createRadialGradient(x, y, 0, x, y, b.r); rg.addColorStop(0, col + '40'); rg.addColorStop(1, col + '00'); ctx.fillStyle = rg; ctx.globalAlpha = 1; ctx.fillRect(x - b.r, y - b.r, b.r * 2, b.r * 2); });
    } else if (kind === 'waves') {
      for (let k = 0; k < 4; k++) { ctx.globalAlpha = .07 + k * .035; ctx.beginPath(); ctx.moveTo(0, 1080); for (let x = 0; x <= 1920; x += 40) ctx.lineTo(x, 700 + k * 80 + Math.sin(x * .004 + t * (.6 + k * .2) + k) * 40); ctx.lineTo(1920, 1080); ctx.fill(); }
    } else if (kind === 'rays') {
      ctx.translate(1650, -80); ctx.rotate(t * .05); ctx.globalAlpha = .07;
      for (let i = 0; i < 18; i++) { ctx.rotate(TAU / 18); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-120, 2600); ctx.lineTo(120, 2600); ctx.fill(); }
    } else if (kind === 'grid') {
      ctx.globalAlpha = DARK ? .22 : .12; ctx.lineWidth = 2; const hz = 560, off = (t * 60) % 80;
      for (let i = -24; i <= 24; i++) { ctx.beginPath(); ctx.moveTo(960 + i * 30, hz); ctx.lineTo(960 + i * 260, 1080); ctx.stroke(); }
      for (let y = 0; y < 12; y++) { const yy = hz + Math.pow((y * 80 + off) / 960, 2) * 520; ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(1920, yy); ctx.stroke(); }
    } else if (kind === 'mesh') {
      [[.3, .2], [.75, .35], [.5, .8]].forEach(([fx, fy], i) => { const x = 1920 * fx + Math.sin(t * .4 + i * 2) * 220, y = 1080 * fy + Math.cos(t * .33 + i) * 160, rg = ctx.createRadialGradient(x, y, 0, x, y, 720); rg.addColorStop(0, col + (DARK ? '55' : '38')); rg.addColorStop(1, col + '00'); ctx.fillStyle = rg; ctx.fillRect(0, 0, 1920, 1080); });
    } else if (kind === 'rings') {
      ctx.lineWidth = 10; for (let i = 0; i < 9; i++) { const r = ((t * 70 + i * 150) % 1350); ctx.globalAlpha = (DARK ? .16 : .09) * (1 - r / 1350); ctx.beginPath(); ctx.arc(1600, 820, r, 0, TAU); ctx.stroke(); }
    } else if (kind === 'split') {
      ctx.globalAlpha = DARK ? .2 : .1; ctx.beginPath(); const sx = 1250 + Math.sin(t * .5) * 60; ctx.moveTo(sx, 0); ctx.lineTo(1920, 0); ctx.lineTo(1920, 1080); ctx.lineTo(sx - 380, 1080); ctx.fill();
      ctx.globalAlpha = DARK ? .12 : .06; ctx.beginPath(); ctx.moveTo(0, 860); ctx.lineTo(700 + Math.sin(t * .6) * 40, 1080); ctx.lineTo(0, 1080); ctx.fill();
    } else if (kind === 'confetti') {
      CONF.forEach((c, i) => { const y = (c.y + t * c.v) % 1180 - 50, x = c.x + Math.sin(t + i) * 20; ctx.save(); ctx.globalAlpha = DARK ? .5 : .28; ctx.fillStyle = i % 3 ? col : PAL[(i + 1) % PAL.length][0]; ctx.translate(x, y); ctx.rotate(c.r + t * c.vr); ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h); ctx.restore(); });
    } else if (kind === 'blobs') {
      ctx.globalAlpha = .1;
      BLOBS.forEach(b => { ctx.beginPath(); for (let i = 0; i <= 8; i++) { const a = i / 8 * TAU, rr = b.r * (1 + .16 * Math.sin(t * .8 + b.ph + i * 1.7)), x = b.x + Math.cos(a) * rr, y = b.y + Math.sin(a) * rr; if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.closePath(); ctx.fill(); });
    }
    ctx.restore();
  }
  // ── cinematic picture scene: slow dolly, cross-dissolve, light leak, vignette, grain, letterbox, subtitles ──
  function cinematic(s, t) {
    const d = s.b - s.a, lt = t - s.a, prev = T.scenes[s.n - 1];
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 1920, 1080);
    const shot = (sc, alpha, l) => { const p = clamp(l / Math.max(1, sc.b - sc.a)), dir = sc.n % 2 ? -1 : 1; ctx.save(); ctx.globalAlpha = alpha; ctx.translate(960, 540); ctx.rotate(dir * (.8 * p - .4) * D2R); ctx.translate(-960, -540); drawMedia(ctx, sc.img, null, 0, 0, 1920, 1080, 'cover', 1.06 + .18 * E.io(p), dir * (.14 * p - .07), .06 * p - .03); ctx.restore(); };
    const fade = clamp(lt / 1.0);
    if (prev && prev.img && fade < 1) shot(prev, 1, t - prev.a);
    shot(s, s.n === 0 ? clamp(lt / 1.4) : E.io(fade), lt);
    const lk = P(lt, 0, 1.4) * (1 - P(lt, 1.4, 2.6));
    if (lk > 0) { const gx = lerp(-300, 2200, P(lt, 0, 2.6)), lg = ctx.createRadialGradient(gx, 280, 0, gx, 280, 760); lg.addColorStop(0, `rgba(255,176,90,${.32 * lk})`); lg.addColorStop(1, 'rgba(255,176,90,0)'); ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = lg; ctx.fillRect(0, 0, 1920, 1080); ctx.restore(); }
    const vg = ctx.createRadialGradient(960, 540, 480, 960, 540, 1150); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.55)'); ctx.fillStyle = vg; ctx.fillRect(0, 0, 1920, 1080);
    if (GRAIN) { ctx.save(); ctx.globalAlpha = .055; ctx.globalCompositeOperation = 'overlay'; const ox = Math.floor((t * 977) % 256), oy = Math.floor((t * 571) % 256); for (let y = -oy; y < 1080; y += 256) for (let x = -ox; x < 1920; x += 256) ctx.drawImage(GRAIN, x, y); ctx.restore(); }
    const bar = 118 * E.out(clamp(t / 1.2));
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 1920, bar); ctx.fillRect(0, 1080 - bar, 1920, bar);
    if (s.n === 0) {
      const k = P(lt, .7, 1.7) * (1 - P(lt, d - .9, d - .3));
      if (k > 0) { ctx.save(); ctx.globalAlpha = k; ctx.shadowColor = 'rgba(0,0,0,.85)'; ctx.shadowBlur = 24; const f = fitWrap(ctx, X.title.ar || s.heading, 1500, 2, 128, 60); lines(f.lines, 960, 500 - (f.lines.length - 1) * f.size * .55, f.size, '#ffffff', 'center', 1.15); if (X.title.en) text(ctx, X.title.en, 960, 520 + f.lines.length * f.size * .62, { size: 48, w: 700, color: '#ffd9a0', maxW: 1500 }); ctx.restore(); }
    } else if (X.textMode !== 'none' && (s.heading || s.text)) {
      const k = P(lt, .5, 1.0) * (1 - P(t, s.b - .45, s.b - .05)), en = s.heading ? s.headingEn : s.textEn;
      if (k > 0) { ctx.save(); ctx.globalAlpha = k; ctx.shadowColor = 'rgba(0,0,0,.9)'; ctx.shadowBlur = 14; text(ctx, s.heading || s.text, 960, 1080 - bar / 2 - (en ? 16 : 0), { size: 44, w: 800, color: '#ffffff', maxW: 1700 }); if (en) text(ctx, en, 960, 1080 - bar / 2 + 28, { size: 28, w: 700, color: '#ffd9a0', maxW: 1700 }); ctx.restore(); }
    }
  }
  // talking presenter: mouth follows the voice loudness, points at the content when a scene starts
  const PRES = X.presenter ? (() => { const g = el('g'), o = personOpts(X.presenter); return { g, o, p: makePerson(g, o) }; })() : null;
  const env = X.voice && Array.isArray(X.voice.env) ? X.voice.env : null;
  const talk = t => { if (!env) return 0; const i = Math.floor(t * 25); return clamp(((env[i] || 0) * .6 + (env[i - 1] || 0) * .4) * 1.5); };
  function presenter(t, s, mode) {
    if (!PRES) return;
    const lt = s ? t - s.a : 0, x = mode === 'outro' ? 250 : 255, y = 1060, sc = .95;
    ctx.save(); ctx.globalAlpha = .55; const sp = ctx.createRadialGradient(x, y - 10, 10, x, y - 10, 240); sp.addColorStop(0, 'rgba(255,255,255,.9)'); sp.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = sp; ctx.fillRect(x - 260, y - 260, 520, 300); ctx.restore();
    let ra = [12, -8], la = [-12, 8], look = [0, 0], lean = Math.sin(t * .9) * 2;
    if (mode === 'outro') { const k = P(t - T.outro[0], .2, .6); ra = [lerp(12, 160 + Math.sin(t * 10) * 8, k), 10]; la = [lerp(-12, -160 - Math.sin(t * 10) * 8, k), -10]; }
    else if (s && s.n === 0 && lt < 2.6) { const k = P(lt, .2, .5) * (1 - P(lt, 2.2, 2.6)); la = [lerp(-12, -150 + Math.sin(t * 12) * 20, k), lerp(8, -25, k)]; }
    else { const k = E.io(P(lt, .3, .8)) * (1 - E.io(P(lt, 2.2, 2.8))); if (k > 0) { ra = { t: [x + 330, y - 520], b: 1, mix: k }; look = [1, -.3]; } else if (Math.sin(t * .7 + 1) > .85) ra = [40, -70]; }
    PRES.p.update({ x, y: y - Math.abs(Math.sin(t * 2)) * 3, s: sc, t, ra, la, look, lean, mouth: talk(t), tilt: Math.sin(t * .8) * 3, pony: Math.sin(t * 2) * 4 });
    drawNode(ctx, PRES.g, 1);
  }
  function bubble(x, y, r, col, emo, k, rot = 0) {
    if (k <= 0) return; ctx.save(); ctx.translate(x, y); ctx.scale(k, k); ctx.rotate(rot * D2R);
    ctx.fillStyle = 'rgba(0,0,0,.12)'; ctx.save(); ctx.translate(0, r * .08); shapePath(r); ctx.fill(); ctx.restore();
    ctx.fillStyle = col; shapePath(r); ctx.fill(); ctx.lineWidth = r * .08; ctx.strokeStyle = DARK ? 'rgba(255,255,255,.85)' : '#fff'; ctx.stroke();
    if (emo) { ctx.font = `${Math.round(r * 1.05)}px 'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'; ctx.fillText(emo, 0, r * .06); }
    ctx.restore();
  }
  function lines(ls, x, y, size, color, align, lh = 1.3, k = 1, w = 900) {
    ls.forEach((l, i) => { const kk = clamp(k * ls.length - i); if (kk <= 0) return; ctx.globalAlpha = kk; text(ctx, l, x + (1 - E.out(kk)) * (align === 'right' ? 40 : 0), y + i * size * lh, { size, w, color, align }); });
    ctx.globalAlpha = 1; return ls.length * size * lh;
  }
  function headingBlock(s, x, y, maxW, col, k, align = 'right', big = 74) {
    if (!s.heading) return 0;
    const f = fitWrap(ctx, s.heading, maxW, 2, big, 40);
    let h = lines(f.lines, x, y, f.size, INK, align, 1.2, k);
    if (s.headingEn) { ctx.globalAlpha = clamp(k * 2 - 1); text(ctx, s.headingEn, x, y + h - f.size * .3, { size: Math.min(40, f.size * .55), w: 800, color: col, align, maxW }); ctx.globalAlpha = 1; h += 44; }
    return h;
  }
  function textBlock(s, x, y, maxW, k, align = 'right', maxLines = 4, big = 50) {
    if (!s.text) return 0;
    const f = fitWrap(ctx, s.text, maxW, maxLines, big, 30, big > 50 ? 800 : 700);
    let h = lines(f.lines, x, y, f.size, INK2, align, 1.38, k, 700);
    if (s.textEn) { const g = fitWrap(ctx, s.textEn, maxW, 2, 32, 22, 700); h += lines(g.lines, x, y + h, g.size, INK3, align, 1.3, clamp(k * 2 - 1), 700); }
    return h;
  }
  function scene(s, t) {
    const [col, tint] = PAL[s.n % PAL.length], d = s.b - s.a, lt = t - s.a, inK = E.back(P(lt, 0, .55)), out = 1 - E.in(P(t, s.b - .3, s.b));
    if (X.cinematic && s.img) { cinematic(s, t); if (X.logo && s.n === 0) { const k = P(t - s.a, .8, 1.6) * (1 - P(t, s.b - .6, s.b)); if (k > 0) { ctx.save(); ctx.globalAlpha = k; drawMedia(ctx, X.logo, null, 1690, 130, 170, 170, "contain"); ctx.restore(); } } return; }
    bgDraw(BGS[s.n % BGS.length], col, tint, t);
    ctx.save(); ctx.globalAlpha = out; ctx.translate(960, 540); ctx.scale(.96 + .04 * out, .96 + .04 * out); ctx.translate(-960, -540);
    if (PRES && !s.img) { ctx.translate(1160, 540); ctx.scale(.79, .79); ctx.translate(-960, -540); }
    { const k = E.out(P(lt, 0, .7)), en = ENTR[s.n % ENTR.length];
      if (en === 'up') ctx.translate(0, (1 - k) * 160); else if (en === 'side') ctx.translate((1 - k) * (s.n % 2 ? -260 : 260), 0);
      else if (en === 'zoomout') { const z = 1 + .35 * (1 - k); ctx.translate(960, 540); ctx.scale(z, z); ctx.translate(-960, -540); }
      else if (en === 'tilt') { ctx.translate(960, 540); ctx.rotate((1 - k) * (s.n % 2 ? 5 : -5) * D2R); ctx.translate(-960, -540); }
      else if (en === 'drop') ctx.translate(0, -(1 - E.back(P(lt, 0, .7))) * 220); }
    const V2 = VAR[s.n] % 2;
    const rev = j => P(lt, .5 + j * Math.min(1.2, d * .55 / Math.max(1, s.items.length)), .5 + j * Math.min(1.2, d * .55 / Math.max(1, s.items.length)) + .45);
    const bob = Math.sin(t * 2.2) * 8;
    if (s.img) {
      ctx.restore(); ctx.save();
      ctx.fillStyle = '#0d1530'; ctx.fillRect(0, 0, 1920, 1080);
      const p = E.io(clamp(lt / Math.max(1, d))), dir = s.n % 2 ? -1 : 1;
      ctx.globalAlpha = P(lt, 0, .45); drawMedia(ctx, s.img, null, 0, 0, 1920, 1080, 'cover', 1.04 + .1 * p, dir * (.1 * p - .05), .04 * p - .02); ctx.globalAlpha = 1;
      if (X.textMode !== 'none' && (s.heading || s.text)) {
        const gr = ctx.createLinearGradient(0, 640, 0, 1080); gr.addColorStop(0, 'rgba(13,21,48,0)'); gr.addColorStop(1, 'rgba(13,21,48,.75)'); ctx.fillStyle = gr; ctx.fillRect(0, 640, 1920, 440);
        const k = E.back(P(lt, .3, .8)), hd = s.heading || s.text, sub = s.heading ? s.text : '';
        const f = fitWrap(ctx, hd, 1500, 2, 64, 36), g2 = sub ? fitWrap(ctx, sub, 1500, 2, 40, 26, 700) : { lines: [], size: 0 };
        const en = s.heading ? s.headingEn : s.textEn, h = f.lines.length * f.size * 1.2 + g2.lines.length * g2.size * 1.3 + (en ? 48 : 0) + 40;
        ctx.save(); ctx.translate(960, 1040 - h / 2); ctx.scale(k, k); ctx.translate(-960, -(1040 - h / 2));
        box(ctx, 960 - 820, 1040 - h, 1640, h, 36, 'rgba(255,255,255,.95)', PAL[s.n % PAL.length][0], 6, 10);
        let y = 1040 - h + 20 + f.size * .6;
        f.lines.forEach(l => { text(ctx, l, 960, y, { size: f.size, color: C.navy }); y += f.size * 1.2; });
        g2.lines.forEach(l => { text(ctx, l, 960, y - f.size * .2, { size: g2.size, w: 700, color: '#33406f' }); y += g2.size * 1.3; });
        if (en) text(ctx, en, 960, y - 6, { size: 34, w: 800, color: PAL[s.n % PAL.length][0], maxW: 1500 });
        ctx.restore();
      }
      if (s.type === 'number' && s.number) { const k2 = E.back(P(lt, .2, .7)); ctx.save(); ctx.translate(1700, 190); ctx.scale(k2, k2); ctx.beginPath(); ctx.arc(0, 0, 130, 0, TAU); ctx.fillStyle = PAL[s.n % PAL.length][0]; ctx.fill(); ctx.lineWidth = 10; ctx.strokeStyle = '#fff'; ctx.stroke(); text(ctx, s.number, 0, 8, { size: 92, color: '#fff', maxW: 220 }); ctx.restore(); }
      ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(0, 1068, 1920, 12); ctx.fillStyle = PAL[s.n % PAL.length][0]; ctx.fillRect(1920 * (1 - t / T.outro[0]), 1068, 1920 * t / T.outro[0], 12);
      if (X.logo && s.n === 0) { const k = E.back(P(lt, .3, .8)); if (k > 0) { ctx.save(); ctx.globalAlpha = clamp(k) * out; drawMedia(ctx, X.logo, null, 1700 - 90 * k, 40, 180 * k, 180 * k, "contain"); ctx.restore(); } }
      ctx.restore(); return;
    }
    if (s.type === 'title' && V2) {
      const k = E.out(P(lt, .05, .55));
      ctx.save(); ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(1920 * (1 - k), 330); ctx.lineTo(1920, 300); ctx.lineTo(1920, 760); ctx.lineTo(1920 * (1 - k) - 60, 790); ctx.closePath(); ctx.fill(); ctx.restore();
      bubble(330, 560 + bob, 150, DARK ? '#ffffff22' : '#ffffff', s.emoji || '✨', inK, Math.sin(t) * 6);
      const f = fitWrap(ctx, s.heading, 1250, 2, 120, 50); lines(f.lines, 1760, 545 - (f.lines.length - 1) * f.size * .6, f.size, '#ffffff', 'right', 1.2, P(lt, .3, .9));
      if (s.headingEn) { ctx.globalAlpha = P(lt, .7, 1.1) * out; text(ctx, s.headingEn, 1760, 545 + f.lines.length * f.size * .62 + 10, { size: 44, w: 800, color: '#ffffffcc', align: 'right', maxW: 1250 }); ctx.globalAlpha = out; }
      if (s.text) textBlock(s, 1760, 850, 1300, P(lt, .8, 1.6), 'right', 2);
    } else if (s.type === 'kinetic') {
      const words = (s.heading || s.text || '').split(/\s+/).filter(Boolean), n = Math.max(1, words.length), per = Math.max(.45, (d - .6) / n), wi = Math.min(n - 1, Math.floor(lt / per)), wl = lt - wi * per;
      const big = words.slice(0, wi + 1).join(' '), kk = E.back(P(wl, 0, .35));
      ctx.save(); ctx.translate(960, 500); ctx.scale(.6 + .4 * kk, .6 + .4 * kk); ctx.rotate((1 - kk) * (wi % 2 ? 6 : -6) * D2R);
      const f = fitWrap(ctx, big, 1700, 2, 190, 70); lines(f.lines, 0, -(f.lines.length - 1) * f.size * .55, f.size, wi === n - 1 ? col : INK, 'center', 1.1); ctx.restore();
      ctx.fillStyle = col; ctx.fillRect(960 - 300 * E.out(P(lt, .2, d * .8)), 760, 600 * E.out(P(lt, .2, d * .8)), 14);
      if (s.headingEn) { ctx.globalAlpha = P(lt, d * .6, d * .8) * out; text(ctx, s.headingEn, 960, 840, { size: 48, w: 800, color: col, maxW: 1600 }); ctx.globalAlpha = out; }
      if (s.text && s.heading) textBlock(s, 960, 880, 1500, P(lt, d * .55, d * .85), 'center', 2);
    } else if (s.type === 'question') {
      ctx.save(); ctx.translate(V2 ? 420 : 1500, 520 + bob); ctx.rotate(Math.sin(t * 1.3) * .12); const qk = E.back(P(lt, 0, .6)); ctx.scale(qk, qk);
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, 0, 230, 0, TAU); ctx.fill(); text(ctx, '؟', 0, 20, { size: 330, color: '#ffffff' }); ctx.restore();
      const hx = V2 ? 1780 : 1180; const hh = headingBlock(s, hx, 330, 1000, col, P(lt, .3, .9), 'right', 86);
      textBlock(s, hx, 330 + hh + 30, 1000, P(lt, .8, 1.6), 'right', 4);
    } else if (s.type === 'title' || s.type === 'quote') {
      if (s.type === 'quote') { ctx.globalAlpha = .18 * out; text(ctx, '”', 1500, 360, { size: 420, color: col }); text(ctx, '“', 420, 820, { size: 420, color: col }); ctx.globalAlpha = out; }
      else bubble(960, 300 + bob, 120, col, s.emoji || '✨', inK, Math.sin(t) * 6);
      const f = fitWrap(ctx, s.type === 'quote' ? (s.text || s.heading) : s.heading, 1500, 3, s.type === 'quote' ? 76 : 110, 44);
      const y0 = s.type === 'quote' ? 540 - f.lines.length * f.size * .62 : 520;
      lines(f.lines, 960, y0, f.size, INK, 'center', 1.2, P(lt, .2, .9));
      const en = s.type === 'quote' ? s.textEn : s.headingEn, y1 = y0 + f.lines.length * f.size * 1.2;
      if (en) { ctx.globalAlpha = P(lt, .7, 1.1) * out; text(ctx, en, 960, y1 + 10, { size: 44, w: 800, color: col, maxW: 1500 }); ctx.globalAlpha = out; }
      if (s.type === 'quote' && s.heading && s.text) { ctx.globalAlpha = P(lt, .9, 1.3) * out; text(ctx, '— ' + s.heading, 960, y1 + 80, { size: 40, w: 700, color: INK3 }); ctx.globalAlpha = out; }
      if (s.type === 'title' && s.text) textBlock(s, 960, y1 + (en ? 80 : 20), 1400, P(lt, .8, 1.6), 'center', 3);
    } else if (s.type === 'icon_text') {
      const bx = V2 ? 440 : 1480, tx = V2 ? 1780 : 1160;
      bubble(bx, 520 + bob, 210, col, s.emoji || '💡', inK, Math.sin(t * .8) * 5);
      const hh = headingBlock(s, tx, 330, 900, col, P(lt, .25, .8));
      textBlock(s, tx, hh ? 330 + hh + 30 : 380, 900, P(lt, hh ? .6 : .25, 1.6), 'right', 5, hh ? 50 : 66);
    } else if (s.type === 'list' || s.type === 'compare') {
      const hh = headingBlock(s, 1780, 150, 1500, col, P(lt, .1, .6));
      if (s.type === 'list' && V2 && s.items.length > 1) {
        const n = s.items.length, cols = n > 2 ? 2 : n, rows = Math.ceil(n / cols), cw = 1500 / cols, ch = Math.min(300, (820 - hh) / rows);
        s.items.forEach((it, j) => { const k = E.back(rev(j)); if (k <= 0) return; const cx = 1710 - (j % cols) * cw - cw / 2 + 30, cy = 200 + hh + Math.floor(j / cols) * ch + ch / 2;
          ctx.save(); ctx.translate(cx, cy); ctx.scale(k, k); ctx.rotate((j % 2 ? 1.5 : -1.5) * D2R); box(ctx, -cw / 2 + 20, -ch / 2 + 14, cw - 40, ch - 28, 36, DARK ? 'rgba(255,255,255,.08)' : '#fff', col, 5, 10);
          bubble(cw / 2 - 110, 0, Math.min(70, ch * .26), col, it.emoji || '✔️', 1);
          const f = fitWrap(ctx, it.text, cw - 280, 2, 46, 26, 800); f.lines.forEach((l, li) => text(ctx, l, cw / 2 - 200, (li - (f.lines.length - 1) / 2) * f.size * 1.2 - (it.en ? 18 : 0), { size: f.size, w: 800, align: 'right', color: INK }));
          if (it.en) text(ctx, it.en, cw / 2 - 200, f.lines.length * f.size * .6 + 10, { size: 28, w: 700, color: col, align: 'right', maxW: cw - 280 });
          ctx.restore(); });
      } else if (s.type === 'list') {
        const n = s.items.length || 1, rh = Math.min(150, (820 - hh) / n);
        s.items.forEach((it, j) => { const k = E.back(rev(j)), y = 200 + hh + j * rh + rh / 2; if (k <= 0) return;
          ctx.save(); ctx.translate((1 - k) * 200, 0); box(ctx, 240, y - rh * .42, 1540, rh * .84, rh * .42, '#fff', col, 5, 8);
          bubble(1700, y, rh * .36, col, it.emoji || '✔️', k);
          text(ctx, it.text, 1620, y - (it.en ? rh * .12 : 0), { size: Math.min(48, rh * .34), w: 800, align: 'right', maxW: 1300 });
          if (it.en) text(ctx, it.en, 1620, y + rh * .2, { size: Math.min(32, rh * .22), w: 700, color: col, align: 'right', maxW: 1300 });
          ctx.restore(); });
      } else {
        const cols = [['good', C.green, '✅'], ['bad', C.red, '❌']];
        cols.forEach(([side, c, mark], ci) => {
          const x0 = ci ? 200 : 1000, its = s.items.filter(i => i.side === side), rh = Math.min(130, (760 - hh) / Math.max(1, its.length));
          box(ctx, x0, 210 + hh, 720, 800 - hh, 40, '#fff', c, 6, 10);
          text(ctx, mark, x0 + 360, 210 + hh + 60, { size: 64 });
          its.forEach((it, j) => { const k = E.back(rev(s.items.indexOf(it))); if (k <= 0) return; const y = 210 + hh + 140 + j * rh;
            ctx.save(); ctx.globalAlpha = clamp(k) * out; text(ctx, (it.emoji ? it.emoji + '  ' : '') + it.text, x0 + 680, y, { size: Math.min(42, rh * .38), w: 800, align: 'right', maxW: 640 });
            if (it.en) text(ctx, it.en, x0 + 680, y + rh * .34, { size: Math.min(28, rh * .24), w: 700, color: c, align: 'right', maxW: 640 }); ctx.restore(); });
        });
      }
    } else if (s.type === 'steps' && V2) {
      const hh = headingBlock(s, 1780, 150, 1500, col, P(lt, .1, .6));
      const n = Math.max(1, s.items.length), rh = Math.min(200, (840 - hh) / n);
      s.items.forEach((it, j) => { const k = E.back(rev(j)); if (k <= 0) return; const y = 220 + hh + j * rh + rh / 2, x = j % 2 ? 1300 : 1560;
        if (j) { ctx.save(); ctx.strokeStyle = col; ctx.globalAlpha = .4 * clamp(k); ctx.lineWidth = 8; ctx.setLineDash([4, 18]); ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(j % 2 ? 1560 : 1300, y - rh); ctx.lineTo(x, y); ctx.stroke(); ctx.restore(); }
        bubble(x, y, rh * .36, col, '', k); ctx.save(); ctx.translate(x, y); ctx.scale(k, k); text(ctx, AR_N[j] || String(j + 1), 0, 6, { size: rh * .4, color: '#fff' }); ctx.restore();
        ctx.globalAlpha = clamp(k) * out; text(ctx, (it.emoji ? it.emoji + '  ' : '') + it.text, x - rh * .5, y - (it.en ? 14 : 0), { size: Math.min(50, rh * .3), w: 800, align: 'right', color: INK, maxW: 1000 });
        if (it.en) text(ctx, it.en, x - rh * .5, y + rh * .2, { size: Math.min(30, rh * .18), w: 700, align: 'right', color: col, maxW: 1000 }); ctx.globalAlpha = out; });
    } else if (s.type === 'steps') {
      const hh = headingBlock(s, 1780, 150, 1500, col, P(lt, .1, .6));
      const n = Math.max(1, s.items.length), gap = Math.min(380, 1500 / n), x0 = 960 + gap * (n - 1) / 2, y = 560 + hh * .3;
      ctx.lineWidth = 14; ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(0,0,0,.08)'; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 - gap * (n - 1), y); ctx.stroke();
      const prog = clamp(s.items.reduce((a, _, j) => a + (rev(j) > 0 ? 1 : 0), 0) - 1 + rev(Math.max(0, s.items.findIndex((_, j) => rev(j) < 1)) || 0));
      ctx.strokeStyle = col; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 - gap * Math.max(0, Math.min(n - 1, prog)), y); ctx.stroke();
      s.items.forEach((it, j) => { const k = E.back(rev(j)), x = x0 - j * gap; if (k <= 0) return;
        bubble(x, y, 78, col, it.emoji || '', k);
        if (!it.emoji) { ctx.save(); ctx.translate(x, y); ctx.scale(k, k); text(ctx, AR_N[j] || String(j + 1), 0, 6, { size: 72, color: '#fff' }); ctx.restore(); }
        ctx.globalAlpha = clamp(k) * out; const f = fitWrap(ctx, it.text, gap - 30, 3, 40, 24, 800); lines(f.lines, x, y + 130, f.size, INK, 'center', 1.25, 1, 800);
        if (it.en) text(ctx, it.en, x, y + 130 + f.lines.length * f.size * 1.25, { size: 26, w: 700, color: col, maxW: gap - 30 }); ctx.globalAlpha = out; });
    } else if (s.type === 'number') {
      const raw = s.number || '', digits = raw.replace(/[٠-٩]/g, c => '٠١٢٣٤٥٦٧٨٩'.indexOf(c)), m = /^(\D*)(\d+(?:\.\d+)?)(.*)$/.exec(digits);
      const k = E.out(P(lt, .2, Math.min(2.2, d * .5)));
      const shown = m ? m[1] + toArabicDigits((+m[2] * k).toFixed(m[2].includes('.') ? 1 : 0)) + toArabicDigits(m[3]) : raw;
      bubble(960, 250 + bob, 90, col, s.emoji || '📊', inK);
      ctx.save(); ctx.translate(960, 520); const sc = E.back(P(lt, .1, .6)); ctx.scale(sc, sc);
      text(ctx, shown, 0, 12, { size: 210, color: 'rgba(0,0,0,.12)' }); text(ctx, shown, 0, 0, { size: 210, color: col, maxW: 1500 }); ctx.restore();
      headingBlock(s, 960, 700, 1500, col, P(lt, .5, 1.1), 'center', 64);
      textBlock(s, 960, 820 + (s.headingEn ? 40 : 0), 1400, P(lt, .9, 1.7), 'center', 2);
    }
    ctx.restore();
    if (X.logo && s.n === 0) { const k = E.back(P(lt, .3, .8)) * out; if (k > 0) { ctx.save(); ctx.globalAlpha = clamp(k); drawMedia(ctx, X.logo, null, 1700 - 90 * k, 40, 180 * k, 180 * k, 'contain'); ctx.restore(); } }
    presenter(t, s, 'scene');
    // progress bar
    ctx.fillStyle = 'rgba(0,0,0,.08)'; ctx.fillRect(0, 1068, 1920, 12); ctx.fillStyle = col; ctx.fillRect(1920 * (1 - t / T.outro[0]), 1068, 1920 * t / T.outro[0], 12);
  }
  function outro(t) {
    const o = T.outro[0], lt = t - o;
    if (X.cinematic) {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 1920, 1080);
      const last = [...T.scenes].reverse().find(x => x.img); if (last) { ctx.save(); ctx.globalAlpha = .35 * (1 - P(lt, 0, 3)); drawMedia(ctx, last.img, null, 0, 0, 1920, 1080, 'cover', 1.24); ctx.restore(); }
      if (X.logo) { const lk = P(lt, .2, 1.2); ctx.save(); ctx.globalAlpha = lk; drawMedia(ctx, X.logo, null, 860, 150, 200, 200, "contain"); ctx.restore(); }
      const k = P(lt, .5, 1.6); ctx.save(); ctx.globalAlpha = k; const f = fitWrap(ctx, X.title.ar || X.scenes[0].heading, 1500, 2, 110, 56); lines(f.lines, 960, 470 - (f.lines.length - 1) * f.size * .55, f.size, '#ffffff', 'center', 1.15); if (X.title.en) text(ctx, X.title.en, 960, 490 + f.lines.length * f.size * .62, { size: 46, w: 700, color: '#ffd9a0', maxW: 1500 });
      if (X.credit) text(ctx, 'هذا العمل من تنسيق ' + X.credit, 960, 820, { size: 38, w: 700, color: 'rgba(255,255,255,.85)', maxW: 1500 }); ctx.restore();
      return;
    }
    if (OUT === 1 || (OUT === 2 && !PRES)) {           // full colour / dark spotlight outro
      const c0 = PAL[0][0], c1 = PAL[1 % PAL.length][0];
      if (OUT === 1) { const g = ctx.createLinearGradient(0, 0, 1920, 1080); g.addColorStop(0, c0); g.addColorStop(1, c1); ctx.fillStyle = g; ctx.fillRect(0, 0, 1920, 1080); }
      else { ctx.fillStyle = '#07090f'; ctx.fillRect(0, 0, 1920, 1080); const sp = ctx.createRadialGradient(960, 480, 0, 960, 480, 900); sp.addColorStop(0, c0 + '66'); sp.addColorStop(1, c0 + '00'); ctx.fillStyle = sp; ctx.fillRect(0, 0, 1920, 1080); }
      bgDraw(OUT === 1 ? 'rings' : 'bokeh', '#ffffff', 'rgba(0,0,0,0)', t);
      burst.update(t, o + .2, 960, 420, 2.4); drawNode(ctx, shapes, .5);
      if (X.logo) { const lk = E.back(P(lt, .05, .55)); if (lk > 0) { ctx.save(); ctx.translate(960, 190); ctx.scale(lk, lk); drawMedia(ctx, X.logo, null, -120, -120, 240, 240, 'contain'); ctx.restore(); } }
      const k1 = P(lt, .2, .9), f = fitWrap(ctx, X.title.ar || X.scenes[0].heading, 1600, 2, 140, 60), y0 = (X.logo ? 520 : 430) - (f.lines.length - 1) * f.size * .55;
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 20; lines(f.lines, 960, y0, f.size, '#ffffff', 'center', 1.1, k1); ctx.restore();
      if (X.title.en) { ctx.globalAlpha = P(lt, .7, 1.2); text(ctx, X.title.en, 960, y0 + f.lines.length * f.size * 1.1, { size: 54, w: 800, color: OUT === 1 ? '#ffffffdd' : c0, maxW: 1500 }); ctx.globalAlpha = 1; }
      ctx.fillStyle = OUT === 1 ? '#ffffff' : c0; const lw = 520 * E.out(P(lt, .6, 1.4)); ctx.fillRect(960 - lw / 2, 790, lw, 10);
      if (X.credit) { ctx.globalAlpha = P(lt, 1, 1.5); text(ctx, 'هذا العمل من تنسيق ' + X.credit, 960, 870, { size: 40, w: 700, color: '#ffffffdd', maxW: 1500 }); ctx.globalAlpha = 1; }
      return;
    }
    const g = ctx.createLinearGradient(0, 0, 0, 1080); g.addColorStop(0, '#9fd8ff'); g.addColorStop(1, '#fff3e0'); ctx.fillStyle = g; ctx.fillRect(0, 0, 1920, 1080);
    fl.forEach(f => { const x = ((f.x + f.vx * t) % 2100 + 2100) % 2100 - 90, y = ((f.y + f.vy * t + Math.sin(t + f.ph) * 20) % 1250 + 1250) % 1250 - 85; f.g.setAttribute('transform', `translate(${x} ${y}) rotate(${f.vr * t})`); });
    burst.update(t, o + .2, 960, 420, 2.4); rain.update(t, o + .4, 960, -60, 3.5); drawNode(ctx, shapes, 1);
    presenter(t, null, 'outro');
    if (X.logo) { const lk = E.back(P(lt, .05, .55)); if (lk > 0) { ctx.save(); ctx.translate(960, 150); ctx.scale(lk, lk); drawMedia(ctx, X.logo, null, -110, -110, 220, 220, 'contain'); ctx.restore(); } }
    const k = E.back(P(lt, .1, .6));
    if (k > 0) { ctx.save(); ctx.translate(PRES ? 1130 : 960, X.logo ? 470 : 420); ctx.scale(k * (PRES ? .82 : 1), k * (PRES ? .82 : 1)); box(ctx, -760, -170, 1520, 340, 80, '#d7efff', '#fff', 8, 18);
      const f = fitWrap(ctx, X.title.ar || X.scenes[0].heading, 1380, 2, 150, 60); lines(f.lines, 0, X.title.en ? -20 - (f.lines.length - 1) * f.size * .5 : -(f.lines.length - 1) * f.size * .55, f.size, C.navy, 'center', 1.1);
      if (X.title.en) text(ctx, X.title.en, 0, 110, { size: 58, w: 800, color: C.orange, maxW: 1380 }); ctx.restore(); }
    const ck = X.credit ? E.back(P(lt, 1, 1.5)) : 0;
    if (ck > 0) {
      const lab = 'هذا العمل من تنسيق', nm = X.credit; font(ctx, 38, 700); const lw = ctx.measureText(lab).width; const ns = fitSize(ctx, nm, 900, 46, 900); font(ctx, ns, 900); const nw = ctx.measureText(nm).width;
      const w = lw + nw + 110, x = 960 - w / 2, y = 700;
      ctx.save(); ctx.translate(960, y + 36); ctx.scale(ck, ck); ctx.translate(-960, -(y + 36));
      box(ctx, x, y, w, 72, 36, 'rgba(255,255,255,.95)', C.orange, 5, 8); text(ctx, '✍️', x + w - 34, y + 38, { size: 32 });
      text(ctx, lab, x + w - 64, y + 38, { size: 38, w: 700, color: C.navy, align: 'right' }); text(ctx, nm, x + w - 64 - lw - 16, y + 38, { size: ns, color: C.orange, align: 'right' }); ctx.restore();
    }
  }
  function render(t) {
    t = clamp(t, 0, T.DUR);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(canvas.width / 1920, 0, 0, canvas.height / 1080, 0, 0);
    if (t >= T.outro[0]) outro(t);
    else { let cur = T.scenes[0]; T.scenes.forEach(s => { if (t >= s.a) cur = s; }); scene(cur, t); }
    // colour sweep between scenes
    if (!X.cinematic) [...T.scenes.slice(1).map(s => s.a), T.outro[0]].forEach((b, j) => {
      const W = .38; if (Math.abs(t - b) >= W) return; const k = P(t, b - W, b + W), c = PAL[(j + 1) % PAL.length][0], cov = Math.sin(k * Math.PI), tr = TRS[j % TRS.length];
      ctx.save(); ctx.fillStyle = c;
      if (tr === 'sweep') { ctx.globalAlpha = 1 - Math.abs(k - .5) * 2; ctx.beginPath(); ctx.arc(1920 - 1920 * E.io(k), 540, 2200 * cov * .6, 0, TAU); ctx.fill(); }
      else if (tr === 'bands') { for (let i = 0; i < 5; i++) { const kk = clamp(k * 1.6 - i * .15), x = lerp(2400, -2400, E.io(kk)); ctx.save(); ctx.translate(x, 0); ctx.rotate(-12 * D2R); ctx.fillStyle = i % 2 ? c : PAL[(j + 2) % PAL.length][0]; ctx.fillRect(-200, i * 260 - 300, 2600, 270); ctx.restore(); } }
      else if (tr === 'blinds') { for (let i = 0; i < 9; i++) { const h = 122 * clamp(cov * 1.3 - Math.abs(i - 4) * .06); ctx.fillRect(0, i * 120 + (120 - h) / 2, 1920, h); } }
      else if (tr === 'zoom') { ctx.globalAlpha = .9 * cov; ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 1920, 1080); ctx.globalAlpha = cov; ctx.strokeStyle = c; ctx.lineWidth = 60 * cov; ctx.beginPath(); ctx.arc(960, 540, 200 + 900 * k, 0, TAU); ctx.stroke(); }
      else if (tr === 'doors') { const w = 960 * E.io(cov); ctx.fillRect(0, 0, w, 1080); ctx.fillStyle = PAL[(j + 2) % PAL.length][0]; ctx.fillRect(1920 - w, 0, w, 1080); }
      else if (tr === 'diamond') { ctx.translate(960, 540); ctx.rotate(45 * D2R + k * 1.2); const r = 1500 * E.io(cov); ctx.fillRect(-r / 2, -r / 2, r, r); }
      else if (tr === 'tiles') { for (let y = 0; y < 6; y++) for (let x = 0; x < 10; x++) { const d2 = ((x + y) / 14), z = clamp(cov * 1.8 - d2 * .8); ctx.fillStyle = (x + y) % 2 ? c : PAL[(j + 2) % PAL.length][0]; ctx.fillRect(x * 192 + 96 * (1 - z), y * 180 + 90 * (1 - z), 192 * z, 180 * z); } }
      else if (tr === 'ink') { INK_DROPS.forEach((dr, i) => { const z = clamp(cov * 1.5 - dr.d); ctx.fillStyle = i % 2 ? c : PAL[(j + 2) % PAL.length][0]; ctx.beginPath(); ctx.arc(dr.x, dr.y, 900 * E.out(z), 0, TAU); ctx.fill(); }); }
      ctx.restore();
    });
  }
  return { DUR: T.DUR, T, S: X, render, mode: 'explainer', music: () => synthMusic(T, 32000, X.music) };
}

// ───────────── PROMO: professional motion ad (port of video/studio-promo) ─────────────
// spec: { kind:'promo', aspect:'16:9'|'9:16', brand:{name,tagline,color,url,phone,logo}, title, credit, textMode,
//         scenes:[{type, emoji, heading (*word* = brand colour), headingEn, text, textEn, label, button, items:[{emoji,text,en,visual}], chips:[…]}],
//         voiceDur:[seconds per scene], music:{seed} }
const PTYPES = ['logo', 'title', 'typing', 'checklist', 'cards', 'chips', 'phone', 'outro'];
const PVIS = ['doc', 'wave', 'tiles', 'progress', 'chart'];
function hexRgb(h) { const m = /^#?([0-9a-f]{6})$/i.exec(str(h)); const n = parseInt(m ? m[1] : 'ff6a13', 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function rgbHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let h = 0, s = 0;
  if (mx !== mn) { const d = mx - mn; s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; }
  return [h, s * 100, l * 100];
}
const hsla = (h, s, l, a = 1) => `hsla(${Math.round(((h % 360) + 360) % 360)},${Math.round(s)}%,${Math.round(l)}%,${a})`;
const pWords = s => str(s).replace(/\*/g, ' ').split(/\s+/).filter(Boolean);
function normPromo(s) {
  const its = a => (Array.isArray(a) ? a : []).map(i => typeof i === 'string' ? { text: i } : (i || {}))
    .map(i => ({ emoji: str(i.emoji).slice(0, 8), text: str(i.text), en: str(i.en), visual: PVIS.includes(i.visual) ? i.visual : '' })).filter(i => i.text || i.emoji);
  const b = s.brand || {};
  const brand = { name: str(b.name), tagline: str(b.tagline), url: str(b.url).replace(/^https?:\/\//i, '').replace(/\/$/, ''), phone: str(b.phone), color: /^#[0-9a-f]{6}$/i.test(str(b.color)) ? str(b.color) : '#ff6a13', logo: b.logo || null };
  const title = pair(s.title);
  let scenes = (Array.isArray(s.scenes) ? s.scenes : []).slice(0, 12).map(x => ({
    type: PTYPES.includes(x.type) ? x.type : 'title', emoji: str(x.emoji).slice(0, 8), heading: str(x.heading), headingEn: str(x.headingEn), text: str(x.text), textEn: str(x.textEn),
    label: str(x.label), button: str(x.button), items: its(x.items).slice(0, x.type === 'chips' ? 6 : 4), chips: its(x.chips).slice(0, 3), say: str(x.say || x.narration) }));
  const name = brand.name || title.ar || (scenes[0] && scenes[0].heading) || 'Brand';
  scenes = scenes.filter((x, i) => !(x.type === 'logo' && i > 0) && !(x.type === 'outro' && i < scenes.length - 1));
  scenes.forEach(x => {
    if (['checklist', 'cards', 'chips'].includes(x.type) && !x.items.length) x.type = 'title';
    if (x.type === 'typing' && !x.text) x.text = x.heading || name;
    if (x.type === 'title' && !x.heading) x.heading = x.text || name;
  });
  if (!scenes.length || scenes[0].type !== 'logo') scenes.unshift({ type: 'logo', emoji: '', heading: name, headingEn: '', text: brand.tagline, textEn: '', label: '', button: '', items: [], chips: [], say: '' });
  if (scenes[scenes.length - 1].type !== 'outro') scenes.push({ type: 'outro', emoji: '', heading: name, headingEn: '', text: brand.tagline, textEn: '', label: '', button: '', items: [], chips: [], say: '' });
  scenes.forEach(x => { if ((x.type === 'logo' || x.type === 'outro') && !x.heading) x.heading = name; });
  const textMode = s.textMode === 'bi' ? 'bi' : 'ar';
  if (textMode !== 'bi') scenes.forEach(x => { x.headingEn = ''; x.textEn = ''; x.items.forEach(i => { i.en = ''; }); x.chips.forEach(i => { i.en = ''; }); });
  const vd = Array.isArray(s.voiceDur) ? s.voiceDur : [];
  scenes.forEach((x, i) => { x.vd = isFinite(vd[i]) ? +vd[i] : 0; });
  return { kind: 'promo', vertical: s.aspect === '9:16', brand, title, credit: str(s.credit), scenes, textMode, music: s.music || {}, en: !isAr(scenes.map(x => x.heading + x.text).join(' ')) };
}
// timings shared by the picture and the sound (every scene starts on a whole second = a beat at 120 BPM)
function planPromo(X) {
  const T = { X, scenes: [], ev: [], flash: [] };
  let t = 0;
  X.scenes.forEach((x, i) => {
    const s = Object.assign({}, x, { n: i, a: t }), nW = pWords(x.heading).length;
    let nat;
    if (x.type === 'logo') { s.hit = 2.0; s.tw = 2.9; s.tag = 2.9 + nW * .35 + .25; nat = Math.max(6, s.tag + 2.2); s.vAt = 2.5; }
    else if (x.type === 'title') { s.tw = .35; s.sub = .35 + nW * .28 + .3; nat = Math.max(4.5, s.sub + 2); s.vAt = .45; }
    else if (x.type === 'typing') { s.ty = Math.max(1.2, Math.min(2.6, [...x.text].length * .085)); s.click = 1.0 + s.ty + 1.0; nat = s.click + 1.6; s.vAt = .45; }
    else if (x.type === 'checklist') { s.step = 2.3; nat = .4 + x.items.length * 2.3 + .8; s.vAt = .45; }
    else if (x.type === 'cards') { s.cT = .5 + x.items.length * .35 + .6; nat = Math.max(5.5, s.cT + x.chips.length * .35 + 1.8); s.vAt = .45; }
    else if (x.type === 'chips') { s.tw = .3; s.cT = .3 + nW * .25 + .35; nat = Math.max(4.5, s.cT + x.items.length * .35 + 1.6); s.vAt = .45; }
    else if (x.type === 'phone') { s.icon = 1.2; s.tap = 2.6; nat = 4.6; s.vAt = .45; }
    else { nat = 6.5; s.vAt = 1.0; }
    let d = Math.max(nat, x.vd ? s.vAt + x.vd + .7 : 0);
    if (x.type === 'checklist' && d > nat) s.step = Math.max(2.3, (d - 1.2) / Math.max(1, x.items.length));
    if (x.type === 'outro') d = Math.max(d, 6.5);
    s.d = Math.ceil(d - 1e-6); s.b = t + s.d; t = s.b;
    T.scenes.push(s);
  });
  T.DUR = t;
  // events for the sound design (absolute seconds)
  const E2 = (tt, k, o) => T.ev.push(Object.assign({ t: tt, k }, o || {}));
  T.scenes.forEach((s, i) => {
    const a = s.a, nx = T.scenes[i + 1], big = ['checklist', 'cards', 'outro'].includes(s.type);
    if (i) { E2(a, 'whoosh', { d: .7, amp: .15 }); if (big) { E2(a, 'boom', { amp: s.type === 'outro' ? 1.1 : .7 }); E2(a, 'stab'); T.flash.push(a); } }
    if (s.type === 'logo') { E2(a + .2, 'riser', { d: s.hit - .2 }); E2(a + s.hit, 'boom'); E2(a + s.hit, 'stab'); T.flash.push(a + s.hit); pWords(s.heading).forEach((_, j) => E2(a + s.tw + j * .35, 'pop', { f: 380 + j * 80 })); if (s.text) E2(a + s.tag, 'ding'); E2(a + s.tag + .4, 'whoosh', { d: .6, amp: .08 }); }
    if (s.type === 'title') { pWords(s.heading).slice(0, 10).forEach((_, j) => E2(a + s.tw + j * .28, 'pop', { f: 360 + (j % 5) * 70, amp: .12 })); if (s.text) E2(a + s.sub, 'ding'); }
    if (s.type === 'chips') { pWords(s.heading).slice(0, 10).forEach((_, j) => E2(a + s.tw + j * .25, 'pop', { f: 360 + (j % 5) * 70, amp: .1 })); s.items.forEach((_, j) => E2(a + s.cT + j * .35, 'pop', { f: 560 + j * 70 })); }
    if (s.type === 'typing') { const n = [...s.text].length; for (let k = 0; k < n; k++) E2(a + 1.0 + s.ty * k / n, 'tick', { amp: .06 }); E2(a + s.click, 'click'); E2(a + s.click + .02, 'pop', { f: 300, amp: .12 }); if (nx) E2(nx.a - 1.0, 'riser', { d: 1.0, amp: .08 }); }
    if (s.type === 'checklist') s.items.forEach((it, j) => {
      const a0 = a + .4 + j * s.step, vis = it.visual || PVIS[j % 4];
      E2(a0 + .35, 'whoosh', { d: .45, amp: .07 }); E2(a0 + s.step, j === s.items.length - 1 ? 'chime' : 'ding');
      if (vis === 'tiles') [0, 1, 2].forEach(q => E2(a0 + .7 + q * .45, 'pop', { f: 400 + q * 90 }));
      if (vis === 'progress') for (let k = 0; k < 16; k++) E2(a0 + .2 + k * Math.max(.05, (s.step - .7) / 16), 'tick', { amp: .03 });
      if (vis === 'chart') [0, 1, 2, 3, 4].forEach(q => E2(a0 + .5 + q * .2, 'pop', { f: 420 + q * 60, amp: .09 }));
    });
    if (s.type === 'cards') { s.items.forEach((_, j) => E2(a + .5 + j * .35, 'pop', { f: 360 + j * 70 })); s.chips.forEach((_, j) => E2(a + s.cT + j * .35, 'pop', { f: 600 + j * 80, amp: .12 })); }
    if (s.type === 'phone') { E2(a + s.icon, 'pop', { f: 500 }); E2(a + s.tap, 'click', { f: 1600 }); if (nx && nx.type === 'outro') E2(nx.a - 1.0, 'riser', { d: 1.0, amp: .1 }); }
    if (s.type === 'outro') { E2(a + 1.7, 'pop', { f: 520 }); E2(a + 2.6, 'chime'); }
  });
  return T;
}
const PTR = new (typeof Path2D !== 'undefined' ? Path2D : Object)('M5 2l14 11-6.5 1.2L16 21l-3 1.3-3.4-6.8L5 19.5z');
function createPromo(canvas, spec) {
  const X = normPromo(spec), T = planPromo(X), ctx = canvas.getContext('2d');
  const VERT = X.vertical, W = VERT ? 1080 : 1920, H = VERT ? 1920 : 1080, CX = W / 2;
  const [hh, , ll] = rgbHsl(hexRgb(X.brand.color)), BR = X.brand.color, BRA = a => `rgba(${hexRgb(BR).join(',')},${a})`;
  const A2 = (a = 1) => hsla(hh + 210, 78, 64, a), A2D = hsla(hh + 225, 62, 36), A3 = hsla(hh + 28, 100, 56);
  const TAG = ll < 50 ? hsla(hh, 95, 64) : BR, ONBR = ll > 72 ? '#0b1029' : '#ffffff';
  const BG = '#0b1029', CARD = '#16204a', LINE = '#2a376e', FIELD = '#0f1838', MUTED = '#cfd8ff', GREEN = '#20a35a';
  const LOGO = X.brand.logo, NAME = X.brand.name || X.title.ar || X.scenes[0].heading;
  const DONE = X.en ? 'Ready!' : 'جاهز!';
  let GA = 1; const al = o => { ctx.globalAlpha = clamp(GA * o); };
  const R = rng(97), PART = Array.from({ length: VERT ? 80 : 70 }, () => { const k = R(); return { x: R() * W, y: R() * H, s: 2 + R() * 5, v: 10 + R() * 30, ph: R() * TAU, c: k < .6 ? 0 : k < .85 ? 1 : 2 }; });
  const PCOL = [a => BRA(a), a => A2(a), a => hsla(hh + 28, 100, 56, a)];
  const EMO = (X.scenes.find(x => x.type === 'checklist') || { items: [] }).items.map(i => i.emoji).filter(Boolean).concat(['💡', '⭐', '🚀', '✨', '🎯', '📈']);

  // ── text helpers: words laid out right-to-left (Arabic) or left-to-right, *word* = highlighted ──
  function toks(s) {             // punctuation right after a *highlight* sticks to it (no gap before «؟»)
    const out = [];
    str(s).split('*').forEach((part, k) => { const glue = k > 0 && part && !/^\s/.test(part) && out.length;
      part.split(/\s+/).filter(Boolean).forEach((w, j) => { if (!j && glue && !/\p{L}/u.test(w)) out[out.length - 1].t += w; else out.push({ t: w, hi: k % 2 === 1 }); }); });
    return out;
  }
  function layout(s, size, maxW, maxLines = 2, w = 900, min = 34) {
    const tk = toks(s), rtl = isAr(s);
    for (let sz = size; ; sz -= 4) {
      font(ctx, sz, w); const sp = ctx.measureText(' ').width, lines = []; let cur = [], cw = 0;
      tk.forEach(o => { const ww = ctx.measureText(o.t).width; if (cur.length && cw + sp + ww > maxW) { lines.push({ ws: cur, w: cw }); cur = []; cw = 0; } cur.push(Object.assign({ w: ww }, o)); cw += (cur.length > 1 ? sp : 0) + ww; });
      if (cur.length) lines.push({ ws: cur, w: cw });
      if ((lines.length <= maxLines && lines.every(l => l.w <= maxW)) || sz <= min) return { lines, size: sz, sp, rtl, w, n: tk.length };
    }
  }
  // draws a laid-out block; y = centre of the first line; anim(i) → {k (0..1 pop), o}
  function words(Lo, x, y, { color = '#fff', hi = TAG, align = 'center', lh = 1.22, anim = null } = {}) {
    let i = 0; font(ctx, Lo.size, Lo.w); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.direction = Lo.rtl ? 'rtl' : 'ltr';
    Lo.lines.forEach((ln, li) => {
      const yy = y + li * Lo.size * lh;
      let pos = align === 'center' ? (Lo.rtl ? x + ln.w / 2 : x - ln.w / 2) : align === 'right' ? x : x;
      if (align === 'right' && !Lo.rtl) pos = x - ln.w; if (align === 'left' && Lo.rtl) pos = x + ln.w;
      ln.ws.forEach(o => {
        const cx = Lo.rtl ? pos - o.w / 2 : pos + o.w / 2; pos += (Lo.rtl ? -1 : 1) * (o.w + Lo.sp);
        const a = anim ? anim(i) : { k: 1, o: 1 }; i++;
        if (a.o <= 0) return;
        ctx.save(); al(a.o); ctx.translate(cx, yy + (1 - a.k) * Lo.size * .8); const sc = .6 + .4 * a.k; ctx.scale(sc, sc);
        ctx.fillStyle = o.hi ? hi : color; ctx.fillText(o.t, 0, 0); ctx.restore();
      });
    });
    return y + (Lo.lines.length - 1) * Lo.size * lh + Lo.size * .6;
  }
  const popAnim = (lt, t0, step) => i => { const q = E.back(P(lt, t0 + i * step, t0 + .7 + i * step)); return { k: q, o: P(lt, t0 + i * step, t0 + .4 + i * step) }; };
  function heading(s, lt, y, size, maxW, lines = 2) {        // drops in from above, + optional English line
    const k = E.out(P(lt, .1, .7)), o = P(lt, .1, .6), dy = (1 - k) * -60;
    const Lo = layout(s.heading, size, maxW, lines); let bottom = words(Lo, CX, y + dy, { anim: () => ({ k: 1, o }) });
    if (s.headingEn) { ctx.save(); al(o); text(ctx, s.headingEn, CX, bottom + 34 + dy, { size: Math.round(size * .42), w: 700, color: A3, maxW }); ctx.restore(); bottom += 60; }
    return bottom;
  }
  function rr(x, y, w, h, r, fill, stroke, sw, shadow) {
    const p = rrPath(new Path2D(), x, y, w, h, r);
    if (shadow) { ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.42)'; ctx.shadowBlur = shadow; ctx.shadowOffsetY = shadow * .4; ctx.fillStyle = fill; ctx.fill(p); ctx.restore(); }
    else { ctx.fillStyle = fill; ctx.fill(p); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = sw; ctx.stroke(p); }
    return p;
  }
  const grad = (x0, y0, x1, y1, c0, c1) => { const g = ctx.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, c0); g.addColorStop(1, c1); return g; };
  function logoAt(x, y, size, rot = 0, o = 1) {
    ctx.save(); al(o); ctx.translate(x, y); ctx.rotate(rot * D2R);
    if (LOGO && (LOGO.naturalWidth || LOGO.width)) {
      const iw = LOGO.naturalWidth || LOGO.width, ih = LOGO.naturalHeight || LOGO.height, k = size / Math.max(iw, ih);
      ctx.shadowColor = BRA(.45); ctx.shadowBlur = size * .1; ctx.shadowOffsetY = size * .05;
      try { ctx.drawImage(LOGO, -iw * k / 2, -ih * k / 2, iw * k, ih * k); } catch (e) {}
    } else {
      const s2 = size * .8; ctx.shadowColor = BRA(.5); ctx.shadowBlur = size * .12; ctx.shadowOffsetY = size * .05;
      rr(-s2 / 2, -s2 / 2, s2, s2, s2 * .26, grad(-s2 / 2, -s2 / 2, s2 / 2, s2 / 2, A3, BR)); ctx.shadowColor = 'transparent';
      const ch = [...(NAME || '★')][0]; text(ctx, /\p{Extended_Pictographic}/u.test(ch) ? ch : (NAME.split(/\s+/).find(w => !/^(ال)$/.test(w)) || ch).replace(/^ال/, '')[0] || ch, 0, s2 * .04, { size: s2 * .55, color: ONBR });
    }
    ctx.restore();
  }
  function ring(x, y, lt, h, r0 = 120, r1 = 700) { const k = P(lt, h, h + 1.1); if (k <= 0 || k >= 1) return; ctx.save(); al(1 - k); ctx.strokeStyle = hsla(hh + 10, 100, 62, .8); ctx.lineWidth = 14 * (1 - k) + 2; ctx.beginPath(); ctx.arc(x, y, r0 + E.out(k) * r1, 0, TAU); ctx.stroke(); ctx.restore(); }
  function pointer(x, y, sc = 1, o = 1) { if (o <= 0) return; ctx.save(); al(o); ctx.translate(x, y); ctx.scale(4.6 * sc, 4.6 * sc); ctx.translate(-5, -2); ctx.fillStyle = '#fff'; ctx.fill(PTR); ctx.strokeStyle = '#111'; ctx.lineWidth = 1.2; ctx.lineJoin = 'round'; ctx.stroke(PTR); ctx.restore(); }
  function ripple(x, y, lt, t0, o = 1) { const k = P(lt, t0, t0 + .8); if (k <= 0 || k >= 1) return; ctx.save(); al((1 - k) * o); ctx.strokeStyle = '#fff'; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(x, y, 30 * (1 + k * 7), 0, TAU); ctx.stroke(); ctx.restore(); }
  function emojiText(s, x, y, size) { font(ctx, size, 400); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'; ctx.fillText(s, x, y); }

  // ── background: drifting glow blobs + particles ──
  function blob(x, y, r, c) { const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, c(1)); g.addColorStop(1, c(0)); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
  function bg(t) {
    ctx.globalAlpha = 1; ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
    blob(W * .78 + Math.sin(t * .3) * 200, H * .23 + Math.cos(t * .25) * 120, 700, a => A2(.32 * a));
    blob(W * .21 + Math.cos(t * .22) * 220, H * .79 + Math.sin(t * .3) * 100, 750, a => BRA(.26 * a));
    blob(CX + Math.sin(t * .17) * 300, H / 2, 500, a => `rgba(47,111,224,${.14 * a})`);
    for (const p of PART) {
      const y = ((p.y - t * p.v) % (H + 100) + H + 100) % (H + 100) - 50, x = p.x + Math.sin(t * .6 + p.ph) * 30, a = .25 + .35 * Math.sin(t * 2 + p.ph) ** 2;
      ctx.fillStyle = PCOL[p.c](a); ctx.beginPath(); ctx.arc(x, y, p.s, 0, TAU); ctx.fill();
    }
  }

  // ── scenes ──
  const SC = {};
  SC.logo = (s, lt, d) => {
    const LX = CX, LY = VERT ? 700 : 340, LS = VERT ? 440 : 380;
    if (lt < 2.4) { const k = P(lt, .2, s.hit); ctx.save(); ctx.lineCap = 'round'; ctx.lineWidth = 6;
      for (let i = 0; i < 16; i++) { const ang = i / 16 * TAU + .3, d0 = 1300 * (1 - E.out(k)), d1 = d0 + 260 * (1 - k); ctx.strokeStyle = hsla(hh + (i % 3) * 10, 100, 58, .8 * (1 - P(lt, s.hit - .1, s.hit + .3))); al(1);
        ctx.beginPath(); ctx.moveTo(LX + Math.cos(ang) * d0, LY + Math.sin(ang) * d0); ctx.lineTo(LX + Math.cos(ang) * d1, LY + Math.sin(ang) * d1); ctx.stroke(); }
      ctx.restore(); }
    ring(LX, LY, lt, s.hit);
    if (lt >= s.hit - .15) { const k = P(lt, s.hit - .15, s.hit + .75); logoAt(LX, LY - P(lt, d - .6, d) * 80, LS * E.back(k) * (1 + .03 * Math.sin(lt * 3)), (1 - E.out(k)) * -25); }
    const Lo = layout(s.heading, VERT ? 132 : 150, W - (VERT ? 120 : 240), 2);
    const ty = VERT ? 1080 : (Lo.lines.length > 1 ? 600 : 650);
    let y = words(Lo, CX, ty, { anim: popAnim(lt, s.tw, .35) });
    if (s.headingEn) { ctx.save(); al(P(lt, s.tag - .2, s.tag + .3)); text(ctx, s.headingEn, CX, y + 30, { size: 46, w: 700, color: MUTED, maxW: W - 200 }); ctx.restore(); y += 56; }
    if (s.text) { const k = E.out(P(lt, s.tag, s.tag + .6)); ctx.save(); al(P(lt, s.tag, s.tag + .5)); const f = fitWrap(ctx, s.text, W - (VERT ? 140 : 300), 2, VERT ? 58 : 60, 34, 800);
      f.lines.forEach((l, i) => text(ctx, l, CX, y + 70 + (1 - k) * 40 + i * f.size * 1.25, { size: f.size, w: 800, color: TAG })); y += 70 + (f.lines.length - 1) * f.size * 1.25; ctx.restore(); }
    const lk = E.out(P(lt, s.tag + .4, s.tag + 1.2)); if (lk > 0) { const lw = VERT ? 440 : 520; ctx.save(); al(1); ctx.fillStyle = grad(CX - lw / 2, 0, CX + lw / 2, 0, BR, A3); rr(CX + lw / 2 - lw * lk, y + 70, lw * lk, 8, 4, ctx.fillStyle); ctx.restore(); }
  };
  SC.title = (s, lt, d) => {
    const bob = Math.sin(lt * 1.5) * 6, hasE = !!s.emoji;
    if (hasE) { const k = E.back(P(lt, .15, .75)); if (k > 0) { ctx.save(); al(P(lt, .15, .4)); ctx.translate(CX, (VERT ? 680 : 250) + bob); ctx.scale(k, k); ctx.fillStyle = BRA(.18); ctx.strokeStyle = BR; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(0, 0, 112, 0, TAU); ctx.fill(); ctx.stroke(); emojiText(s.emoji, 0, 6, 120); ctx.restore(); } }
    const Lo = layout(s.heading, VERT ? 120 : 130, W - (VERT ? 120 : 260), 3);
    const y0 = (VERT ? (hasE ? 990 : 860) : (hasE ? 500 : 420)) - (Lo.lines.length - 1) * Lo.size * .3;
    let y = words(Lo, CX, y0 + bob, { anim: popAnim(lt, s.tw, .28) });
    if (s.headingEn) { ctx.save(); al(P(lt, s.sub - .3, s.sub + .2)); text(ctx, s.headingEn, CX, y + 46, { size: 50, w: 700, color: A3, maxW: W - 200 }); ctx.restore(); y += 70; }
    if (s.text) { const k = E.out(P(lt, s.sub, s.sub + .6)); ctx.save(); al(P(lt, s.sub, s.sub + .5)); const f = fitWrap(ctx, s.text, W - (VERT ? 160 : 420), 3, VERT ? 54 : 56, 32, 700);
      f.lines.forEach((l, i) => text(ctx, l, CX, y + 80 + (1 - k) * 40 + i * f.size * 1.4, { size: f.size, w: 700, color: MUTED })); ctx.restore();
      if (s.textEn) { ctx.save(); al(P(lt, s.sub + .3, s.sub + .8)); text(ctx, s.textEn, CX, y + 80 + f.lines.length * f.size * 1.4 + 10, { size: 36, w: 600, color: A3, maxW: W - 300 }); ctx.restore(); } }
  };
  SC.typing = (s, lt, d) => {
    heading(s, lt, VERT ? 450 : 150, VERT ? 82 : 76, W - 160);
    const C0 = VERT ? { x: 70, y: 700, w: 940, h: 760 } : { x: 360, y: 300, w: 1200, h: 540 };
    const ck = E.back(P(lt, .3, 1.0)), sc = .9 + .1 * E.out(P(lt, .3, 1));
    ctx.save(); ctx.translate(CX, C0.y + C0.h / 2 + (1 - ck) * 300); ctx.scale(sc, sc); ctx.translate(-CX, -(C0.y + C0.h / 2)); al(P(lt, .3, .6));
    rr(C0.x, C0.y, C0.w, C0.h, 44, CARD, LINE, 3, 50);
    const rtl = isAr(s.text) || (!s.text && !X.en), lab = s.label || (X.en ? 'Your idea' : 'اكتب هنا');
    text(ctx, lab, rtl ? C0.x + C0.w - 60 : C0.x + 60, C0.y + 66, { size: 40, w: 800, color: '#a9b4df', align: rtl ? 'right' : 'left' });
    const B = VERT ? { x: C0.x + 50, y: C0.y + 120, w: C0.w - 100, h: 330 } : { x: C0.x + 60, y: C0.y + 116, w: C0.w - 120, h: 190 };
    rr(B.x, B.y, B.w, B.h, 28, FIELD, A2(), 4);
    const f = fitWrap(ctx, s.text, B.w - 80, VERT ? 4 : 2, VERT ? 58 : 56, 32, 700), chars = [...f.lines.join('\n')];
    const n = Math.round(P(lt, 1.0, 1.0 + s.ty) * chars.length), shown = chars.slice(0, n).join('').split('\n'), lh = f.size * 1.3;
    const ty0 = B.y + B.h / 2 - (f.lines.length - 1) * lh / 2;
    font(ctx, f.size, 700); ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.direction = rtl ? 'rtl' : 'ltr'; ctx.textAlign = rtl ? 'right' : 'left';
    const tx = rtl ? B.x + B.w - 40 : B.x + 40; let cx = tx, cy = ty0;
    shown.forEach((l, i) => { ctx.fillText(l, tx, ty0 + i * lh); cx = rtl ? tx - ctx.measureText(l).width - 8 : tx + ctx.measureText(l).width + 8; cy = ty0 + i * lh; });
    if ((lt < 1.0 + s.ty || Math.floor(lt * 2.5) % 2) && lt < s.click) { ctx.fillStyle = BR; ctx.fillRect(cx - 3, cy - f.size * .55, 6, f.size * 1.1); }
    const Bt = VERT ? { x: B.x, y: C0.y + C0.h - 200, w: B.w, h: 140 } : { x: B.x, y: C0.y + C0.h - 160, w: B.w, h: 120 };
    const press = lt >= s.click && lt < s.click + .25, pulse = lt < s.click ? 1 + .03 * Math.sin(lt * 6) * P(lt, s.click - .6, s.click - .1) : 1, bs = press ? .95 : pulse;
    ctx.save(); ctx.translate(Bt.x + Bt.w / 2, Bt.y + Bt.h / 2); ctx.scale(bs, bs); ctx.translate(-(Bt.x + Bt.w / 2), -(Bt.y + Bt.h / 2));
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fill(rrPath(new Path2D(), Bt.x, Bt.y + 10, Bt.w, Bt.h, 30));
    rr(Bt.x, Bt.y, Bt.w, Bt.h, 30, grad(Bt.x + Bt.w, 0, Bt.x, 0, A2(), BR));
    text(ctx, s.button || (X.en ? 'Start now' : 'ابدأ الآن'), Bt.x + Bt.w / 2, Bt.y + Bt.h / 2 + 4, { size: VERT ? 60 : 58, color: '#fff', maxW: Bt.w - 80 });
    ctx.restore(); ctx.restore();
    const tx2 = Bt.x + Bt.w / 2, ty2 = Bt.y + Bt.h / 2, mv = E.io(P(lt, s.click - .9, s.click - .1)), sx = VERT ? 900 : 1500, sy = VERT ? 1820 : 980;
    pointer(lerp(sx, tx2 + 30, mv), lerp(sy, ty2 + 30, mv), press ? .85 : 1, P(lt, s.click - 1.1, s.click - .8) * (1 - P(lt, s.click + 1.0, s.click + 1.3)));
    ripple(tx2 + 30, ty2 + 30, lt, s.click);
  };
  function visual(kind, it, s, vt, j) {           // 820 × 640 stage
    if (kind === 'doc') {
      rr(150, 90, 520, 460, 24, '#fff');
      [[420], [340], [400], [260], [380], [300], [200]].forEach(([w], i) => { const k = E.out(P(vt, .2 + i * .25, .6 + i * .25)); rr(670 - 50 - w, 140 + i * 56, w, 26, 13, '#d5e2f5'); if (k > 0) rr(670 - 50 - w * k, 140 + i * 56, w * k, 26, 13, i ? '#1d2a6e' : BR); });
    } else if (kind === 'wave') {
      emojiText(it.emoji || '🎙️', 410, 200, 150);
      const on = P(vt, .3, .7);
      for (let i = 0; i < 21; i++) { const h = 30 + 170 * Math.abs(Math.sin(vt * 7 + i * .7) * Math.sin(vt * 2.3 + i * .31)) * on; ctx.fillStyle = grad(0, 440 - h / 2, 0, 440 + h / 2, A3, BR); rr(135 + i * 26.5, 440 - h / 2, 18, h, 9, ctx.fillStyle); }
    } else if (kind === 'tiles') {
      const G = [['#4fc3f7', '#1d6fe0'], [A3, BR], ['#7ee08a', GREEN]];
      [[70, 80, -8], [450, 140, 6], [250, 360, -3]].forEach(([x, y, r], i) => { const q = E.back(P(vt, .7 + i * .45, 1.3 + i * .45)); if (q <= 0) return;
        ctx.save(); al(P(vt, .7 + i * .45, .9 + i * .45)); ctx.translate(x + 150, y + 110); ctx.rotate((r + (1 - q) * 40) * D2R); ctx.scale(q, q);
        rr(-150, -110, 300, 220, 24, grad(-150, -110, 150, 110, G[i][0], G[i][1]), null, 0, 30); emojiText(EMO[(j + i) % EMO.length], 0, 8, 120); ctx.restore(); });
    } else if (kind === 'progress') {
      const cols = ['#4fc3f7', A3, '#7ee08a', '#ff9a6b', '#b39dff', '#4fc3f7'], off = -((vt * 160) % 320);
      for (let i = 0; i < 6; i++) { const x = off + i * 320; rr(x, 90, 300, 250, 18, cols[i], '#111', 8); emojiText(EMO[i % EMO.length], x + 150, 220, 110); }
      const fp = P(vt, .2, Math.max(.8, s.step - .5));
      text(ctx, fp >= 1 ? '✅ ' + DONE : (X.en ? '' : '') + Math.round(E.out(fp) * 100) + '%', 410, 470, { size: 56, color: '#fff' });
      rr(110, 520, 600, 40, 20, FIELD); if (fp > 0) rr(710 - 600 * E.out(fp), 520, 600 * E.out(fp), 40, 20, grad(110, 0, 710, 0, A3, GREEN));
    } else if (kind === 'chart') {
      const hs = [.32, .5, .42, .7, .95];
      ctx.strokeStyle = 'rgba(255,255,255,.15)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(110, 540); ctx.lineTo(710, 540); ctx.stroke();
      hs.forEach((h, i) => { const k = E.back(P(vt, .5 + i * .2, 1.1 + i * .2)), hh2 = 360 * h * Math.max(0, k); rr(150 + i * 115, 540 - hh2, 80, hh2, 14, grad(0, 540 - hh2, 0, 540, A3, BR)); });
      const ak = E.out(P(vt, 1.4, 2.0)); if (ak > 0) { ctx.save(); ctx.strokeStyle = GREEN; ctx.lineWidth = 12; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(160, 420); ctx.lineTo(lerp(160, 680, ak), lerp(420, 130, ak)); ctx.stroke(); ctx.restore(); }
      emojiText(it.emoji || '📈', 410, 90, 80);
    }
  }
  SC.checklist = (s, lt, d) => {
    heading(s, lt, VERT ? 200 : 110, VERT ? 76 : 80, W - 160);
    const n = s.items.length, ST = VERT ? { x: 140, y: 360, w: 800, h: 600 } : { x: 150, y: 240, w: 820, h: 640 };
    const sx = (1 - E.out(P(lt, .2, .9))) * -(VERT ? 1100 : 900);
    ctx.save(); ctx.translate(ST.x + sx, ST.y); al(P(lt, .2, .5)); const p = rr(0, 0, ST.w, ST.h, 44, CARD, LINE, 3, 40); ctx.clip(p); ctx.scale(ST.w / 820, ST.h / 640);
    s.items.forEach((it, j) => { const a0 = .4 + j * s.step, o = Math.min(P(lt, a0, a0 + .3), j === n - 1 ? 1 : 1 - P(lt, a0 + s.step - .1, a0 + s.step + .2)); if (o <= 0) return; ctx.save(); GA = o * P(lt, .2, .5); al(1); visual(it.visual || PVIS[j % 4], it, s, lt - a0, j); ctx.restore(); GA = 1; });
    ctx.restore();
    const RW = VERT ? 900 : 680, RH = VERT ? 120 : 130, gap = VERT ? 150 : Math.min(160, n > 1 ? (620 - RH) / (n - 1) : 0), top = VERT ? 1040 : 250 + (620 - RH - gap * (n - 1)) / 2;
    const rx = VERT ? 90 : W - 150 - RW, rtlRows = !X.en;
    s.items.forEach((it, j) => {
      const a0 = .4 + j * s.step, on = P(lt, a0, a0 + .5), done = lt > a0 + s.step - .3, y = top + j * gap; if (on <= 0) return;
      ctx.save(); al(on); ctx.translate((1 - E.back(on)) * 800 * (rtlRows ? 1 : -1), 0);
      rr(rx, y, RW, RH, 30, CARD, done ? GREEN : lt > a0 ? BR : LINE, 4);
      const ic = rtlRows ? rx + RW - 74 : rx + 74; emojiText(it.emoji || '✨', ic, y + RH / 2 + 4, VERT ? 60 : 64);
      const tx = rtlRows ? rx + RW - 140 : rx + 140, mw = RW - 140 - 130;
      if (it.en) { text(ctx, it.text, tx, y + RH / 2 - 16, { size: VERT ? 46 : 48, w: 800, color: '#fff', align: rtlRows ? 'right' : 'left', maxW: mw, min: 26 }); text(ctx, it.en, tx, y + RH / 2 + 32, { size: 28, w: 600, color: A3, align: rtlRows ? 'right' : 'left', maxW: mw }); }
      else text(ctx, it.text, tx, y + RH / 2 + 4, { size: VERT ? 52 : 54, w: 800, color: '#fff', align: rtlRows ? 'right' : 'left', maxW: mw, min: 28 });
      const q = E.back(P(lt, a0 + s.step - .3, a0 + s.step)); if (q > 0) { const cx2 = rtlRows ? rx + 70 : rx + RW - 70; ctx.save(); al(on * P(lt, a0 + s.step - .3, a0 + s.step - .1)); ctx.translate(cx2, y + RH / 2); ctx.scale(q, q); ctx.fillStyle = GREEN; ctx.beginPath(); ctx.arc(0, 0, 35, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 8; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath(); ctx.moveTo(-14, 1); ctx.lineTo(-4, 12); ctx.lineTo(15, -11); ctx.stroke(); ctx.restore(); }
      ctx.restore();
    });
  };
  function chip(c, x, y, size, q, o) { // x = centre
    if (q <= 0) return; const s = (c.emoji ? c.emoji + '  ' : '') + c.text; font(ctx, size, 800); const w = ctx.measureText(s).width + size * 2, h = size * 2.5;
    ctx.save(); al(o); ctx.translate(x, y); ctx.scale(q, q); rr(-w / 2, -h / 2, w, h, h / 2, 'rgba(255,255,255,.08)', 'rgba(255,255,255,.22)', 3); text(ctx, s, 0, 3, { size, w: 800, color: '#fff' }); ctx.restore();
  }
  const chipW = (c, size) => { font(ctx, size, 800); return ctx.measureText((c.emoji ? c.emoji + '  ' : '') + c.text).width + size * 2; };
  function chipRow(list, y, size, t0, lt, maxW) {      // centred rows, right-to-left order for Arabic
    const rows = []; let cur = [], cw = 0; const gap = size;
    list.forEach(c => { const w = chipW(c, size); if (cur.length && cw + gap + w > maxW) { rows.push({ cs: cur, w: cw }); cur = []; cw = 0; } cur.push({ c, w }); cw += (cur.length > 1 ? gap : 0) + w; });
    if (cur.length) rows.push({ cs: cur, w: cw });
    let i = 0; rows.forEach((r, ri) => { let pos = X.en ? CX - r.w / 2 : CX + r.w / 2; r.cs.forEach(({ c, w }) => { const x = X.en ? pos + w / 2 : pos - w / 2; pos += (X.en ? 1 : -1) * (w + gap);
      chip(c, x, y + ri * size * 3.1, size, E.back(P(lt, t0 + i * .35, t0 + .6 + i * .35)), P(lt, t0 + i * .35, t0 + .2 + i * .35)); i++; }); });
  }
  SC.cards = (s, lt, d) => {
    heading(s, lt, VERT ? 220 : 120, VERT ? 76 : 80, W - 160);
    const n = s.items.length, G = [[A3, BR], ['#3b3b4f', '#0d0d14'], [hsla(hh + 210, 85, 74), A2D], ['#4fc3f7', '#1d6fe0']];
    const pos = [];
    if (!VERT) { const cw = n > 3 ? 380 : 420, gap = 30, tot = n * cw + (n - 1) * gap; for (let i = 0; i < n; i++) pos.push({ x: X.en ? CX - tot / 2 + i * (cw + gap) : CX + tot / 2 - cw - i * (cw + gap), y: s.chips.length ? 260 : 300, w: cw, h: 420 }); }
    else { const cw = 440, ch = 400, xs = X.en ? [CX - 20 - cw, CX + 20] : [CX + 20, CX - 20 - cw]; for (let i = 0; i < n; i++) { const row = Math.floor(i / 2), lone = n % 2 === 1 && i === n - 1; pos.push({ x: lone ? CX - cw / 2 : xs[i % 2], y: (n <= 2 ? 520 : 400) + row * (ch + 40), w: cw, h: ch }); } }
    s.items.forEach((it, i) => { const p = pos[i], q = E.back(P(lt, .5 + i * .35, 1.1 + i * .35)), o = P(lt, .5 + i * .35, .7 + i * .35); if (o <= 0) return;
      ctx.save(); al(o); ctx.translate(p.x + p.w / 2, p.y + p.h / 2 + (1 - q) * 500 + Math.sin(lt * 2 + i) * 8 * P(lt, s.cT, s.cT + .5)); ctx.rotate((1 - q) * (i % 2 ? 12 : -12) * D2R);
      rr(-p.w / 2, -p.h / 2, p.w, p.h, 40, grad(-p.w / 2, -p.h / 2, p.w / 3, p.h / 2, G[i % 4][0], G[i % 4][1]), null, 0, 50);
      emojiText(it.emoji || '✨', 0, -p.h * .18, p.h * .34);
      const f = fitWrap(ctx, it.text, p.w - 50, 2, 46, 28); const y0 = p.h * .2 - (f.lines.length - 1) * f.size * .62;
      f.lines.forEach((l, k) => text(ctx, l, 0, y0 + k * f.size * 1.25, { size: f.size, color: '#fff' }));
      if (it.en) text(ctx, it.en, 0, y0 + f.lines.length * f.size * 1.25 + 4, { size: 28, w: 700, color: 'rgba(255,255,255,.85)', maxW: p.w - 50 });
      ctx.restore(); });
    if (s.chips.length) { if (VERT) s.chips.forEach((c, i) => chip(c, CX, 1420 + i * 140, 44, E.back(P(lt, s.cT + i * .35, s.cT + .6 + i * .35)), P(lt, s.cT + i * .35, s.cT + .2 + i * .35)));
      else chipRow(s.chips, 845, 44, s.cT, lt, W - 200); }
  };
  SC.chips = (s, lt, d) => {
    const Lo = layout(s.heading, VERT ? 110 : 120, W - 200, 3); const y0 = VERT ? 760 : 300;
    let y = words(Lo, CX, y0 - (Lo.lines.length - 1) * Lo.size * .4, { anim: popAnim(lt, s.tw, .25) });
    if (s.headingEn) { ctx.save(); al(P(lt, s.cT - .3, s.cT)); text(ctx, s.headingEn, CX, y + 34, { size: 46, w: 700, color: A3, maxW: W - 200 }); ctx.restore(); y += 60; }
    chipRow(s.items, Math.max(y + 140, VERT ? 1120 : 600), VERT ? 46 : 48, s.cT, lt, W - (VERT ? 100 : 240));
  };
  SC.phone = (s, lt, d) => {
    const PH = VERT ? { x: CX - 210, y: 960, k: 420 / 470 } : { x: X.en ? W - 300 - 470 : 300, y: 90, k: 1 };
    const pk = E.back(P(lt, .1, .9));
    ctx.save(); al(P(lt, .1, .3)); ctx.translate(PH.x + 235 * PH.k, PH.y + 465 * PH.k + (1 - pk) * 900); ctx.rotate((1 - E.out(P(lt, .1, .9))) * -10 * D2R); ctx.scale(PH.k, PH.k); ctx.translate(-235, -465);
    rr(0, 0, 470, 930, 70, '#05081a', LINE, 14, 40);
    const scr = rrPath(new Path2D(), 14, 14, 442, 902, 56); ctx.save(); ctx.clip(scr); ctx.fillStyle = grad(14, 14, 456, 916, A2D, BR); ctx.fillRect(14, 14, 442, 902);
    const APPC = ['#ff5f6d', '#ffc371', '#47c9ff', '#7ee08a', '#b39dff', '#ff9a6b', '#4fc3f7', '#f06292', '#9ccc65', '#ffd54f', '#80deea', '#ce93d8'];
    APPC.forEach((c, i) => rr(58 + (i % 3) * 132, 124 + Math.floor(i / 3) * 140, 96, 96, 26, c));
    const q = E.back(P(lt, s.icon, s.icon + .7)), tap = lt > s.tap && lt < s.tap + .25;
    if (q > 0) { ctx.save(); ctx.translate(239, 779); ctx.scale(q * (tap ? .88 : 1) * (1 + .05 * Math.sin(lt * 5) * (lt < s.tap ? 1 : 0)), q * (tap ? .88 : 1)); rr(-75, -75, 150, 150, 38, '#fff', null, 0, 24);
      if (LOGO) logoAt(0, 0, 124); else { rr(-64, -64, 128, 128, 30, grad(-64, -64, 64, 64, A3, BR)); text(ctx, s.emoji || [...NAME][0], 0, 4, { size: 70, color: ONBR }); } ctx.restore(); }
    ctx.save(); al(P(lt, s.icon + .3, s.icon + .7)); text(ctx, NAME, 239, 885, { size: 30, w: 800, color: '#fff', maxW: 300 }); ctx.restore();
    ripple(239, 779, lt, s.tap, .8);
    ctx.restore(); ctx.restore();
    const mv = E.io(P(lt, s.tap - .9, s.tap - .1)), ix = PH.x + 239 * PH.k, iy = PH.y + 779 * PH.k;
    pointer(lerp(ix + (VERT ? 380 : 520), ix + 20, mv), lerp(iy + (VERT ? 300 : 260), iy + 20, mv), lt >= s.tap && lt < s.tap + .25 ? .85 : 1, P(lt, s.tap - 1.1, s.tap - .8) * (1 - P(lt, s.tap + .8, s.tap + 1.1)));
    // headline + text beside (or above) the phone
    const k1 = E.out(P(lt, .4, 1)), k2 = E.out(P(lt, .9, 1.5));
    if (VERT) {
      const Lo = layout(s.heading, 92, 940, 3); ctx.save(); let y = words(Lo, CX, 260, { anim: () => ({ k: 1, o: P(lt, .4, .9) }) }); ctx.restore();
      ctx.save(); ctx.translate(0, (1 - k2) * 40); al(P(lt, .9, 1.4)); const f = fitWrap(ctx, s.text, 920, 3, 48, 30, 700); f.lines.forEach((l, i) => text(ctx, l, CX, y + 60 + i * f.size * 1.45, { size: f.size, w: 700, color: MUTED })); ctx.restore();
    } else {
      const rtl = !X.en, x = rtl ? W - 170 : 170, mw = 900;
      ctx.save(); ctx.translate((1 - k1) * -300 * (rtl ? 1 : -1), 0); const Lo = layout(s.heading, 96, mw, 3); const y = words(Lo, x, 340 - (Lo.lines.length - 1) * 30, { align: rtl ? 'right' : 'left', lh: 1.25, anim: () => ({ k: 1, o: P(lt, .4, .9) }) }); ctx.restore();
      ctx.save(); ctx.translate((1 - k2) * -300 * (rtl ? 1 : -1), 0); al(P(lt, .9, 1.4)); const f = fitWrap(ctx, s.text, mw, 3, 50, 30, 700);
      f.lines.forEach((l, i) => text(ctx, l, x, y + 60 + i * f.size * 1.5, { size: f.size, w: 700, color: MUTED, align: rtl ? 'right' : 'left' }));
      if (s.textEn) text(ctx, s.textEn, x, y + 60 + f.lines.length * f.size * 1.5 + 10, { size: 34, w: 600, color: A3, align: rtl ? 'right' : 'left', maxW: mw }); ctx.restore();
    }
  };
  SC.outro = (s, lt, d) => {
    const LY = VERT ? 560 : 270, LS = VERT ? 400 : 320, k = P(lt, 0, .8);
    ring(CX, LY, lt, .15, 140, 800);
    logoAt(CX, LY, LS * E.back(k) * (1 + .025 * Math.sin(lt * 3)), (1 - E.out(k)) * 20, P(lt, 0, .2));
    const Lo = layout(s.heading, VERT ? 120 : 124, W - 200, 2), k1 = E.out(P(lt, .6, 1.2));
    let y = words(Lo, CX, (VERT ? 900 : 540) + (1 - k1) * 80, { anim: () => ({ k: 1, o: P(lt, .6, 1.1) }) });
    if (s.text) { const k2 = E.out(P(lt, 1.1, 1.7)); ctx.save(); al(P(lt, 1.1, 1.6)); const f = fitWrap(ctx, s.text, W - 200, 2, VERT ? 52 : 54, 30, 800); f.lines.forEach((l, i) => text(ctx, l, CX, y + 50 + (1 - k2) * 60 + i * f.size * 1.3, { size: f.size, w: 800, color: TAG })); y += 50 + (f.lines.length - 1) * f.size * 1.3; ctx.restore(); }
    if (s.textEn) { ctx.save(); al(P(lt, 1.3, 1.8)); text(ctx, s.textEn, CX, y + 54, { size: 36, w: 600, color: MUTED, maxW: W - 200 }); ctx.restore(); y += 44; }
    const pills = []; if (X.brand.url) pills.push({ t: X.brand.url, main: true }); if (X.brand.phone) pills.push({ t: (/^\+?[\d\s-]{6,}$/.test(X.brand.phone) ? '📞 ' : '') + X.brand.phone, main: !pills.length });
    const PSZ = VERT ? 58 : 60, ph = PSZ * 1.8, pw = pills.map(p => { font(ctx, PSZ, 900); return Math.max(VERT ? 420 : 460, ctx.measureText(p.t).width + 120); });
    const py = y + (VERT ? 150 : 120);
    pills.forEach((p, i) => {
      const q = E.back(P(lt, 1.7 + i * .25, 2.3 + i * .25)); if (q <= 0) return;
      const x = VERT || pills.length === 1 ? CX : (i === 0 ? CX + (pw[1] + 40) / 2 : CX - (pw[0] + 40) / 2) * 1, yy = VERT ? py + i * (ph + 36) : py;
      const xx = VERT || pills.length === 1 ? CX : (i === 0 ? CX - (pw[0] + pw[1] + 40) / 2 + pw[0] / 2 : CX + (pw[0] + pw[1] + 40) / 2 - pw[1] / 2);
      ctx.save(); al(P(lt, 1.7 + i * .25, 1.9 + i * .25)); ctx.translate(xx, yy); ctx.scale(q, q);
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fill(rrPath(new Path2D(), -pw[i] / 2, -ph / 2 + 12, pw[i], ph, ph / 2));
      rr(-pw[i] / 2, -ph / 2, pw[i], ph, ph / 2, p.main ? BR : 'rgba(255,255,255,.1)', p.main ? null : 'rgba(255,255,255,.4)', 4);
      ctx.direction = 'ltr'; font(ctx, PSZ, 900); ctx.fillStyle = p.main ? ONBR : '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(p.t, 0, 4); ctx.restore(); void x;
    });
    const cy = VERT ? Math.max(py + pills.length * (ph + 36) + 60, 1640) : Math.min(1010, py + (pills.length ? ph / 2 + 90 : 40));
    if (X.credit) { ctx.save(); al(P(lt, 2.6, 3.3)); text(ctx, (X.en ? '✍️ Made by ' : '✍️ هذا العمل من تنسيق ') + X.credit, CX, cy, { size: VERT ? 40 : 40, w: 700, color: MUTED, maxW: W - 200 }); ctx.restore(); }
  };

  function render(t) {
    t = clamp(t, 0, T.DUR);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    bg(t);
    T.scenes.forEach((s, i) => {
      if (t < s.a || t > s.b + .2) return; const last = i === T.scenes.length - 1;
      const fin = i ? P(t, s.a, s.a + .45) : 1, fout = last ? 1 : 1 - P(t, s.b - .25, s.b + .2);
      GA = Math.min(fin, fout); if (GA <= 0) return; ctx.save(); al(1); SC[s.type](s, t - s.a, s.d); ctx.restore(); GA = 1;
    });
    ctx.globalAlpha = 1;
    const fl = Math.max(0, ...T.flash.map(h => t >= h ? .55 * Math.exp(-(t - h) * 9) : 0));
    if (fl > .01) { ctx.fillStyle = `rgba(255,255,255,${fl})`; ctx.fillRect(0, 0, W, H); }
    const end = P(t, T.DUR - .8, T.DUR); if (end > 0) { ctx.fillStyle = `rgba(0,0,0,${end})`; ctx.fillRect(0, 0, W, H); }
    if (t < .25) { ctx.fillStyle = `rgba(0,0,0,${1 - t / .25})`; ctx.fillRect(0, 0, W, H); }
  }
  return { DUR: T.DUR, T, S: X, W, H, render, mode: 'promo', music: () => promoMusic(T, 32000, X.music) };
}
// music + sound effects synced to the promo (port of video/studio-promo/music.js), C major 120 BPM transposed by seed
function promoMusic(T, SR = 32000, mo = {}) {
  const TN = 8192, TB = new Float32Array(TN); for (let i = 0; i < TN; i++) TB[i] = Math.sin(i / TN * TAU);
  const SN = c => TB[((c * TN) | 0) & (TN - 1)];
  const DUR = T.DUR, N = Math.ceil(SR * DUR), L = new Float32Array(N), R = new Float32Array(N), SL = new Float32Array(N), SRV = new Float32Array(N);
  let seed = 11; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff * 2 - 1; };
  let ms = ((mo.seed || 7) >>> 0) || 7; ms = Math.imul(ms ^ (ms >>> 16), 0x45d9f3b) >>> 0; ms = Math.imul(ms ^ (ms >>> 16), 0x45d9f3b) >>> 0; const rr2 = () => { ms = (Math.imul(ms, 1664525) + 1013904223) >>> 0; return ms / 4294967296; };
  const KEY = [0, 2, -3, 5, -2, 3, -1][Math.floor(rr2() * 7)];
  function add(t0, dur, amp, pan, fn, send = 0) {
    const s0 = Math.max(0, Math.round(t0 * SR)), s1 = Math.min(N, Math.round((t0 + dur) * SR));
    const gl = Math.cos((pan + 1) * Math.PI / 4) * amp, gr = Math.sin((pan + 1) * Math.PI / 4) * amp;
    for (let i = s0; i < s1; i++) { const v = fn((i - s0) / SR); L[i] += v * gl; R[i] += v * gr; if (send) { SL[i] += v * gl * send; SRV[i] += v * gr * send; } }
  }
  const hz = m => 440 * Math.pow(2, (m + KEY - 69) / 12);
  const env = (t, a, d) => Math.min(1, t / a) * Math.exp(-t / d);
  const kick = (t0, a = .7) => add(t0, .45, a, 0, t => Math.exp(-t * 9) * SN(48 * t + 110 / 25 * (1 - Math.exp(-t * 25))));
  function noise(t0, dur, amp, pan, dec, hp = .85, send = 0) { let p = 0, y = 0; add(t0, dur, amp, pan, t => { const x = rnd(); y = hp * (y + x - p); p = x; return y * Math.exp(-t / dec); }, send); }
  const clap = (t0, a = .22) => { [0, .012, .024].forEach(d => noise(t0 + d, .2, a * .6, .05, .05, .7, .25)); add(t0, .1, a * .5, 0, t => Math.exp(-t * 40) * SN(210 * t)); };
  const hat = (t0, a = .06, pan = .35) => noise(t0, .07, a, pan, .016, .98);
  const bass = (t0, m, dur, a = .3) => { const f = hz(m); add(t0, dur, a, 0, t => Math.min(1, t / .008) * Math.min(1, (dur - t) / .04) * (SN(f * t) + .35 * SN(f * 2 * t) + .12 * Math.tanh(3 * SN(f * t)))); };
  const pluck = (t0, m, a = .12, pan = -.15) => { const f = hz(m); add(t0, .9, a, pan, t => env(t, .003, .16) * (SN(f * t) + .5 * SN(f * 2 * t) * Math.exp(-t * 12) + .25 * SN(f * 3 * t) * Math.exp(-t * 18)), .35); };
  const marimba = (t0, m, a = .2, pan = .1) => { const f = hz(m); add(t0, 1.2, a, pan, t => env(t, .003, .3) * (SN(f * t) + .3 * SN(f * 4 * t) * Math.exp(-t * 20)), .4); };
  const bell = (t0, m, a = .09, pan = 0) => { const f = hz(m); add(t0, 2.6, a, pan, t => env(t, .002, .75) * (SN(f * t) + .35 * SN(f * 2.76 * t) * Math.exp(-t * 3) + .15 * SN(f * 5.4 * t) * Math.exp(-t * 8)), .6); };
  const pad = (t0, mm, dur, a = .045) => mm.forEach((m, j) => { const f = hz(m); add(t0, dur, a, j % 2 ? .5 : -.5, t => Math.min(1, t / .5) * Math.min(1, (dur - t) / .6) * (SN(f * t) + .4 * SN(f * 1.004 * t + .16) + .2 * SN(f * 2 * t)), .5); });
  const stab = (t0, mm, a = .07) => mm.forEach((m, j) => { const f = hz(m); add(t0, 1.4, a, (j - 1) * .4, t => env(t, .004, .35) * (Math.tanh(2 * SN(f * t)) + .3 * SN(f * 2 * t)), .6); });
  const pop = (t0, a = .16, f = 420) => add(t0, .2, a, 0, t => Math.exp(-t * 24) * SN(f * t + 900 * t * t), .3);
  const tick = (t0, a = .05) => noise(t0, .03, a, rnd() * .6, .006, .95);
  const click = (t0, f = 1800) => add(t0, .06, .25, 0, t => Math.exp(-t * 80) * SN(f * t));
  const ding = t0 => { bell(t0, 96, .09, .3); bell(t0 + .08, 103, .07, -.3); };
  const chime = t0 => [84, 88, 91, 96].forEach((m, i) => bell(t0 + i * .07, m, .07, (i - 1.5) * .3));
  function whoosh(tEnd, dur = .8, a = .16) { let y = 0; add(tEnd - dur, dur + .3, a, 0, t => { const k = Math.min(1, t / dur); y += (.02 + .45 * k * k) * (rnd() - y); return y * (t < dur ? k * k : Math.exp(-(t - dur) * 12)); }, .3); }
  function riser(t0, dur, a = .1) { add(t0, dur, a, 0, t => { const k = t / dur; return k * k * SN(200 * t + 500 * k * k * t) * .5; }, .3); whoosh(t0 + dur, dur, a * 1.2); }
  function boom(t0, a = 1) { kick(t0, .9 * a); add(t0, 2.2, .35 * a, 0, t => Math.exp(-t * 2.2) * SN(42 * t)); noise(t0, 2.4, .2 * a, 0, .8, .9, .6); }
  // chords: I–V–vi–IV (or a rotation picked by the seed), one chord per bar
  const B = .5, BAR = 2, PROGS = [[[48, [60, 64, 67]], [43, [59, 62, 67]], [45, [60, 64, 69]], [41, [60, 65, 69]]], [[45, [60, 64, 69]], [41, [60, 65, 69]], [48, [60, 64, 67]], [43, [59, 62, 67]]], [[48, [60, 64, 67]], [45, [60, 64, 69]], [41, [60, 65, 69]], [43, [59, 62, 67]]]];
  const CH = PROGS[Math.floor(rr2() * PROGS.length)], chordAt = t => CH[Math.floor(t / BAR + 1e-6) % 4];
  const HOOK = [[0, 76], [.5, 79], [1, 81], [1.5, 79], [2, 76], [2.75, 74], [3, 72], [3.5, 74]];
  function groove(t0, t1, o = {}) {
    for (let t = t0; t < t1 - 1e-6; t += B) {
      const beat = Math.round(t / B) % 4;
      if (!o.noKick && (beat === 0 || beat === 2)) kick(t, .55);
      if (!o.noKick && beat === 2 && o.extra) kick(t + B * .75, .35);
      if (beat === 1 || beat === 3) clap(t, o.clap || .18);
      hat(t + B / 2, .055); if (o.busyHats) hat(t, .03, -.3);
    }
    for (let bt = Math.floor(t0 / BAR + 1e-6) * BAR; bt < t1 - 1e-6; bt += BAR) {
      const [r, c] = chordAt(bt), s = Math.max(bt, t0);
      pad(s, c, Math.min(bt + BAR, t1) - s + .2, o.pad || .03);
      [0, .75, 1, 1.5].forEach((d, j) => { if (bt + d >= t0 - 1e-6 && bt + d < t1) bass(bt + d, r + (j === 3 ? 12 : 0), j === 0 ? .7 : .45, .26); });
      if (o.arp) for (let k = 0; k < 8; k++) { const tt = bt + k * B / 2; if (tt >= t0 - 1e-6 && tt < t1) pluck(tt, c[[0, 1, 2, 1][k % 4]] + 12, .07, k % 2 ? .3 : -.3); }
    }
  }
  function hook(t0, t1, up = 0, a = .14) { for (let ph = Math.ceil(t0 / BAR - 1e-6) * BAR; ph < t1 - 1e-6; ph += 4) HOOK.forEach(([d, m]) => { if (ph + d < t1 - .1) marimba(ph + d, m + up, a, up ? -.15 : .15); }); }
  function soft(t0, t1) {
    for (let bt = Math.floor(t0 / BAR + 1e-6) * BAR; bt < t1 - 1e-6; bt += BAR) { const [r, c] = chordAt(bt), s = Math.max(bt, t0); pad(s, c.map(m => m + 12), Math.min(bt + BAR, t1) - s + .2, .035); if (bt >= t0 - 1e-6) bass(bt, r, 1.8, .18);
      if (Math.round(bt / BAR) % 2 === 1) for (let i = 0; i < 8; i++) { const tt = bt + i * .25; if (tt >= t0 && tt < t1) bell(tt, c[i % 3] + 24, .035, i % 2 ? .4 : -.4); } }
  }
  T.scenes.forEach((s, i) => {
    const a = s.a, b = s.b, nx = T.scenes[i + 1];
    if (s.type === 'logo') { pad(a, [60, 67, 72], s.hit + .4, .03); soft(a + s.hit, b); }
    else if (s.type === 'outro') { const end = Math.max(a + 2, b - 2.5); groove(a, end, { arp: true, extra: true, pad: .03 }); hook(a, end, 0, .15); kick(end, .6); pad(end, [48, 60, 64, 67, 72], b - end, .05); bass(end, 36, Math.min(1.9, b - end), .3); bell(end, 84, .08); bell(end + .1, 91, .06, .4); bell(end + .2, 96, .05, -.4); }
    else if (s.type === 'phone') groove(a, nx && nx.type === 'outro' ? b - 1 : b, { noKick: true, clap: .1, pad: .04 });
    else if (s.type === 'checklist' || s.type === 'cards') { groove(a, b, { arp: true, extra: true, busyHats: s.type === 'checklist', pad: .028 }); hook(a, b, s.type === 'cards' ? 12 : 0, s.type === 'cards' ? .1 : .14); }
    else groove(a, b, { arp: true, clap: .14 });
  });
  T.ev.forEach(e => {
    const t = e.t;
    if (e.k === 'whoosh') whoosh(t, e.d || .8, e.amp || .16);
    else if (e.k === 'boom') boom(t, e.amp || 1);
    else if (e.k === 'stab') stab(t, [60, 64, 67, 72], .08);
    else if (e.k === 'riser') riser(t, e.d || 1, e.amp || .09);
    else if (e.k === 'pop') pop(t, e.amp || .15, e.f || 420);
    else if (e.k === 'tick') tick(t, e.amp || .05);
    else if (e.k === 'click') click(t, e.f || 1800);
    else if (e.k === 'ding') ding(t);
    else if (e.k === 'chime') chime(t);
  });
  // reverb on the send (Schroeder: 4 combs + 2 allpasses per side) + master
  const sc = SR / 44100;
  function reverb(x, offs) {
    const y = new Float32Array(N);
    for (const [d0, g] of [[1557, .82], [1617, .81], [1491, .83], [1422, .8]]) { const d = Math.round((d0 + offs) * sc), buf = new Float32Array(d); let k = 0, lp = 0; for (let i = 0; i < N; i++) { const o = buf[k]; lp = o * .7 + lp * .3; buf[k] = x[i] + lp * g; y[i] += o * .25; k = (k + 1) % d; } }
    for (const d0 of [225, 556]) { const d = Math.round((d0 + offs) * sc), buf = new Float32Array(d); let k = 0; for (let i = 0; i < N; i++) { const b = buf[k], v = y[i] + b * -.5; buf[k] = v; y[i] = b + v * .5; k = (k + 1) % d; } }
    return y;
  }
  const rl = reverb(SL, 0), rrv = reverb(SRV, 23);
  let peak = 0; for (let i = 0; i < N; i++) { L[i] = Math.tanh((L[i] + rl[i] * .9) * .6); R[i] = Math.tanh((R[i] + rrv[i] * .9) * .6); peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); }
  const g = .89 / (peak || 1); for (let i = 0; i < N; i++) { const f = Math.min(1, (N - i) / (SR * 1.2)) * g; L[i] *= f; R[i] *= f; }
  return { sr: SR, L, R };
}

// ───────────── engine ─────────────
function create(canvas, spec) {
  if (spec && spec.kind === 'explainer') return createExplainer(canvas, spec);
  if (spec && spec.kind === 'promo') return createPromo(canvas, spec);
  const S = normalize(spec), MEDIA = spec.media || {};
  // card pictures when chosen, or automatically when the cartoon cannot show this card faithfully
  const cartoonOK = S.animatable && S.template !== 'other' && (S.template !== 'workout' || S.exercises.every(x => x.known));
  const CARDS = !!MEDIA.image && (S.mode === 'cards' || (S.mode === 'auto' && !cartoonOK));
  const WK = !CARDS && S.template === 'workout', T = CARDS ? planCards(S) : WK ? planWorkout(S) : plan(S), ev = T.ev, Ch = T.C;
  const MAINO = personOpts(S.chars.main), HELPO = personOpts(S.chars.helper), MS = MAINO.sc, showHelper = !WK && S.helper;
  const ctx = canvas.getContext('2d');
  const usesItems = !WK && !CARDS && S.steps.some(x => ['squat', 'pick', 'place', 'throw', 'repeat'].includes(x.action));
  const ROOT = { bg: el('g'), intro: el('g'), tools: el('g'), gym: el('g'), ben: el('g'), outro: el('g') };

  // background floaters
  const floaters = []; {
    const R = rng(7), cols = [C.orange, C.blue, C.yellow, C.red, C.green];
    for (let i = 0; i < 26; i++) {
      const g = el('g', { opacity: .16 + R() * .14 }, ROOT.bg), c = cols[i % 5], k = R();
      if (k < .3) el('circle', { r: 30 + R() * 50, fill: c }, g);
      else if (k < .55) el('rect', { x: -40, y: -40, width: 80, height: 80, rx: 18, fill: c }, g);
      else if (k < .8) star(g, 40 + R() * 30, c);
      else el('circle', { r: 40 + R() * 30, fill: 'none', stroke: c, 'stroke-width': 14 }, g);
      floaters.push({ g, x: R() * 1920, y: R() * 1080, vx: (R() - .5) * 30, vy: -10 - R() * 25, vr: (R() - .5) * 30, ph: R() * 6 });
    }
  }
  const BG = { intro: ['#9fd8ff', '#eaf7ff'], tools: ['#ffe27a', '#fff8dc'], ben: ['#a8eac3', '#effcf4'], outro: ['#9fd8ff', '#fff3e0'] };
  const makeSurface = p => WK ? makeYogaMat(p, S.setting === 'fitness_studio' ? '#8e5bff' : '#2f6fe0') : S.surface === 'beam' ? makeBeam(p) : S.surface === 'floor' ? makeSpot(p) : makeWobble(p);
  function makeTarget(p) {
    if (S.target === 'cone') { const c = makeTallCone(p); return { back: c.g, front: null, update: (x, y, s = 1, op = 1, rot = 0) => c.update(x, y, s, op, rot), top: [0, -250] }; }
    if (S.target === 'basket') { const b = makeBasket(p); return { back: b.back, front: b.front, update: b.update, top: [0, -125] }; }
    const h = makeHoop(p, C.red); return { back: h.g, front: null, update: (x, y, s = 1, op = 1) => h.update(x, y, s, op), top: [0, 0] };
  }

  // ── INTRO ──
  const gI = ROOT.intro;
  const iRays = el('g', {}, gI);
  for (let i = 0; i < 16; i++) el('path', { d: 'M 0 0 L -70 -1100 L 70 -1100 Z', fill: i % 2 ? '#ffffff' : '#ffe8a3', opacity: .55, transform: `rotate(${i * 22.5})` }, iRays);
  el('ellipse', { cx: 960, cy: 1070, rx: 1300, ry: 110, fill: '#7cc7f5', opacity: .55 }, gI);
  const iTarget = makeTarget(gI);
  const iSurf = makeSurface(gI);
  const iKid = makePerson(gI, MAINO);
  const iItems = [0, 1, 2, 3].map(i => makeItem(gI, S.item, i));
  if (iTarget.front) gI.appendChild(iTarget.front);
  const iStars = makeStars(gI, 6, 11), iBurst = makeBurst(gI, 3, 90, { power: 1100, spread: 160 });
  const I_ITEM = [[600, 1045, 5.2], [720, 1062, 5.4], [1200, 1062, 5.6], [1320, 1045, 5.8]];
  const teaser = usesItems;
  function renderIntro(t) {
    iRays.setAttribute('transform', `translate(960 220) rotate(${t * 8}) scale(${E.out(P(t, .8, 1.8))})`);
    iRays.setAttribute('opacity', .9 * P(t, .8, 1.6));
    const bx = K(t, [[4.3, 1980], [4.8, 960, 'out']]), by = 1050, hop = P(t, 4.9, 5.4);
    const bang = S.surface === 'board' ? wob(t, 5.4, 8, 1.3, .9) + wob(t, 6.5, 3, 1.4, 1.4) + wob(t, 7.1, 3, 1.4, 1.4) : 0;
    iSurf.update(bx, by, bang, S.surface === 'beam' ? .7 : 1, P(t, 4.3, 4.4));
    const onB = iSurf.base(bx, by, bang, S.surface === 'beam' ? .7 : 1);
    let kx = 960, ky = 1035, jump = Math.max(0, Math.sin(P(t, .15, .7) * Math.PI)) * 110;
    if (t >= 4.9) { kx = lerp(960, onB[0], E.io(hop)); ky = lerp(1035, onB[1], E.io(hop)) - Math.sin(hop * Math.PI) * 120; jump = 0; }
    const sq = teaser ? Math.sin(P(t, 6.4, 7.3) * Math.PI) : 0, wave = t < 3.6;
    let ra = wave ? [150 + Math.sin(t * 13) * 22, 25] : [12, -8], la = [-12, 8];
    const bal = P(t, 5.4, 5.7);
    if (bal > 0) { ra = [lerp(12, 82 - bang * 2, bal), lerp(-8, 14, bal)]; la = [lerp(-12, -82 - bang * 2, bal), lerp(8, -14, bal)]; }
    const cheer = P(t, 7.35, 7.55);
    if (cheer > 0) { ra = [lerp(82, 160 + Math.sin(t * 12) * 10, cheer), 10]; la = [lerp(-82, -160 - Math.sin(t * 12) * 10, cheer), -10]; }
    const crouch = 70 * sq + (t > 4.7 && t < 4.9 ? 25 * Math.sin(P(t, 4.7, 4.9) * Math.PI) : 0);
    iKid.update({ x: kx, y: ky - jump, s: MS * E.back(P(t, .1, .6)), lean: t > 5.4 ? bang : 0, bend: t > 5.4 ? -bang * .5 : 0, crouch, spread: t > 5.3 ? (S.surface === 'beam' ? 18 : 34) : 22, la, ra, t,
      mouth: Math.max(wave ? .6 * Math.abs(Math.sin(t * 9)) * P(t, .2, .4) : 0, cheer * .9), look: t > 4.5 && t < 7.3 ? [0, .6] : [0, 0], shadow: 1 - jump / 300 });
    iStars.update(t, .5, iKid.handW[1][0], iKid.handW[1][1], 1.3);
    I_ITEM.forEach(([x, y, t0], i) => iItems[i].update(x, y - (1 - E.out(P(t, t0, t0 + .35))) * 300, (1 - P(t, t0, t0 + .35)) * 200, 1.1 * pop(t, t0, .4), usesItems ? P(t, t0, t0 + .05) : 0));
    iTarget.update(1520, 1050, .85 * pop(t, 6.1, .5), usesItems ? P(t, 6.1, 6.15) : 0, wob(t, 6.4, 6, 1.5, 1.5));
    iBurst.update(t, 7.4, 960, 600, 1.8);
  }

  // ── TOOLS ──
  const gT = ROOT.tools, nT = S.tools.length;
  const cw = Math.min(330, (1720 - (nT - 1) * 30) / Math.max(1, nT)), cs = cw / 330, tot = nT * cw + (nT - 1) * 30;
  const cards = S.tools.map((tool, i) => {
    const x = 960 + tot / 2 - cw / 2 - i * (cw + 30);
    const g = el('g', {}, gT);
    el('rect', { x: -165, y: -215, width: 330, height: 430, rx: 40, fill: 'rgba(0,0,0,.12)', transform: 'translate(0 14)' }, g);
    el('rect', { x: -165, y: -215, width: 330, height: 430, rx: 40, fill: '#fff', stroke: C.yellow, 'stroke-width': 10 }, g);
    const glow = el('rect', { x: -177, y: -227, width: 354, height: 454, rx: 50, fill: 'none', stroke: '#fff', 'stroke-width': 8 }, g);
    const art = el('g', {}, g);
    el('text', { x: 0, y: 122, size: 48, weight: 900, fill: C.navy, maxw: 300, text: tool.ar }, g);
    el('text', { x: 0, y: 172, size: 34, weight: 800, fill: C.orange, maxw: 300, text: tool.en }, g);
    return { g, art, glow, x, anim: toolArt(art, tool.kind, tool) };
  });
  function toolArt(g, kind, tool) {
    const src = CARDS && tool && boxRect(tool.box, MEDIA.image.naturalWidth || MEDIA.image.width, MEDIA.image.naturalHeight || MEDIA.image.height, .01);
    if (src) { const im = el('image', { img: MEDIA.image, src, x: -140, y: -200, w: 280, h: 280 }, g); return (t, t0) => im.setAttribute('transform', `scale(${E.back(P(t, t0, t0 + .5))})`); }
    switch (kind) {
      case 'board': { const b = makeWobble(g); return (t, t0) => b.update((1 - E.out(P(t, t0, t0 + .5))) * 300, -10, wob(t, t0 + .4, 10, 1.2, 1) + Math.sin(t * 2) * 2, .85, 1); }
      case 'beam': { const b = makeBeam(g); return (t, t0) => b.update((1 - E.out(P(t, t0, t0 + .5))) * 300, 10, 0, .48, 1); }
      case 'discs': { const d = [3, 1, 2, 0].map(i => makeDisc(g, i)), pos = [[-55, -80], [55, -80], [-55, -5], [55, -5]];
        return (t, t0) => d.forEach((x, i) => { const k = P(t, t0 + .1 + i * .18, t0 + .7 + i * .18); x.update(pos[i][0], pos[i][1] - (1 - E.elastic(k)) * 160, (1 - k) * 90, 1.05, k > 0 ? 1 : 0); }); }
      case 'cone': { const c = makeTallCone(g); return (t, t0) => c.update(0, 70, .64 * E.elastic(P(t, t0 + .1, t0 + 1.1)), P(t, t0, t0 + .1), wob(t, t0 + .5, 5, 1.4, 1.4)); }
      case 'tongs': { makeMat(g, 230, 90, 2, 4).setAttribute('transform', 'translate(0 20)'); const tg = makeTongs(g);
        return (t, t0) => tg.update(-60 + (1 - E.out(P(t, t0, t0 + .5))) * -200, -70, 18, 4 + 10 * Math.abs(Math.sin((t - t0) * 3)), 1.1, P(t, t0, t0 + .2)); }
      case 'mat': { const m = makeMat(g, 240, 130, 3, 4); return (t, t0) => m.setAttribute('transform', `translate(0 -30) scale(${E.back(P(t, t0, t0 + .5))})`); }
      case 'bags': { const b = [0, 1, 2].map(i => makeBag(g, ...BAGC[i])), pos = [[-60, -40], [60, -40], [0, -110]];
        return (t, t0) => b.forEach((x, i) => { const k = P(t, t0 + .1 + i * .2, t0 + .8 + i * .2); x.update(pos[i][0], pos[i][1] - (1 - E.elastic(k)) * 200, (1 - k) * 90 * (i ? 1 : -1), 2.1, k > 0 ? 1 : 0); }); }
      case 'hoop': { const h = [C.blue, C.red].map(c => el('ellipse', { cx: 0, cy: 0, rx: 100, ry: 100, fill: 'none', stroke: c, 'stroke-width': 16 }, g));
        return (t, t0) => h.forEach((x, i) => { const k = P(t, t0 + .1 + i * .25, t0 + .9 + i * .25); set(x, { cx: i ? 18 : -18, cy: (i ? 10 : -10) - 50, ry: 100 * Math.abs(Math.cos((1 - E.out(k)) * Math.PI * 2)), opacity: k > 0 ? 1 : 0 }); }); }
      case 'ball': { const b = [0, 1].map(i => makeBall(g, i)); return (t, t0) => b.forEach((x, i) => { const k = P(t, t0 + .1 + i * .25, t0 + .9 + i * .25); x.update(i ? 55 : -55, -50 - Math.abs(Math.sin(k * Math.PI * 2)) * 90 * (1 - k), k * 360, 2, k > 0 ? 1 : 0); }); }
      case 'basket': { const b = makeBasket(g), bag = makeBag(g, ...BAGC[0]); g.appendChild(b.front); return (t, t0) => { b.update(0, 60, .8 * E.back(P(t, t0, t0 + .5)), 1); const k = P(t, t0 + .5, t0 + 1.1); bag.update(0, lerp(-260, -50, E.in(k)), k * 300, 1.8, k > 0 && k < 1 ? 1 : k >= 1 ? 1 : 0); }; }
      case 'table': { const tb = makeTable(g); return (t, t0) => tb.update(0, lerp(-1000, -760, E.out(P(t, t0, t0 + .5))), 1, 1); }
      case 'helper': { const a = makePerson(g, HELPO), k = makePerson(g, MAINO);
        return (t, t0) => { const p = E.back(P(t, t0, t0 + .5)); a.update({ x: -40, y: 70, s: .42 * p, t, ra: { t: [30, -30], b: -1, mix: 1 }, look: [1, .4] }); k.update({ x: 50, y: 70, s: .42 * p, t, la: a.handW[1] ? { t: a.handW[1], b: 1, mix: 1 } : [-12, 8], mouth: .3 }); }; }
      default: { const ic = iconG('star', C.orange); g.appendChild(ic); return (t, t0) => ic.setAttribute('transform', `translate(0 -50) scale(${1.6 * E.back(P(t, t0, t0 + .5))}) rotate(${t * 30})`); }
    }
  }
  const tSpark = makeStars(gT, 7, 21);
  function renderTools(t) {
    cards.forEach((c, i) => {
      const t0 = T.cardT[i], k = pop(t, t0, .55);
      const nx = i < nT - 1 ? T.cardT[i + 1] : (T.helpT || T.tools[1]);
      const active = t >= t0 && t < nx, hl = active ? 1 + .05 * Math.sin(P(t, t0, t0 + .6) * Math.PI) : 1;
      c.g.setAttribute('transform', `translate(${c.x} ${490 - (1 - k) * 200}) scale(${k * hl * cs}) rotate(${(1 - k) * -20})`);
      c.g.setAttribute('opacity', P(t, t0, t0 + .12));
      c.glow.setAttribute('stroke', active ? C.orange : '#fff'); c.glow.setAttribute('opacity', active ? .9 : 0);
      c.anim(t, t0);
    });
    if (nT) tSpark.update(t, T.cardT[nT - 1] + .1, cards[nT - 1].x, 490, 1.2);
  }

  // ── GYM ──
  const renderGym = CARDS ? null : WK ? buildWorkoutGym() : buildActivityGym();
  function buildActivityGym() {
  const cam = el('g', {}, ROOT.gym);
  buildRoom(cam, S.setting);
  const gTeacher = makePerson(cam, HELPO);
  const gSurf = makeSurface(cam);
  const gTarget = makeTarget(cam);
  const TGT = S.target === 'cone' ? G.CONE : S.target === 'basket' ? G.BASK : G.HOOP;
  const reticle = el('g', {}, cam);
  el('ellipse', { rx: 175, ry: 62, fill: 'none', stroke: '#fff', 'stroke-width': 6, 'stroke-dasharray': '40 22' }, reticle);
  const targetGlow = el('ellipse', { rx: 80, ry: 40, fill: 'url(#glow)' }, cam);
  const itemGlow = el('ellipse', { rx: 90, ry: 40, fill: 'url(#glow)' }, cam);
  const gKid = makePerson(cam, MAINO);
  const gItems = [0, 1, 2, 3].map(i => makeItem(cam, S.item, i));
  if (gTarget.front) cam.appendChild(gTarget.front);
  const gTongs = makeTongs(cam);
  const tongGlow = el('circle', { r: 70, fill: 'url(#glow)' }, cam);
  const feetArrows = el('g', {}, cam);
  [-1, 1].forEach(s => el('path', { d: `M ${s * 70} -16 L ${s * 110} 0 L ${s * 70} 16 Z M ${s * 40} -6 L ${s * 74} -6 L ${s * 74} 6 L ${s * 40} 6 Z`, fill: C.yellow, stroke: C.navy, 'stroke-width': 4, 'stroke-linejoin': 'round' }, feetArrows));
  const IC = {};
  IC.down = iconBubble(cam, C.blue); arrowIcon(IC.down, false);
  IC.up = iconBubble(cam, C.red); arrowIcon(IC.up, true);
  IC.ok = iconBubble(cam, C.green); el('path', { d: 'M -26 2 L -8 20 L 28 -18', fill: 'none', stroke: '#fff', 'stroke-width': 13, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, IC.ok);
  IC.level = iconBubble(cam, C.orange);
  el('rect', { x: -42, y: -16, width: 84, height: 32, rx: 16, fill: '#fff' }, IC.level);
  el('line', { x1: -12, y1: -16, x2: -12, y2: 16, stroke: C.navy, 'stroke-width': 4 }, IC.level); el('line', { x1: 12, y1: -16, x2: 12, y2: 16, stroke: C.navy, 'stroke-width': 4 }, IC.level);
  const levelBub = el('circle', { r: 9, fill: C.green }, IC.level);
  IC.loop = iconBubble(cam, C.blue);
  const loopArr = el('g', {}, IC.loop);
  [0, 180].forEach(r => { const g = el('g', { transform: `rotate(${r})` }, loopArr); el('path', { d: 'M 30 -6 A 30 30 0 0 0 -20 -22', fill: 'none', stroke: '#fff', 'stroke-width': 11, 'stroke-linecap': 'round' }, g); el('path', { d: 'M -32 -34 L -14 -10 L -38 -6 Z', fill: '#fff' }, g); });
  const gStars = ev.stars.map((_, i) => makeStars(cam, 7, 17 + i));
  const gBursts = ev.bursts.map((_, i) => makeBurst(cam, 13 + i, 120, { power: 1200, spread: 130 }));

  const hop = ev.hop, onSurfT = hop ? hop[1] : -1;
  function sway(t) {
    let a = Math.sin(t * 2.1) * .8 * P(t, onSurfT, onSurfT + .8);
    ev.wob.forEach(([t0, amp]) => { a += wob(t, t0, amp, 1.4, 1.4); });
    return a;
  }
  const tongsOn = t => S.tongs && ev.tongsT != null && t >= ev.tongsT;
  function kidPose(t) {
    const sw = sway(t), sang = S.surface === 'board' ? sw : 0;
    const onS = gSurf.base(G.SX, G.SY, sang);
    let x = onS[0] + Ch.kx.at(t), y = onS[1], onSurf = t >= onSurfT;
    if (!onSurf) { const k = P(t, hop[0], hop[1]); x = lerp(G.KID0[0], onS[0], E.io(k)); y = lerp(G.KID0[1], onS[1], E.io(k)) - Math.sin(k * Math.PI) * 120; }
    let crouch = Ch.crouch.at(t);
    if (hop) { if (t > hop[0] - .25 && t < hop[0]) crouch += 28 * Math.sin(P(t, hop[0] - .25, hop[0]) * Math.PI); if (t > hop[1] && t < hop[1] + .3) crouch += 24 * Math.sin(P(t, hop[1], hop[1] + .3) * Math.PI); }
    const lean = onSurf ? sw * (S.surface === 'board' ? 1 : .4) : 0;
    let bend = Ch.bend.at(t) - (onSurf ? sw * .5 : 0);
    const mix = Ch.mix.at(t), tip = Ch.tip.at(t), open = Ch.open.at(t), bal = Ch.bal.at(t), show = Ch.show.at(t), cheer = Ch.cheer.at(t), lift = Ch.lift.at(t);
    let tAng = Ch.tAng.at(t);
    const base = tongsOn(t) ? [15, 45] : [12, -8];
    let ra = base, la = [-12, 8];
    if (bal > 0) { la = [lerp(-12, -80 - sw * 2, bal), lerp(8, -12, bal)]; if (mix <= 0) ra = [lerp(base[0], 82 - sw * 2, bal), lerp(base[1], 14, bal)]; }
    if (show > 0) { ra = [lerp(ra[0], 130, show), lerp(ra[1], -40, show)]; tAng = lerp(tAng, -40, show); }
    const L = S.tongs ? 108 : 0;
    if (mix > 0) ra = { t: [tip[0] - Math.cos(tAng * D2R) * L, tip[1] - Math.sin(tAng * D2R) * L], b: -1, mix, from: ra };
    for (const [t0, rel] of ev.throws) if (t >= t0 && t < rel + 1.1) ra = [K(t, [[t0, 12], [t0 + .45, -35], [rel, 70, 'in'], [rel + .3, 115, 'out'], [rel + 1.1, 12]]), -10];
    let jumpH = 0; ev.jumps.forEach(([t0, d, h]) => { if (t >= t0 && t < t0 + d) jumpH = Math.max(jumpH, Math.sin(P(t, t0, t0 + d) * Math.PI) * h); });
    if (jumpH > 0 && !ra.t) { const k = clamp(jumpH / 50); ra = [lerp(ra[0], 150, k), lerp(ra[1], 10, k)]; la = [lerp(la[0], -150, k), lerp(la[1], -10, k)]; }
    if (cheer > 0) { ra = [lerp(base[0], 160 + Math.sin(t * 12) * 10, cheer), lerp(base[1], 10, cheer)]; la = [lerp(-12, -160 - Math.sin(t * 12) * 10, cheer), -10]; tAng = lerp(tAng, -70, cheer); }
    const v = Ch.kx.at(t + .05) - Ch.kx.at(t - .05), walking = Math.abs(v) > .5, ph = t * 7;
    const lf = walking ? [Math.max(0, Math.sin(ph)) * .45, Math.max(0, -Math.sin(ph)) * .45] : [0, lift];
    if (walking) y -= Math.abs(Math.sin(ph)) * 6;
    const spread = !onSurf ? 22 : S.surface === 'beam' ? 18 : ev.arrows ? lerp(30, 40, E.io(P(t, ev.arrows[0], ev.arrows[0] + .6))) : 36;
    return { x, y: y - jumpH, s: MS, lean, bend, crouch, spread, la, ra, t, lift: lf, sang, tAng, open,
      look: mix > .3 ? [1, .6] : show > 0 ? [.5, -.5] : [0, 0], mouth: Math.max(cheer * .9, show * .7, jumpH > 0 ? .6 : 0, ev.icons.some(([k, a, b]) => k === 'ok' && t > a && t < a + 1) ? .5 : 0) };
  }
  const ptCache = {};
  function grabPt(time) {         // world point where the held item sits, at a given time
    if (ptCache[time]) return ptCache[time];
    const p = kidPose(time); gKid.update(p); const h = gKid.handW[1];
    const tp = S.tongs ? gTongs.tip(h[0], h[1], p.tAng) : h;
    return (ptCache[time] = [tp[0] + T.off[0], tp[1] + T.off[1]]);
  }
  function teacherPose(t) {
    const tx = Ch.tx.at(t), walking = Math.abs(Ch.tx.at(t + .05) - Ch.tx.at(t - .05)) > .5;
    let la = [-14, 6], ra = [14, -6], mouth = 0;
    if (hop && hop[0] > 0) { const pt = P(t, hop[0] - 1, hop[0] - .6) * (1 - P(t, hop[0] - .1, hop[0] + .3)); if (pt > 0) ra = { t: [G.SX, G.SY - 40], b: -1, mix: E.io(pt), from: ra }; }
    const cheer = Ch.cheer.at(t), spot = Ch.spot.at(t) * (1 - clamp(cheer * 3));
    if (spot > 0) { const s = gKid.shoulderW[0]; ra = { t: [s[0] - 8, s[1] + 80], b: -1, mix: spot, from: ra }; }
    if (cheer > 0) { la = [lerp(-14, -150 + Math.sin(t * 12) * 12, cheer), -20]; ra = [lerp(14, 150 - Math.sin(t * 12) * 12, cheer), 20]; mouth = .7 * cheer; }
    return { x: tx, y: 768 - (walking ? Math.abs(Math.sin(t * 9)) * 14 : 0), s: 1, crouch: Ch.tcrouch.at(t), la, ra, look: [1, .3], t, tilt: Math.sin(t * .8) * 2 + 5, pony: Math.sin(t * 2) * 4, mouth };
  }
  function itemPos(i, t) {
    const it = ev.items[i];
    if (it.grab == null || t < it.grab) return { p: it.grab == null ? [T.INT[i][0] + T.off[0], T.INT[i][1] + T.off[1]] : grabPt(it.grab), rot: 0 };
    if (it.rel == null || t < it.rel) return { p: null, rot: 0 };
    const from = grabPt(it.rel), to = T.slotPos(it.slot), onCone = S.target === 'cone';
    if (it.mode === 'place') {
      const k = E.in(P(t, it.rel, it.rel + .25));
      if (k < 1) return { p: [lerp(from[0], to[0], k), lerp(from[1], to[1], k)], rot: 0, onCone: onCone && k > .6 };
      return { p: to, rot: 0, onCone, sy: 1 - .25 * Math.exp(-14 * (t - it.rel - .25)) * Math.abs(Math.sin((t - it.rel - .25) * 26)) };
    }
    const k = P(t, it.rel, it.rel + .8);
    if (k < 1) return { p: [lerp(from[0], to[0], k), lerp(from[1], to[1], k) - Math.sin(k * Math.PI) * 230], rot: -k * 600 };
    return { p: to, rot: 0, sy: .75 + .25 * (1 - Math.exp(-10 * (t - it.rel - .8))) };
  }
  function renderGym(t) {
    const [zs, zx, zy] = Ch.cam.at(t);
    cam.setAttribute('transform', `translate(960 540) scale(${zs}) translate(${-zx + Math.sin(t * .5) * 6} ${-zy})`);
    ev.items.forEach(it => { if (it.grab != null) grabPt(it.grab); if (it.rel != null) grabPt(it.rel); });
    const kp = kidPose(t);
    gSurf.update(G.SX, G.SY, kp.sang, 1, 1);
    gTarget.update(TGT[0], TGT[1], 1, usesItems ? 1 : 0);
    gKid.update(kp);
    gTeacher.update(teacherPose(t)); gTeacher.g.setAttribute('opacity', showHelper ? 1 : 0);
    const h = gKid.handW[1], tip = S.tongs ? gTongs.tip(h[0], h[1], kp.tAng) : h;
    gTongs.update(h[0], h[1], kp.tAng, kp.open, ev.tongsT > 0 ? pop(t, ev.tongsT, .4) : 1, tongsOn(t) ? 1 : 0);
    set(tongGlow, { cx: h[0] + 40, cy: h[1], r: 80 + 10 * Math.sin(t * 9), opacity: ev.tongsT > 0 ? P(t, ev.tongsT, ev.tongsT + .2) * (1 - P(t, ev.tongsT + 1.6, ev.tongsT + 2)) : 0 });
    let curI = -1;
    gItems.forEach((g, i) => {
      const r = itemPos(i, t); let p = r.p;
      if (!p) { p = [tip[0] + T.off[0], tip[1] + T.off[1]]; curI = i; }
      g.update(p[0], p[1], r.rot, 1, usesItems ? 1 : 0, !!r.onCone, r.sy || 1);
    });
    if (curI >= 0) cam.insertBefore(gItems[curI].g, gTarget.front || gTongs.g);
    const gl = ev.glowItem.reduce((a, [i, t0, t1]) => { const k = P(t, t0, t0 + .4) * (t1 ? 1 - P(t, t1, t1 + .3) : 1); return k > a[0] ? [k, i] : a; }, [0, -1]);
    if (gl[1] >= 0) { const r = itemPos(gl[1], t).p || tip; set(itemGlow, { cx: r[0], cy: r[1] - 8, rx: 90 + 8 * Math.sin(t * 10), opacity: gl[0] }); } else itemGlow.setAttribute('opacity', 0);
    const tg = ev.glowTarget.reduce((a, [t0, t1]) => Math.max(a, P(t, t0, t0 + .4) * (1 - P(t, t1, t1 + .3))), 0);
    set(targetGlow, { cx: TGT[0], cy: TGT[1] + gTarget.top[1], rx: (S.target === 'hoop' ? 150 : 80) + 8 * Math.sin(t * 10), opacity: tg });
    reticle.setAttribute('transform', `translate(${TGT[0]} ${TGT[1]}) rotate(${t * 20}) scale(${S.target === 'hoop' ? tg : 0})`);
    const fa = ev.arrows ? pop(t, ev.arrows[0], .4) * (1 - P(t, ev.arrows[1] - .4, ev.arrows[1])) : 0, fw = ev.arrows ? E.io(P(t, ev.arrows[0], ev.arrows[0] + .6)) : 0;
    feetArrows.setAttribute('transform', `translate(${G.SX} ${G.SY - 30}) scale(${fa})`);
    feetArrows.children.forEach((c, i) => c.setAttribute('transform', `translate(${(i ? 1 : -1) * (fw * 30 + Math.sin(t * 10) * 4)} 0)`));
    const ih = [gKid.headW[0], gKid.headW[1] - 130];
    Object.keys(IC).forEach(k => IC[k].setAttribute('opacity', 0));
    ev.icons.forEach(([k, a, b]) => { if (t < a || t > b) return; const s = pop(t, a, .45) * (1 - P(t, b - .3, b)); IC[k].setAttribute('transform', `translate(${ih[0]} ${ih[1] - 10 * Math.sin(t * 4)}) scale(${s})`); IC[k].setAttribute('opacity', 1); if (k === 'level') set(levelBub, { cx: Math.sin((t - a) * 7) * 26 * Math.exp(-1.6 * (t - a)) }); });
    loopArr.setAttribute('transform', `rotate(${t * 240})`);
    ev.stars.forEach(([t0, k], i) => { const sp = T.slotPos(k); gStars[i].update(t, t0, sp[0], sp[1] - 20, 1.3); });
    ev.bursts.forEach((t0, i) => gBursts[i].update(t, t0, TGT[0], TGT[1] - 260, 2.4));
  }

  return renderGym;
  }
  function buildWorkoutGym() {
    const cam = el('g', {}, ROOT.gym);
    buildRoom(cam, S.setting);
    const mat = makeYogaMat(cam, S.setting === 'fitness_studio' ? '#8e5bff' : '#2f6fe0');
    const X0 = 960, GY = 852;
    const side = makeSide(cam, MAINO), front = makePerson(cam, MAINO);
    const counter = el('g', {}, cam);
    el('circle', { r: 66, fill: C.orange, stroke: '#fff', 'stroke-width': 8 }, counter);
    const cNum = el('text', { x: 0, y: 6, size: 70, weight: 900, fill: '#fff', text: '' }, counter);
    const ring = el('g', {}, cam);
    el('circle', { r: 64, fill: '#fff', stroke: '#e6dcff', 'stroke-width': 14 }, ring);
    const arc = el('circle', { r: 64, fill: 'none', stroke: '#8e5bff', 'stroke-width': 14, 'stroke-linecap': 'round', transform: 'rotate(-90)' }, ring);
    el('circle', { r: 30, fill: 'none', stroke: C.navy, 'stroke-width': 7 }, ring);
    const hand = el('line', { x1: 0, y1: 0, x2: 0, y2: -22, stroke: C.navy, 'stroke-width': 6, 'stroke-linecap': 'round' }, ring);
    el('rect', { x: -8, y: -48, width: 16, height: 10, rx: 3, fill: C.navy }, ring);
    const stars = T.steps.map((_, i) => makeStars(cam, 6, 40 + i));
    const burst = makeBurst(cam, 13, 120, { power: 1200, spread: 130 });
    return function renderWorkout(t) {
      let cur = T.steps[0]; T.steps.forEach(s => { if (t >= s.ts) cur = s; });
      const cheer = t >= T.cheer;
      const m = MOVES[cur.move] || MOVES.stretch, frontal = cheer || m.type === 'front';
      const camV = frontal || !m.floor ? [1.05, 960, 600] : [1.15, 960, 690];
      cam.setAttribute('transform', `translate(960 540) scale(${camV[0]}) translate(${-camV[1] + Math.sin(t * .5) * 5} ${-camV[2]})`);
      mat.update(X0, GY + 14, 0, 1, 1);
      const tl = t - cur.a;
      side.g.setAttribute('opacity', frontal ? 0 : 1); front.g.setAttribute('opacity', frontal ? 1 : 0);
      if (frontal) {
        if (cheer) { const c = E.back(P(t, T.cheer, T.cheer + .4)); front.update({ x: X0, y: GY - Math.abs(Math.sin((t - T.cheer) * 6)) * 30 * c, s: MS * 1.1, t, la: [-160 - Math.sin(t * 12) * 10, -10], ra: [160 + Math.sin(t * 12) * 10, 10], mouth: .9, spread: 34 }); }
        else front.update(Object.assign({ t, spread: 26 }, frontPose(cur.move, tl, X0, GY, MS * 1.1)));
      } else side.update(Object.assign({ mouth: 0 }, movePose(cur.move, tl)), X0, GY, t);
      // rep counter / hold timer, beside the body
      const show = !cheer && t >= cur.te + .3 && tl > -.4 && t < cur.end - .3;
      const pos = [X0 + 430, GY - 330];
      if (show && !cur.hold) {
        const n = Math.min(cur.reps, Math.max(1, Math.floor(Math.max(0, tl) / m.rep) + 1)), f = (Math.max(0, tl) / m.rep) % 1;
        const bump = tl < 0 ? E.back(P(tl, -.4, 0)) : (n < cur.reps || f < .5 ? 1 + .18 * Math.max(0, 1 - f * 4) : 1);
        cNum.setAttribute('text', ['١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩', '١٠'][n - 1] || String(n));
        counter.setAttribute('transform', `translate(${pos[0]} ${pos[1]}) scale(${bump})`); counter.setAttribute('opacity', 1);
      } else counter.setAttribute('opacity', 0);
      if (show && cur.hold) {
        const p = clamp(tl / cur.dur), c = 2 * Math.PI * 64;
        set(arc, { 'stroke-dasharray': `${c * p} ${c}` }); hand.setAttribute('transform', `rotate(${p * 360 * 3})`);
        ring.setAttribute('transform', `translate(${pos[0]} ${pos[1]}) scale(${E.back(P(tl, -.4, 0))})`); ring.setAttribute('opacity', 1);
      } else ring.setAttribute('opacity', 0);
      T.steps.forEach((s, i) => stars[i].update(t, s.a + s.dur - .2, pos[0], pos[1], 1.2));
      burst.update(t, T.cheer, X0, GY - 420, 2.4);
    };
  }

  // ── BENEFITS (kid; tiles are drawn as overlays) ──
  const bKid = makePerson(ROOT.ben, MAINO), bStars = makeStars(ROOT.ben, 7, 23);
  const nB = S.benefits.length, tileH = Math.min(168, (760 - (nB - 1) * 24) / Math.max(1, nB));
  const BCOL = [C.orange, C.blue, '#f2b600', C.red, C.green], BTXT = [C.orange, C.blue, '#c98a00', C.red, C.green];
  const tileY = i => 195 + i * (tileH + 24);
  const benIcons = S.benefits.map((b, i) => iconG(b.icon, BCOL[i % 5]));
  function renderBen(t) {
    const act = T.benT.reduce((a, t0, i) => t >= t0 - .1 ? i : a, -1);
    let ra = [12, -8], la = [-12, 8];
    if (act >= 0) ra = { t: [480, tileY(act) + tileH / 2 + 40], b: 1, mix: E.io(P(t, T.benT[act] - .1, T.benT[act] + .3)) };
    const ch = P(t, T.ben[1] - 1.1, T.ben[1] - .8);
    if (ch > 0) { ra = [lerp(40, 160, ch), 10]; la = [lerp(-12, -160, ch), -10]; }
    bKid.update({ x: 210, y: 1030 - Math.abs(Math.sin(t * 3)) * 8, s: .9 * MS * E.back(P(t, T.ben[0] + .3, T.ben[0] + .8)), la, ra, t, look: act >= 0 ? [1, -.6] : [0, 0], mouth: ch * .8 });
    bStars.update(t, T.ben[1] - 1.05, 210, 600, 1.2);
  }

  // ── OUTRO ──
  const gO = ROOT.outro;
  el('ellipse', { cx: 960, cy: 1070, rx: 1300, ry: 110, fill: '#7cc7f5', opacity: .55 }, gO);
  const oTarget = makeTarget(gO);
  const oItems = [0, 1, 2, 3].map(i => makeItem(gO, S.item, i));
  if (oTarget.front) gO.appendChild(oTarget.front);
  const oTeacher = makePerson(gO, HELPO), oKid = makePerson(gO, MAINO);
  const oHeart = el('path', { d: 'M 0 40 C -70 -6 -46 -66 0 -30 C 46 -66 70 -6 0 40 Z', fill: C.red, stroke: '#fff', 'stroke-width': 8 }, gO);
  const oStars = makeStars(gO, 8, 31), oBurst = makeBurst(gO, 41, 160, { power: 1300, spread: 170, w: 600 }), oRain = makeBurst(gO, 43, 120, { dir: 90, power: 200, spread: 40, w: 1900 });
  function renderOutro(t) {
    const o = T.outro[0], HI5 = o + 2, enter = E.out(P(t, o + .2, o + 1));
    const tx = lerp(-200, 760, enter), kx = lerp(2100, showHelper ? 1160 : (usesItems ? 1220 : 960), enter), ts = 1.1 * pop(t, o + .4, .5);
    oTarget.update(960, 1040, ts, usesItems ? P(t, o + .4, o + .45) : 0);
    oItems.forEach((d, i) => {
      const t0 = o + .7 + i * .15, k = E.out(P(t, t0, t0 + .3));
      const sp = S.target === 'cone' ? [0, slotDy(i)] : S.target === 'basket' ? [(i - 1.5) * 24, -106 - (i % 2) * 6] : [[-40, 34, -6, 48][i], [-6, 8, 12, -4][i]];
      d.update(960 + sp[0] * 1.1, 1040 + sp[1] * 1.1 - (1 - k) * 400, 0, 1.1, usesItems ? P(t, t0, t0 + .05) : 0, S.target === 'cone');
    });
    const jump = Math.max(0, Math.sin(P(t, HI5 - .35, HI5 + .35) * Math.PI)) * 100 + Math.max(0, Math.sin(P(t, o + 4, o + 4.6) * Math.PI)) * 90;
    const reach = showHelper ? E.io(P(t, HI5 - .5, HI5 - .05)) * (1 - E.io(P(t, HI5 + .5, HI5 + .9))) : 0;
    oKid.update({ x: kx, y: 1040 - jump, s: 1.15 * MS, t, la: reach > 0 ? { t: [995, 610], b: 1, mix: reach } : t > o + 4 ? [-160, -10] : [-12, 8], ra: t > o + 4 ? [160, 10] : [12, -8], mouth: Math.max(reach * .8, P(t, o + 4, o + 4.2) * .9, .1), look: [-1, -.4], shadow: 1 - jump / 300 });
    oTeacher.g.setAttribute('opacity', showHelper ? 1 : 0); if (showHelper) oTeacher.update({ x: tx, y: 1040, s: 1.1, t, la: t > o + 4 ? [-150, -10] : [-14, 6], ra: reach > 0 ? { t: [995, 610], b: -1, mix: reach } : [14, -6], look: [1, -.3], tilt: 4, pony: Math.sin(t * 2.4) * 5, mouth: Math.max(reach * .6, P(t, o + 4, o + 4.2) * .6) });
    oHeart.setAttribute('transform', `translate(980 ${470 - 30 * P(t, HI5, HI5 + 1.4)}) scale(${pop(t, HI5, .5) * (1 + .08 * Math.sin(t * 9)) * 1.3})`);
    oHeart.setAttribute('opacity', 1 - P(t, HI5 + 1.2, HI5 + 1.5));
    oStars.update(t, HI5, 995, 610, 1.3); oBurst.update(t, o + 3.6, 960, 420, 2.4); oRain.update(t, o + 3.8, 960, -60, 3.5);
  }

  // ── overlays (drawn straight onto the canvas) ──
  const AR_N = ['١', '٢', '٣', '٤', '٥', '٦'];
  const STEP_C = [C.orange, C.blue, '#e8a400', C.red, C.green, '#8e5bff'];
  const words = S.title.ar.split(/\s+/).filter(Boolean);
  if (words.length > 3) words.splice(2, words.length, words.slice(2).join(' '));
  const WCOL = [C.navy, C.orange, C.blue];
  const SEC = { tools: { ar: 'الأدوات', en: 'Tools', bg: C.yellow, icon: iconG('tools', C.orange) }, ben: { ar: 'الفوائد', en: 'Benefits', bg: '#7be0a5', icon: iconG('dumbbell', C.green) } };
  const helpIcon = iconG('help', C.orange);
  function drawTitle(t, w, en, ban, ts, ty) {
    ctx.save(); ctx.translate(960, ty); ctx.scale(ts, ts); ctx.translate(-960, 0);
    if (ban > 0) { ctx.save(); ctx.translate(960, 205); ctx.scale(ban, ban); box(ctx, -750, -165, 1500, 330, 80, '#d7efff', '#fff', 8, 18); ctx.restore(); }
    font(ctx, 190); const ws = words.map(x => ctx.measureText(x).width), gap = 44, tot2 = ws.reduce((a, b) => a + b, 0) + gap * (ws.length - 1);
    const size = Math.min(190, 190 * 1380 / Math.max(1, tot2)), k = size / 190;
    let x = 960 + tot2 * k / 2;
    words.forEach((wd, i) => {
      const cx = x - ws[i] * k / 2; x -= ws[i] * k + gap * k;
      const a = w[i] == null ? 1 : w[i]; if (a <= 0) return;
      ctx.save(); ctx.translate(cx, 150); ctx.scale(lerp(3, 1, E.out(a)) * (1 + .12 * Math.sin(P(a, .7, 1) * Math.PI)), lerp(3, 1, E.out(a)) * (1 + .12 * Math.sin(P(a, .7, 1) * Math.PI))); ctx.rotate((1 - E.out(a)) * -12 * D2R);
      ctx.globalAlpha = clamp(a * 4);
      text(ctx, wd, 0, 10, { size, color: 'rgba(29,42,110,.18)' }); text(ctx, wd, 0, 0, { size, color: WCOL[i % 3] });
      ctx.restore();
    });
    if (en > 0) { ctx.globalAlpha = en; text(ctx, S.title.en, 960, 300 + (1 - E.out(en)) * 40, { size: 72, w: 800, color: C.orange, maxW: 1380 }); }
    ctx.restore(); ctx.globalAlpha = 1;
  }
  function pillHeader(t, k, sec) {
    if (k <= 0) return;
    ctx.save(); ctx.translate(0, (1 - k) * -220);
    font(ctx, 72); const aw = ctx.measureText(sec.ar).width; font(ctx, 52, 800); const ew = ctx.measureText(sec.en).width;
    const w = 22 + 100 + 26 + aw + 26 + 14 + 26 + ew + 56, x = 960 - w / 2;
    box(ctx, x, 34, w, 124, 62, sec.bg, '#fff', 7, 10);
    let cx = x + w - 22 - 50;
    ctx.save(); ctx.translate(cx, 96); ctx.rotate(Math.sin(t * 3) * 10 * D2R); svgIcon(ctx, sec.icon, 0, 0, 100); ctx.restore();
    cx -= 50 + 26; text(ctx, sec.ar, cx, 92, { size: 72, align: 'right' });
    cx -= aw + 26; ctx.globalAlpha = .5; ctx.fillStyle = C.navy; ctx.beginPath(); ctx.arc(cx - 7, 96, 7, 0, TAU); ctx.fill(); ctx.globalAlpha = .8;
    text(ctx, sec.en, cx - 14 - 26, 94, { size: 52, w: 800, align: 'right' });
    ctx.restore(); ctx.globalAlpha = 1;
  }
  function twoLineBox(x, y, w, ar, en, { arSize = 46, enSize = 34, stroke = C.navy, enColor = C.blue, fill = 'rgba(255,255,255,.96)' } = {}) {
    const h = en ? arSize * 1.35 + enSize * 1.3 + 26 : arSize * 1.35 + 24;
    box(ctx, x, y, w, h, 40, fill, stroke, 6, 10);
    text(ctx, ar, x + w / 2, y + 12 + arSize * .68, { size: arSize, w: 800, maxW: w - 70 });
    if (en) text(ctx, en, x + w / 2, y + 12 + arSize * 1.35 + enSize * .62, { size: enSize, w: 800, color: enColor, maxW: w - 70 });
    return h;
  }
  function renderOverlays(t) {
    // title
    if (t < T.tools[0] + .1 && t > .8) drawTitle(t, [P(t, 1.0, 1.3), P(t, 1.35, 1.65), P(t, 1.7, 2.0)], P(t, 2.1, 2.5), E.back(P(t, .85, 1.3)), 1, 0);
    const o = T.outro[0];
    if (t > o + 3.3) drawTitle(t, [P(t, o + 3.5, o + 3.8), P(t, o + 3.75, o + 4.05), P(t, o + 4.0, o + 4.3)], P(t, o + 4.3, o + 4.7), E.back(P(t, o + 3.35, o + 3.8)), .8, 10);
    // credit («بصمة العمل»): only when a name was written
    const ck0 = S.credit ? E.back(P(t, o + 4.9, o + 5.4)) : 0;
    if (ck0 > 0) {
      const lab = 'هذا العمل من تنسيق', nm = S.credit;
      font(ctx, 38, 700); const lw = ctx.measureText(lab).width; const ns = fitSize(ctx, nm, 900, 46, 900); font(ctx, ns, 900); const nw = ctx.measureText(nm).width;
      const w = lw + nw + 110, x = 960 - w / 2, y = 330;
      ctx.save(); ctx.translate(960, y + 36); ctx.scale(ck0, ck0); ctx.translate(-960, -(y + 36));
      box(ctx, x, y, w, 72, 36, 'rgba(255,255,255,.95)', C.orange, 5, 8);
      text(ctx, '✍️', x + w - 34, y + 38, { size: 32 });
      text(ctx, lab, x + w - 64, y + 38, { size: 38, w: 700, color: C.navy, align: 'right' });
      text(ctx, nm, x + w - 64 - lw - 16, y + 38, { size: ns, color: C.orange, align: 'right' });
      ctx.restore();
    }
    // description
    const dk = t < T.tools[0] ? E.back(P(t, 3.0, 3.5)) * (1 - E.in(P(t, 7.4, 7.8))) : 0;
    if (dk > 0 && S.desc.ar) { ctx.save(); ctx.translate(960, 510); ctx.scale(dk, dk); ctx.translate(-960, -510); twoLineBox(150, 430, 1620, S.desc.ar, S.desc.en, { stroke: C.blue }); ctx.restore(); }
    // level badge
    const lv = t < T.tools[0] ? E.back(P(t, 2.6, 3.1)) * (1 - E.in(P(t, 7.5, 7.9))) : t > o + 4.5 ? E.back(P(t, o + 4.7, o + 5.2)) : 0;
    if (lv > 0 && S.level.ar) {
      ctx.save(); ctx.translate(0, (1 - lv) * 260);
      font(ctx, 50); const w = Math.max(ctx.measureText(S.level.ar).width, (font(ctx, 32, 800), ctx.measureText(S.level.en).width)) + 150;
      box(ctx, 40, 930, w, 112, 34, '#ff6a1a', '#fff', 6, 10);
      [30, 48, 68].forEach((h, i) => { ctx.fillStyle = '#fff'; ctx.fill(rrPath(new Path2D(), 70 + i * 25, 1020 - h, 18, h, 4)); });
      text(ctx, S.level.ar, 40 + w - 30, S.level.en ? 968 : 986, { size: 50, color: '#fff', align: 'right' });
      if (S.level.en) text(ctx, S.level.en, 40 + w - 30, 1012, { size: 32, w: 800, color: '#fff', align: 'right' });
      ctx.restore();
    }
    // section headers
    if (t > T.tools[0] && t < T.gym[0]) pillHeader(t, E.back(P(t, T.tools[0] + .5, T.tools[0] + 1)), SEC.tools);
    if (nB && t > T.ben[0] && t < T.ben[1]) pillHeader(t, E.back(P(t, T.ben[0] + .5, T.ben[0] + 1)), SEC.ben);
    // adult-help ribbon
    if (T.helpT && t > T.helpT - .1 && t < T.gym[0]) {
      const hk = E.back(P(t, T.helpT, T.helpT + .5));
      ctx.save(); ctx.translate(0, (1 - hk) * 260);
      font(ctx, 50); const w = Math.max(ctx.measureText(S.help.ar).width, (font(ctx, 34, 800), ctx.measureText(S.help.en).width)) + 190, x = 960 - w / 2;
      box(ctx, x, 860, w, 130, 50, '#fff6c9', C.orange, 6, 10);
      svgIcon(ctx, helpIcon, x + w - 24 - 48, 925, 96);
      text(ctx, S.help.ar, x + w - 150, S.help.en ? 905 : 925, { size: 50, align: 'right' });
      if (S.help.en) text(ctx, S.help.en, x + w - 150, 953, { size: 34, w: 800, color: C.orange, align: 'right' });
      ctx.restore();
    }
    // benefit tiles
    if (t > T.ben[0] && t < T.ben[1]) S.benefits.forEach((b, i) => {
      const t0 = T.benT[i], k = pop(t, t0, .55); if (k <= 0) return;
      const act = T.benT.reduce((a, x, j) => t >= x - .1 ? j : a, -1) === i;
      const hl = act ? 1 + .03 * Math.sin(P(t, t0, t0 + .5) * Math.PI) : 1, y = tileY(i), R = 1830;
      ctx.save(); ctx.globalAlpha = clamp(P(t, t0, t0 + .12) * (act ? 1 : .85));
      ctx.translate(R + (1 - k) * 300, y + tileH / 2); ctx.scale(k * hl, k * hl); ctx.translate(-R, -(y + tileH / 2));
      box(ctx, R - 1340, y, 1340, tileH, 44, act ? '#fffdf3' : '#fff', BCOL[i % 5], 8, 12);
      const isz = Math.min(124, tileH - 30);
      ctx.save(); ctx.translate(R - 34 - isz / 2, y + tileH / 2); ctx.rotate((1 - E.out(P(t, t0 + .1, t0 + .7))) * -180 * D2R); svgIcon(ctx, benIcons[i], 0, 0, isz * (1 + .06 * Math.sin(t * 4 + i))); ctx.restore();
      const tx = R - 34 - isz - 34, mw = 1340 - isz - 120, arS = Math.min(50, tileH * .32);
      text(ctx, b.ar, tx, y + tileH / 2 - (b.en ? arS * .45 : 0), { size: arS, align: 'right', maxW: mw });
      if (b.en) text(ctx, b.en, tx, y + tileH / 2 + arS * .62, { size: Math.min(36, tileH * .23), w: 800, color: BTXT[i % 5], align: 'right', maxW: mw });
      ctx.restore();
    });
    // steps: wipe, header, dots, caption
    const St = T.steps; let cur = -1; St.forEach((s, i) => { if (t >= s.ts - .45) cur = i; });
    if (cur >= 0 && t < T.gym[1]) {
      const s = St[cur], col = STEP_C[cur % 6];
      const grow = E.out(P(t, s.ts - .45, s.ts)), shrink = E.io(P(t, s.te + .05, s.te + .55));
      const prevShown = cur > 0 && t < s.ts;
      const H = prevShown ? St[cur - 1] : s, gymOn = t >= T.gym[0] - .01;
      if (gymOn || cur > 0) {
        // dots
        const n = St.length, dw = n * 46 + 24;
        box(ctx, 40, 48, dw, 58, 29, 'rgba(255,255,255,.92)', null, 0, 8);
        for (let i = 0; i < n; i++) {
          const on = i <= cur && !(i === cur && t < s.te);
          const sc = i === cur && on ? 1.25 + .1 * Math.sin(t * 6) : 1, cx = 40 + dw - 12 - 23 - i * 46;
          ctx.beginPath(); ctx.arc(cx, 77, 15 * sc, 0, TAU); ctx.fillStyle = i < cur ? C.navy : i === cur && on ? C.orange : 'rgba(255,255,255,.75)'; ctx.fill();
          ctx.lineWidth = 5; ctx.strokeStyle = C.navy; ctx.setLineDash([]); ctx.stroke();
        }
        // header pill
        const vis = prevShown ? 1 - P(t, s.ts - .45, s.ts - .25) : E.back(P(t, s.te + .45, s.te + .85));
        if (vis > 0) {
          font(ctx, 62); const aw = ctx.measureText(H.ar).width; font(ctx, 34, 800); const ew = ctx.measureText(H.en).width;
          const pw = Math.min(1100, Math.max(aw, ew) + 130), right = 1821 - 30;
          ctx.save(); ctx.translate(right, 92); ctx.scale(vis, 1); ctx.globalAlpha = clamp(vis * 3);
          box(ctx, -pw, -60, pw, 120, 60, '#fff', C.navy, 6, 8);
          text(ctx, H.ar, -70, H.en ? -14 : 0, { size: 62, align: 'right', maxW: pw - 110 });
          if (H.en) text(ctx, H.en, -70, 36, { size: 34, w: 800, color: C.orange, align: 'right', maxW: pw - 110 });
          ctx.restore(); ctx.globalAlpha = 1;
        }
        if (!(t < s.te + .5 && !prevShown)) {
          ctx.beginPath(); ctx.arc(1821, 92, 66, 0, TAU); ctx.fillStyle = C.navy; ctx.fill(); ctx.lineWidth = 7; ctx.strokeStyle = '#fff'; ctx.stroke();
          text(ctx, AR_N[H.n] || String(H.n + 1), 1821, 96, { size: 84, color: '#fff' });
        }
        // caption
        const end = cur < St.length - 1 ? St[cur + 1].ts - .5 : (T.cheer && T.cheer > s.ts ? T.cheer - .2 : s.end);
        const ck = prevShown ? 0 : E.back(P(t, s.te + .6, s.te + 1.0)) * (1 - E.in(P(t, end - .3, end)));
        if (ck > 0 && s.capAr) {
          ctx.save(); ctx.globalAlpha = clamp(ck * 2); ctx.translate(960, 1054); ctx.scale(Math.max(ck, .001), Math.max(ck, .001)); ctx.translate(-960, -1054 + (1 - clamp(ck)) * 60);
          const hh = s.capEn ? 46 * 1.35 + 34 * 1.3 + 26 : 46 * 1.35 + 24;
          twoLineBox(180, 1054 - hh, 1560, s.capAr, s.capEn);
          ctx.restore(); ctx.globalAlpha = 1;
        }
      }
      if (t < s.te + .55) {   // wipe circle
        const R0 = 1150 * grow, cx = lerp(960, 1821, shrink), cy = lerp(540, 92, shrink), R = lerp(R0, 66, shrink);
        ctx.beginPath(); ctx.arc(cx, cy, R + lerp(30, 7, shrink), 0, TAU); ctx.fillStyle = `rgba(255,255,255,${.35 + .65 * shrink})`; ctx.fill();
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fillStyle = shrink > .7 ? C.navy : col; ctx.fill();
        ctx.save(); ctx.translate(cx, cy);
        ctx.beginPath(); ctx.arc(0, 0, R * .62 * .78 / 1, 0, TAU); ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fill();
        ctx.beginPath(); ctx.arc(0, 0, R * .62 * .92, 0, TAU); ctx.setLineDash([R * .045, R * .04]); ctx.lineWidth = R * .016; ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.stroke(); ctx.setLineDash([]);
        const sc = E.back(P(t, s.ts - .25, s.ts + .2));
        ctx.rotate((1 - E.out(P(t, s.ts - .25, s.ts + .3))) * -30 * D2R); if (sc > 0) { ctx.scale(sc, sc); text(ctx, AR_N[cur] || String(cur + 1), 0, lerp(30, 6, shrink), { size: lerp(480, 84, shrink), color: '#fff' }); }
        ctx.restore();
      }
    }
    // bands
    [T.tools[0], T.gym[1], T.ben[1]].forEach((b, j) => {
      if (j === 2 && !nB) return;
      if (Math.abs(t - b) >= .5) return; const k = P(t, b - .5, b + .5);
      [C.orange, C.blue, C.yellow].forEach((c, i) => {
        const x = lerp(2200, -1400, E.io(clamp(k * 1.15 - i * .07))) + i * 220;
        ctx.save(); ctx.translate(x + 450, 540); ctx.transform(1, 0, Math.tan(-18 * D2R), 1, 0, 0); ctx.fillStyle = c; ctx.fillRect(-450, -840, 900, 1680); ctx.restore();
      });
    });
  }


  // ── CARD-PICTURES mode: the card's own pictures move (any kind of card) ──
  function buildCards() {
    const img = MEDIA.image, IW = img.naturalWidth || img.width, IH = img.naturalHeight || img.height;
    const full = { sx: 0, sy: 0, sw: IW, sh: IH };
    const crops = S.steps.map(x => boxRect(x.box, IW, IH));
    const fx = el('g'), burst = makeBurst(fx, 41, 160, { power: 1300, spread: 170, w: 600 }), rain = makeBurst(fx, 43, 120, { dir: 90, power: 200, spread: 40, w: 1900 });
    const stepBurst = makeBurst(fx, 13, 120, { power: 1200, spread: 130 }), sparks = T.steps.map((_, i) => makeStars(fx, 6, 60 + i));
    const TINT = ['#ffe3c9', '#d9e8ff', '#fff2b8', '#ffd9d9', '#d6f5e3', '#eadcff', '#ffe0f0', '#dff6ff'];
    // a picture in a white rounded frame; returns its size
    function frame(src, media, cx, cy, maxW, maxH, k, rot = 0, zoom = 1, px = 0, py = 0) {
      if (k <= 0) return null;
      const a = src.sw / src.sh; let w = maxW, h = w / a; if (h > maxH) { h = maxH; w = h * a; }
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot * D2R); ctx.scale(k, k);
      box(ctx, -w / 2 - 14, -h / 2 - 14, w + 28, h + 28, 34, '#fff', null, 0, 16);
      ctx.save(); ctx.clip(rrPath(new Path2D(), -w / 2, -h / 2, w, h, 22));
      ctx.fillStyle = '#fff'; ctx.fillRect(-w / 2, -h / 2, w, h);
      if (media && media.readyState >= 2) drawMedia(ctx, media, null, -w / 2, -h / 2, w, h, 'cover');
      else drawMedia(ctx, img, src, -w / 2, -h / 2, w, h, 'cover', zoom, px, py);
      ctx.restore(); ctx.restore();
      return { w, h };
    }
    function rays(t, x, y, col, op) {
      if (op <= 0) return;
      ctx.save(); ctx.translate(x, y); ctx.rotate(t * .12); ctx.globalAlpha = op; ctx.fillStyle = col;
      for (let i = 0; i < 14; i++) { ctx.rotate(TAU / 14); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-90, -1300); ctx.lineTo(90, -1300); ctx.fill(); }
      ctx.restore(); ctx.globalAlpha = 1;
    }
    function badge(n, x, y, col, k) {
      if (k <= 0) return; ctx.save(); ctx.translate(x, y); ctx.scale(k, k); ctx.rotate(-8 * D2R);
      ctx.beginPath(); ctx.arc(0, 0, 58, 0, TAU); ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 8; ctx.strokeStyle = '#fff'; ctx.stroke();
      text(ctx, ['١', '٢', '٣', '٤', '٥', '٦', '٧', '٨'][n] || String(n + 1), 0, 6, { size: 70, color: '#fff' }); ctx.restore();
    }
    const SC = [C.orange, C.blue, '#e8a400', C.red, C.green, '#8e5bff', '#ff5fa2', '#00a6c8'];
    function intro(t) {
      rays(t, 960, 700, '#ffffff', .35 * P(t, .3, 1));
      const k1 = E.back(P(t, .25, .8)) * (1 - E.in(P(t, 2.7, 3.1)));
      frame(full, null, 960, 715, 1100, 600, k1, Math.sin(t * .8) * 1.5 - 2, 1 + .04 * P(t, .3, 3));
      // preview row of the step pictures
      const n = crops.filter(Boolean).length; let j = 0;
      const cw = Math.min(330, (1700 - (n - 1) * 26) / Math.max(1, n));
      S.steps.forEach((x, i) => {
        const c = crops[i]; if (!c) return;
        const t0 = 3.6 + j * .35, k = E.back(P(t, t0, t0 + .45)) * (1 - E.in(P(t, 7.4, 7.8)));
        const cx = 960 + ((n - 1) / 2 - j) * (cw + 26);
        frame(c, MEDIA.clips && MEDIA.clips[i], cx, 820 + Math.sin(t * 2 + j) * 8, cw - 14, 300, k, (j % 2 ? 3 : -3));
        badge(i, cx + cw / 2 - 30, 680, SC[i % 8], k * .7); j++;
      });
    }
    function steps(t) {
      let cur = T.steps[0]; T.steps.forEach(s => { if (t >= s.ts) cur = s; });
      const i = cur.n, col = SC[i % 8], tl = t - cur.a;
      const g = ctx.createLinearGradient(0, 0, 0, 1080); g.addColorStop(0, TINT[i % 8]); g.addColorStop(1, '#ffffff'); ctx.fillStyle = g; ctx.fillRect(0, 0, 1920, 1080);
      floaters.forEach(f => { const x = ((f.x + f.vx * t) % 2100 + 2100) % 2100 - 90, y = ((f.y + f.vy * t + Math.sin(t + f.ph) * 20) % 1250 + 1250) % 1250 - 85; f.g.setAttribute('transform', `translate(${x} ${y}) rotate(${f.vr * t})`); });
      drawNode(ctx, ROOT.bg, 1);
      rays(t, 960, 520, '#ffffff', .5);
      const k = E.back(P(t, cur.te + .3, cur.te + .8)), src = crops[i] || full, p = clamp(tl / cur.dur);
      const dir = i % 2 ? -1 : 1;
      const f = frame(src, MEDIA.clips && MEDIA.clips[i], 960, 525, 1180, 640, k, Math.sin(t * .7) * 1.2, 1 + .12 * E.io(p), dir * .25 * E.io(p) - dir * .12, .1 * E.io(p) - .05);
      if (f) {
        badge(i, 960 + f.w / 2 + 6, 525 - f.h / 2 + 6, col, E.back(P(t, cur.te + .5, cur.te + 1)));
        // pointing hand that taps the picture
        const hx = 960 - f.w / 2 + 40, hy = 525 + f.h / 2 - 10 - Math.abs(Math.sin(t * 4)) * 26, hk = E.back(P(t, cur.a + .4, cur.a + .9)) * (1 - P(t, cur.end - .6, cur.end - .3));
        if (hk > 0) { ctx.save(); ctx.translate(hx, hy); ctx.scale(hk, hk); ctx.rotate(-25 * D2R); text(ctx, '👆', 0, 0, { size: 96 }); ctx.restore(); }
        sparks[i].update(t, cur.a + .2, 960 + f.w / 2 - 40, 525 - f.h / 2 + 40, 1.4);
      }
      // keep any Veo clip roughly in step with the timeline
      const v = MEDIA.clips && MEDIA.clips[i];
      if (v && v.readyState >= 1) { const want = Math.max(0, tl) % Math.max(.1, v.duration || 8); if (Math.abs(v.currentTime - want) > .3) { try { v.currentTime = want; } catch (e) {} } }
      stepBurst.update(t, T.cheer, 960, 420, 2.4);
      drawNode(ctx, fx, 1);
    }
    function outro(t) {
      const o = T.outro[0];
      rays(t, 960, 700, '#ffffff', .4);
      frame(full, null, 960, 700, 1000, 560, E.back(P(t, o + .3, o + .9)), Math.sin(t * .8) * 1.5, 1);
      burst.update(t, o + 3.6, 960, 420, 2.4); rain.update(t, o + 3.8, 960, -60, 3.5);
      drawNode(ctx, fx, 1);
    }
    return { intro, steps, outro, toolCrop: tool => boxRect(tool.box, IW, IH, .01) };
  }

  const CR = CARDS ? buildCards() : null;
  T.items = usesItems;
  // ── main ──
  function sceneAt(t) { return t < T.tools[0] ? 'intro' : t < T.gym[0] ? 'tools' : t < T.gym[1] ? 'gym' : t < T.ben[1] ? 'ben' : 'outro'; }
  function render(t) {
    t = clamp(t, 0, T.DUR);
    const W = canvas.width, Hh = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.clearRect(0, 0, W, Hh);
    ctx.setTransform(W / 1920, 0, 0, Hh / 1080, 0, 0);
    const sc = sceneAt(t);
    const own = CARDS && sc !== 'tools';
    if (sc === 'gym') { if (CARDS) CR.steps(t); else renderGym(t); }
    else {
      const [a, b] = BG[sc], gr = ctx.createLinearGradient(0, 0, 0, 1080); gr.addColorStop(0, a); gr.addColorStop(1, b);
      ctx.fillStyle = gr; ctx.fillRect(0, 0, 1920, 1080);
      floaters.forEach(f => { const x = ((f.x + f.vx * t) % 2100 + 2100) % 2100 - 90, y = ((f.y + f.vy * t + Math.sin(t + f.ph) * 20) % 1250 + 1250) % 1250 - 85; f.g.setAttribute('transform', `translate(${x} ${y}) rotate(${f.vr * t})`); });
      drawNode(ctx, ROOT.bg, 1);
      if (own) { if (sc === 'intro') CR.intro(t); else if (sc === 'outro') CR.outro(t); }
      else ({ intro: renderIntro, tools: renderTools, ben: renderBen, outro: renderOutro })[sc](t);
    }
    if (!own) drawNode(ctx, ROOT[sc], 1);
    if (sc !== 'gym') { const v = ctx.createRadialGradient(960, 540, 600, 960, 540, 1150); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.2)'); ctx.fillStyle = v; ctx.fillRect(0, 0, 1920, 1080); }
    renderOverlays(t);
  }
  return { DUR: T.DUR, T, S, render, mode: CARDS ? 'cards' : WK ? 'workout' : 'activity', music: () => synthMusic(T, 32000, spec.music || {}) };
}

// ───────────── original background music (120 BPM, C–G–Am–F) + sound effects ─────────────
function synthMusic(T, SR = 32000, mo = {}) {
  const TN = 8192, TB = new Float32Array(TN); for (let i = 0; i < TN; i++) TB[i] = Math.sin(i / TN * TAU);
  const SN = c => TB[((c * TN) | 0) & (TN - 1)];   // sin(TAU * c) by table lookup (fast on phones)
  const DUR = T.DUR, N = Math.ceil(SR * DUR), L = new Float32Array(N), R = new Float32Array(N);
  const NOTE = n => { const m = /^([A-G])(#?)(\d)$/.exec(n); const k = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] ? 1 : 0); return 440 * Math.pow(2, (k + (+m[3] + 1) * 12 - 69) / 12); };
  let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff * 2 - 1; };
  function add(t0, dur, amp, pan, fn) {
    const s0 = Math.max(0, Math.round(t0 * SR)), s1 = Math.min(N, Math.round((t0 + dur) * SR));
    const gl = Math.cos((pan + 1) * Math.PI / 4) * amp, gr = Math.sin((pan + 1) * Math.PI / 4) * amp;
    for (let i = s0; i < s1; i++) { const v = fn((i - s0) / SR); L[i] += v * gl; R[i] += v * gr; }
  }
  const env = (t, a, d) => Math.min(1, t / a) * Math.exp(-t / d);
  const marimba = (t0, f, amp = .2, pan = 0) => add(t0, 1.2, amp, pan, t => env(t, .004, .28) * (SN(f * t) + .25 * SN(f * 4 * t) * Math.exp(-t * 18)));
  const bell = (t0, f, amp = .08, pan = 0) => add(t0, 2.5, amp, pan, t => env(t, .002, .7) * (SN(f * t) + .35 * SN(f * 2.76 * t) * Math.exp(-t * 3) + .15 * SN(f * 5.4 * t) * Math.exp(-t * 8)));
  const bass = (t0, f, dur, amp = .28) => add(t0, dur, amp, 0, t => Math.min(1, t / .01) * Math.min(1, (dur - t) / .05) * Math.exp(-t * 1.2) * (SN(f * t) + .3 * SN(f * 2 * t) + .12 * SN(f * 3 * t)));
  const pad = (t0, fs, dur, amp = .05) => fs.forEach((f, j) => add(t0, dur, amp, j % 2 ? .4 : -.4, t => Math.min(1, t / .4) * Math.min(1, (dur - t) / .4) * (SN(f * t) + .3 * SN(f * 2.006 * t) + .15 * SN(f * 3 * t))));
  const kick = (t0, amp = .55) => add(t0, .35, amp, 0, t => Math.exp(-t * 14) * SN(45 * t + 75 / 22 * (1 - Math.exp(-t * 22))));
  function noise(t0, dur, amp, pan, dec, hp = .85) { let prev = 0, y = 0; add(t0, dur, amp, pan, t => { const x = rnd(); y = hp * (y + x - prev); prev = x; return y * Math.exp(-t / dec); }); }
  const snare = (t0, amp = .16) => { noise(t0, .25, amp, .1, .07, .6); add(t0, .15, amp * .8, 0, t => Math.exp(-t * 30) * SN(190 * t)); };
  const hat = (t0, amp = .05, pan = .3) => noise(t0, .08, amp, pan, .018, .97);
  function whoosh(tEnd, dur = .9, amp = .14) { let y = 0; add(tEnd - dur, dur + .25, amp, 0, t => { const k = Math.min(1, t / dur); y += (.02 + .5 * k * k) * (rnd() - y); return y * (t < dur ? k * k : Math.exp(-(t - dur) * 14)); }); }
  const popS = (t0, amp = .16) => add(t0, .18, amp, 0, t => Math.exp(-t * 26) * Math.sin(TAU * (380 * t + 900 * t * t)));
  const ding = t0 => { bell(t0, NOTE('C7'), .1, .3); bell(t0 + .09, NOTE('G7'), .07, -.3); };
  const chime = t0 => [0, .08, .16].forEach((d, i) => bell(t0 + d, NOTE(['E6', 'G6', 'C7'][i]), .07, (i - 1) * .4));

  const pluck = (t0, f, amp, len) => add(t0, Math.min(1.2, len + .4), amp, -.1, t => env(t, .003, .18) * (SN(f * t) + .5 * SN(f * 2 * t) * Math.exp(-t * 10) + .3 * SN(f * 3 * t) * Math.exp(-t * 16)));
  const piano = (t0, f, amp) => add(t0, 2.2, amp, -.1, t => env(t, .004, .9) * (SN(f * t) + .4 * SN(f * 2 * t) * Math.exp(-t * 2.5) + .15 * SN(f * 3 * t) * Math.exp(-t * 4)));
  // ── composition: a mood + a seed → different music for every video ──
  let ms = ((mo.seed || 7) >>> 0) || 7; ms = Math.imul(ms ^ (ms >>> 16), 0x45d9f3b) >>> 0; ms = Math.imul(ms ^ (ms >>> 16), 0x45d9f3b) >>> 0; const rr = () => { ms = (Math.imul(ms, 1664525) + 1013904223) >>> 0; return ms / 4294967296; };
  const MOODS = {
    cheerful: { bpm: 120, prog: [[0, 1], [7, 1], [9, 0], [5, 1]], lead: 'marimba', drums: 2, bass: 1, pad: 1, bells: 1 },
    calm: { bpm: 84, prog: [[0, 1], [9, 0], [5, 1], [7, 1]], lead: 'bell', drums: 0, bass: .6, pad: 1.4, bells: 0 },
    energetic: { bpm: 128, prog: [[9, 0], [5, 1], [0, 1], [7, 1]], lead: 'pluck', drums: 3, bass: 1.15, pad: .8, bells: 0 },
    inspiring: { bpm: 100, prog: [[0, 1], [7, 1], [9, 0], [5, 1]], lead: 'piano', drums: 1, bass: .8, pad: 1.3, bells: 1 },
    modern: { bpm: 110, prog: [[2, 0], [7, 1], [0, 1], [9, 0]], lead: 'pluck', drums: 2, bass: .9, pad: .9, bells: 0 },
  };
  const M = Object.assign({}, MOODS[mo.mood] || MOODS.cheerful);
  // genre: instruments, groove and scale — from the seed unless given (🔀🎵 re-rolls it too)
  const GENRES = ['pop', 'lofi', 'arabic', 'cinematic', 'electro', 'acoustic'];
  const GEN = GENRES.includes(mo.genre) ? mo.genre : GENRES[Math.floor(rr() * GENRES.length)];
  if (GEN === 'lofi') { M.bpm *= .74; M.lead = 'epiano'; M.drums = Math.min(M.drums || 1, 2); }
  if (GEN === 'arabic') { M.lead = 'oud'; M.drums = Math.max(1, M.drums); M.prog = [[0, 1], [1, 1], [0, 1], [10, 0]]; }
  if (GEN === 'cinematic') { M.bpm *= .82; M.lead = 'piano'; M.pad = 1.8; M.bells = 1; }
  if (GEN === 'electro') { M.bpm = Math.max(118, M.bpm); M.lead = 'pluck'; M.drums = 3; M.bass = 1.2; }
  if (GEN === 'acoustic') { M.lead = 'guitar'; M.drums = Math.min(M.drums || 1, 1.5); }
  const KEY = mo.key != null ? mo.key : [0, 2, -3, 5, -2, 3][Math.floor(rr() * 6)];
  const prog = M.prog.slice(); if (rr() < .5) { prog.push(prog.shift()); prog.push(prog.shift()); }
  const BEAT = 60 / M.bpm, BAR = BEAT * 4;
  const hz = m => 440 * Math.pow(2, (m - 69) / 12);
  const chordOf = ([r, maj]) => [r, r + (maj ? 4 : 3), r + 7].map(x => 60 + KEY + x);
  const SCALE = GEN === 'arabic' ? [0, 1, 4, 5, 7] : [0, 2, 4, 7, 9], scaleNote = i => 72 + KEY + SCALE[((i % 5) + 5) % 5] + 12 * Math.floor(i / 5);
  const RHY = [[1, .5, .5, 1, 1], [.5, .5, 1, .5, .5, 1], [1.5, .5, 1, 1], [1, 1, .5, .5, 1], [.5, .5, .5, .5, 2], [2, 1, 1]];
  function phrase() {                           // 4 bars of melody: [beat offset, midi note, length in beats]
    const out = []; let idx = 2 + Math.floor(rr() * 5);
    for (let b = 0; b < 4; b++) {
      const r = b === 3 ? [1, 1, 2] : RHY[Math.floor(rr() * RHY.length)], bar = []; let o = 0;
      r.forEach((d, j) => { idx = Math.max(0, Math.min(9, idx + Math.floor(rr() * 5) - 2)); if (b === 3 && j === r.length - 1) idx = 5; bar.push([o, scaleNote(idx), d]); o += d; });
      out.push(bar);
    }
    return out;
  }
  const A = phrase(), B = phrase();
  const epiano = (t0, f, amp) => add(t0, 2, amp * .9, -.1, t => Math.min(1, t / .01) * Math.exp(-t * 1.4) * (SN(f * t) * (1 + .25 * SN(5 * t)) + .25 * SN(f * 2 * t) * Math.exp(-t * 4) + .08 * SN(f * 7 * t) * Math.exp(-t * 12)));
  const oud = (t0, f, amp, len) => add(t0, Math.min(1.4, len + .5), amp * .8, -.1, t => { const g = f * (1 - .03 * Math.exp(-t * 30)); return env(t, .002, .22) * (SN(g * t) + .55 * SN(g * 2 * t) * Math.exp(-t * 6) + .35 * SN(g * 3 * t) * Math.exp(-t * 9) + .2 * SN(g * 5 * t) * Math.exp(-t * 14)); });
  const guitar = (t0, f, amp, len) => add(t0, Math.min(1.6, len + .6), amp * .75, -.15, t => env(t, .002, .45) * (SN(f * t) + .6 * SN(f * 2 * t) * Math.exp(-t * 3) + .4 * SN(f * 3 * t) * Math.exp(-t * 5) + .2 * SN(f * 4 * t) * Math.exp(-t * 8)));
  const doum = (t0, a = .5) => add(t0, .4, a, 0, t => Math.exp(-t * 11) * SN(95 * t + 40 / 15 * (1 - Math.exp(-t * 15))));
  const tek = (t0, a = .18, pan = .15) => { add(t0, .08, a, pan, t => Math.exp(-t * 55) * SN(720 * t)); noise(t0, .06, a * .6, pan, .012, .9); };
  const lead = (t0, f, amp, len) => M.lead === 'epiano' ? epiano(t0, f, amp) : M.lead === 'oud' ? oud(t0, f, amp, len) : M.lead === 'guitar' ? guitar(t0, f, amp, len) : M.lead === 'bell' ? bell(t0, f, amp * .55, .1) : M.lead === 'pluck' ? pluck(t0, f, amp * .8, len) : M.lead === 'piano' ? piano(t0, f, amp) : marimba(t0, f, amp, -.15);
  const END = Math.min(DUR - 2, Math.ceil((T.outro[0] + 3.4) / BAR) * BAR);
  const secs = [
    { to: 4, pad: .05, bass: 0, drums: 0, mel: 'B', melAmp: .16, bell: .05 },
    { to: T.tools[0], pad: .045, bass: .22, drums: 1, drumAmp: .7, mel: 'A', melAmp: .18, bell: .04 },
    { to: T.gym[0], pad: .04, bass: .24, drums: 1, drumAmp: 1, mel: 'A', melAmp: .18 },
    { to: T.gym[1], pad: .045, bass: .2, drums: 1, drumAmp: .6, mel: 'AB', melAmp: .13 },
    { to: T.ben[1], pad: .04, bass: .24, drums: 1, drumAmp: .9, mel: 'B', melAmp: .17, bell: .03 },
    { to: 1e9, pad: .045, bass: .26, drums: 1, drumAmp: 1, mel: 'A', melAmp: .2, bell: .05 },
  ];
  for (let b = 0; b * BAR < END; b++) {
    const t0 = b * BAR, notes = chordOf(prog[b % 4]), sec = secs.find(x => t0 < x.to);
    pad(t0, notes.map(hz), BAR + .3, sec.pad * M.pad);
    if (sec.bass && M.bass) for (let k = 0; k < 4; k++) bass(t0 + k * BEAT, hz(notes[0] - 24) * (k === 2 && M.drums ? 1.5 : 1), BEAT * .9, sec.bass * M.bass);
    const dl = sec.drums * M.drums;
    if (dl && GEN === 'lofi') for (let k = 0; k < 8; k++) {
      const tt = t0 + k * BEAT / 2 + (k % 2 ? BEAT * .09 : 0);
      if (k === 0 || k === 5) kick(tt, .42 * sec.drumAmp); if (k === 2 || k === 6) snare(tt, .09 * sec.drumAmp); hat(tt, .028 * sec.drumAmp, k % 2 ? .3 : -.2);
      if (k === 0) noise(t0, BAR, .006, 0, 9, .5);
    } else if (dl && GEN === 'arabic') for (let k = 0; k < 8; k++) {
      const tt = t0 + k * BEAT / 2;
      if (k === 0 || k === 4) doum(tt, .5 * sec.drumAmp); if (k === 1 || k === 3 || k === 6) tek(tt, .16 * sec.drumAmp, k % 2 ? .2 : -.2);
      hat(tt + BEAT / 4, .018 * sec.drumAmp, .35);
    } else if (dl && GEN === 'cinematic') {
      kick(t0, .7 * sec.drumAmp); add(t0, 1.6, .22 * sec.drumAmp, 0, t => Math.exp(-t * 2.5) * SN(55 * t)); if (dl > 1) { kick(t0 + BEAT * 2.5, .5 * sec.drumAmp); kick(t0 + BEAT * 3, .45 * sec.drumAmp); }
      for (let k = 0; k < 8; k++) pluck(t0 + k * BEAT / 2, hz(notes[0] - 12 + (k % 2 ? 12 : 0)), .045 * sec.drumAmp, BEAT / 2);
    } else if (dl && GEN === 'electro') for (let k = 0; k < 8; k++) {
      const tt = t0 + k * BEAT / 2;
      if (k % 2 === 0) kick(tt, .55 * sec.drumAmp); if (k === 2 || k === 6) snare(tt, .12 * sec.drumAmp);
      if (k % 2) { noise(tt, .2, .05 * sec.drumAmp, .3, .07, .97); bass(tt, hz(notes[0] - 24), BEAT * .45, .16 * sec.drumAmp); }
    } else if (dl && GEN === 'acoustic') for (let k = 0; k < 16; k++) {
      const tt = t0 + k * BEAT / 4;
      hat(tt, (k % 4 === 2 ? .03 : .015) * sec.drumAmp, .25); if (k === 0 || k === 10) kick(tt, .35 * sec.drumAmp); if (k === 8) snare(tt, .07 * sec.drumAmp);
      if (k % 2 === 0) guitar(tt, hz(notes[(k / 2) % 3] + (k % 8 === 4 ? 12 : 0)), .045 * sec.drumAmp, BEAT / 2);
    } else if (dl) for (let k = 0; k < 8; k++) {
      const tt = t0 + k * BEAT / 2;
      if (dl >= 3 ? k % 2 === 0 : (k % 4 === 0 || (dl > 1 && k === 7))) kick(tt, .5 * sec.drumAmp);
      if (dl >= 2 && (k === 2 || k === 6)) snare(tt, .13 * sec.drumAmp);
      hat(tt, (k % 2 ? .035 : .05) * sec.drumAmp, k % 2 ? .35 : -.2);
      if (dl >= 3) hat(tt + BEAT / 4, .025 * sec.drumAmp, .3);
    } else if (sec.drums && b % 2 === 0) bell(t0, hz(notes[2] + 12), .03, .3);
    const ph = sec.mel === 'A' ? A : sec.mel === 'B' ? B : (Math.floor(b / 4) % 2 ? B : A);
    ph[b % 4].forEach(([o, m, d]) => { lead(t0 + o * BEAT, hz(m), sec.melAmp, d * BEAT); if (sec.bell && M.bells) bell(t0 + o * BEAT, hz(m) * 2, sec.bell, .2); });
  }
  const fin = chordOf(prog[0]);
  kick(END, M.drums ? .6 : .25); noise(END, 2.5, .08, 0, .6, .9); bass(END, hz(fin[0] - 24), 3.5, .3);
  [...fin, fin[0] + 12].forEach((m, i) => { lead(END + i * .06, hz(m + 12), .18, 2); bell(END + i * .06, hz(m + 24), .07, (1.5 - i) * .3); });
  pad(END, [...fin, fin[0] + 12].map(hz), DUR - END, .05);
  // effects synced to the picture
  const ev = T.ev, usesItems = T.items !== undefined ? T.items : T.S.steps.some(x => ['squat', 'pick', 'place', 'throw', 'repeat'].includes(x.action));
  [T.tools[0], T.gym[1], ...(T.S.benefits.length ? [T.ben[1]] : []), ...T.steps.map(s => s.ts)].forEach(t => whoosh(t));
  [...(usesItems ? [5.2, 5.4, 5.6, 5.8, 6.1] : []), ...T.cardT, ...(T.helpT ? [T.helpT] : []), ...ev.pops, ...T.benT].forEach(t => popS(t));
  ev.dings.forEach(ding);
  [1.0, ...ev.bursts, T.outro[0] + 3.5].forEach(chime);
  let peak = 0;
  for (let i = 0; i < N; i++) { const t = i / SR, g = Math.min(1, t / .3) * Math.min(1, (DUR - t) / 1.5); L[i] = Math.tanh(L[i] * 1.1) * g; R[i] = Math.tanh(R[i] * 1.1) * g; peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); }
  const gain = .85 / (peak || 1); for (let i = 0; i < N; i++) { L[i] *= gain; R[i] *= gain; }
  return { sr: SR, L, R, genre: GEN };
}

global.VideoEngine = { create, normalize, normExplainer, normPromo, PTYPES, PVIS, ACTIONS, TOOL_KINDS, BEN_ICONS, MOVES, XTYPES };
})(typeof window !== 'undefined' ? window : globalThis);
