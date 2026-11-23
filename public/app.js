// Claude Code Office: every session is a room, the main agent sits at the lead's desk,
// subagents sit at the desks in front. State comes from /api/state every 2 seconds.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { STRINGS, pickLanguage } from './i18n.js';

// ---------------------------------------------------------------- constants
const STATUS = {
  tool:     { color: '#34d399', icon: '' },
  thinking: { color: '#60a5fa', icon: '…' },
  waiting:  { color: '#fbbf24', icon: '!' },
  blocked:  { color: '#f87171', icon: '?' },
  done:     { color: '#9ca3af', icon: '✓' },
  away:     { color: '#6b7280', icon: 'z' },
};
const STATUS_ORDER = ['tool', 'thinking', 'waiting', 'blocked', 'done', 'away'];
const TYPE_COLOR = {
  'general-purpose': 0x2f9e8f, Explore: 0x7c5cd6, Plan: 0xe07b39,
  'workflow-subagent': 0xd6457a, fork: 0x5b8def,
};
const PALETTE = [0x2f9e8f, 0x7c5cd6, 0xe07b39, 0xd6457a, 0x4c8bf5, 0x8a6d3b, 0x3f8f4f, 0xb5523b];
const SKIN = [0xf1c9a5, 0xe0ac7e, 0xc68a5e, 0x9c6a43, 0xf5d6bc];
const HAIR = [0x2b2118, 0x4a3426, 0x7a5638, 0xb88b4a, 0x1c1c1c, 0x8c8c8c];
const CARPET = [0xdfe7f1, 0xe7efe2, 0xf1e6dc, 0xeae3f2, 0xe3eef0, 0xf3e9d7];
const DESK_DX = 2.9, DESK_DZ = 3.0, ROW_MAX_WIDTH = 90, ROOM_GAP = 7;

