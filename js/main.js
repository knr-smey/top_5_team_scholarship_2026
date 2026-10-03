import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const gsap = window.gsap;
gsap.defaults({ overwrite: 'auto' });

const $ = (sel) => document.querySelector(sel);

// ---------------------------------------------------------------------------
// Config: where each rank's planet sits in space, its color, and screen size
// ---------------------------------------------------------------------------
const RANK_STYLE = {
  1: { color: '#ffc828', pos: [0, 4, -80], screenScale: 1.35 }, // gold stone
  2: { color: '#3d7bff', pos: [26, -10, -55], screenScale: 1.1 }, // blue stone
  3: { color: '#ff2e4d', pos: [-24, 12, -40], screenScale: 1.1 }, // red stone
  4: { color: '#22e07a', pos: [36, 8, -20], screenScale: 1 }, // green stone
  5: { color: '#a24bff', pos: [-36, -6, -10], screenScale: 1 }, // purple stone
};
const START = { pos: new THREE.Vector3(0, 0, 220), target: new THREE.Vector3(0, 0, -35) };
const OVERVIEW = { pos: new THREE.Vector3(0, 4, 70), target: new THREE.Vector3(0, 0, -35) };
const FINALE = { pos: new THREE.Vector3(0, 24, 88), target: new THREE.Vector3(0, 6, -40) }; // screens sit below the finale text
const BLOOM_NORMAL = 0.8; // overall glow of the scene
const STONE_GLOW = 0.6; // stone brightness: 1 = original, lower = darker (try 0.4 – 1)
const BLOOM_VIDEO = 0; // no glow over the video, so it stays sharp with true colours
const MEMBER_HOLD = 1.6; // seconds each member stays on screen
const VIDEO_FIRST = true; // true: video plays first, members after it. false: members first, then the video
const VIDEO_MAX = 60; // longest a demo video plays (seconds); override with "videoMax" in teams.json
const VIDEO_FADE = 2; // fade-out (picture + sound) at the end of that limit
const MUSIC_VOLUME = 0.25;
const MUSIC_END = 110; // music plays only until 1:50, then fades out (and stays off)
const MUSIC_FADE = 3; // length of that fade-out (seconds), ending exactly at MUSIC_END

// ---------------------------------------------------------------------------
// Loading progress (shown on the opening loader)
// ---------------------------------------------------------------------------
const loadTasks = [];
const loadState = { done: 0, shown: 0 };
function track(promise) {
  const p = Promise.resolve(promise).catch(() => {}).finally(() => { loadState.done++; updateLoader(); });
  loadTasks.push(p);
  return promise;
}
function updateLoader() {
  const target = (loadState.done / Math.max(loadTasks.length, 1)) * 99; // the last 1% is set when everything is ready
  gsap.to(loadState, {
    shown: Math.max(loadState.shown, target),
    duration: 0.6,
    ease: 'power2.out',
    onUpdate: () => {
      $('#ld-num').textContent = Math.round(loadState.shown);
      gsap.set('.ld-bar-fill', { scaleX: loadState.shown / 100 });
    },
  });
}

// Resolves when a media element / image has loaded (or failed, or took too long)
function whenLoaded(el, event, timeout = 10000) {
  return new Promise((resolve) => {
    el.addEventListener(event, resolve, { once: true });
    el.addEventListener('error', resolve, { once: true });
    setTimeout(resolve, timeout);
  });
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------
const data = await track(fetch('data/teams.json').then((r) => r.json()));
const event = data.event ?? {};
const teams = data.teams
  .slice()
  .sort((a, b) => b.rank - a.rank) // show #5 first, #1 last
  .map((t) => ({ ...t, style: RANK_STYLE[t.rank] ?? RANK_STYLE[5] }));

$('#intro-title').textContent = event.title ?? 'Top 5 Teams';
$('#intro-title').dataset.text = $('#intro-title').textContent; // used by the outline layer
$('#intro-subtitle').textContent = event.subtitle ?? '';
$('#finale-title').textContent = event.finaleTitle ?? 'Congratulations!';
$('#finale-title').dataset.text = $('#finale-title').textContent;
$('#finale-subtitle').textContent = event.finaleSubtitle ?? '';

// Agenda (event.agenda in teams.json): shown after Start Show, before the top 5
const agenda = event.agenda ?? [];
$('#agenda-title').textContent = event.agendaTitle ?? 'Agenda';
$('#agenda-title').dataset.text = $('#agenda-title').textContent;
$('#agenda-subtitle').textContent = event.agendaSubtitle ?? '';
if (agenda.length) gsap.set('#intro', { autoAlpha: 0 }); // agenda replaces the intro screen
$('.ag-list').replaceChildren(...agenda.map((item, i) => {
  const li = document.createElement('li');
  li.className = `ag-item${item.highlight ? ' highlight' : ''}`;
  li.addEventListener('mouseenter', () => setSelected(i));
  li.addEventListener('click', () => { setSelected(i); selectAgenda(i); });
  const num = document.createElement('div');
  num.className = 'ag-num';
  num.textContent = String(i + 1).padStart(2, '0');
  li.appendChild(num);
  const body = document.createElement('div');
  const title = document.createElement('div');
  title.className = 'ag-title';
  title.textContent = item.title ?? '';
  body.appendChild(title);
  if (item.note) {
    const note = document.createElement('div');
    note.className = 'ag-note';
    note.textContent = item.note;
    body.appendChild(note);
  }
  li.append(body);
  if (item.highlight) {
    const badge = document.createElement('span');
    badge.className = 'ag-badge';
    badge.textContent = 'UP NEXT';
    li.appendChild(badge);
  }
  return li;
}));

// School logo (event.logo in teams.json); stays hidden if the file is missing
if (event.logo) {
  for (const img of document.querySelectorAll('#intro-logo, #finale-logo, #corner-logo, #loader-logo, #agenda-logo')) {
    track(whenLoaded(img, 'load'));
    img.onload = () => { img.hidden = false; };
    img.classList.add(`shape-${event.logoShape ?? 'none'}`); // "circle", "rounded" or "none"
    img.src = event.logo;
  }
}

await track(document.fonts.load('900 80px Orbitron')).catch(() => {});

// ---------------------------------------------------------------------------
// Renderer, scene, camera, bloom
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas: $('#scene'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#05030f');
scene.fog = new THREE.FogExp2('#05030f', 0.004);

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 2000);
const rig = { pos: START.pos.clone(), target: START.target.clone(), roll: 0 };
const shake = new THREE.Vector3(); // short camera shake (e.g. the boom)
function shakeTl(amount, duration) {
  const s = { a: amount };
  return gsap.to(s, {
    a: 0,
    duration,
    ease: 'power2.out',
    onUpdate: () => shake.set((Math.random() - 0.5) * s.a, (Math.random() - 0.5) * s.a, 0),
    onComplete: () => shake.set(0, 0, 0),
  });
}

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), BLOOM_NORMAL, 0.5, 0.3);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// Per-frame callbacks (used by the explosion particles)
const tickers = new Set();

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------
function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.2, 'rgba(255,255,255,0.6)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.15)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const glowTex = makeGlowTexture();

function makeTextTexture(text, color, { width = 256, height = 128, size = 84 } = {}) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const g = c.getContext('2d');
  g.font = `900 ${size}px Orbitron, Preahvihear, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = color;
  g.shadowBlur = 24;
  g.fillStyle = '#ffffff';
  g.fillText(text, width / 2, height / 2 + 4, width - 20);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Shown on the 3D screen when a team's video file is missing
function makePlaceholderTexture(team) {
  const c = document.createElement('canvas');
  c.width = 1280;
  c.height = 720;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 1280, 720);
  grd.addColorStop(0, '#07051a');
  grd.addColorStop(1, team.style.color + '30');
  g.fillStyle = grd;
  g.fillRect(0, 0, 1280, 720);

  g.strokeStyle = team.style.color + '33';
  g.lineWidth = 1;
  for (let x = 0; x <= 1280; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 720); g.stroke(); }
  for (let y = 0; y <= 720; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(1280, y); g.stroke(); }

  g.textAlign = 'center';
  g.fillStyle = '#e8e4ff';
  g.font = '900 72px Orbitron, Preahvihear, sans-serif';
  g.fillText(team.project, 640, 320, 1180);
  g.fillStyle = team.style.color;
  g.font = '500 34px Inter, Preahvihear, sans-serif';
  if (team.video) {
    g.fillText('▶  Demo video coming soon', 640, 400);
    g.fillStyle = '#a9a3c9';
    g.font = '400 24px Inter, Preahvihear, sans-serif';
    g.fillText(`Add your file at: ${team.video}`, 640, 460);
  } else {
    g.fillText(team.teamName, 640, 400, 1180); // no video for this team: just its name
  }

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------------
// Background: stars, dust, nebula
// ---------------------------------------------------------------------------
function makePoints(count, rMin, rMax, size, hue) {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const r = rMin + Math.random() * (rMax - rMin);
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
    pos[i * 3 + 2] = r * Math.cos(ph);
    c.setHSL(hue + Math.random() * 0.25, 0.6, 0.6 + Math.random() * 0.4);
    col.set([c.r, c.g, c.b], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size,
    map: glowTex,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  return new THREE.Points(geo, mat);
}

const stars = makePoints(6000, 150, 600, 1.8, 0.55);
const dust = makePoints(1500, 20, 140, 0.45, 0.7);
scene.add(stars, dust);

[
  ['#6a3cff', [-180, 60, -320], 360],
  ['#ff3c8e', [200, -40, -380], 320],
  ['#1fb6ff', [0, 120, -450], 420],
].forEach(([color, p, s]) => {
  const neb = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color, transparent: true, opacity: 0.14,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  neb.position.set(...p);
  neb.scale.setScalar(s);
  scene.add(neb);
});

// ---------------------------------------------------------------------------
// Team objects: a mystery planet + a hidden video screen
// ---------------------------------------------------------------------------
function screenSize(team) {
  const s = team.style.screenScale;
  return { W: 12 * s, H: 6.75 * s };
}

// ---------------------------------------------------------------------------
// Raw crystal stones: a lumpy rock cut by random flat "fracture" planes,
// drawn with a shader that glows hot in the middle and dark at the edges
// ---------------------------------------------------------------------------
function seededRandom(seed) {
  let a = seed * 2654435761;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRockGeometry(seed) {
  const rand = seededRandom(seed);
  const geo = new THREE.IcosahedronGeometry(2.2, 4);
  const pos = geo.attributes.position;

  // Random bumps on the surface
  const bumps = Array.from({ length: 7 }, () => ({
    dir: new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize(),
    amount: 0.08 + rand() * 0.14,
  }));
  // Flat fracture cuts (anything beyond the plane gets sliced off)
  const cuts = Array.from({ length: 16 }, () => ({
    n: new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize(),
    d: 1.65 + rand() * 0.45,
  }));

  const v = new THREE.Vector3();
  const dir = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    dir.copy(v).normalize();
    let r = 2.2;
    for (const b of bumps) r += b.amount * Math.max(0, dir.dot(b.dir)) ** 2;
    v.copy(dir).multiplyScalar(r);
    for (const c of cuts) {
      const over = v.dot(c.n) - c.d;
      if (over > 0) v.addScaledVector(c.n, -over);
    }
    v.set(v.x * 0.95, v.y * 1.25, v.z * 0.85); // egg-like, a bit flat
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

function makeStoneMaterial(color) {
  const base = new THREE.Color(color);
  const core = base.clone().lerp(new THREE.Color('#fff4c2'), 0.55);
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: base },
      uCore: { value: core },
      uTime: { value: 0 },
      uGlow: { value: 1.3 * STONE_GLOW },
      uSeed: { value: Math.random() * 100 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vObjPos;
      varying vec3 vViewPosition;
      void main() {
        vObjPos = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewPosition = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform vec3 uCore;
      uniform float uTime;
      uniform float uGlow;
      uniform float uSeed;
      varying vec3 vObjPos;
      varying vec3 vViewPosition;

      float hash(vec3 p) {
        p = fract(p * 0.3183099 + 0.1);
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }
      float noise(vec3 x) {
        vec3 i = floor(x);
        vec3 f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x),
              mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
          mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
              mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
      }
      float fbm(vec3 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
        return v;
      }

      void main() {
        // Flat facet normal -> chunky broken-crystal look
        vec3 n = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
        vec3 v = normalize(vViewPosition);
        float facing = clamp(abs(dot(n, v)), 0.0, 1.0);

        // Swirling energy inside the stone
        vec3 p = vObjPos * 0.9 + vec3(uSeed, uTime * 0.15, 0.0);
        float energy = fbm(p + fbm(p * 1.7 + uTime * 0.1));

        // Hot in the middle (faces pointing at you), dark saturated edges
        float centre = pow(facing, 1.5) * (0.5 + energy);
        vec3 col = uColor * 0.12;
        col = mix(col, uColor, smoothstep(0.15, 0.6, centre));
        col = mix(col, uCore, smoothstep(0.6, 1.05, centre));

        // Thin glowing cracks
        float crack = 1.0 - smoothstep(0.0, 0.03, abs(noise(vObjPos * 2.6 + uSeed) - 0.5));
        col += uCore * crack * 0.45 * facing;

        // Light glints on the facets
        vec3 h = normalize(normalize(vec3(0.4, 0.8, 0.6)) + v);
        col += vec3(pow(max(dot(n, h), 0.0), 70.0)) * 0.7;

        // Coloured rim
        col += uColor * pow(1.0 - facing, 3.0) * 0.35;

        gl_FragColor = vec4(col * uGlow, 1.0);
      }
    `,
  });
}

