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
const buildRoom = (cam, setting) => setting === 'fitness_studio' ? buildStudio(cam) : buildKidsRoom(cam);
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
    const dur = hold ? 7 : Math.max(6.5, n * m.rep);
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
    const dur = Math.max(4.6, Math.min(8.5, 3.2 + words * .32));
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
    template, setting: ['kids_gym', 'fitness_studio'].includes(s.setting) ? s.setting : (template === 'workout' ? 'fitness_studio' : 'kids_gym'),
    chars: { main: mainC, helper: helpC }, exercises,
    title: pair(s.title), desc: pair(s.desc), level: pair(s.level), help: pair(s.help), credit: str(s.credit),
    surface, item, target, tongs: !!su.tongs, helper: su.helper !== false,
    steps,
    tools: (Array.isArray(s.tools) ? s.tools : []).slice(0, 6).map(x => ({ ar: str(x.ar || x), en: str(x.en), kind: TOOL_KINDS.includes(x.kind) ? x.kind : 'other', box: Array.isArray(x.box) ? x.box.map(Number) : null })),
    mode: ['auto', 'cards', 'cartoon'].includes(s.mode) ? s.mode : 'auto', animatable: s.animatable !== false,
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
    const end = Math.max(e + .6, ts + 4.5);
    T.steps.push(Object.assign({}, st, { n: k, ts, te: ts + .8, end }));
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

// ───────────── engine ─────────────
function create(canvas, spec) {
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
  return { DUR: T.DUR, T, S, render, mode: CARDS ? 'cards' : WK ? 'workout' : 'activity', music: () => synthMusic(T) };
}