const hash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shortModel = (m) => (m ? m.replace(/^claude-/, '') : '');
const kfmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 1e5 ? 0 : 1)}k` : String(n || 0));
const easeOut = (x) => 1 - Math.pow(1 - x, 3);
const easeInOut = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

// ---------------------------------------------------------------- language
let lang = pickLanguage();
let L = STRINGS[lang];
let clockSkew = 0;
const now = () => Date.now() - clockSkew;
function ago(ts, short = false) {
  if (!ts) return '';
  const f = short ? L.agoShort : L.ago;
  const s = Math.max(0, Math.round((now() - ts) / 1000));
  if (s < 60) return f.s(s);
  if (s < 3600) return f.m(Math.round(s / 60));
  if (s < 86400) return f.h(Math.round(s / 3600));
  return f.d(Math.round(s / 86400));
}
function applyStaticText() {
  document.documentElement.lang = lang;
  document.title = L.title;
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = L[el.dataset.i18n]; });
  document.getElementById('legend').innerHTML = STATUS_ORDER
    .map((k) => `<span><i style="--c:${STATUS[k].color}"></i>${esc(L.status[k])}</span>`).join('');
  document.getElementById('close').setAttribute('aria-label', L.panel.close);
  document.getElementById('demoBadge').textContent = L.demoBadge;
}

// ---------------------------------------------------------------- scene
const host = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
host.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(innerWidth, innerHeight);
Object.assign(labelRenderer.domElement.style, { position: 'absolute', top: '0', left: '0', pointerEvents: 'none' });
host.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe9e6df);
scene.fog = new THREE.Fog(0xe9e6df, 90, 230);

const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 500);
camera.position.set(0, 26, 34);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.46;
controls.minDistance = 4;
controls.maxDistance = 140;
controls.screenSpacePanning = false;

scene.add(new THREE.HemisphereLight(0xffffff, 0xcfc4b2, 1.15));
const sun = new THREE.DirectionalLight(0xfff4e6, 1.7);
sun.position.set(25, 45, 30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

const floor = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), new THREE.MeshStandardMaterial({ color: 0xdcd5ca, roughness: 0.95 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const grid = new THREE.GridHelper(800, 400, 0xd2cabd, 0xd2cabd);
grid.position.y = 0.004;
grid.material.transparent = true;
grid.material.opacity = 0.55;
scene.add(grid);

// ---------------------------------------------------------------- mesh helpers
const materials = new Map();
function mat(color, o = {}) {
  const k = color + JSON.stringify(o);
  if (!materials.has(k)) materials.set(k, new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.04, ...o }));
  return materials.get(k);
}
const shadowed = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };
const box = (w, h, d, m) => shadowed(new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(w, h, d) * 0.22), m));
const cylinder = (r1, r2, h, m, seg = 16) => shadowed(new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), m));
const capsule = (r, l, m) => shadowed(new THREE.Mesh(new THREE.CapsuleGeometry(r, l, 4, 12), m));
const sphere = (r, m, ws = 18, hs = 14) => shadowed(new THREE.Mesh(new THREE.SphereGeometry(r, ws, hs), m));
function dispose(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.isCSS2DObject && o.element) o.element.remove();
  });
  obj.removeFromParent();
}

// Monitor textures: scrolling "code" lines in the status colour.
const screenSources = {};
function screenTexture(status) {
  if (!screenSources[status]) {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 256;
    const x = c.getContext('2d');
    const idle = status === 'done' || status === 'away';
    x.fillStyle = idle ? '#20242c' : '#0f1724';
    x.fillRect(0, 0, 128, 256);
    if (!idle) {
      for (let y = 6; y < 256; y += 9) {
        const indent = (hash(y + status) % 4) * 10 + 8;
        const len = 20 + (hash(status + y) % 80);
        x.globalAlpha = 0.85; x.fillStyle = STATUS[status].color;
        x.fillRect(indent, y, Math.min(len, 120 - indent), 4);
        if (hash(y) % 3 === 0) { x.globalAlpha = 0.45; x.fillStyle = '#ffffff'; x.fillRect(indent + len + 6, y, 18, 4); }
      }
      x.globalAlpha = 1;
    } else {
      x.fillStyle = '#3b4250';
      x.font = 'bold 34px Inter, sans-serif';
      x.textAlign = 'center';
      x.fillText(status === 'done' ? '✓' : 'z z', 64, 140);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1, 0.5);
    screenSources[status] = t;
  }
  const t = screenSources[status].clone();
  t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------- furniture and people
function makeDesk(lead) {
  const g = new THREE.Group();
  const w = lead ? 2.2 : 1.6, d = lead ? 1.05 : 0.85;
  const top = box(w, 0.07, d, mat(lead ? 0x8a5a3c : 0xc19a6b)); top.position.y = 0.76; g.add(top);
  const metal = mat(0x8b93a1, { metalness: 0.5, roughness: 0.4 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = cylinder(0.03, 0.03, 0.74, metal, 8);
    leg.position.set(sx * (w / 2 - 0.1), 0.37, sz * (d / 2 - 0.1)); g.add(leg);
  }
  const stand = cylinder(0.04, 0.06, 0.22, mat(0x2a2f38), 10); stand.position.set(0, 0.9, -d / 2 + 0.22); g.add(stand);
  const frame = box(0.86, 0.54, 0.05, mat(0x1f2530)); frame.position.set(0, 1.25, -d / 2 + 0.2); g.add(frame);
  const screenMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.46), screenMat);
  screen.position.set(0, 1.25, -d / 2 + 0.23); g.add(screen);
  const keyboard = box(0.55, 0.025, 0.17, mat(0x3a4150)); keyboard.position.set(0, 0.81, 0.02); g.add(keyboard);
  const mouse = box(0.07, 0.025, 0.11, mat(0x3a4150)); mouse.position.set(0.42, 0.81, 0.04); g.add(mouse);
  if (lead) {
    const mug = cylinder(0.06, 0.05, 0.12, mat(0xe8e1d4), 12); mug.position.set(-0.75, 0.86, 0.15); g.add(mug);
    const pot = cylinder(0.11, 0.08, 0.18, mat(0xb5654a), 12); pot.position.set(0.85, 0.88, -0.25); g.add(pot);
    const leaves = shadowed(new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 1), mat(0x4f8a4b, { flatShading: true })));
    leaves.position.set(0.85, 1.12, -0.25); g.add(leaves);
    const plate = box(0.5, 0.1, 0.05, mat(0xd4b26a, { metalness: 0.5, roughness: 0.35 })); plate.position.set(0, 0.84, d / 2 - 0.06); g.add(plate);
  }
  const chairZ = d / 2 + 0.42;
  const fabric = lead ? mat(0x6b2f2a) : mat(0x39414f);
  const seat = box(0.56, 0.08, 0.54, fabric); seat.position.set(0, 0.48, chairZ); g.add(seat);
  const back = box(0.56, lead ? 0.8 : 0.6, 0.08, fabric); back.position.set(0, lead ? 0.92 : 0.82, chairZ + 0.27); g.add(back);
  const post = cylinder(0.04, 0.04, 0.42, metal, 8); post.position.set(0, 0.23, chairZ); g.add(post);
  const base = cylinder(0.26, 0.26, 0.04, mat(0x2a2f38), 5); base.position.set(0, 0.03, chairZ); g.add(base);
  return { g, screenMat, chairZ };
}

function makePerson(shirt, key, lead) {
  const h = hash(key);
  const skin = mat(SKIN[h % SKIN.length]);
  const hair = mat(HAIR[(h >> 3) % HAIR.length]);
  const trousers = mat(lead ? 0x1f2a44 : 0x3d4452);
  const root = new THREE.Group();
  const upper = new THREE.Group(); upper.position.y = 0.52; root.add(upper);
  const torso = capsule(0.27, 0.42, mat(shirt)); torso.position.y = 0.44; upper.add(torso);
  if (lead) {
    const tie = box(0.08, 0.34, 0.03, mat(0xc0392b)); tie.position.set(0, 0.56, -0.26); upper.add(tie);
    const collar = box(0.3, 0.08, 0.06, mat(0xf4f1ea)); collar.position.set(0, 0.78, -0.2); upper.add(collar);
  }
  const head = new THREE.Group(); head.position.y = 1.16; upper.add(head);
  head.add(sphere(0.24, skin));
  const cap = shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.255, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hair));
  cap.rotation.x = 0.25; cap.position.z = 0.02; head.add(cap);
  const eyeMat = mat(0x1b1f27);
  for (const s of [-1, 1]) { const e = sphere(0.032, eyeMat, 8, 6); e.position.set(s * 0.085, 0.03, -0.215); head.add(e); }
  const arms = [];
  for (const s of [-1, 1]) {
    const shoulder = new THREE.Group(); shoulder.position.set(s * 0.34, 0.8, 0); upper.add(shoulder);
    const arm = capsule(0.08, 0.4, mat(shirt)); arm.position.y = -0.26; shoulder.add(arm);
    const hand = sphere(0.07, skin, 10, 8); hand.position.y = -0.52; shoulder.add(hand);
    arms.push(shoulder);
  }
  const legs = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(s * 0.13, 0.52, 0); root.add(hip);
    const thigh = capsule(0.1, 0.34, trousers); thigh.position.y = -0.24; hip.add(thigh);
    const knee = new THREE.Group(); knee.position.y = -0.46; hip.add(knee);
    const shin = capsule(0.09, 0.3, trousers); shin.position.y = -0.22; knee.add(shin);
    const shoe = box(0.13, 0.07, 0.24, mat(0x1b1f27)); shoe.position.set(0, -0.46, -0.05); knee.add(shoe);
    legs.push({ hip, knee });
  }
  const bubble = new THREE.Group(); bubble.position.set(0.34, 1.62, 0.05); upper.add(bubble);
  const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, transparent: true, opacity: 0.95 });
  [[0, 0, 0.05], [0.12, 0.14, 0.075], [0.3, 0.32, 0.14]].forEach(([x, y, r]) => {
    const b = sphere(r, white, 12, 10); b.castShadow = false; b.position.set(x, y, 0); bubble.add(b);
  });
  bubble.visible = false;
  return { root, upper, head, arms, legs, bubble };
}

// ---------------------------------------------------------------- agent
const pickable = [];
class Agent {
  constructor(room, key, lead, data) {
    this.room = room; this.key = key; this.lead = lead; this.data = data;
    this.phase = (hash(key) % 1000) / 1000 * Math.PI * 2;
    this.root = new THREE.Group();
    this.desk = makeDesk(lead);
    this.root.add(this.desk.g);
    const shirt = lead ? 0x2b3a67 : (TYPE_COLOR[data.type] ?? PALETTE[hash(data.type) % PALETTE.length]);
    this.person = makePerson(shirt, key, lead);
    this.root.add(this.person.root);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.82, 40),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, toneMapped: false }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.set(0, 0.07, this.desk.chairZ - 0.1);
    this.root.add(this.ring);

    const el = document.createElement('div');
    el.className = 'tag';
    el.innerHTML = `<div class="icon"></div><div class="name${lead ? ' lead' : ''}"><i></i><span></span></div><div class="doing"></div>`;
    el.addEventListener('click', (e) => { e.stopPropagation(); select({ room: room.id, agent: key }); });
    this.el = el;
    this.label = new CSS2DObject(el);
    this.label.position.set(0, 2.25, 0);
    this.person.root.add(this.label);

    this.root.traverse((o) => { if (o.isMesh) { o.userData.agent = this; pickable.push(o); } });
    this.target = new THREE.Vector3();
    this.walk = null;      // { from, to, t } while walking in from the door
    this.appear = 0;       // desk pop-in
    this.leaving = null;
    this.status = null;
    this.update(data);
  }

  update(data) {
    this.data = data;
    const s = data.status in STATUS ? data.status : 'thinking';
    if (s !== this.status) {
      this.status = s;
      if (this.desk.screenMat.map) this.desk.screenMat.map.dispose();
      this.desk.screenMat.map = screenTexture(s);
      this.desk.screenMat.needsUpdate = true;
      this.ring.material.color.set(STATUS[s].color);
      this.person.bubble.visible = s === 'thinking';
    }
    this.refreshLabel();
  }

  refreshLabel() {
    const d = this.data;
    this.el.style.setProperty('--c', STATUS[this.status].color);
    this.el.classList.toggle('waiting', this.status === 'waiting');
    this.el.querySelector('.icon').textContent = STATUS[this.status].icon;
    this.el.querySelector('.name span').textContent = this.lead ? `${L.lead} · ${shortModel(d.model) || '?'}` : d.name;
    this.el.querySelector('.doing').textContent = actionText(d, this.lead ? this.room.data : null);
  }

  place(x, z, first) {
    this.target.set(x, 0, z);
    if (!first) return;
    this.root.position.copy(this.target);
    if (!this.lead && this.room.ready) {
      const door = new THREE.Vector3(0, 0, this.room.D / 2 + 0.6).sub(this.target);
      this.walk = { from: door, to: new THREE.Vector3(0, 0, this.desk.chairZ), t: 0 };
      this.appear = 0;
    } else this.appear = 1;
  }

  leave() { this.leaving = 0; }

  tick(t, dt) {
    this.root.position.lerp(this.target, 1 - Math.exp(-dt * 4));
    if (this.appear < 1) { this.appear = Math.min(1, this.appear + dt * 2.2); this.desk.g.scale.setScalar(0.3 + 0.7 * easeOut(this.appear)); }
    if (this.leaving !== null) {
      this.leaving += dt * 1.8;
      this.root.scale.setScalar(Math.max(0.001, 1 - this.leaving));
      if (this.leaving >= 1) { this.room.removeAgent(this.key); return; }
    }
    const P = this.person;
    if (this.walk) {
      const w = this.walk;
      w.t += dt / 2.2;
      const p = Math.min(1, w.t);
      P.root.position.lerpVectors(w.from, w.to, easeInOut(p));
      P.root.position.y = 0.43 + Math.abs(Math.sin(t * 9)) * 0.05;
      P.root.rotation.y = Math.atan2(w.to.x - w.from.x, w.to.z - w.from.z) + Math.PI;
      const swing = Math.sin(t * 9) * 0.5;
      P.legs[0].hip.rotation.x = swing; P.legs[1].hip.rotation.x = -swing;
      P.legs[0].knee.rotation.x = P.legs[1].knee.rotation.x = 0;
      P.arms[0].rotation.set(-swing * 0.6, 0, 0); P.arms[1].rotation.set(swing * 0.6, 0, 0);
      P.upper.rotation.set(0, 0, 0);
      P.head.rotation.set(0, 0, 0);
      if (p >= 1) { this.walk = null; P.root.rotation.y = 0; }
      return;
    }
    // seated
    P.root.position.set(0, 0, this.desk.chairZ - 0.12);
    P.root.rotation.y = 0;
    for (const l of P.legs) { l.hip.rotation.x = Math.PI / 2; l.knee.rotation.x = -Math.PI / 2; }
    const [left, right] = P.arms;
    const f = this.phase;
    let lean = 0, nod = 0.08, tilt = 0;
    left.rotation.set(1.15, 0, 0.1); right.rotation.set(1.15, 0, -0.1);
    const scr = this.desk.screenMat;
    scr.color.setScalar(1);
    this.ring.scale.setScalar(1);
    switch (this.status) {
      case 'tool': // typing
        left.rotation.x = 1.12 + Math.sin(t * 17 + f) * 0.1;
        right.rotation.x = 1.12 + Math.sin(t * 17 + f + Math.PI) * 0.1;
        nod = 0.14 + Math.sin(t * 2.3 + f) * 0.03; lean = 0.08;
        this.ring.scale.setScalar(1 + Math.sin(t * 4 + f) * 0.06);
        if (scr.map) scr.map.offset.y = (t * 0.18 + f) % 1;
        break;
      case 'thinking': // hand on chin, thought bubble
        right.rotation.set(2.25, 0, -0.55);
        tilt = Math.sin(t * 1.3 + f) * 0.14; nod = -0.08;
        P.bubble.children.forEach((b, i) => b.scale.setScalar(0.75 + 0.3 * Math.max(0, Math.sin(t * 3 - i * 0.8))));
        P.bubble.position.y = 1.62 + Math.sin(t * 2) * 0.04;
        if (scr.map) scr.map.offset.y = (t * 0.03 + f) % 1;
        break;
      case 'waiting': // waving
        right.rotation.set(Math.PI - 0.15, 0, -0.25 + Math.sin(t * 6 + f) * 0.3);
        nod = -0.15; lean = -0.06;
        this.ring.scale.setScalar(1 + Math.max(0, Math.sin(t * 3)) * 0.14);
        break;
      case 'blocked': // hands on head, blinking screen
        left.rotation.set(2.55, 0, 0.75); right.rotation.set(2.55, 0, -0.75);
        tilt = Math.sin(t * 5) * 0.1;
        scr.color.setScalar(Math.sin(t * 6) > 0 ? 1 : 0.55);
        break;
      case 'done': // leaning back
        lean = -0.2; nod = -0.2;
        left.rotation.set(0.25, 0, 0.12); right.rotation.set(0.25, 0, -0.12);
        break;
      case 'away': // asleep on the desk
        lean = 0.55; nod = 0.35;
        left.rotation.set(1.5, 0, 0.35); right.rotation.set(1.5, 0, -0.35);
        break;
    }
    if (this.selected) this.ring.scale.multiplyScalar(1.3);
    P.upper.rotation.x = lean;
    P.head.rotation.set(nod, 0, tilt);
  }
}

function actionText(d, sessionData) {
  const a = d.action;
  switch (d.status) {
    case 'tool': return a && a.tool ? (a.detail ? `${a.tool} · ${a.detail}` : a.tool) : L.act.working;
    case 'blocked': return a && a.tool ? `${a.tool} · ${L.act.started(ago(a.ts))}` : L.act.stuck;
    case 'thinking': return a && a.kind === 'notification' ? L.act.notification : L.act.thinking;
    case 'waiting': {
      const busy = sessionData ? sessionData.subagents.filter((s) => s.status === 'tool' || s.status === 'thinking').length : 0;
      return busy ? L.act.waitingTeam(busy) : L.act.waiting;
    }
    case 'done': return L.act.done(ago(d.lastTs));
    case 'away': return L.act.away(ago(d.lastTs));
    default: return '';
  }
}

// ---------------------------------------------------------------- room
class Room {
  constructor(id) {
    this.id = id;
    this.g = new THREE.Group();
    this.target = new THREE.Vector3();
    this.shell = null;
    this.W = 0; this.D = 0;
    this.lead = null;
    this.team = new Map();
    this.ready = false;
    scene.add(this.g);
    this.boardCanvas = document.createElement('canvas');
    this.boardCanvas.width = 640; this.boardCanvas.height = 400;
    this.boardTexture = new THREE.CanvasTexture(this.boardCanvas);
    this.boardTexture.colorSpace = THREE.SRGBColorSpace;
    this.boardTexture.anisotropy = 4;
    this.boardKey = '';
    const el = document.createElement('div');
    el.className = 'room-tag';
    el.innerHTML = '<div class="t"></div><div class="p"></div>';
    el.addEventListener('click', (e) => { e.stopPropagation(); focusRoom(this, true); select({ room: id, agent: 'lead' }); });
    this.tagEl = el;
    this.tag = new CSS2DObject(el);
    this.g.add(this.tag);
  }

  build(W, D) {
    if (this.shell) dispose(this.shell);
    this.W = W; this.D = D;
    const s = new THREE.Group();
    this.shell = s;
    this.g.add(s);
    const carpet = box(W, 0.05, D, mat(CARPET[hash(this.id) % CARPET.length], { roughness: 1 }));
    carpet.position.y = 0.025; carpet.castShadow = false; s.add(carpet);
    const wall = mat(0xf6f4ef), trim = mat(0x9aa3b2);
    const back = box(W + 0.3, 2.8, 0.16, wall); back.position.set(0, 1.4, -D / 2); s.add(back);
    const backTrim = box(W + 0.34, 0.08, 0.2, trim); backTrim.position.set(0, 2.82, -D / 2); s.add(backTrim);
    for (const x of [-1, 1]) {
      const side = box(0.16, 1.05, D, wall); side.position.set(x * W / 2, 0.525, 0); s.add(side);
      const sideTrim = box(0.2, 0.06, D + 0.04, trim); sideTrim.position.set(x * W / 2, 1.07, 0); s.add(sideTrim);
      const fw = (W - 2.6) / 2; // front wall, with a door in the middle
      const front = box(fw, 1.05, 0.16, wall); front.position.set(x * (W / 2 - fw / 2), 0.525, D / 2); s.add(front);
      const frontTrim = box(fw + 0.04, 0.06, 0.2, trim); frontTrim.position.set(x * (W / 2 - fw / 2), 1.07, D / 2); s.add(frontTrim);
    }
    const bx = -W / 2 + 2.1;
    const frame = box(3.3, 2.05, 0.08, mat(0xb9c0cc, { metalness: 0.4, roughness: 0.35 })); frame.position.set(bx, 1.62, -D / 2 + 0.12); s.add(frame);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(3.12, 1.9), new THREE.MeshBasicMaterial({ map: this.boardTexture, toneMapped: false }));
    board.position.set(bx, 1.62, -D / 2 + 0.17); s.add(board);
    const pot = cylinder(0.25, 0.2, 0.45, mat(0xb5654a), 14); pot.position.set(W / 2 - 0.55, 0.25, D / 2 - 0.55); s.add(pot);
    const plant = shadowed(new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), mat(0x4a8a4f, { flatShading: true })));
    plant.position.set(W / 2 - 0.55, 0.95, D / 2 - 0.55); plant.scale.y = 1.3; s.add(plant);
    const cooler = box(0.4, 1.0, 0.4, mat(0xe8ecf1)); cooler.position.set(-W / 2 + 0.55, 0.52, D / 2 - 0.6); s.add(cooler);
    const bottle = cylinder(0.16, 0.16, 0.38, new THREE.MeshStandardMaterial({ color: 0x7cc4f2, transparent: true, opacity: 0.6, roughness: 0.1 }), 14);
    bottle.position.set(-W / 2 + 0.55, 1.22, D / 2 - 0.6); s.add(bottle);
    this.tag.position.set(0, 0.25, D / 2 + 1.0);
    this.boardKey = '';
  }

  removeAgent(key) {
    const a = key === 'lead' ? this.lead : this.team.get(key);
    if (!a) return;
    a.root.traverse((o) => { const i = pickable.indexOf(o); if (i >= 0) pickable.splice(i, 1); });
    dispose(a.root);
    this.team.delete(key);
  }

  update(data, showDone) {
    this.data = data;
    const team = data.subagents.filter((s) => showDone || s.status !== 'done');
    const n = team.length;
    const cols = n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;
    const rows = Math.ceil(n / cols);
    const W = Math.max(9.5, cols * DESK_DX + 3.2);
    const D = n ? 5.3 + rows * DESK_DZ : 5.8;
    if (W !== this.W || D !== this.D) this.build(W, D);

    const first = !this.lead;
    if (first) {
      this.lead = new Agent(this, 'lead', true, data);
      this.lead.root.rotation.y = Math.PI; // the lead faces the team
      this.g.add(this.lead.root);
    } else this.lead.update(data);
    this.lead.place(W / 2 - 2.4, -D / 2 + 1.75, first);

    const seen = new Set();
    team.forEach((s, i) => {
      seen.add(s.id);
      let a = this.team.get(s.id);
      const isNew = !a;
      if (isNew) { a = new Agent(this, s.id, false, s); this.team.set(s.id, a); this.g.add(a.root); } else {
        a.update(s);
        if (a.leaving !== null) { a.leaving = null; a.root.scale.setScalar(1); }
      }
      const r = Math.floor(i / cols), c = i % cols;
      const inRow = Math.min(cols, n - r * cols);
      a.place((c - (inRow - 1) / 2) * DESK_DX, -D / 2 + 4.2 + r * DESK_DZ, isNew);
      a.label.position.y = 2.25 + (c % 2) * 0.5; // stagger labels so neighbours don't overlap
    });
    for (const [k, a] of this.team) if (!seen.has(k) && a.leaving === null) a.leave();

    const working = data.subagents.filter((s) => s.status === 'tool').length;
    this.tagEl.querySelector('.t').textContent = data.title || L.untitled;
    const where = [data.project, data.branch].filter(Boolean).join(' · ');
    this.tagEl.querySelector('.p').textContent = where + (data.subagents.length ? L.team(data.subagents.length, working) : '');
    this.drawBoard(data);
    this.ready = true;
  }

  drawBoard(d) {
    const key = JSON.stringify([lang, d.plan, d.title, d.prompt]);
    if (key === this.boardKey) return;
    this.boardKey = key;
    const c = this.boardCanvas, x = c.getContext('2d');
    x.fillStyle = '#fbfcfd'; x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = '#1d2433';
    x.font = '700 30px Inter, sans-serif';
    const fit = (text, maxW) => {
      if (x.measureText(text).width <= maxW) return text;
      while (text.length && x.measureText(text + '…').width > maxW) text = text.slice(0, -1);
      return text + '…';
    };
    if (d.plan && d.plan.length) {
      const done = d.plan.filter((p) => p.status === 'completed').length;
      x.fillText(L.board.tasks, 28, 50);
      x.font = '600 24px Inter, sans-serif';
      x.fillStyle = '#667085';
      x.textAlign = 'right'; x.fillText(`${done}/${d.plan.length}`, c.width - 28, 50); x.textAlign = 'left';
      x.fillStyle = '#e4e7ec'; x.fillRect(28, 66, c.width - 56, 8);
      x.fillStyle = '#34d399'; x.fillRect(28, 66, (c.width - 56) * done / d.plan.length, 8);
      const lineH = Math.min(40, 300 / Math.min(d.plan.length, 8));
      d.plan.slice(0, 8).forEach((p, i) => {
        const y = 110 + i * lineH;
        x.fillStyle = p.status === 'completed' ? '#16a34a' : p.status === 'in_progress' ? '#2563eb' : '#98a2b3';
        x.font = '700 24px Inter, sans-serif';
        x.fillText(p.status === 'completed' ? '✓' : p.status === 'in_progress' ? '▶' : '○', 30, y);
        x.font = `${p.status === 'in_progress' ? 700 : 500} 23px Inter, sans-serif`;
        x.fillStyle = p.status === 'completed' ? '#98a2b3' : '#1d2433';
        x.fillText(fit(p.text, c.width - 100), 66, y);
      });
      if (d.plan.length > 8) { x.fillStyle = '#98a2b3'; x.font = '500 20px Inter'; x.fillText(L.board.more(d.plan.length - 8), 66, 110 + 8 * lineH); }
    } else {
      x.fillText(L.board.agenda, 28, 50);
      x.font = '500 23px Inter, sans-serif';
      x.fillStyle = '#344054';
      let line = '', y = 100;
      for (const w of String(d.prompt || d.title || '').split(/\s+/)) {
        const tryLine = line ? line + ' ' + w : w;
        if (x.measureText(tryLine).width > c.width - 56) { x.fillText(line, 28, y); y += 32; line = w; if (y > 360) break; } else line = tryLine;
      }
      if (y <= 360) x.fillText(line, 28, y);
    }
    this.boardTexture.needsUpdate = true;
  }

  tick(t, dt) {
    this.g.position.lerp(this.target, 1 - Math.exp(-dt * 3));
    if (this.lead) this.lead.tick(t, dt);
    for (const a of [...this.team.values()]) a.tick(t, dt);
    if (this.closing !== undefined) {
      this.closing += dt * 1.5;
      this.g.scale.setScalar(Math.max(0.001, 1 - this.closing));
      if (this.closing >= 1) {
        this.g.traverse((o) => { const i = pickable.indexOf(o); if (i >= 0) pickable.splice(i, 1); });
        dispose(this.g);
        rooms.delete(this.id);
      }
    }
  }
}

// ---------------------------------------------------------------- layout
const rooms = new Map();
let firstFrame = true;
let bounds = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 };

function layout() {
  const list = [...rooms.values()].filter((r) => r.closing === undefined);
  // aim for a wide-screen shaped floor plan
  const area = list.reduce((s, r) => s + (r.W + ROOM_GAP) * (r.D + ROOM_GAP), 0);
  const rowMax = Math.min(ROW_MAX_WIDTH, Math.max(30, Math.sqrt(area) * 1.45));
  let x = 0, z = 0, rowD = 0, maxX = 0;
  const rows = [[]];
  for (const r of list) {
    if (x > 0 && x + r.W > rowMax) { rows.push([]); x = 0; z += rowD + ROOM_GAP + 2; rowD = 0; }
    r.target.set(x + r.W / 2, 0, z + r.D / 2);
    rows[rows.length - 1].push(r);
    x += r.W + ROOM_GAP; rowD = Math.max(rowD, r.D); maxX = Math.max(maxX, x - ROOM_GAP);
  }
  const totalZ = z + rowD;
  for (const row of rows) {
    if (!row.length) continue;
    const last = row[row.length - 1];
    const width = last.target.x + last.W / 2;
    for (const r of row) { r.target.x -= width / 2; r.target.z -= totalZ / 2; }
  }
  bounds = { minX: -maxX / 2, maxX: maxX / 2, minZ: -totalZ / 2, maxZ: totalZ / 2 };
  for (const r of list) if (!r.placed) { r.g.position.copy(r.target); r.placed = true; }
  const radius = Math.max(20, Math.hypot(maxX, totalZ) / 2 + 6);
  const sc = sun.shadow.camera;
  sc.left = -radius; sc.right = radius; sc.top = radius; sc.bottom = -radius; sc.near = 1; sc.far = 200;
  sc.updateProjectionMatrix();
  sun.position.set(radius * 0.6, 60, radius * 0.8);
  if (firstFrame && list.length) { firstFrame = false; overview(true); }
}

// ---------------------------------------------------------------- camera
let camGoal = null;
controls.addEventListener('start', () => { camGoal = null; });
function focusRoom(room, smooth) {
  const p = room.target.clone();
  p.x += room.W * 0.2; // keep the room clear of the details panel on the right
  const dist = Math.max(room.W, room.D) * 0.95 + 4;
  camGoal = { look: p, pos: p.clone().add(new THREE.Vector3(0, dist * 0.85, dist * 0.95)) };
  if (!smooth) { controls.target.copy(camGoal.look); camera.position.copy(camGoal.pos); camGoal = null; }
}
function overview(instant) {
  const w = bounds.maxX - bounds.minX + 4, d = bounds.maxZ - bounds.minZ + 6;
  const side = innerWidth > 760 ? 294 : 0; // sidebar width in px
  const usable = (innerWidth - side - 24) / innerWidth;
  const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const tanH = tanV * camera.aspect;
  // the floor is seen at ~42°, so its depth shows up foreshortened on screen
  const dist = Math.max(18, w / (2 * tanH * usable * 0.95), (d * 0.66) / (2 * tanV * 0.8));
  // shift the view so the rooms sit in the area the sidebar does not cover
  const shift = (side / 2) * (2 * tanH * dist) / innerWidth;
  const p = new THREE.Vector3(-shift, 0, (bounds.minZ + bounds.maxZ) / 2 + 1);
  camGoal = { look: p, pos: p.clone().addScaledVector(new THREE.Vector3(0, 0.8, 0.9).normalize(), dist) };
  if (instant) { controls.target.copy(p); camera.position.copy(camGoal.pos); camGoal = null; }
}

// ---------------------------------------------------------------- selection and panels
let selection = null;
const details = document.getElementById('details');
const detailsBody = document.getElementById('detailsBody');
function closeDetails() { selection = null; details.hidden = true; highlight(); renderList(); }
document.getElementById('close').onclick = closeDetails;

function select(s) { selection = s; renderDetails(); highlight(); renderList(); }
function highlight() {
  for (const r of rooms.values()) {
    for (const a of [r.lead, ...r.team.values()]) {
      if (!a) continue;
      a.selected = !!(selection && selection.room === r.id && selection.agent === a.key);
      a.el.classList.toggle('selected', a.selected);
    }
  }
}

function historyHtml(h) {
  if (!h || !h.length) return `<div class="role">${esc(L.panel.noTools)}</div>`;
  return `<ul>${[...h].reverse().map((e) => `<li class="${e.error ? 'error' : ''}"><span class="t">${esc(ago(e.ts, true))}</span><span class="k">${esc(e.tool)}</span><span class="d">${esc(e.detail)}</span></li>`).join('')}</ul>`;
}

function renderDetails() {
  if (!selection) { details.hidden = true; return; }
  const room = rooms.get(selection.room);
  if (!room || !room.data) { details.hidden = true; return; }
  const isLead = selection.agent === 'lead';
  const v = isLead ? room.data : room.data.subagents.find((s) => s.id === selection.agent);
  if (!v) { details.hidden = true; return; }
  const S = STATUS[v.status] || STATUS.thinking;
  const P = L.panel;
  let h = `<h2>${esc(isLead ? (room.data.title || L.untitled) : v.name)}</h2>`;
  h += `<div class="role">${isLead ? esc(L.leadRole) : `${esc(L.subRole)} · ${esc(v.type)}${v.phase ? ` · ${esc(v.phase)}` : ''}${v.background ? ` · ${esc(L.background)}` : ''}`}</div>`;
  h += `<span class="status" style="--c:${S.color}"><i></i>${esc(L.status[v.status] || v.status)}</span>`;
  h += `<div class="action">${esc(actionText(v, isLead ? room.data : null))}</div>`;
  if (isLead && v.plan && v.plan.length) {
    h += `<h3>${esc(P.taskList)}</h3><ul class="plan">${v.plan.map((p) => `<li class="${esc(p.status)}"><span class="i">${p.status === 'completed' ? '✓' : p.status === 'in_progress' ? '▶' : '○'}</span><span class="d">${esc(p.text)}</span></li>`).join('')}</ul>`;
  }
  if (isLead && v.subagents.length) {
    h += `<h3>${esc(P.team(v.subagents.length))}</h3><ul class="teamList">${v.subagents.map((s) => {
      const c = (STATUS[s.status] || STATUS.thinking).color;
      return `<li data-id="${esc(s.id)}"><span class="k" style="color:${c};min-width:0">●</span><span class="d">${esc(s.name)} <small style="color:#667085">— ${esc(actionText(s))}</small></span></li>`;
    }).join('')}</ul>`;
  }
  if (!isLead && v.brief) h += `<h3>${esc(P.brief)}</h3><div class="text">${esc(v.brief)}</div>`;
  if (isLead && v.prompt) h += `<h3>${esc(P.lastPrompt)}</h3><div class="text">${esc(v.prompt)}</div>`;
  if (v.lastText) h += `<h3>${esc(P.lastText)}</h3><div class="text">${esc(v.lastText)}</div>`;
  h += `<h3>${esc(P.recent)}</h3>${historyHtml(v.history)}`;
  h += `<h3>${esc(P.info)}</h3><dl class="props">
    <dt>${esc(P.model)}</dt><dd>${esc(shortModel(v.model) || '—')}</dd>
    <dt>${esc(P.toolCalls)}</dt><dd>${v.toolCount}${v.errors ? ` (${esc(P.errors(v.errors))})` : ''}</dd>
    <dt>${esc(P.outTok)}</dt><dd>${kfmt(v.outTok)}</dd>
    <dt>${esc(P.context)}</dt><dd>${kfmt(v.ctx)}</dd>
    <dt>${esc(P.started)}</dt><dd>${esc(ago(v.startTs))}</dd>
    <dt>${esc(P.lastSeen)}</dt><dd>${esc(ago(v.lastTs))}</dd>
    ${isLead ? `<dt>${esc(P.folder)}</dt><dd>${esc(v.cwd || '—')}</dd><dt>${esc(P.branch)}</dt><dd>${esc(v.branch || '—')}</dd>` : ''}
  </dl>`;
  detailsBody.innerHTML = h;
  details.hidden = false;
  detailsBody.querySelectorAll('.teamList li').forEach((li) => { li.onclick = () => select({ room: room.id, agent: li.dataset.id }); });
}

const listEl = document.getElementById('sessionList');
function renderList() {
  const sessions = lastState ? lastState.sessions : [];
  listEl.innerHTML = sessions.map((s) => {
    const S = STATUS[s.status] || STATUS.thinking;
    const team = s.subagents.map((a) => `<i style="--c:${(STATUS[a.status] || STATUS.thinking).color}" title="${esc(a.name)}"></i>`).join('');
    return `<div class="session${selection && selection.room === s.id ? ' selected' : ''}" data-id="${esc(s.id)}">
      <div class="name"><span class="dot" style="background:${S.color};flex:none"></span><span>${esc(s.title || L.untitled)}</span></div>
      <div class="meta"><span>${esc(s.project)}</span><span>${esc(L.status[s.status] || '')}</span><span>${esc(ago(s.lastTs))}</span></div>
      ${team ? `<div class="team">${team}</div>` : ''}
    </div>`;
  }).join('');
  listEl.querySelectorAll('.session').forEach((el) => {
    el.onclick = () => { const r = rooms.get(el.dataset.id); if (r) { focusRoom(r, true); select({ room: r.id, agent: 'lead' }); } };
  });
}

function renderCounters(v) {
  const count = {};
  let total = 0;
  for (const s of v.sessions) for (const a of [s, ...s.subagents]) { count[a.status] = (count[a.status] || 0) + 1; total++; }
  const pill = (k) => (count[k] ? `<span class="pill"><i style="--c:${STATUS[k].color}"></i><b>${count[k]}</b> ${esc(L.status[k].toLowerCase())}</span>` : '');
  document.getElementById('counters').innerHTML = `<span>${L.nSessions(v.sessions.length)}</span><span>${L.nAgents(total)}</span>` + STATUS_ORDER.map(pill).join('');
}

// ---------------------------------------------------------------- picking
const ray = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
  const a = hit(e);
  if (a) select({ room: a.room.id, agent: a.key });
});
let lastHover = 0;
renderer.domElement.addEventListener('pointermove', (e) => {
  const t = performance.now();
  if (t - lastHover < 60) return;
  lastHover = t;
  renderer.domElement.style.cursor = hit(e) ? 'pointer' : '';
});
renderer.domElement.addEventListener('dblclick', (e) => {
  const a = hit(e);
  if (a) focusRoom(a.room, true); else overview(false);
});
function hit(e) {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(pointer, camera);
  const h = ray.intersectObjects(pickable, false)[0];
  return h ? h.object.userData.agent : null;
}

// ---------------------------------------------------------------- data
let lastState = null;
const hoursEl = document.getElementById('hours');
const showDoneEl = document.getElementById('showDone');
const langEl = document.getElementById('lang');
const conn = document.getElementById('conn');
function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem('cco') || '{}');
    if (p.hours) hoursEl.value = p.hours;
    if (p.showDone === false) showDoneEl.checked = false;
  } catch { /* storage unavailable */ }
}
function savePrefs() {
  try { localStorage.setItem('cco', JSON.stringify({ hours: hoursEl.value, showDone: showDoneEl.checked, lang })); } catch { /* ignore */ }
}
loadPrefs();
langEl.value = lang;
hoursEl.onchange = () => { savePrefs(); refresh(); };
showDoneEl.onchange = () => { savePrefs(); if (lastState) apply(lastState); };
langEl.onchange = () => {
  lang = langEl.value; L = STRINGS[lang];
  savePrefs(); applyStaticText();
  if (lastState) apply(lastState);
};
applyStaticText();

async function refresh() {
  try {
    const r = await fetch(`/api/state?hours=${hoursEl.value}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const v = await r.json();
    clockSkew = Date.now() - v.now;
    conn.className = 'dot ok';
    conn.title = L.connection;
    apply(v);
  } catch (e) {
    conn.className = 'dot err';
    conn.title = L.unreachable + e.message;
  }
}