function makeAura(color, count = 320) {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 3.4 + Math.random() * 2.2;
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 6;
    pos[i * 3 + 2] = Math.sin(a) * r;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({
    size: 0.22, map: glowTex, color, transparent: true, opacity: 0.85,
    depthWrite: false, blending: THREE.AdditiveBlending,
  }));
}

function makePlanet(team) {
  const color = new THREE.Color(team.style.color);
  const group = new THREE.Group();
  group.position.set(...team.style.pos);

  const gem = new THREE.Mesh(makeRockGeometry(team.rank * 7 + 3), makeStoneMaterial(color));
  gem.rotation.set(Math.random() * 0.6 - 0.3, Math.random() * 6, Math.random() * 0.6 - 0.3);
  const aura = makeAura(color);
  aura.rotation.z = 0.25;
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color, transparent: true, opacity: 0.5 * STONE_GLOW,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  glow.scale.setScalar(15);
  // #1 is the farthest stone, so make it bigger to stand out as the winner
  if (team.rank === 1) {
    gem.scale.setScalar(1.6);
    aura.scale.setScalar(1.6);
    glow.scale.setScalar(24);
  }
  group.add(glow, gem, aura);
  group.userData = { gem, aura, glow, baseY: group.position.y, seed: Math.random() * 10 };
  scene.add(group);
  return group;
}

// Crystal shards that fly out when a stone shatters
function shardsTl(team, center) {
  const mat = team.planet.userData.gem.material;
  const geo = new THREE.TetrahedronGeometry(0.55, 0);
  const shards = [];
  for (let i = 0; i < 36; i++) {
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(center);
    m.scale.setScalar(0.5 + Math.random() * 1.1);
    m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    const dir = new THREE.Vector3().randomDirection().multiplyScalar(10 + Math.random() * 16);
    m.userData = { dir, spin: new THREE.Vector3().randomDirection().multiplyScalar(6) };
    shards.push(m);
    scene.add(m);
  }
  const state = { p: 0 };
  const tl = gsap.timeline();
  tl.to(state, {
    p: 1,
    duration: 1.8,
    ease: 'expo.out',
    onUpdate: () => {
      for (const m of shards) {
        m.position.copy(center).addScaledVector(m.userData.dir, state.p);
        m.rotation.x = m.userData.spin.x * state.p;
        m.rotation.y = m.userData.spin.y * state.p;
      }
    },
  });
  tl.to(shards.map((m) => m.scale), { x: 0, y: 0, z: 0, duration: 0.9, ease: 'power2.in' }, 0.7);
  tl.call(() => {
    shards.forEach((m) => scene.remove(m));
    geo.dispose();
  });
  return tl;
}

function makeScreen(team) {
  const { W, H } = screenSize(team);
  const color = new THREE.Color(team.style.color);
  const group = new THREE.Group();
  group.position.set(...team.style.pos);
  group.visible = false;

  const haloMat = new THREE.SpriteMaterial({
    map: glowTex, color, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const halo = new THREE.Sprite(haloMat);
  halo.scale.set(W * 2, H * 2.4, 1);
  halo.position.z = -0.3;

  const frameMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0 });
  const frame = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.45, H + 0.45), frameMat);
  frame.position.z = -0.06;

  const screenMat = new THREE.MeshBasicMaterial({
    map: team.placeholderTex, toneMapped: false, transparent: true, opacity: 0, fog: false,
  });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(W, H), screenMat);
  // Draw the frame and screen before other see-through objects so they block what's behind
  frame.renderOrder = -2;
  screen.renderOrder = -1;

  const nameMat = new THREE.SpriteMaterial({
    map: makeTextTexture(team.teamName, team.style.color, { width: 1024, height: 128, size: 72 }),
    transparent: true, opacity: 0, depthWrite: false,
  });
  const nameLabel = new THREE.Sprite(nameMat);
  nameLabel.scale.set(W, W / 8, 1);
  nameLabel.position.y = H / 2 + 1.4;

  group.add(halo, frame, screen, nameLabel);
  scene.add(group);
  return { group, screenMat, frameMat, haloMat, nameMat };
}

// Fill the 16:9 screen without stretching: a video of another shape is cropped in the middle
// (a square video loses a bit of its top and bottom)
function fitVideoToScreen(team, videoAspect) {
  if (!(videoAspect > 0)) return;
  const { W, H } = screenSize(team);
  const screenAspect = W / H;
  const tex = team.videoTex;
  const rx = videoAspect > screenAspect ? screenAspect / videoAspect : 1;
  const ry = videoAspect < screenAspect ? videoAspect / screenAspect : 1;
  tex.repeat.set(rx, ry);
  tex.offset.set((1 - rx) / 2, (1 - ry) / 2);
}

function setupVideo(team) {
  const v = document.createElement('video');
  v.playsInline = true;
  v.preload = 'auto';
  v.crossOrigin = 'anonymous';
  team.videoEl = v;
  team.videoStatus = team.video ? 'loading' : 'none';
  if (team.video) track(whenLoaded(v, 'loadedmetadata'));
  team.videoTex = new THREE.VideoTexture(v);
  team.videoTex.colorSpace = THREE.SRGBColorSpace;

  v.addEventListener('loadeddata', () => {
    team.videoStatus = 'ready';
    fitVideoToScreen(team, v.videoWidth / v.videoHeight);
    team.screen.screenMat.map = team.videoTex;
    team.screen.screenMat.needsUpdate = true;
  });
  v.addEventListener('error', () => {
    team.videoStatus = 'error';
    if (teams[current] === team && !busy) showHint();
  });
  v.addEventListener('ended', () => onVideoEnded(team));
  v.addEventListener('timeupdate', () => checkVideoLimit(team, v));
  if (team.video) v.src = team.video;
}

for (const team of teams) {
  team.placeholderTex = makePlaceholderTexture(team);
  team.planet = makePlanet(team);
  team.screen = makeScreen(team);
  team.revealed = false;
  setupVideo(team);
}

// ---------------------------------------------------------------------------
// Music (optional: put a file at audio/music.mp3)
// ---------------------------------------------------------------------------
const music = new Audio('audio/music.mp3');
music.loop = false;
music.volume = 0;
// Music stops completely while a team's video plays (from the build-up until the video ends),
// then fades back in and continues where it stopped
let musicOn = false; // true once the top 5 part has started

function startMusic() {
  musicOn = true;
  musicEnding = false;
  gsap.killTweensOf(music);
  if (music.currentTime >= MUSIC_END - MUSIC_FADE) music.currentTime = 0; // starting the show again: from the top
  music.play().catch(() => {});
  gsap.to(music, { volume: MUSIC_VOLUME, duration: 2.5, ease: 'power1.in' });
}

function stopMusic() {
  musicOn = false;
  gsap.killTweensOf(music);
  gsap.to(music, { volume: 0, duration: 1, onComplete: () => music.pause() });
}

// At 1:47 the music fades out over 3 s and stops for good (until the show is started again)
let musicEnding = false;
music.addEventListener('timeupdate', () => {
  if (musicEnding || !musicOn || music.paused || music.currentTime < MUSIC_END - MUSIC_FADE) return;
  musicEnding = true;
  musicOn = false; // duckMusic() won't bring it back
  gsap.killTweensOf(music);
  gsap.to(music, { volume: 0, duration: MUSIC_FADE, ease: 'power1.in', onComplete: () => music.pause() });
});

function duckMusic(down) {
  gsap.killTweensOf(music);
  if (down) {
    gsap.to(music, { volume: 0, duration: 0.8, onComplete: () => music.pause() });
  } else if (started && musicOn) {
    music.play().catch(() => {});
    gsap.to(music, { volume: MUSIC_VOLUME, duration: 1.5 });
  }
}

// Sound when a stone shatters (audio/impactglass.mp3). The file is long, so only
// the first ~3 s are used, then it fades out. #1 plays a bit louder and deeper.
const STONE_SOUND_VOLUME = 0.8;
const STONE_SOUND_LENGTH = 3; // seconds before it fades out
const stoneSound = new Audio('audio/impactglass.mp3');

// Build-up for the energy orb (audio/beforeboom.mp3). The riser cuts off at ORB_SOUND_HIT
// seconds into the file; playback starts early enough for that moment to land on the boom.
const ORB_SOUND_HIT = 8.15;
const ORB_SOUND_VOLUME = 0.3; // build-up (beforeboom) volume
const ORB_SOUND_FADE_IN = 1.6; // seconds the build-up takes to fade in
// Fine sync between the boom you hear and the flash you see:
// positive = the light comes this many seconds AFTER the sound's start-of-boom, negative = before
const BOOM_LIGHT_DELAY = 0.14;
const orbSound = new Audio('audio/beforeboom.mp3');
orbSound.preload = 'auto';
function playOrbSound(secondsUntilBoom, isTop) {
  gsap.killTweensOf(orbSound);
  orbSound.pause();
  orbSound.currentTime = Math.max(0, ORB_SOUND_HIT - secondsUntilBoom + 0.05); // +0.05 s for playback start delay
  orbSound.volume = 0;
  orbSound.play().catch(() => {});
  // fade in gently instead of starting at full volume
  gsap.to(orbSound, { volume: Math.min(1, ORB_SOUND_VOLUME * (isTop ? 1.1 : 1)), duration: ORB_SOUND_FADE_IN, ease: 'power2.in' });
}
// Stop the riser right at the boom (its own boom is not used; the glass impact replaces it)
function stopOrbSound() {
  gsap.killTweensOf(orbSound);
  gsap.to(orbSound, { volume: 0, duration: 0.05, onComplete: () => orbSound.pause() });
}

// The boom: the glass impact, slowed down so it sounds deeper and longer (movie slow-motion)
const BOOM_VOLUME = 0.5;
const BOOM_SPEED = 0.7; // 1 = normal; lower = slower and deeper
const BOOM_LENGTH = 4; // seconds before it fades out
function playBoomSound(isTop) {
  const s = stoneSound.cloneNode();
  s.preservesPitch = false; // slow AND deep, like a movie
  s.playbackRate = isTop ? BOOM_SPEED * 0.85 : BOOM_SPEED;
  s.volume = Math.min(1, BOOM_VOLUME * (isTop ? 1.2 : 1));
  s.play().catch(() => {});
  gsap.to(s, { volume: 0, duration: 1.5, delay: BOOM_LENGTH, ease: 'power1.in', onComplete: () => s.pause() });
}