// ───────────── original background music (120 BPM, C–G–Am–F) + sound effects ─────────────
function synthMusic(T, SR = 32000) {
  const TN = 8192, TB = new Float32Array(TN); for (let i = 0; i < TN; i++) TB[i] = Math.sin(i / TN * TAU);
  const SN = c => TB[((c * TN) | 0) & (TN - 1)];   // sin(TAU * c) by table lookup (fast on phones)
  const DUR = T.DUR, N = Math.ceil(SR * DUR), L = new Float32Array(N), R = new Float32Array(N);
  const BEAT = .5, BAR = 2;
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

  const CH = [['C3', ['C4', 'E4', 'G4']], ['G2', ['B3', 'D4', 'G4']], ['A2', ['C4', 'E4', 'A4']], ['F2', ['C4', 'F4', 'A4']]];
  const A = [[[0, 'E5', .5], [.5, 'G5', .5], [1, 'C6', 1], [2, 'G5', .5], [2.5, 'E5', .5], [3, 'G5', 1]],
    [[0, 'D5', .5], [.5, 'G5', .5], [1, 'B5', 1], [2, 'A5', .5], [2.5, 'G5', .5], [3, 'D5', 1]],
    [[0, 'E5', .5], [.5, 'A5', .5], [1, 'C6', 1], [2, 'B5', .5], [2.5, 'A5', .5], [3, 'E5', 1]],
    [[0, 'F5', .5], [.5, 'A5', .5], [1, 'C6', .5], [1.5, 'A5', .5], [2, 'G5', 2]]];
  const B = [[[0, 'C6', 1.5], [1.5, 'G5', .5], [2, 'E5', 2]], [[0, 'D5', .5], [.5, 'E5', .5], [1, 'G5', 1], [2, 'B5', 2]],
    [[0, 'C6', 1], [1, 'B5', .5], [1.5, 'A5', .5], [2, 'E5', 2]], [[0, 'F5', 1], [1, 'A5', 1], [2, 'G5', 2]]];
  const END = Math.min(DUR - 2, Math.ceil((T.outro[0] + 3.4) / BAR) * BAR);
  const secs = [
    { to: 4, pad: .05, bass: 0, drums: 0, mel: 'B', melAmp: .16, bell: .05 },
    { to: T.tools[0], pad: .045, bass: .22, drums: 1, drumAmp: .7, mel: 'A', melAmp: .18, bell: .04 },
    { to: T.gym[0], pad: .04, bass: .24, drums: 2, drumAmp: 1, mel: 'A', melAmp: .18 },
    { to: T.gym[1], pad: .045, bass: .2, drums: 1, drumAmp: .6, mel: 'AB', melAmp: .13 },
    { to: T.ben[1], pad: .04, bass: .24, drums: 2, drumAmp: .9, mel: 'B', melAmp: .17, bell: .03 },
    { to: 1e9, pad: .045, bass: .26, drums: 2, drumAmp: 1, mel: 'A', melAmp: .2, bell: .05 },
  ];
  for (let b = 0; b * BAR < END; b++) {
    const t0 = b * BAR, [root, chord] = CH[b % 4], sec = secs.find(s => t0 < s.to);
    pad(t0, chord.map(NOTE), BAR + .3, sec.pad);
    if (sec.bass) for (let k = 0; k < 4; k++) bass(t0 + k * BEAT, NOTE(root) * (k === 2 ? 1.5 : 1), BEAT * .9, sec.bass);
    if (sec.drums) for (let k = 0; k < 8; k++) {
      const tt = t0 + k * BEAT / 2;
      if (k % 4 === 0 || (sec.drums > 1 && k === 7)) kick(tt, .5 * sec.drumAmp);
      if (k === 2 || k === 6) snare(tt, .13 * sec.drumAmp);
      hat(tt, (k % 2 ? .035 : .05) * sec.drumAmp, k % 2 ? .35 : -.2);
    }
    const ph = sec.mel === 'A' ? A : sec.mel === 'B' ? B : (Math.floor(b / 4) % 2 ? B : A);
    ph[b % 4].forEach(([o, n]) => { marimba(t0 + o * BEAT, NOTE(n), sec.melAmp, -.15); if (sec.bell) bell(t0 + o * BEAT, NOTE(n) * 2, sec.bell, .2); });
  }
  kick(END, .6); noise(END, 2.5, .08, 0, .6, .9); bass(END, NOTE('C3'), 3.5, .3);
  ['C5', 'E5', 'G5', 'C6'].forEach((n, i) => { marimba(END + i * .06, NOTE(n), .18, (i - 1.5) * .3); bell(END + i * .06, NOTE(n) * 2, .07, (1.5 - i) * .3); });
  pad(END, ['C4', 'E4', 'G4', 'C5'].map(NOTE), DUR - END, .05);
  // effects synced to the picture
  const ev = T.ev, usesItems = T.items !== undefined ? T.items : T.S.steps.some(x => ['squat', 'pick', 'place', 'throw', 'repeat'].includes(x.action));
  [T.tools[0], T.gym[1], ...(T.S.benefits.length ? [T.ben[1]] : []), ...T.steps.map(s => s.ts)].forEach(t => whoosh(t));
  [...(usesItems ? [5.2, 5.4, 5.6, 5.8, 6.1] : []), ...T.cardT, ...(T.helpT ? [T.helpT] : []), ...ev.pops, ...T.benT].forEach(t => popS(t));
  ev.dings.forEach(ding);
  [1.0, ...ev.bursts, T.outro[0] + 3.5].forEach(chime);
  let peak = 0;
  for (let i = 0; i < N; i++) { const t = i / SR, g = Math.min(1, t / .3) * Math.min(1, (DUR - t) / 1.5); L[i] = Math.tanh(L[i] * 1.1) * g; R[i] = Math.tanh(R[i] * 1.1) * g; peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); }
  const gain = .85 / (peak || 1); for (let i = 0; i < N; i++) { L[i] *= gain; R[i] *= gain; }
  return { sr: SR, L, R };
}

global.VideoEngine = { create, normalize, ACTIONS, TOOL_KINDS, BEN_ICONS, MOVES };
})(typeof window !== 'undefined' ? window : globalThis);