function apply(v) {
  lastState = v;
  document.getElementById('demoBadge').hidden = !v.demo;
  const seen = new Set();
  for (const s of v.sessions) {
    seen.add(s.id);
    let r = rooms.get(s.id);
    if (!r) { r = new Room(s.id); rooms.set(s.id, r); }
    if (r.closing !== undefined) { delete r.closing; r.g.scale.setScalar(1); }
    r.update(s, showDoneEl.checked);
  }
  for (const [id, r] of rooms) if (!seen.has(id) && r.closing === undefined) r.closing = 0;
  layout();
  renderCounters(v);
  renderList();
  if (selection) renderDetails();
  highlight();
  document.getElementById('empty').hidden = v.sessions.length > 0;
}

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
let frame = 0;
const tmp = new THREE.Vector3();
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, clock.getDelta());
  const t = clock.elapsedTime;
  if (camGoal) {
    const k = 1 - Math.exp(-dt * 3.5);
    controls.target.lerp(camGoal.look, k);
    camera.position.lerp(camGoal.pos, k);
    if (camera.position.distanceTo(camGoal.pos) < 0.05) camGoal = null;
  }
  controls.update();
  for (const r of [...rooms.values()]) r.tick(t, dt);
  if (++frame % 12 === 0 || frame < 4) { // hide label details when zoomed out
    for (const r of rooms.values()) {
      for (const a of [r.lead, ...r.team.values()]) {
        if (!a) continue;
        a.label.getWorldPosition(tmp);
        const d = tmp.distanceTo(camera.position);
        a.el.classList.toggle('far', !a.selected && d > 26);
        a.el.classList.toggle('very-far', !a.selected && !a.lead && d > 46);
      }
    }
  }
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  labelRenderer.setSize(innerWidth, innerHeight);
});
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDetails();
  if (e.key === 'Home') overview(false);
});

// Deep link for screenshots and sharing: #room=<id> or #overview
function applyHash() {
  const m = location.hash.match(/room=([^&]+)/);
  if (!m) return;
  const r = rooms.get(decodeURIComponent(m[1]));
  if (r) { focusRoom(r, false); select({ room: r.id, agent: 'lead' }); }
}

loop();
refresh().then(applyHash);
setInterval(refresh, 2000);