stoneSound.preload = 'auto';
// Glitch sound when the big rank number (#5, #4...) pops up (audio/glitchsound.mp3)
const GLITCH_VOLUME = 0.45;
const glitchSound = new Audio('audio/glitchsound.mp3');
glitchSound.preload = 'auto';
function playGlitchSound(isTop) {
  const s = glitchSound.cloneNode();
  s.preservesPitch = false;
  s.playbackRate = isTop ? 0.85 : 1; // a bit deeper for #1
  s.volume = Math.min(1, GLITCH_VOLUME * (isTop ? 1.2 : 1));
  s.play().catch(() => {});
}

// Sound when each member's name tag pops up (audio/studennamesound.mp3).
// The file is silent for its first ~0.65 s, so playback skips straight to the pop.
// Each next member in the row sounds slightly higher, so it feels like a sequence.
const NAME_SOUND_VOLUME = 0.35;
const NAME_SOUND_START = 0.64; // seconds into the file where the pop begins
const nameSound = new Audio('audio/studennamesound.mp3');
nameSound.preload = 'auto';
function playNameSound(index) {
  const s = nameSound.cloneNode();
  s.preservesPitch = false;
  s.playbackRate = 1 + index * 0.06;
  s.volume = NAME_SOUND_VOLUME;
  s.currentTime = NAME_SOUND_START;
  s.play().catch(() => {});
}

function playStoneSound(isTop) {
  const s = stoneSound.cloneNode();
  s.volume = Math.min(1, STONE_SOUND_VOLUME * (isTop ? 1.25 : 1));
  s.playbackRate = isTop ? 0.85 : 1; // slower = deeper for the winner
  s.play().catch(() => {});
  gsap.to(s, { volume: 0, duration: 1, delay: STONE_SOUND_LENGTH, onComplete: () => s.pause() });
}

// ---------------------------------------------------------------------------
// Camera helpers
// ---------------------------------------------------------------------------
// Where the camera sits to look at a team's screen.
// Normal view: screen takes ~56% of the window height and sits low, leaving room for the
// rank / team name / project above it. Zoomed: the screen fills the window.
function teamView(team, zoom = false) {
  const { W, H } = screenSize(team);
  const fillH = zoom ? 1 : 0.56;
  const fillW = zoom ? 1 : 0.84;
  const tan = Math.tan(THREE.MathUtils.degToRad(50 / 2));
  const d = Math.max(H / (fillH * 2 * tan), W / (fillW * 2 * tan * camera.aspect));
  const shiftUp = zoom ? 0 : 2 * d * tan * 0.075; // moves the screen ~7.5% down the window
  const target = new THREE.Vector3(...team.style.pos).add(new THREE.Vector3(0, shiftUp, 0));
  return { pos: target.clone().add(new THREE.Vector3(0, 0, d)), target };
}

function flyTo(pos, target, duration = 2.2, warp = 0) {
  const tl = gsap.timeline();
  tl.to(rig.pos, { x: pos.x, y: pos.y, z: pos.z, duration, ease: 'power3.inOut' }, 0);
  tl.to(rig.target, { x: target.x, y: target.y, z: target.z, duration, ease: 'power3.inOut' }, 0);
  if (warp) {
    tl.to(camera, {
      fov: 50 + warp,
      duration: duration / 2,
      ease: 'power2.inOut',
      yoyo: true,
      repeat: 1,
      onUpdate: () => camera.updateProjectionMatrix(),
    }, 0);
  }
  return tl;
}

// ---------------------------------------------------------------------------
// DOM animations
// ---------------------------------------------------------------------------
const hud = $('#hud');
const hint = $('#hint');

function bigRankTl(team) {
  const el = $('#big-rank');
  return gsap.timeline()
    // blur + darken whatever is behind first, then show the number
    .to('#rank-backdrop', { autoAlpha: 1, duration: 0.45, ease: 'power2.out' })
    .call(() => {
      el.querySelector('.num').textContent = `#${team.rank}`;
      el.style.setProperty('--c', team.style.color);
      el.classList.add('glitch');
      playGlitchSound(team.rank === 1);
    })
    .fromTo(el,
      { autoAlpha: 0, scale: 2.4, filter: 'blur(24px)' },
      { autoAlpha: 1, scale: 1, filter: 'blur(0px)', duration: 0.7, ease: 'expo.out' })
    .to(el, { autoAlpha: 0, scale: 0.85, filter: 'blur(10px)', duration: 0.45, ease: 'power2.in', delay: 0.7 })
    .to('#rank-backdrop', { autoAlpha: 0, duration: 0.6, ease: 'power2.inOut' }, '<0.15')
    .call(() => el.classList.remove('glitch'));
}

function suspenseTl() {
  const el = $('#suspense');
  return gsap.timeline()
    .to('#rank-backdrop', { autoAlpha: 1, duration: 0.6, ease: 'power2.out' }, 0)
    .to(bloom, { strength: 0.5, duration: 1 }, 0)
    .fromTo(el,
      { autoAlpha: 0, y: 20, letterSpacing: '0.05em' },
      { autoAlpha: 1, y: 0, letterSpacing: '0.25em', duration: 1.4, ease: 'power2.out' }, 0)
    .to(el, { autoAlpha: 0, duration: 0.5, delay: 1.2 });
}

// Preload member photos so they appear instantly in the spotlight
for (const team of teams) {
  for (const m of team.members ?? []) if (m.photo) new Image().src = m.photo;
}

// Team group photos: we need their size to crop each member out of them
function loadImageSize(src) {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => resolve({ w: im.naturalWidth, h: im.naturalHeight });
    im.onerror = () => resolve(null);
    im.src = src;
  });
}
await Promise.all(teams.map(async (t) => {
  t.photoSize = t.photo ? await track(loadImageSize(t.photo)) : null;
}));

// CSS that shows one member cut out of the team's group photo.
// face = where their face is in the photo, in % from the left/top.
// boxRatio = box height / width, faceAt = where the face should sit in the box (0 top – 1 bottom)
function faceCropStyle(team, face, boxRatio, zoom, faceAt) {
  const imgRatio = team.photoSize.h / team.photoSize.w;
  zoom = Math.max(zoom, (boxRatio / imgRatio) * 1.01, 1.01); // photo must always cover the box
  const imgH = zoom * imgRatio; // photo height, measured in box widths
  const clamp = (v) => Math.min(1, Math.max(0, v));
  const px = clamp((0.5 - (face.x / 100) * zoom) / (1 - zoom));
  const py = clamp((faceAt * boxRatio - (face.y / 100) * imgH) / (boxRatio - imgH));
  return `background-image:url("${team.photo}");background-size:${zoom * 100}% auto;`
    + `background-position:${px * 100}% ${py * 100}%;`;
}

