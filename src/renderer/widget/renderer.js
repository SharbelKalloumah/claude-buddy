// Widget renderer: three.js voxel mascot, speech bubble and sounds.
import * as THREE from '../../../node_modules/three/build/three.module.js';
import { playSound } from '../shared/sounds.js';

const STATES = {
  idle:        { label: 'Idle',                        body: '#D97757', ring: '#5BC98A', ringSpeed: 0.5 },
  working:     { label: 'Working…',                    body: '#D97757', ring: '#4A9EFF', ringSpeed: 7.0 },
  needs_input: { label: 'Needs you — review & accept', body: '#F2B84B', ring: '#FF4D4D', ringSpeed: 2.0 },
  done:        { label: 'Done ✓',                      body: '#D97757', ring: '#5BC98A', ringSpeed: 1.5 },
};

// ---------- scene ----------
const canvas = document.getElementById('scene');
const labelEl = document.getElementById('label');

const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
renderer.setClearColor(0x000000, 0);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
camera.position.set(0, 0.5, 5.4);
camera.lookAt(0, 0.35, 0);

scene.add(new THREE.AmbientLight(0xffffff, 1.4));
const fill = new THREE.DirectionalLight(0xffffff, 1.0);
fill.position.set(-2, 0.5, 4);
scene.add(fill);
const key = new THREE.DirectionalLight(0xffffff, 2.4);
key.position.set(2, 3, 4);
scene.add(key);

// root: float/bounce/sway. body: squash & stretch (eyes included).
const root = new THREE.Group();
scene.add(root);
const body = new THREE.Group();
root.add(body);

// Voxel mascot; one shared material so all blocks change colour together.
const bodyMat = new THREE.MeshStandardMaterial({ color: STATES.idle.body, roughness: 0.75, metalness: 0 });
const block = (w, h, d, x, y, z, mat = bodyMat) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  body.add(m);
  return m;
};
block(1.5, 1.1, 1.0, 0, 0.8, 0);                                       // torso
// Invisible point on top of the head; the speech bubble follows it.
const headTop = new THREE.Object3D();
headTop.position.set(0, 1.4, 0);
body.add(headTop);
for (const s of [-1, 1]) block(0.3, 0.3, 0.4, s * 0.9, 0.75, 0);      // stub arms
for (const x of [-0.55, -0.2, 0.2, 0.55]) block(0.16, 0.34, 0.16, x, 0.08, 0.2); // legs
// Pivot near the feet so squash looks grounded; slight turn for depth.
body.position.y = -0.5;
body.rotation.y = -0.25;
root.scale.setScalar(0.9);

// Eyes: square pixels normally; "> <" chevrons when done (cross-faded by scale).
const eyeMat = new THREE.MeshStandardMaterial({ color: 0x1b1b1f, roughness: 0.5 });
const eyes = [-0.34, 0.34].map((x) => block(0.17, 0.17, 0.04, x, 0.92, 0.51, eyeMat));
const happyEyes = [-1, 1].map((s) => {
  // Two short bars meeting at a point: '>' on the left, '<' on the right.
  const g = new THREE.Group();
  g.position.set(s * 0.34, 0.92, 0.52);
  for (const dir of [1, -1]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.04), eyeMat);
    bar.position.set(0, dir * 0.04, 0);
    bar.rotation.z = s * dir * 0.46;
    g.add(bar);
  }
  body.add(g);
  return g;
});

// Tilted ring: the group holds the tilt, the ring spins inside it.
const ringTilt = new THREE.Group();
ringTilt.rotation.set(-1.2, 0, 0.2); // front arc passes below the face, back arc above the head
root.add(ringTilt);
const ringMat = new THREE.MeshStandardMaterial({
  color: STATES.idle.ring, emissive: STATES.idle.ring, emissiveIntensity: 0.6, roughness: 0.4,
});
const RING_R = 1.45;
const ring = new THREE.Mesh(new THREE.TorusGeometry(RING_R, 0.055, 16, 96), ringMat);
ringTilt.add(ring);