// How to picture a member: their own photo, a crop of the team photo, or nothing (initials)
function memberPicture(team, m, boxRatio, zoomMul, faceAt) {
  if (m.photo) return { src: m.photo };
  if (m.face && team.photoSize) {
    return { style: faceCropStyle(team, m.face, boxRatio, (team.photoZoom ?? 3.2) * zoomMul, faceAt) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Team photo spotlight (memberStyle: "group" in teams.json)
// The outline + glow is drawn once into a new image at startup, so showing and
// animating it later costs nothing extra.
// ---------------------------------------------------------------------------
async function bakeOutlinedPhoto(src, color) {
  const original = new Image();
  original.src = src;
  await original.decode();
  const iw = original.naturalWidth;
  const ih = original.naturalHeight;

  // Fade out the bottom of the photo, so a waist-up cut has no hard edge or outline line
  const img = document.createElement('canvas');
  img.width = iw;
  img.height = ih;
  const ig = img.getContext('2d');
  ig.drawImage(original, 0, 0);
  const fade = ig.createLinearGradient(0, ih * 0.78, 0, ih);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(1, 'rgba(0,0,0,1)');
  ig.globalCompositeOperation = 'destination-out';
  ig.fillStyle = fade;
  ig.fillRect(0, ih * 0.78, iw, ih * 0.22);

  const unit = Math.max(iw, ih) / 800;
  const pad = Math.round(40 * unit);
  const w = iw + pad * 2;
  const h = ih + pad * 2;
  const canvas = () => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return [c, c.getContext('2d')];
  };
  // Solid-colour shape of the people (uses the photo's transparency)
  const silhouette = (fill) => {
    const [c, g] = canvas();
    g.drawImage(img, pad, pad);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = fill;
    g.fillRect(0, 0, w, h);
    return c;
  };
  const outer = silhouette(color);
  const inner = silhouette('#ffffff');
  const [c, g] = canvas();
  const ring = (sil, r) => {
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      g.drawImage(sil, Math.cos(a) * r, Math.sin(a) * r);
    }
  };
  g.save();
  g.shadowColor = color;
  g.shadowBlur = 36 * unit;
  g.drawImage(outer, 0, 0); // soft glow
  g.drawImage(outer, 0, 0);
  g.restore();
  ring(outer, 10 * unit); // coloured outline
  ring(inner, 4 * unit); // thin white line inside it
  g.drawImage(img, pad, pad);

  const toUrl = async (cv) => URL.createObjectURL(await new Promise((resolve) => cv.toBlob(resolve, 'image/png')));
  const url = await toUrl(c);
  const maskUrl = await toUrl(inner); // exact shape of the people, used for the skeleton
  const out = new Image();
  out.src = url;
  await out.decode();
  return { url, maskUrl, w, h, pad, iw, ih };
}

for (const team of teams) {
  if (team.memberStyle === 'group' && team.photo) {
    team.groupReady = track(bakeOutlinedPhoto(team.photo, team.style.color))
      .then((g) => { team.group = g; })
      .catch(() => {});
  }
}

function groupIntroTl(team) {
  const members = team.members ?? [];
  const wrap = $('#group-intro');
  const stage = wrap.querySelector('.gi-stage');
  const photo = wrap.querySelector('.gi-photo');
  const skeleton = wrap.querySelector('.gi-skeleton');
  const spot = wrap.querySelector('.gi-spot');

  const hasPhoto = !!(team.photo && team.groupReady);

  // Horizontal position of a member, in % of the stage
  const xOf = (m, i) => {
    const g = team.group;
    if (g && m.face) return ((g.pad + (m.face.x / 100) * g.iw) / g.w) * 100;
    // centre of the i-th placeholder silhouette (matches the .gi-skeleton layout: 4% sides, 4% gaps)
    const n = members.length;
    const w = (92 - 4 * (n - 1)) / n;
    return 4 + i * (w + 4) + w / 2;
  };

  const tags = members.map((m) => {
    const t = document.createElement('div');
    t.className = 'gi-tag';
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = m.name;
    const role = document.createElement('div');
    role.className = 'role';
    role.textContent = m.role ?? '';
    t.append(name, role);
    return t;
  });

  // Shrink long names until they fit the tag, instead of cutting them off.
  // A tag may only be as wide as the space to its neighbours, so tags never overlap.
  // All names then use the same size (the smallest one needed), so they look alike.
  const fitTagNames = () => {
    const names = tags.map((t) => t.querySelector('.name'));
    const sizes = tags.map((t, i) => {
      const x = xOf(members[i], i);
      let room = 2 * Math.min(x, 100 - x);
      if (i > 0) room = Math.min(room, x - xOf(members[i - 1], i - 1));
      if (i < tags.length - 1) room = Math.min(room, xOf(members[i + 1], i + 1) - x);
      t.style.maxWidth = `${Math.min(32, room - 2)}%`;
      const name = names[i];
      name.style.fontSize = '';
      let size = parseFloat(getComputedStyle(name).fontSize);
      while (name.scrollWidth > name.clientWidth && size > 8) name.style.fontSize = `${--size}px`;
      return size;
    });
    const size = Math.min(...sizes);
    names.forEach((n) => { n.style.fontSize = `${size}px`; });
    gsap.set(tags, { xPercent: -50, x: 0 }); // centred under the face (GSAP-safe, whatever the tag width)
  };

  const applyPhoto = () => {
    const g = team.group;
    if (!g) return;
    stage.style.setProperty('--ar', g.w / g.h);
    photo.src = g.url;
    tags.forEach((t, i) => { t.style.left = `${xOf(members[i], i)}%`; });
    fitTagNames();
  };

  const setup = () => {
    wrap.style.setProperty('--c', team.style.color);
    const g = team.group;
    if (g) {
      // Skeleton in the exact shape of the people in the photo
      stage.style.setProperty('--ar', g.w / g.h);
      const shape = document.createElement('div');
      shape.className = 'sk-shape';
      shape.style.webkitMaskImage = shape.style.maskImage = `url("${g.maskUrl}")`;
      skeleton.className = 'gi-skeleton exact';
      skeleton.replaceChildren(shape);
    } else {
      // Photo not ready yet: generic waist-up silhouettes
      stage.style.setProperty('--ar', members.length > 2 ? 1.4 : 1);
      skeleton.className = 'gi-skeleton';
      skeleton.replaceChildren(...members.map((m) => {
        const p = document.createElement('div');
        p.className = 'sk-person';
        p.innerHTML = '<div class="sk-head"><span></span></div><div class="sk-body"></div>';
        p.querySelector('span').textContent = m.name.slice(0, 2).toUpperCase();
        return p;
      }));
    }
    wrap.querySelector('.gi-tags').replaceChildren(...tags);
    tags.forEach((t, i) => { t.style.left = `${xOf(members[i], i)}%`; });
    fitTagNames();
    gsap.set(stage, { scale: 1, scaleX: 1, scaleY: 1, rotation: 0, filter: 'none', autoAlpha: 1 });
    gsap.set(skeleton, { autoAlpha: 1 });
    gsap.set([photo, ...tags], { autoAlpha: 0 });
    gsap.set(spot, { opacity: 0 });
    photo.removeAttribute('src');
  };

  const tl = gsap.timeline();
  tl.call(setup);
  tl.to(wrap, { autoAlpha: 1, duration: 0.4 });
  if (hasPhoto) {
    // Skeleton shows for a moment; if the photo still isn't ready, wait for it
    tl.call(() => {
      if (team.group) return applyPhoto();
      const parent = revealTl;
      parent?.pause();
      Promise.resolve(team.groupReady).then(() => { applyPhoto(); parent?.resume(); });
    }, null, '+=0.7');
    tl.to(skeleton, { autoAlpha: 0, duration: 0.4 });
    tl.fromTo(photo,
      { autoAlpha: 0, scale: 0.94, filter: 'blur(10px)' },
      { autoAlpha: 1, scale: 1, filter: 'blur(0px)', duration: 0.9, ease: 'expo.out' }, '<');
  } else {
    // No team photo yet: the skeleton turns into solid placeholder silhouettes with initials
    tl.call(() => skeleton.classList.add('solid'), null, '+=0.6');
    tl.to({}, { duration: 0.5 });
  }

  members.forEach((m, i) => {
    tl.call(() => spot.style.setProperty('--x', `${xOf(m, i)}%`));
    tl.to(spot, { opacity: 1, duration: 0.4 }, '<');
    tl.call(() => playNameSound(i));
    tl.fromTo(tags[i],
      { autoAlpha: 0, y: 20, scale: 0.85 },
      { autoAlpha: 1, y: 0, scale: 1, duration: 0.5, ease: 'back.out(2)' });
    tl.to({}, { duration: MEMBER_HOLD * 0.7 });
  });
  tl.to(spot, { opacity: 0, duration: 0.5 });
  tl.to({}, { duration: 1 });
  // (no fade-out here: the energy orb transition fades it)
  return tl;
}

function memberIntroTl(team) {
  if (team.memberStyle === 'group') return groupIntroTl(team);
  const members = team.members ?? [];
  const wrap = $('#member-intro');
  const card = wrap.querySelector('.mi-card');
  const img = wrap.querySelector('img');
  const crop = wrap.querySelector('.mi-crop');
  img.onerror = () => { img.style.display = 'none'; }; // fall back to initials

  const fill = (m, i) => {
    wrap.style.setProperty('--c', team.style.color);
    wrap.querySelector('.mi-initials').textContent = m.name.slice(0, 2).toUpperCase();
    wrap.querySelector('.mi-count').textContent = `MEMBER ${i + 1} / ${members.length}`;
    wrap.querySelector('.mi-name').textContent = m.name;
    wrap.querySelector('.mi-role').textContent = m.role ?? '';
    const pic = memberPicture(team, m, 4 / 3, 1, 0.4);
    img.style.display = pic?.src ? '' : 'none';
    if (pic?.src) img.src = pic.src;
    crop.style.cssText = pic?.style ?? 'display:none';
    card.classList.remove('sweep');
    void card.offsetWidth; // restart the light-sweep animation
    card.classList.add('sweep');
  };

  const tl = gsap.timeline();
  if (!members.length) return tl;
  tl.to(wrap, { autoAlpha: 1, duration: 0.4 });
  members.forEach((m, i) => {
    tl.call(() => { fill(m, i); playNameSound(i); });
    tl.fromTo(card,
      { autoAlpha: 0, x: 140, scale: 0.8, rotateY: -30, filter: 'blur(12px)' },
      { autoAlpha: 1, x: 0, scale: 1, rotateY: 0, filter: 'blur(0px)', duration: 0.7, ease: 'expo.out' });
    tl.fromTo(card.querySelectorAll('.mi-count, .mi-name, .mi-role'),
      { autoAlpha: 0, y: 20 },
      { autoAlpha: 1, y: 0, stagger: 0.1, duration: 0.5, ease: 'power2.out' }, '-=0.45');
    tl.to(card,
      { autoAlpha: 0, x: -140, scale: 0.85, rotateY: 30, filter: 'blur(8px)', duration: 0.5, ease: 'power2.in', delay: MEMBER_HOLD });
  });
  tl.to(wrap, { autoAlpha: 0, duration: 0.4 });
  return tl;
}

function hideMemberIntro() {
  gsap.to(['#member-intro', '#group-intro'], { autoAlpha: 0, duration: 0.3 });
}

function showHud(team) {
  buildHud(team);
  animateHudIn();
}

function buildHud(team) {
  hud.style.setProperty('--c', team.style.color);
  $('#hud-rank').textContent = `RANK #${team.rank}`;
  $('#hud-project').textContent = team.project;

  // Animate word by word so names in any script (including Khmer) render correctly
  const teamEl = $('#hud-team');
  teamEl.replaceChildren(...team.teamName.split(/\s+/).map((w) => {
    const s = document.createElement('span');
    s.textContent = w;
    return s;
  }));
}

function animateHudIn() {
  const teamEl = $('#hud-team');
  gsap.killTweensOf(hud);
  gsap.set(hud, { autoAlpha: 1 });
  gsap.timeline()
    .fromTo('#hud-rank', { autoAlpha: 0, y: -20 }, { autoAlpha: 1, y: 0, duration: 0.5 })
    .fromTo(teamEl.children,
      { autoAlpha: 0, y: 40, rotateX: -90 },
      { autoAlpha: 1, y: 0, rotateX: 0, stagger: 0.08, duration: 0.6, ease: 'back.out(2)' }, '-=0.2')
    .fromTo('#hud-project', { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.5 }, '-=0.3');
}

function hideHud() {
  gsap.to(hud, { autoAlpha: 0, duration: 0.3 });
}

function nextHintText() {
  if (current < 0) return `Press → to reveal Rank #${teams[0].rank}`;
  if (current < teams.length - 1) return `Press → for Rank #${teams[current + 1].rank}`;
  if (current === teams.length - 1) return 'Press → for the finale';
  return '';
}

function showHint() {
  const text = nextHintText();
  if (!text) return;
  hint.textContent = text;
  gsap.fromTo(hint, { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.5 });
}

function hideHint() {
  gsap.to(hint, { autoAlpha: 0, duration: 0.2 });
}

const progress = $('#progress');
progress.replaceChildren(...teams.map((t) => {
  const d = document.createElement('span');
  d.className = 'dot';
  d.textContent = `#${t.rank}`;
  d.style.setProperty('--dot-c', t.style.color);
  return d;
}));
function updateProgress() {
  [...progress.children].forEach((d, i) => {
    d.classList.toggle('active', i === current);
    d.classList.toggle('done', i < current || current >= teams.length);
  });
}

function celebrate(gold = true) {
  const colors = gold ? ['#ffd166', '#fff3c4', '#ffb703'] : ['#ffd166', '#ff7ab6', '#4cc9f0', '#b388ff'];
  const fire = (x, angle) => window.confetti?.({
    particleCount: 90, spread: 70, startVelocity: 55, angle, origin: { x, y: 0.7 }, colors,
  });
  [0, 0.5, 1.0].forEach((delay) => gsap.delayedCall(delay, () => { fire(0.1, 60); fire(0.9, 120); }));
}

// ---------------------------------------------------------------------------
// The planet explodes into particles, which regroup into the video screen
// ---------------------------------------------------------------------------
// The stone shatters: shards + a burst of glowing particles that drift away and fade.
// (The video screen is NOT shown here; it appears after the members.)
function explodeTl(team) {
  const planet = team.planet;
  const center = new THREE.Vector3(...team.style.pos);
  const N = 1800;

  const start = new Float32Array(N * 3);
  const burst = new Float32Array(N * 3);
  const dir = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    dir.randomDirection();
    const k = i * 3;
    start[k] = center.x + dir.x * 3;
    start[k + 1] = center.y + dir.y * 3;
    start[k + 2] = center.z + dir.z * 3;
    const r = 8 + Math.random() * 22;
    burst[k] = center.x + dir.x * r;
    burst[k + 1] = center.y + dir.y * r;
    burst[k + 2] = center.z + dir.z * r;
  }

  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(start.slice(), 3);
  geo.setAttribute('position', posAttr);
  const mat = new THREE.PointsMaterial({
    size: 0.3, map: glowTex, color: team.style.color, transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);

  const state = { b: 0 };
  const update = () => {
    const p = posAttr.array;
    for (let k = 0; k < N * 3; k++) p[k] = start[k] + (burst[k] - start[k]) * state.b;
    posAttr.needsUpdate = true;
  };

  return gsap.timeline()
    .to(planet.scale, { x: 1.35, y: 1.35, z: 1.35, duration: 0.5, ease: 'power2.in' })
    .call(() => {
      planet.visible = false;
      team.revealed = true;
      playStoneSound(team.rank === 1);
      scene.add(points);
      tickers.add(update);
      shardsTl(team, planet.position.clone());
      gsap.fromTo(bloom, { strength: 2 }, { strength: BLOOM_NORMAL, duration: 1.2 });
    })
    .to(state, { b: 1, duration: 1.6, ease: 'expo.out' })
    .to(mat, { opacity: 0, duration: 0.8 }, '-=0.9')
    .call(() => {
      tickers.delete(update);
      scene.remove(points);
      geo.dispose();
      mat.dispose();
    });
}

function hideScreen(team) {
  const s = team.screen;
  s.group.visible = false;
  s.screenMat.opacity = 0;
  s.frameMat.opacity = 0;
  s.haloMat.opacity = 0;
}

// ---------------------------------------------------------------------------
// Energy orb before the video: a glowing core with a starburst flare, tilted
// orbit rings with comets of light racing around them.
// It spins up, flashes, and the video screen comes out of the core.
// ---------------------------------------------------------------------------
let flareTex = null;
function makeFlareTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.globalCompositeOperation = 'lighter';
  const core = g.createRadialGradient(256, 256, 0, 256, 256, 120);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(0.25, 'rgba(220,235,255,0.6)');
  core.addColorStop(1, 'rgba(120,170,255,0)');
  g.fillStyle = core;
  g.fillRect(0, 0, 512, 512);
  // thin starburst rays
  for (let k = 0; k < 8; k++) {
    const len = k % 2 ? 150 : 250;
    g.save();
    g.translate(256, 256);
    g.rotate((k / 8) * Math.PI * 2 + 0.2);
    const ray = g.createLinearGradient(0, 0, len, 0);
    ray.addColorStop(0, 'rgba(255,255,255,0.9)');
    ray.addColorStop(1, 'rgba(160,200,255,0)');
    g.fillStyle = ray;
    g.beginPath();
    g.moveTo(0, -3);
    g.lineTo(len, 0);
    g.lineTo(0, 3);
    g.fill();
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildOrb(team, state) {
  const { H } = screenSize(team);
  const R = H * 0.42; // orbit radius
  const group = new THREE.Group();
  group.position.set(...team.style.pos);

  // Colours from the team's stone: stone-coloured halo and rings, lighter trails, white-hot core
  const stone = new THREE.Color(team.style.color);
  const tint = stone.clone();
  const bright = stone.clone().lerp(new THREE.Color('#ffffff'), 0.35);
  const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false };

  // Orbit rings with a comet (bright head + fading trail) on each
  const TRAIL = 48;
  const ringGeo = new THREE.TorusGeometry(1, 0.008, 6, 200);
  const ringMat = new THREE.MeshBasicMaterial({ color: bright, opacity: 0.7, ...additive });
  const headMat = new THREE.SpriteMaterial({ map: glowTex, color: '#ffffff', ...additive });
  const trailMat = new THREE.LineBasicMaterial({ vertexColors: true, ...additive });
  const orbits = [];
  for (let i = 0; i < 5; i++) {
    const pivot = new THREE.Group();
    pivot.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    const r = R * (0.9 + Math.random() * 0.2);
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.scale.setScalar(r);
    const head = new THREE.Sprite(headMat);
    head.scale.setScalar(R * 0.3);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
    const colors = new Float32Array(TRAIL * 3);
    for (let j = 0; j < TRAIL; j++) {
      const f = (1 - j / TRAIL) ** 1.5; // fades towards the tail
      colors.set([bright.r * f, bright.g * f, bright.b * f], j * 3);
    }
    trailGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const trail = new THREE.Line(trailGeo, trailMat);
    pivot.add(ring, head, trail);
    group.add(pivot);
    orbits.push({ pivot, head, trail, r, a: Math.random() * Math.PI * 2, speed: (1.4 + Math.random()) * (Math.random() < 0.5 ? -1 : 1) });
  }

  // Core: bright centre, blue halo, rotating starburst
  if (!flareTex) flareTex = makeFlareTexture();
  const sprite = (map, color, opacity, size) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, color, opacity, ...additive }));
    s.scale.setScalar(size);
    group.add(s);
    return s;
  };
  const halo = sprite(glowTex, tint, 0.55, R * 3.4);
  const core = sprite(glowTex, '#ffffff', 1, R * 0.9);
  const flare = sprite(flareTex, bright, 1, R * 2.6);

  const update = (dt, t) => {
    const p = state.power;
    const fade = p * (1 - state.burst);
    group.scale.setScalar(Math.max(0.001, p * (1 - 0.1 * state.charge) + state.burst * 0.5));
    group.rotation.y += dt * 0.3 * state.spin;
    for (const o of orbits) {
      o.a += dt * o.speed * state.spin;
      o.head.position.set(Math.cos(o.a) * o.r, Math.sin(o.a) * o.r, 0);
      const pos = o.trail.geometry.attributes.position;
      const dir = Math.sign(o.speed);
      for (let j = 0; j < TRAIL; j++) {
        const a = o.a - dir * j * 0.045;
        pos.setXYZ(j, Math.cos(a) * o.r, Math.sin(a) * o.r, 0);
      }
      pos.needsUpdate = true;
    }
    ringMat.opacity = 0.7 * fade;
    headMat.opacity = fade;
    trailMat.opacity = fade;
    halo.material.opacity = 0.55 * fade * (1 + state.charge * 0.6);
    const pulse = 1 + Math.sin(t * 18) * 0.04 * (1 + state.charge * 2);
    core.scale.setScalar(R * (0.9 + state.charge * 0.9) * pulse);
    core.material.opacity = fade;
    flare.material.rotation += dt * 0.25 * state.spin;
    flare.material.opacity = fade;
  };
  const dispose = () => {
    ringGeo.dispose();
    for (const mat of [ringMat, headMat, trailMat, halo.material, core.material, flare.material]) mat.dispose();
    for (const o of orbits) o.trail.geometry.dispose();
  };
  return { group, update, dispose };
}