// Three orbiting dots (only visible while working). They sit on the ring plane.
const dotMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.8 });
const dots = [0, 1, 2].map((i) => {
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 10), dotMat);
  dot.userData.phase = (i / 3) * Math.PI * 2;
  ringTilt.add(dot);
  return dot;
});

// "Deal with it" pixel sunglasses: sometimes drop onto the face when a task is done.
const shadesMat = new THREE.MeshStandardMaterial({ color: 0x111114, roughness: 0.4 });
const glareMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const shades = new THREE.Group();
const shadesPart = (w, h, x, y, z, mat) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.05), mat);
  m.position.set(x, y, z);
  shades.add(m);
};
shadesPart(1.24, 0.08, 0, 0.09, 0.53, shadesMat); // top bar
for (const x of [-0.33, 0.33]) {
  shadesPart(0.42, 0.26, x, -0.02, 0.53, shadesMat); // lens
  for (const [dx, dy] of [[-0.12, 0.05], [-0.06, -0.01], [0, 0.05]]) {
    shadesPart(0.055, 0.055, x + dx, -0.02 + dy, 0.56, glareMat); // pixel glare
  }
}
body.add(shades);
let shadesOn = 0; // 0 = hidden above the head, 1 = on the face
let coolDone = false; // picked per "done" event

// ---------- state ----------
let state = 'idle';
// Per-state blend weights: each frame they ease toward 1 (active) / 0 (inactive),
// so motions cross-fade instead of snapping.
const weight = { idle: 1, working: 0, needs_input: 0, done: 0 };
const targetBody = new THREE.Color(STATES.idle.body);
const targetRing = new THREE.Color(STATES.idle.ring);
let ringSpeed = STATES.idle.ringSpeed;
let ringAngle = 0;
let dotAngle = 0;

function applyState(next) {
  if (!STATES[next]) return;
  const prev = state;
  state = next;
  if (next !== prev) reactToState(next);
  targetBody.set(STATES[next].body);
  targetRing.set(STATES[next].ring);
  labelEl.textContent = STATES[next].label;
  labelEl.className = next;
}

// ---------- speech bubble ----------
const QUIPS = {
  idle: [
    '{name}, got any bugs for me?',
    'Just vibing, {name}.',
    'Coffee o\'clock, {name}? ☕',
    'I could refactor something… just saying.',
    '{name}, blink twice if you need code.',
    'Idle hands are the devil\'s linter.',
    'Pretending to be a paperweight.',
    'Waiting for {name}\'s next genius idea…',
  ],
  working: [
    'Typing furiously…',
    'Don\'t look, {name}, I\'m shy!',
    'Reticulating splines…',
    '{name}, this is fine. 🔥',
    '100% not guessing.',
    'Downloading more RAM…',
    'Tests are just suggestions, right?',
    'Hold my coffee, {name}.',
  ],
  needs_input: [
    '{NAME}! Need you here!',
    '{name}, a little help? 🙏',
    'Psst… {name}… approve me?',
    'Knock knock, {name}!',
  ],
  done: [
    'Nailed it, {name}! 🎉',
    'Ship it, {name}! 🚀',
    'Another one done. You\'re welcome.',
    'High five, {name}! ✋',
  ],
};

const bubbleEl = document.getElementById('bubble');
const typedEl = document.getElementById('bubble-typed');
const restEl = document.getElementById('bubble-rest');
let hideTimer = null;
let typeTimer = null;
let chatterTimer = null;
let bubblePinned = false; // pinned bubbles (needs_input) stay until the state changes
let talking = false; // true while the typewriter runs; the body wiggles
let lastQuip = '';
let userName = 'Buddy';

window.buddy.onName((name) => { userName = name || 'Buddy'; });

// Fill {name} / {NAME} in a quip.
const withName = (text) => text.replaceAll('{NAME}', userName.toUpperCase()).replaceAll('{name}', userName);

function pick(list) {
  const options = list.filter((q) => q !== lastQuip);
  return (lastQuip = options[Math.floor(Math.random() * options.length)]);
}