// The video screen comes out of the orb's core and goes straight to full window:
// the camera zooms in at the same time, so there is no small-screen step.
function screenFromCoreTl(team) {
  const s = team.screen;
  const { pos, target } = teamView(team, true);
  return gsap.timeline()
    .call(() => {
      s.group.visible = true;
      s.group.scale.set(0.05, 0.05, 1);
      s.frameMat.opacity = 0; // full window: no coloured frame
      s.haloMat.opacity = 0;
      zoomed = true;
    })
    .to(s.group.scale, { x: 1, y: 1, duration: 0.9, ease: 'expo.out' }, 0)
    .to(s.screenMat, { opacity: 1, duration: 0.3 }, 0)
    .to(rig.pos, { x: pos.x, y: pos.y, z: pos.z, duration: 0.9, ease: 'expo.out' }, 0)
    .to(rig.target, { x: target.x, y: target.y, z: target.z, duration: 0.9, ease: 'expo.out' }, 0);
}

// fromStone: the orb grows smoothly straight out of the stone's explosion (no members to fade first)
function orbTl(team, fromStone = false) {
  const state = { power: 0, spin: 1, charge: 0, burst: 0 };
  const FADE = fromStone ? 0.3 : 0.6; // members fade out
  const FORM = fromStone ? 1.4 : 1.0; // orb forms (starts 0.3 s before the fade ends)
  const CHARGE = 1.8; // orb spins up
  const untilBoom = FADE - 0.3 + FORM + CHARGE;
  const lightPad = Math.max(0, BOOM_LIGHT_DELAY); // extra wait before the flash
  const soundLead = untilBoom + lightPad - BOOM_LIGHT_DELAY; // when the boom sound hits
  let orb = null;
  return gsap.timeline()
    .call(() => {
      orb = buildOrb(team, state);
      playOrbSound(soundLead, team.rank === 1); // riser now, boom lands on the flash
      duckMusic(true); // music steps back for the build-up
      prepareVideo(team);
      scene.add(orb.group);
      tickers.add(orb.update);
      bloom.strength = BLOOM_NORMAL;
      hideHud();
      hideHint();
    })
    // members fade out gently (no moving)
    .to(['#group-intro', '#member-intro'], { autoAlpha: 0, duration: FADE, ease: 'power2.inOut' })
    // the orb forms...
    .to(state, { power: 1, duration: FORM, ease: fromStone ? 'power3.out' : 'back.out(1.4)' }, '-=0.3')
    // ...spins faster and faster while the core charges up
    .to(state, { spin: 5, charge: 1, duration: CHARGE, ease: 'power2.in' })
    .to({}, { duration: lightPad }) // lines the flash up with the boom
    // BOOM: bright flash + shockwave + shake, the orb is gone and the screen comes out of the core
    .addLabel('burst')
    // Sound boom (BOOM_LIGHT_DELAY before the light): riser stops, slow glass impact hits
    .call(() => {
      stopOrbSound();
      playBoomSound(team.rank === 1);
    }, null, `burst${BOOM_LIGHT_DELAY >= 0 ? '-=' : '+='}${Math.abs(BOOM_LIGHT_DELAY)}`)
    .call(() => {
      $('#boom').style.setProperty('--c', team.style.color);
      $('#shockwave').style.setProperty('--c', team.style.color);
    }, null, 'burst-=0.1')
    .fromTo('#boom', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.09, ease: 'power2.in' }, 'burst-=0.09')
    .to('#boom', { autoAlpha: 0, duration: 0.6, ease: 'power2.out' }, 'burst+=0.06')
    // immediateRender: false = don't show the ring's start state before the boom actually happens
    .fromTo('#shockwave', { autoAlpha: 1, scale: 0.15 }, { autoAlpha: 0, scale: 4, duration: 0.8, ease: 'expo.out', immediateRender: false }, 'burst')
    .add(shakeTl(0.9, 0.7), 'burst') // strong shake with the boom
    .to(state, { burst: 1, duration: 0.35, ease: 'power2.out' }, 'burst')
    .to(bloom, { strength: 0, duration: 0.3 }, 'burst') // no glow over the video
    .add(screenFromCoreTl(team), 'burst')
    // a video starts playing while the screen grows, so it is already moving at full size
    .call(() => { if (hasPlayableVideo(team)) playTeamVideo(team); }, null, 'burst')
    .call(() => {
      tickers.delete(orb.update);
      scene.remove(orb.group);
      orb.dispose();
    }, null, 'burst+=0.4')
    .to({}, { duration: 0.2 });
}

function showScreenTl(team) {
  const s = team.screen;
  return gsap.timeline()
    .call(() => { s.group.visible = true; })
    .fromTo(s.group.scale, { x: 0.6, y: 0.6, z: 0.6 }, { x: 1, y: 1, z: 1, duration: 0.8, ease: 'back.out(1.6)' }, 0)
    .to(s.screenMat, { opacity: 1, duration: 0.6 }, 0)
    .to(s.frameMat, { opacity: 0.9, duration: 0.6 }, 0)
    .to(s.haloMat, { opacity: 0.3, duration: 0.8 }, 0);
}

// ---------------------------------------------------------------------------
// Video playback
// ---------------------------------------------------------------------------
const fullWrap = $('#fullvideo');
const fullEl = $('#fullvideo-el');

function hasPlayableVideo(team) {
  return team.videoStatus === 'ready' || team.videoStatus === 'loading';
}

// Zoom the camera so the video screen fills the window (on) or back to the normal view (off)
let zoomed = false;
function zoomVideo(on, duration = 1.4, withHud = true) {
  const team = teams[current];
  if (!team) return;
  zoomed = on;
  const { pos, target } = teamView(team, on);
  gsap.to(rig.pos, { x: pos.x, y: pos.y, z: pos.z, duration, ease: 'power3.inOut' });
  gsap.to(rig.target, { x: target.x, y: target.y, z: target.z, duration, ease: 'power3.inOut' });
  gsap.to(team.screen.haloMat, { opacity: on ? 0 : 0.3, duration });
  gsap.to(team.screen.frameMat, { opacity: on ? 0 : 0.9, duration: on ? 0.4 : duration }); // no coloured edges around the full-window video
  if (on) {
    hideHud();
    hideHint();
  } else {
    if (withHud) gsap.delayedCall(duration * 0.6, () => { if (!zoomed && teams[current] === team) animateHudIn(); });
  }
}

// Rewind the video and put its first frame on the screen ahead of time,
// so there is no black moment when the screen appears
function prepareVideo(team) {
  if (!hasPlayableVideo(team)) return;
  const v = team.videoEl;
  v.pause();
  v.addEventListener('seeked', () => { team.videoTex.needsUpdate = true; }, { once: true });
  v.currentTime = 0;
}

function playTeamVideo(team) {
  gsap.to(bloom, { strength: BLOOM_VIDEO, duration: 1 });
  if (!hasPlayableVideo(team)) {
    buildHud(team);
    onVideoEnded(team); // no video: music back up, normal view (and the members, if they come after the video)
    return;
  }
  buildHud(team);
  if (zoomed) { hideHud(); hideHint(); } // already zooming in (screen coming out of the orb)
  else zoomVideo(true);
  const v = team.videoEl;
  v.loop = false;
  v.muted = false;
  resetVideoFade(team);
  if (v.currentTime > 0.05) v.currentTime = 0; // already at the start if prepareVideo() ran
  v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
  duckMusic(true);
  gsap.to(bloom, { strength: BLOOM_VIDEO, duration: 1 });
}

function onVideoEnded(team) {
  if (teams[current] !== team) return;
  duckMusic(false);
  if (VIDEO_FIRST && !team.membersShown) return showMembersAfterVideo(team); // boom, then the members
  zoomVideo(false);
  gsap.delayedCall(1.6, () => { if (!zoomed && teams[current] === team) showHint(); });
}

// Video done: the full-window screen collapses into a bright point and BOOMs (flash, shockwave,
// shake, boom sound), the same light as when the stone exploded. The members come out of the flash.
function videoBoomTl(team) {
  const s = team.screen;
  const SHRINK = 0.7;
  return gsap.timeline()
    .call(() => {
      $('#boom').style.setProperty('--c', team.style.color);
      $('#shockwave').style.setProperty('--c', team.style.color);
    })
    .to(s.group.scale, { x: 0.04, y: 0.04, duration: SHRINK, ease: 'expo.in' }, 0)
    .to(bloom, { strength: BLOOM_NORMAL * 2, duration: SHRINK, ease: 'power2.in' }, 0)
    .addLabel('burst', SHRINK)
    .call(() => playBoomSound(team.rank === 1), null, `burst-=${BOOM_LIGHT_DELAY}`)
    .fromTo('#boom', { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.09, ease: 'power2.in' }, 'burst-=0.09')
    .fromTo('#shockwave', { autoAlpha: 1, scale: 0.15 }, { autoAlpha: 0, scale: 4, duration: 0.8, ease: 'expo.out', immediateRender: false }, 'burst')
    .add(shakeTl(0.9, 0.7), 'burst')
    // behind the flash: back to the normal view, screen at full size again (paused on its last frame)
    .call(() => {
      const { pos, target } = teamView(team);
      zoomed = false;
      rig.pos.copy(pos);
      rig.target.copy(target);
      s.group.scale.set(1, 1, 1);
      s.screenMat.color.setScalar(1);
      s.frameMat.opacity = 0.9;
      s.haloMat.opacity = 0.3;
      bloom.strength = BLOOM_NORMAL;
    }, null, 'burst')
    .to('#boom', { autoAlpha: 0, duration: 0.6, ease: 'power2.out' }, 'burst+=0.06');
}

// VIDEO_FIRST: the member spotlight plays once the video is over, and stays on screen
// (while the team comes up for their certificates) until → goes to the next team
// boom = false: no video was shown (the stone's own explosion is the boom)
function showMembersAfterVideo(team, boom = true) {
  team.membersShown = true;
  hideHud();
  hideHint();
  const tl = gsap.timeline({
    data: { keepMembers: true },
    onComplete: () => {
      if (revealTl === tl) revealTl = null;
      if (teams[current] === team) gsap.delayedCall(0.5, showHint);
    },
  });
  revealTl = tl; // so pressing next shows all the names at once
  busy = true; // no skipping during the boom
  if (boom) tl.add(videoBoomTl(team));
  tl.addLabel('members', boom ? '-=0.6' : 0); // members appear while the flash fades
  tl.call(() => { busy = false; }, null, 'members');
  tl.add(memberIntroTl(team), 'members');
  tl.addLabel('screen');
}

// ---------------------------------------------------------------------------
// 1-minute limit: near the limit, picture and sound fade out, then it counts as ended
// ---------------------------------------------------------------------------
function videoLimit(team) {
  return team.videoMax ?? event.videoMax ?? VIDEO_MAX;
}

function checkVideoLimit(team, el) {
  if (team.fading || teams[current] !== team || el.paused) return;
  const limit = videoLimit(team);
  if (!(el.duration > limit)) return; // shorter videos simply play to the end
  if (el.currentTime >= limit - VIDEO_FADE) fadeOutVideo(team, el);
}

function fadeOutVideo(team, el) {
  team.fading = true;
  const color = team.screen.screenMat.color;
  gsap.to(color, { r: 0, g: 0, b: 0, duration: VIDEO_FADE, ease: 'power1.in' }); // 3D screen to black
  if (el === fullEl) gsap.to(fullEl, { opacity: 0, duration: VIDEO_FADE }); // fullscreen fallback
  gsap.to(el, {
    volume: 0,
    duration: VIDEO_FADE,
    onComplete: () => {
      el.pause();
      if (el === fullEl) closeFullVideo(false);
      onVideoEnded(team);
      // bring the (paused) picture back while the camera zooms out
      gsap.to(color, { r: 1, g: 1, b: 1, duration: 1, delay: 0.6 });
    },
  });
}

function resetVideoFade(team) {
  team.fading = false;
  gsap.killTweensOf(team.videoEl);
  gsap.killTweensOf(team.screen.screenMat.color);
  team.videoEl.volume = 1;
  team.screen.screenMat.color.setScalar(1);
}

function stopAllVideos() {
  zoomed = false;
  if (revealTl) { // a member spotlight still running after a video
    revealTl.kill();
    revealTl = null;
  }
  hideMemberIntro(); // members may still be on screen (VIDEO_FIRST)
  closeFullVideo(false);
  teams.forEach((t) => {
    t.videoEl.pause();
    resetVideoFade(t);
  });
  duckMusic(false);
}

function openFullVideo() {
  const team = teams[current];
  if (!team || team.videoStatus !== 'ready') return;
  const v = team.videoEl;
  fullEl.src = `${team.video}#t=${v.currentTime}`;
  fullEl.muted = v.muted;
  fullEl.onended = () => { closeFullVideo(false); onVideoEnded(team); };
  fullEl.ontimeupdate = () => checkVideoLimit(team, fullEl);
  fullEl.style.opacity = '';
  fullEl.volume = 1;
  fullWrap.classList.add('show');
  fullEl.play().catch(() => {});
  v.pause();
}