function say(template, ms = 4500) {
  const text = withName(template);
  clearTimeout(hideTimer);
  clearInterval(typeTimer);
  const chars = [...text]; // spread so emoji aren't split mid-surrogate
  let i = 0;
  // Untyped text stays invisible so the bubble doesn't resize while typing.
  typedEl.textContent = '';
  restEl.textContent = text;
  bubbleEl.classList.add('show');
  talking = true;
  typeTimer = setInterval(() => {
    i += 1;
    typedEl.textContent = chars.slice(0, i).join('');
    restEl.textContent = chars.slice(i).join('');
    if (i >= chars.length) { clearInterval(typeTimer); talking = false; }
  }, 35);
  bubblePinned = ms === Infinity;
  if (!bubblePinned) hideTimer = setTimeout(hideBubble, ms);
}

function hideBubble() {
  clearTimeout(hideTimer);
  clearInterval(typeTimer);
  talking = false;
  bubblePinned = false;
  bubbleEl.classList.remove('show');
}

// ---------- sounds ----------
const REPEAT_MS = 30000;
let sound = { enabled: true, volume: 70, repeat: true, needs_input: 'whistle', done: 'none', working: 'none' };
let repeatTimer = null;

window.buddy.onSounds((s) => { sound = s; });

const play = (event) => { if (sound.enabled) playSound(sound[event], sound.volume); };

function reactToState(next) {
  hideBubble(); // a quip from the previous state would be stale
  clearInterval(repeatTimer);
  play(next);
  if (next === 'needs_input' && sound.repeat) repeatTimer = setInterval(() => play('needs_input'), REPEAT_MS);
  if (next === 'needs_input') say(pick(QUIPS.needs_input), Infinity);
  if (next === 'done') {
    coolDone = Math.random() < 0.5;
    say(coolDone ? 'Deal with it, {name}. 😎' : pick(QUIPS.done), 5000);
  }
  if (next === 'working' && Math.random() < 0.35) say(pick(QUIPS.working));
}

// Random chatter every 20–45s while idle or working.
function scheduleChatter() {
  chatterTimer = setTimeout(() => {
    if ((state === 'idle' || state === 'working') && !bubbleEl.classList.contains('show')) {
      say(pick(QUIPS[state]));
    }
    scheduleChatter();
  }, 20000 + Math.random() * 25000);
}
scheduleChatter();
// Greet on startup unless something else is already being said.
setTimeout(() => { if (!bubbleEl.classList.contains('show')) say('Hey {name}! 👋'); }, 1200);

window.buddy.onState(applyState);
labelEl.addEventListener('contextmenu', (e) => { e.preventDefault(); window.buddy.showContextMenu(); });

// ---------- blinking ----------
let nextBlink = 2 + Math.random() * 3;
let blinkT = -1; // <0 means not blinking
const BLINK_DUR = 0.16;

function updateBlink(dt) {
  if (blinkT < 0) {
    nextBlink -= dt;
    if (nextBlink <= 0) blinkT = 0;
  } else {
    blinkT += dt;
    if (blinkT >= BLINK_DUR) {
      blinkT = -1;
      nextBlink = 2.5 + Math.random() * 3.5;
    }
  }
  // Close then open: squash eye height with a sine bump over the blink duration.
  const closed = blinkT < 0 ? 0 : Math.sin((blinkT / BLINK_DUR) * Math.PI);
  const square = Math.max(1 - weight.done, 0.0001); // square eyes fade out as happy eyes fade in
  for (const eye of eyes) eye.scale.set(square, square * (1 - 0.9 * closed), 1);
  for (const g of happyEyes) g.scale.setScalar(Math.max(weight.done, 0.0001));
}