function closeFullVideo(resume = true) {
  if (!fullWrap.classList.contains('show')) return;
  const team = teams[current];
  const wasPlaying = !fullEl.paused && !fullEl.ended;
  fullEl.pause();
  fullWrap.classList.remove('show');
  if (team && resume) {
    team.videoEl.currentTime = fullEl.currentTime;
    if (wasPlaying) team.videoEl.play().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Show flow:  -1 = overview, 0..4 = teams (#5 → #1), 5 = finale
// ---------------------------------------------------------------------------
let current = -1;
let busy = false;
let revealTl = null; // timeline of the reveal in progress (used to skip the member spotlight)

function resetScreenRotations() {
  teams.forEach((t) => {
    gsap.to(t.screen.group.rotation, { x: 0, y: 0, z: 0, duration: 1 });
    gsap.to(t.screen.nameMat, { opacity: 0, duration: 0.4 });
  });
}

function revealTeam(i) {
  busy = true;
  current = i;
  updateProgress();
  const team = teams[i];
  const isTop = team.rank === 1;

  stopAllVideos();
  hideHint();
  hideHud();
  resetScreenRotations();
  gsap.to('#finale', { autoAlpha: 0, duration: 0.4 });
  hideScreen(team); // the screen appears out of the orb

  const tl = gsap.timeline({ onComplete: () => { busy = false; if (revealTl === tl) revealTl = null; } });
  revealTl = tl;

  if (isTop && !team.revealed) tl.add(suspenseTl());
  tl.add(bigRankTl(team));
  const view = teamView(team);
  tl.add(flyTo(view.pos, view.target, isTop ? 3 : 2.2, isTop ? 30 : 16), '-=0.7');

  const exploding = !team.revealed;
  if (exploding) tl.add(explodeTl(team), '-=0.4').addLabel('stoneBoom', '<0.5'); // 0.5 s in: the stone bursts
  else tl.to(bloom, { strength: BLOOM_NORMAL, duration: 0.5 }, '<');

  if (isTop) tl.call(() => celebrate(true));
  team.membersShown = VIDEO_FIRST ? false : true;
  if (!VIDEO_FIRST) {
    tl.addLabel('members');
    tl.add(memberIntroTl(team));
    tl.addLabel('screen');
  }
  // No video: no orb or screen, the members come straight out of the stone's burst
  if (VIDEO_FIRST && !hasPlayableVideo(team)) {
    tl.call(() => showMembersAfterVideo(team, false), null, exploding ? 'stoneBoom+=0.6' : '>');
    return;
  }
  // VIDEO_FIRST: the orb comes straight out of the stone's burst, smoothly
  if (VIDEO_FIRST && exploding) tl.add(orbTl(team, true), 'stoneBoom');
  else tl.add(orbTl(team, VIDEO_FIRST));
  tl.call(() => { if (!hasPlayableVideo(team)) playTeamVideo(team); }); // no video: show the card + team info
}

// Pressing next during the member spotlight skips it (to the video, or to the end if the video came first)
function skipMemberIntro() {
  if (!revealTl) return false;
  const { members, screen: video } = revealTl.labels;
  if (members === undefined) return false; // this timeline has no member spotlight
  const t = revealTl.time();
  if (t < members || t >= video) return false;
  revealTl.seek(video - 0.01, true);
  if (!revealTl.data?.keepMembers) hideMemberIntro();
  return true;
}

function goOverview() {
  busy = true;
  current = -1;
  updateProgress();
  stopAllVideos();
  hideHud();
  hideHint();
  resetScreenRotations();
  gsap.timeline({ onComplete: () => { busy = false; showHint(); } })
    .add(flyTo(OVERVIEW.pos, OVERVIEW.target, 2.2, 10))
    .to(bloom, { strength: BLOOM_NORMAL, duration: 1 }, 0);
}

function finale() {
  busy = true;
  current = teams.length;
  updateProgress();
  stopAllVideos();
  hideHud();
  hideHint();

  const tl = gsap.timeline({ onComplete: () => { busy = false; } });
  tl.add(flyTo(FINALE.pos, FINALE.target, 3, 12));
  tl.to(bloom, { strength: 0.6, duration: 1.5 }, 0);

  // No screens or stones in the finale: the teams themselves stand on a podium
  teams.forEach((t) => {
    t.planet.visible = false;
    t.screen.group.visible = false;
  });
  const cards = buildFinaleTeams();
  gsap.set(cards.map((c) => c.el), { autoAlpha: 0 });
  tl.fromTo('#finale', { autoAlpha: 0, y: -20 }, { autoAlpha: 1, y: 0, duration: 1 }, 2.2);
  // teams rise up one by one, #5 first and #1 last
  [...cards].sort((a, b) => b.rank - a.rank).forEach((c, k) => {
    tl.fromTo(c.el,
      { autoAlpha: 0, y: 60, scale: 0.9 },
      { autoAlpha: 1, y: 0, scale: 1, duration: 0.8, ease: 'back.out(1.6)' }, 2.8 + k * 0.35);
  });
  tl.call(() => celebrate(false), null, 2.8 + cards.length * 0.35);
}

// Finale podium: #4 #2 #1 #3 #5 from left to right, #1 in the middle and biggest
function buildFinaleTeams() {
  const order = [4, 2, 1, 3, 5];
  const byRank = new Map(teams.map((t) => [t.rank, t]));
  const cards = order.filter((r) => byRank.has(r)).map((r) => {
    const team = byRank.get(r);
    const el = document.createElement('div');
    el.className = `ft-team rank-${r}`;
    el.style.setProperty('--c', team.style.color);
    const src = team.group?.url ?? team.photo;
    if (src) {
      const img = document.createElement('img');
      img.className = 'ft-photo';
      img.alt = '';
      img.src = src;
      el.append(img);
    }
    const info = document.createElement('div');
    info.className = 'ft-info';
    const line = (cls, text) => {
      const d = document.createElement('div');
      d.className = cls;
      d.textContent = text;
      info.append(d);
    };
    line('ft-rank', `RANK #${r}`);
    line('ft-name', team.teamName);
    line('ft-project', team.project);
    line('ft-members', (team.members ?? []).map((m) => m.name).join('  ·  '));
    el.append(info);
    return { el, rank: r };
  });
  $('#finale-teams').replaceChildren(...cards.map((c) => c.el));
  return cards;
}

// ---------------------------------------------------------------------------
// Agenda = main menu (like a game): pick an item to open its page;
// the "top5" item starts the top 5 show. Esc goes back to the menu.
// ---------------------------------------------------------------------------
let mode = 'loading'; // 'menu' | 'section' | 'top5'
let selectedIndex = 0; // the agenda opens with the first item selected

function setSelected(i) {
  selectedIndex = i;
  document.querySelectorAll('.ag-item').forEach((el, k) => el.classList.toggle('selected', k === i));
}

function selectAgenda(i) {
  if (busy || mode !== 'menu' || !agenda[i]) return;
  if (agenda[i].action === 'top5') enterTop5();
  else openSection(i);
}

function showAgendaTl() {
  return gsap.timeline()
    .call(() => { mode = 'menu'; setSelected(selectedIndex); })
    .set('#agenda', { autoAlpha: 1 })
    .fromTo('.ag-panel', { autoAlpha: 0, y: 30, scale: 0.97 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.7, ease: 'power3.out' })
    .fromTo('.ag-item', { autoAlpha: 0, x: -30 }, { autoAlpha: 1, x: 0, stagger: 0.12, duration: 0.5, ease: 'power2.out' }, '-=0.35');
}

function hideAgendaTl() {
  return gsap.timeline()
    .to('.ag-panel', { autoAlpha: 0, y: -20, duration: 0.5, ease: 'power2.in' })
    .to('#agenda', { autoAlpha: 0, duration: 0.4 }, '-=0.2');
}

// Page for one agenda item
function openSection(i) {
  const item = agenda[i];
  mode = 'section';
  busy = true;
  $('#section .sec-num').textContent = String(i + 1).padStart(2, '0');
  const title = $('#section .sec-title');
  title.textContent = item.title ?? '';
  title.dataset.text = title.textContent;
  $('#section .sec-note').textContent = item.note ?? '';
  gsap.timeline({
    onComplete: () => {
      busy = false;
      // the title pops first, then the video plays
      if (item.youtube) sectionVideoCall = gsap.delayedCall(1.2, () => playSectionVideo(item));
    },
  })
    .add(hideAgendaTl())
    .set('#section', { autoAlpha: 1 })
    .set('#section .sec-inner', { autoAlpha: 1, y: 0 })
    .fromTo('#section .sec-num', { autoAlpha: 0, scale: 1.6, filter: 'blur(16px)' }, { autoAlpha: 1, scale: 1, filter: 'blur(0px)', duration: 0.7, ease: 'expo.out' })
    .fromTo(['#section .sec-title', '#section .sec-note', '#section .sec-back'],
      { autoAlpha: 0, y: 24 }, { autoAlpha: 1, y: 0, stagger: 0.1, duration: 0.5, ease: 'power2.out' }, '-=0.35');
}

function closeSection() {
  if (busy) return;
  busy = true;
  stopSectionVideo();
  gsap.timeline({ onComplete: () => { busy = false; } })
    .to('#section .sec-inner', { autoAlpha: 0, y: -20, duration: 0.4, ease: 'power2.in' })
    .set('#section', { autoAlpha: 0 })
    .add(showAgendaTl());
}

// ---------------------------------------------------------------------------
// YouTube video on an agenda page ("youtube": "<video id>" on the agenda item)
// Needs internet. When the video ends, the title comes back.
// ---------------------------------------------------------------------------
let ytApi = null;
let ytPlayer = null;
let sectionVideoCall = null;
let sectionVideoToken = 0;

function loadYouTubeApi() {
  if (!ytApi) {
    ytApi = new Promise((resolve) => {
      if (window.YT?.Player) return resolve(window.YT);
      window.onYouTubeIframeAPIReady = () => resolve(window.YT);
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      document.head.append(s);
    });
  }
  return ytApi;
}

async function playSectionVideo(item) {
  const id = item.youtube;
  const token = ++sectionVideoToken;
  const YT = await loadYouTubeApi();
  if (token !== sectionVideoToken || mode !== 'section') return; // left the page meanwhile
  const box = $('#section .sec-video');
  const holder = document.createElement('div');
  box.replaceChildren(holder);
  ytPlayer = new YT.Player(holder, {
    videoId: id,
    playerVars: { autoplay: 1, controls: 0, rel: 0, modestbranding: 1, playsinline: 1, iv_load_policy: 3, disablekb: 1 },
    events: {
      onReady: (e) => {
        e.target.playVideo();
        gsap.to('#section .sec-inner', { autoAlpha: 0, duration: 0.5 });
        gsap.fromTo(box, { autoAlpha: 0, scale: 0.92 }, { autoAlpha: 1, scale: 1, duration: 0.8, ease: 'expo.out' });
      },
      onStateChange: (e) => {
        if (e.data !== YT.PlayerState.ENDED) return;
        gsap.to(box, { autoAlpha: 0, duration: 0.8, onComplete: () => stopSectionVideo(true) });
        if (item.armyTribute) playTribute(() => gsap.to('#section .sec-inner', { autoAlpha: 1, duration: 0.8 }));
        else gsap.to('#section .sec-inner', { autoAlpha: 1, duration: 0.8, delay: 0.3 });
      },
    },
  });
}

function stopSectionVideo(keepTribute = false) {
  if (!keepTribute) stopTribute();
  sectionVideoToken++;
  sectionVideoCall?.kill();
  sectionVideoCall = null;
  ytPlayer?.destroy();
  ytPlayer = null;
  const box = $('#section .sec-video');
  gsap.killTweensOf(box);
  gsap.set(box, { autoAlpha: 0 });
  box.replaceChildren();
}

// ---------------------------------------------------------------------------
// Army tribute (10 s, after the agenda video): sunset, the flag is raised on a hill
// while soldiers stand up and salute, with a message of respect
// ---------------------------------------------------------------------------
const TRIBUTE_SECONDS = 10;
let tributeTl = null;

// One soldier silhouette (front view, ~60 x 140): helmet, rifle, one arm down, one arm that salutes
const SOLDIER = `
  <path d="M17 23 Q30 5 43 23 L46 27 L14 27 Z"/>
  <ellipse cx="30" cy="31" rx="8.5" ry="10"/>
  <rect x="26" y="38" width="8" height="6"/>
  <path d="M15 43 Q30 37 45 43 L47 86 L13 86 Z"/>
  <path d="M15 45 L8 48 L6 86 L12 87 L16 54 Z"/>
  <path d="M9 14 L12 14 L11 112 L8 112 Z"/>
  <path d="M14 86 L46 86 L44 139 L34 139 L30 98 L26 139 L16 139 Z"/>
  <path class="arm-down" d="M45 45 L52 48 L54 86 L48 87 L44 54 Z"/>
  <path class="arm-up" d="M44 44 L57 33 L41 22 L37 27 L49 34 L41 41 Z" opacity="0"/>`;

function buildTribute() {
  const root = $('#section .tribute');
  if (root.querySelector('svg')) return root;
  const hillY = (x) => 640 + ((x - 800) / 800) ** 2 * 130;
  // soldiers on both sides of the flag, bigger near the middle
  const soldiers = [];
  for (const side of [-1, 1]) {
    for (let k = 1; k <= 5; k++) {
      const x = 800 + side * (70 + k * 135);
      const sc = 1.75 - k * 0.17;
      soldiers.push({ x, y: hillY(x), sc, k });
    }
  }
  const rays = Array.from({ length: 18 }, (_, i) => {
    const a = (i / 18) * Math.PI * 2;
    const b = a + 0.07;
    const R = 1400;
    return `<path d="M800 600 L${800 + Math.cos(a) * R} ${600 + Math.sin(a) * R} L${800 + Math.cos(b) * R} ${600 + Math.sin(b) * R} Z"/>`;
  }).join('');
  // Cambodian flag (blue, red, blue) with a simple white Angkor Wat
  const flag = `
    <rect width="190" height="122" fill="#032ea1"/>
    <rect y="30" width="190" height="62" fill="#e00025"/>
    <g fill="#fff">
      <rect x="55" y="76" width="80" height="6"/>
      <rect x="60" y="70" width="70" height="6"/>
      <rect x="66" y="58" width="58" height="12"/>
      <path d="M95 36 L101 48 L101 58 L89 58 L89 48 Z"/>
      <path d="M74 44 L79 52 L79 58 L69 58 L69 52 Z"/>
      <path d="M116 44 L121 52 L121 58 L111 58 L111 52 Z"/>
    </g>`;
  root.insertAdjacentHTML('afterbegin', `
    <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <linearGradient id="tr-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#07061e"/>
          <stop offset="0.45" stop-color="#2a1640"/>
          <stop offset="0.68" stop-color="#a8432f"/>
          <stop offset="0.8" stop-color="#f29a3c"/>
        </linearGradient>
        <radialGradient id="tr-sun" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stop-color="#fff3c4"/>
          <stop offset="0.25" stop-color="#ffc85a" stop-opacity="0.9"/>
          <stop offset="1" stop-color="#ff8a3c" stop-opacity="0"/>
        </radialGradient>
        <filter id="tr-wave">
          <feTurbulence type="fractalNoise" baseFrequency="0.012 0.03" numOctaves="1" seed="3">
            <animate attributeName="baseFrequency" dur="3s" values="0.012 0.03;0.016 0.035;0.012 0.03" repeatCount="indefinite"/>
          </feTurbulence>
          <feDisplacementMap in="SourceGraphic" scale="12"/>
        </filter>
      </defs>
      <rect width="1600" height="900" fill="url(#tr-sky)"/>
      <g class="tr-rays" fill="#ffd27a" opacity="0.12">${rays}</g>
      <circle class="tr-sunglow" cx="800" cy="610" r="420" fill="url(#tr-sun)"/>
      <g class="tr-hill">
        <path d="M0 900 L0 770 Q400 690 800 640 Q1200 690 1600 770 L1600 900 Z" fill="#050308"/>
        <rect x="796" y="340" width="8" height="305" rx="3" fill="#0b0810"/>
        <circle cx="800" cy="336" r="9" fill="#ffc20e"/>
        <g class="tr-flag" transform="translate(804 520)"><g filter="url(#tr-wave)">${flag}</g></g>
        ${soldiers.map((p) => `<g transform="translate(${p.x - 30 * p.sc} ${p.y - 137 * p.sc}) scale(${p.sc})">
            <g class="tr-soldier" data-k="${p.k}" fill="#050308">${SOLDIER}</g></g>`).join('')}
      </g>
    </svg>`);
  return root;
}

function playTribute(onDone) {
  stopTribute();
  const root = buildTribute();
  const flag = root.querySelector('.tr-flag');
  const soldiers = [...root.querySelectorAll('.tr-soldier')];
  const textParts = root.querySelectorAll('.tr-text > div');
  gsap.set(root, { autoAlpha: 0 });
  gsap.set(flag, { attr: { transform: 'translate(804 520)' } });
  gsap.set(root.querySelectorAll('.arm-up'), { opacity: 0 });
  gsap.set(root.querySelectorAll('.arm-down'), { opacity: 1 });
  gsap.set(textParts, { autoAlpha: 0, y: 20 });

  tributeTl = gsap.timeline({ onComplete: () => { tributeTl = null; onDone?.(); } })
    .to(root, { autoAlpha: 1, duration: 0.8 })
    .fromTo(root.querySelector('.tr-hill'), { y: 220 }, { y: 0, duration: 1.4, ease: 'power3.out' }, 0.2)
    .fromTo(root.querySelector('.tr-sunglow'), { opacity: 0, scale: 0.6, transformOrigin: '50% 50%' },
      { opacity: 1, scale: 1, duration: 2.5, ease: 'power2.out' }, 0.2)
    .fromTo(root.querySelector('.tr-rays'), { rotation: 0, svgOrigin: '800 600' },
      { rotation: 25, svgOrigin: '800 600', duration: TRIBUTE_SECONDS, ease: 'none' }, 0)
    // soldiers stand up from the middle outwards
    .fromTo(soldiers, { opacity: 0, y: 60 },
      { opacity: 1, y: 0, duration: 0.8, ease: 'back.out(1.4)', stagger: (i, el) => (el.dataset.k - 1) * 0.15 }, 0.9)
    // the flag goes up the pole
    .to(flag, { attr: { transform: 'translate(804 344)' }, duration: 3, ease: 'power1.inOut' }, 1.6)
    // everybody salutes
    .to(root.querySelectorAll('.arm-down'), { opacity: 0, duration: 0.25 }, 4.4)
    .to(root.querySelectorAll('.arm-up'), { opacity: 1, duration: 0.25 }, 4.4)
    .to(textParts, { autoAlpha: 1, y: 0, duration: 0.9, stagger: 0.35, ease: 'power2.out' }, 4.6)
    .to(root, { autoAlpha: 0, duration: 1 }, TRIBUTE_SECONDS - 1);
}

function stopTribute() {
  tributeTl?.kill();
  tributeTl = null;
  gsap.set('#section .tribute', { autoAlpha: 0 });
}

// Agenda -> top 5 show (this click/key also unlocks video + music playback)
function enterTop5() {
  if (!started) {
    started = true;
    teams.forEach((t) => {
      if (!t.video) return;
      const v = t.videoEl;
      v.muted = true;
      v.play().then(() => { v.pause(); v.currentTime = 0; }).catch(() => {});
    });
  }
  mode = 'top5';
  current = -1;
  updateProgress();
  startMusic();
  busy = true;
  gsap.timeline({ onComplete: () => { busy = false; showHint(); } })
    .add(hideAgendaTl())
    .to('#intro', { autoAlpha: 0, duration: 0.5 }, 0)
    .add(flyTo(OVERVIEW.pos, OVERVIEW.target, 3, 25), 0.2)
    .to(['#progress', '#controls', '#help', '#corner-logo'], { autoAlpha: 1, duration: 0.8 }, 2);
}

// Top 5 show -> back to the agenda
function backToMenu() {
  if (busy || !agenda.length) return;
  closeFullVideo(false);
  stopAllVideos();
  stopMusic();
  hideHud();
  hideHint();
  hideMemberIntro();
  resetScreenRotations();
  gsap.to(['#finale', '#progress', '#controls', '#help', '#corner-logo'], { autoAlpha: 0, duration: 0.5 });
  current = -1;
  mode = 'menu';
  busy = true;
  gsap.timeline({ onComplete: () => { busy = false; } })
    .add(flyTo(START.pos, START.target, 2, 10), 0)
    .add(showAgendaTl(), 0.4);
}

function next() {
  if (skipMemberIntro()) return;
  if (busy) return;
  if (current < teams.length - 1) revealTeam(current + 1);
  else if (current === teams.length - 1) finale();
  else backToMenu(); // after the finale
}

function prev() {
  if (busy) return;
  if (current >= teams.length) revealTeam(teams.length - 1);
  else if (current > 0) revealTeam(current - 1);
  else if (current === 0) goOverview();
  else if (current === -1) backToMenu(); // the five stones -> back to the agenda
}

function toggleZoom() {
  const team = teams[current];
  if (busy || !team || team.videoStatus !== 'ready') return;
  if (zoomed) {
    zoomVideo(false);
  } else {
    hideHint();
    hideMemberIntro();
    zoomVideo(true);
    if (team.videoEl.paused || team.videoEl.ended) playTeamVideo(team);
  }
}

function replay() {
  const team = teams[current];
  if (busy || !team) return;
  closeFullVideo(false);
  hideHint();
  if (!hasPlayableVideo(team)) { // no video: replay the member spotlight
    if (revealTl) { revealTl.kill(); revealTl = null; }
    showMembersAfterVideo(team, false);
    return;
  }
  playTeamVideo(team);
}

// ---------------------------------------------------------------------------
// Start + input
// ---------------------------------------------------------------------------
let started = false;

// Intro "Start Show" screen: only used when there is no agenda
$('#start-btn').addEventListener('click', () => {
  if (started || !loaderDone || busy) return;
  enterTop5();
});

$('#next-btn').addEventListener('click', next);
$('#scene').addEventListener('click', toggleZoom);
$('#prev-btn').addEventListener('click', prev);

addEventListener('keydown', (e) => {
  if (!loaderDone) return;

  if (mode === 'menu') {
    const n = agenda.length;
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((selectedIndex + 1) % n); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((selectedIndex - 1 + n) % n); }
    else if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') { e.preventDefault(); selectAgenda(selectedIndex); }
    else if (/^[1-9]$/.test(e.key) && Number(e.key) <= n) { setSelected(Number(e.key) - 1); selectAgenda(selectedIndex); }
    return;
  }
  if (mode === 'section') {
    if (['Escape', 'Backspace', 'ArrowLeft', 'Enter', ' '].includes(e.key)) { e.preventDefault(); closeSection(); }
    return;
  }
  if (!started) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#start-btn').click(); }
    return;
  }
  switch (e.key) {
    case 'ArrowRight': case ' ': case 'Enter': case 'PageDown':
      e.preventDefault(); next(); break;
    case 'ArrowLeft': case 'PageUp':
      e.preventDefault(); prev(); break;
    case 'r': case 'R': replay(); break;
    case 'f': case 'F':
      fullWrap.classList.contains('show') ? closeFullVideo() : openFullVideo(); break;
    case 'Escape':
      if (fullWrap.classList.contains('show')) closeFullVideo();
      else backToMenu();
      break;
    case 'm': case 'M':
      music.muted = !music.muted;
      break;
    case 'z': case 'Z': toggleZoom(); break;
    case 'h': case 'H': $('#help').classList.toggle('hidden'); break;
  }
});

const mouse = new THREE.Vector2();
addEventListener('pointermove', (e) => {
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  if (!busy && current >= 0 && current < teams.length) {
    const view = teamView(teams[current], zoomed);
    rig.pos.copy(view.pos);
    rig.target.copy(view.target);
  }
});

// ---------------------------------------------------------------------------
// Rank labels above the stones: plain HTML text that follows each stone,
// so the glow effect never blurs it
// ---------------------------------------------------------------------------
const labelLayer = $('#stone-labels');
for (const team of teams) {
  const el = document.createElement('div');
  el.className = 'stone-label';
  el.textContent = `#${team.rank}`;
  el.style.setProperty('--c', team.style.color);
  labelLayer.appendChild(el);
  team.labelEl = el;
}
const labelPos = new THREE.Vector3();
function updateStoneLabels() {
  // Labels only on the overview of all stones (after Start); never over the intro, a screen or a video
  const show = mode === 'top5' && current < 0;
  labelLayer.classList.toggle('hidden', !show);
  if (!show) return;
  for (const team of teams) {
    const p = team.planet;
    const el = team.labelEl;
    labelPos.copy(p.position);
    labelPos.y += 5.2;
    const dist = camera.position.distanceTo(labelPos);
    labelPos.project(camera);
    if (!p.visible || labelPos.z > 1) {
      el.style.display = 'none';
      continue;
    }
    const x = ((labelPos.x + 1) / 2) * innerWidth;
    const y = ((1 - labelPos.y) / 2) * innerHeight;
    // about the same size for every stone, so all labels are readable
    const s = THREE.MathUtils.clamp(70 / dist, 0.9, 1.25);
    el.style.display = '';
    el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%) scale(${s})`;
  }
}

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();
const parallax = new THREE.Vector3();
const parallaxGoal = new THREE.Vector3();

function tick() {
  const dt = clock.getDelta();
  const t = clock.elapsedTime;

  stars.rotation.y += dt * 0.01;
  dust.rotation.y -= dt * 0.02;

  for (const team of teams) {
    const p = team.planet;
    if (!p.visible) continue;
    const u = p.userData;
    u.gem.rotation.y += dt * 0.35;
    u.aura.rotation.y -= dt * 0.8;
    const pulse = Math.sin(t * 2 + u.seed);
    u.gem.material.uniforms.uTime.value = t;
    u.gem.material.uniforms.uGlow.value = 1.3 * STONE_GLOW * (1 + pulse * 0.07);
    u.glow.material.opacity = (0.45 + pulse * 0.1) * STONE_GLOW;
    p.position.y = u.baseY + Math.sin(t * 0.8 + u.seed) * 0.6;
  }

  tickers.forEach((fn) => fn(dt, t));
  updateStoneLabels();

  if (zoomed) parallaxGoal.set(0, 0, 0);
  else parallaxGoal.set(mouse.x * 1.2, mouse.y * 0.8, 0);
  parallax.lerp(parallaxGoal, 0.05);
  camera.position.copy(rig.pos).add(parallax).add(shake);
  camera.lookAt(rig.target);
  if (rig.roll) camera.rotateZ(rig.roll);

  bloom.enabled = bloom.strength > 0.01; // glow fully off (and cheaper) while a video is on screen
  composer.render();
  requestAnimationFrame(tick);
}
tick();

// ---------------------------------------------------------------------------
// Opening: loader finishes -> "100% Loaded" -> "Ready to Explore" -> opens
// through a growing beveled (cut-corner) window onto the scene
// ---------------------------------------------------------------------------
let loaderDone = false;

// Swap the status text with a gold bar wiping across it
function wipeText(text) {
  const wipe = $('.ld-wipe');
  return gsap.timeline()
    .set(wipe, { transformOrigin: 'left center' })
    .to(wipe, { scaleX: 1, duration: 0.35, ease: 'power3.in' })
    .call(() => { $('.ld-text').textContent = text; })
    .set(wipe, { transformOrigin: 'right center' })
    .to(wipe, { scaleX: 0, duration: 0.35, ease: 'power3.out' });
}

// Full-screen panel with a beveled hole in the middle (hole size: 0 = closed, 1.4 = fully open)
function beveledHole(p) {
  const w = innerWidth;
  const h = innerHeight;
  const hw = (w / 2) * p;
  const hh = (h / 2) * p;
  const b = Math.min(hw, hh) * 0.22;
  const cx = w / 2;
  const cy = h / 2;
  const outer = `M0 0 H${w} V${h} H0 Z`;
  const inner = `M${cx - hw + b} ${cy - hh} H${cx + hw - b} L${cx + hw} ${cy - hh + b} V${cy + hh - b} `
    + `L${cx + hw - b} ${cy + hh} H${cx - hw + b} L${cx - hw} ${cy + hh - b} V${cy - hh + b} Z`;
  return `path(evenodd, "${outer} ${inner}")`;
}

async function finishLoader() {
  const minTime = new Promise((r) => setTimeout(r, 1200)); // let the counter be seen
  await Promise.race([Promise.all([...loadTasks, minTime]), new Promise((r) => setTimeout(r, 20000))]);
  const loader = $('#loader');
  const hole = { p: 0 };
  gsap.timeline({
    onComplete: () => {
      loader.remove();
      loaderDone = true;
      if (!agenda.length) mode = 'top5'; // no agenda: the old "Start Show" intro is used
    },
  })
    .to(loadState, {
      shown: 100,
      duration: 0.5,
      ease: 'power2.out',
      onUpdate: () => {
        $('#ld-num').textContent = Math.round(loadState.shown);
        gsap.set('.ld-bar-fill', { scaleX: loadState.shown / 100 });
      },
    })
    .add(wipeText('100% Loaded'))
    .add(wipeText('Ready to Explore'), '+=0.35')
    .to('.ld-inner', { autoAlpha: 0, y: -20, duration: 0.5, ease: 'power2.in' }, '+=0.5')
    .to(hole, {
      p: 1.45,
      duration: 1.4,
      ease: 'expo.inOut',
      onUpdate: () => { loader.style.clipPath = beveledHole(hole.p); },
    }, '-=0.1')
    // the agenda menu is the first page: it appears as the loader opens
    .add(agenda.length ? showAgendaTl() : gsap.timeline(), '<0.3');
}
finishLoader();