// ---------- loop ----------
let last = performance.now();
let t = 0;
const labelColor = new THREE.Color();

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05); // clamp so a stalled tab doesn't jump
  last = now;
  t += dt;

  // Frame-rate independent easing factors.
  const ease = (rate) => 1 - Math.exp(-rate * dt);
  for (const s in weight) weight[s] += ((s === state ? 1 : 0) - weight[s]) * ease(6);
  bodyMat.color.lerp(targetBody, ease(5));
  ringMat.color.lerp(targetRing, ease(5));
  ringMat.emissive.copy(ringMat.color);
  ringSpeed += (STATES[state].ringSpeed - ringSpeed) * ease(3);

  const w = weight;

  // Vertical motion: gentle float (idle/working), bouncy hops (needs_input/done).
  const float = Math.sin(t * 1.3) * 0.09;
  const hopFast = Math.abs(Math.sin(t * 6.5)) * 0.32;
  const hopHappy = Math.abs(Math.sin(t * 4.2)) * 0.2;
  root.position.y = (w.idle + w.working) * float + w.needs_input * hopFast + w.done * hopHappy;

  // Sway / wobble around Z.
  root.rotation.z =
    w.idle * Math.sin(t * 0.8) * 0.07 +
    w.done * Math.sin(t * 9) * 0.12 +
    w.needs_input * Math.sin(t * 13) * 0.04;
  root.rotation.y = w.idle * Math.sin(t * 0.5) * 0.12;

  // Squash & stretch: subtle pulse while working, landing squash for hops.
  const pulse = Math.sin(t * 8) * 0.05;
  const land = (1 - Math.abs(Math.sin(t * 6.5))) ** 4 * 0.18; // peaks when the hop touches down
  const landHappy = (1 - Math.abs(Math.sin(t * 4.2))) ** 4 * 0.1;
  const chatter = talking ? Math.sin(t * 32) * 0.035 : 0;
  const squash = w.working * pulse - w.needs_input * land - w.done * landHappy + chatter;
  body.scale.set(1 - squash * 0.5, 1 + squash, 1 - squash * 0.5);

  // Ring spin and (needs_input) scale pulse.
  ringAngle += ringSpeed * dt;
  ring.rotation.z = ringAngle;
  const ringPulse = 1 + w.needs_input * (0.08 + Math.sin(t * 10) * 0.08);
  ringTilt.scale.setScalar(ringPulse);

  // Dots orbit the ring and fade with the working weight.
  dotAngle += (ringSpeed * 0.6 + 1.5) * dt;
  for (const dot of dots) {
    const a = dotAngle + dot.userData.phase;
    dot.position.set(Math.cos(a) * RING_R, Math.sin(a) * RING_R, 0);
    dot.scale.setScalar(Math.max(w.working, 0.0001));
  }

  // Shades drop from above the head onto the face, and lift off again when done ends.
  shadesOn += ((state === 'done' && coolDone ? 1 : 0) - shadesOn) * ease(5);
  shades.visible = shadesOn > 0.01;
  shades.position.y = 0.92 + (1 - shadesOn) * 1.6;

  updateBlink(dt);

  // Label border follows the (already smoothed) ring colour.
  labelColor.copy(ringMat.color);
  labelEl.style.setProperty('--ring', `#${labelColor.getHexString()}`);

  renderer.render(scene, camera);
  placeBubble();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// Keep the bubble just above the head, wherever the mascot bounces.
const BUBBLE_GAP = 8;
const headPos = new THREE.Vector3();
function placeBubble() {
  headTop.getWorldPosition(headPos).project(camera);
  const headY = canvas.offsetTop + ((1 - headPos.y) / 2) * canvas.clientHeight;
  const top = Math.max(2, headY - bubbleEl.offsetHeight - BUBBLE_GAP);
  bubbleEl.style.top = `${Math.round(top)}px`;
}

// ---------- settings button ----------
const settingsBtn = document.getElementById('settings-btn');
settingsBtn.addEventListener('click', () => window.buddy.openSettings());
// Dot on the button shows the LED strip connection.
const LED_DOT = { connected: '#5BC98A', connecting: '#F2B84B', reconnecting: '#F2B84B', error: '#FF4D4D' };
window.buddy.onLedState((led) => {
  settingsBtn.style.setProperty('--led-dot', LED_DOT[led.status] || 'transparent');
  settingsBtn.title = `Settings · LED ${led.status}`;
});
