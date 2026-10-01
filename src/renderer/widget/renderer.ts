// Widget renderer: three.js voxel mascot, speech bubble and sounds.
import * as THREE from '../../../node_modules/three/build/three.module.js';
import { playSound } from '../shared/sounds.js';
import { createRig } from './mascot/rig.js';
import { Brain } from './mascot/brain.js';
import { createRing } from './mascot/ring.js';
import { VoiceRecorder } from './voice.js';

/** How the widget looks in one state; 'listening' is ours, not one of Claude's. */
interface StateStyle {
  label: string;
  body: string;
  ring: string;
  ringSpeed: number;
}

const STATES: Record<BuddyState | 'listening', StateStyle> = {
  idle:        { label: 'Idle',                        body: '#D97757', ring: '#5BC98A', ringSpeed: 0.5 },
  working:     { label: 'Working…',                    body: '#D97757', ring: '#4A9EFF', ringSpeed: 7.0 },
  needs_input: { label: 'Needs you — review & accept', body: '#F2B84B', ring: '#FF4D4D', ringSpeed: 2.0 },
  listening:   { label: 'Listening…',                  body: '#D97757', ring: '#A78BFA', ringSpeed: 4.0 },
  done:        { label: 'Done ✓',                      body: '#D97757', ring: '#5BC98A', ringSpeed: 1.5 },
};

/** The page's own elements; a missing one is a bug in index.html, not a runtime case. */
function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`widget: #${id} is missing from index.html`);
  return found as T;
}

// ---------- scene ----------
const canvas = el<HTMLCanvasElement>('scene');
const labelEl = el('label');

const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
renderer.setClearColor(0x000000, 0);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
camera.position.set(0, 0.5, 5.4);
camera.lookAt(0, 0.35, 0);

// Lighting: key from the upper left (casts shadows), soft fill from the right,
// rim from behind for edges on dark backgrounds, sky/ground bounce instead of flat ambient.
scene.add(new THREE.HemisphereLight(0xfff4ec, 0x6a4336, 1.4));
const key = new THREE.DirectionalLight(0xffffff, 3.0);
key.position.set(-1.5, 3.5, 4);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.left = key.shadow.camera.bottom = -2;
key.shadow.camera.right = key.shadow.camera.top = 2;
key.shadow.camera.near = 1;
key.shadow.camera.far = 12;
key.shadow.bias = -0.002;
key.shadow.normalBias = 0.02;
key.shadow.radius = 3;
scene.add(key);
const fill = new THREE.DirectionalLight(0xffe2d6, 0.7);
fill.position.set(3, 1, 2);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xffffff, 1.2);
rim.position.set(0.5, 3, -4);
scene.add(rim);

// stage holds the mascot and its ring.
const stage = new THREE.Group();
stage.scale.setScalar(0.85);
scene.add(stage);

// Voxel mascot; one shared material so all blocks change colour together.
const bodyMat = new THREE.MeshStandardMaterial({ color: STATES.idle.body, roughness: 0.75, metalness: 0 });
const rig = createRig(bodyMat);
const mascot = new THREE.Group();
mascot.position.y = -0.62;
mascot.add(rig.root);
stage.add(mascot);

// Soft contact shadow under the feet (a radial gradient on a flat plane).
const shadowTex = ((): THREE.CanvasTexture => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  if (!g) throw new Error('widget: no 2d canvas context for the contact shadow');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)');
  grad.addColorStop(0.6, 'rgba(0,0,0,0.25)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();
const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });
const contactShadow = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.2), shadowMat);
contactShadow.rotation.x = -Math.PI / 2;
contactShadow.position.y = 0.01;
mascot.add(contactShadow);

/** A dust puff; it owns its material so it can fade on its own. */
interface Puff {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  vel: THREE.Vector3;
  t: number;
}

// Dust puffs that burst out when he lands a jump.
const puffs: Puff[] = Array.from({ length: 6 }, () => {
  const mat = new THREE.MeshBasicMaterial({ color: 0xbfb8b0, transparent: true, opacity: 0, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.09), mat);
  mesh.visible = false;
  mascot.add(mesh);
  return { mesh, mat, vel: new THREE.Vector3(), t: 1 };
});
let prevPoseY = 0;

function spawnPuffs(x: number): void {
  let n = 0;
  for (const p of puffs) {
    if (p.t < 1) continue;
    p.t = 0;
    p.mesh.visible = true;
    p.mesh.position.set(x + (Math.random() - 0.5) * 0.7, 0.06, 0.25);
    p.vel.set((Math.random() - 0.5) * 1.6, 0.35 + Math.random() * 0.5, 0);
    if (++n >= 4) break;
  }
}

function updatePuffs(dt: number): void {
  for (const p of puffs) {
    if (p.t >= 1) continue;
    p.t += dt * 1.8;
    p.mesh.position.addScaledVector(p.vel, dt);
    p.vel.multiplyScalar(Math.max(0, 1 - 3 * dt));
    p.mesh.scale.setScalar(0.5 + p.t * 0.9);
    p.mat.opacity = 0.45 * Math.max(0, 1 - p.t);
    if (p.t >= 1) p.mesh.visible = false;
  }
}
const brain = new Brain();
const headTop = rig.headTop; // the speech bubble follows it

// Status halo: tilted so the front arc passes below the face.
const ring = createRing(STATES.idle);
stage.add(ring.group);

// "Deal with it" pixel sunglasses: sometimes drop onto the face when a task is done.
const shadesMat = new THREE.MeshStandardMaterial({ color: 0x111114, roughness: 0.4 });
const glareMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const shades = new THREE.Group();
const shadesPart = (w: number, h: number, x: number, y: number, z: number, mat: THREE.Material): void => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.05), mat);
  m.position.set(x, y, z);
  shades.add(m);
};
shadesPart(1.24, 0.08, 0, 0.09, 0.03, shadesMat); // top bar
for (const x of [-0.33, 0.33]) {
  shadesPart(0.42, 0.26, x, -0.02, 0.03, shadesMat); // lens
  for (const [dx, dy] of [[-0.12, 0.05], [-0.06, -0.01], [0, 0.05]]) {
    shadesPart(0.055, 0.055, x + dx, -0.02 + dy, 0.06, glareMat); // pixel glare
  }
}
rig.faceAnchor.add(shades);
let shadesOn = 0; // 0 = hidden above the head, 1 = on the face
let coolDone = false; // picked per "done" event

// ---------- state ----------
let state: BuddyState = 'idle';
// Per-state blend weights: each frame they ease toward 1 (active) / 0 (inactive),
// so motions cross-fade instead of snapping.
const weight: Record<BuddyState, number> = { idle: 1, working: 0, needs_input: 0, done: 0 };
const targetBody = new THREE.Color(STATES.idle.body);

function applyState(next: BuddyState): void {
  if (!Object.hasOwn(STATES, next)) return;
  const prev = state;
  state = next;
  if (next !== prev) reactToState(next);
  brain.setState(next);
  targetBody.set(STATES[next].body);
  ring.setState(STATES[next]);
  labelEl.textContent = STATES[next].label;
  labelEl.className = next;
}

// ---------- speech bubble ----------
const QUIPS: Record<BuddyState, string[]> = {
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

const bubbleEl = el('bubble');
const typedEl = el('bubble-typed');
const restEl = el('bubble-rest');
let hideTimer: number | undefined;
let typeTimer: number | undefined;
let chatterTimer: number | undefined;
let bubblePinned = false; // pinned bubbles (needs_input) stay until the state changes
let talking = false; // true while the typewriter runs; the mouth moves
let lastQuip = '';
let userName = 'Buddy';

window.buddy.onName((name) => { userName = name || 'Buddy'; });

// Fill {name} / {NAME} in a quip.
const withName = (text: string): string => text.replaceAll('{NAME}', userName.toUpperCase()).replaceAll('{name}', userName);

function pick(list: string[]): string {
  const options = list.filter((q) => q !== lastQuip);
  return (lastQuip = options[Math.floor(Math.random() * options.length)]);
}

function say(template: string, ms = 4500): void {
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

function hideBubble(): void {
  clearTimeout(hideTimer);
  clearInterval(typeTimer);
  talking = false;
  bubblePinned = false;
  bubbleEl.classList.remove('show');
}

// ---------- sounds ----------
const REPEAT_MS = 30000;
let sound: SoundConfig = { enabled: true, volume: 70, repeat: true, needs_input: 'whistle', done: 'none', working: 'none' };
let repeatTimer: number | undefined;

window.buddy.onSounds((s) => { sound = s; });

const canPlay = (event: BuddyState): event is SoundEvent => event !== 'idle';
const play = (event: BuddyState): void => { if (sound.enabled && canPlay(event)) playSound(sound[event], sound.volume); };

function reactToState(next: BuddyState): void {
  hideBubble(); // a quip from the previous state would be stale
  clearInterval(repeatTimer);
  play(next);
  if (next === 'needs_input' && sound.repeat) repeatTimer = setInterval(() => play('needs_input'), REPEAT_MS);
  if (next === 'needs_input') say(pick(QUIPS.needs_input), Infinity);
  if (next === 'done') {
    ring.burst();
    coolDone = Math.random() < 0.5;
    say(coolDone ? 'Deal with it, {name}. 😎' : pick(QUIPS.done), 5000);
  }
  if (next === 'working' && Math.random() < 0.35) say(pick(QUIPS.working));
}

// Random chatter every 20–45s while idle or working.
function scheduleChatter(): void {
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

// ---------- loop ----------
let last = performance.now();
let t = 0;
const labelColor = new THREE.Color();

function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.05); // clamp so a stalled tab doesn't jump
  last = now;
  t += dt;

  // Frame-rate independent easing factors.
  const ease = (rate: number): number => 1 - Math.exp(-rate * dt);
  for (const s of Object.keys(weight) as BuddyState[]) weight[s] += ((s === state ? 1 : 0) - weight[s]) * ease(6);
  bodyMat.color.lerp(targetBody, ease(5));

  const w = weight;

  // Mascot pose from the behaviour brain.
  brain.talking = talking;
  const pose = brain.update(dt);
  rig.apply(pose);
  // Contact shadow follows him and shrinks/fades while he's in the air.
  const air = Math.max(0, pose.y);
  contactShadow.position.x = pose.x;
  contactShadow.scale.setScalar(1 / (1 + air * 1.5));
  shadowMat.opacity = 1 / (1 + air * 3);
  if (prevPoseY > 0.05 && pose.y <= 0.015) spawnPuffs(pose.x);
  prevPoseY = pose.y;
  updatePuffs(dt);

  ring.update(dt, { t, w, x: pose.x, y: pose.y, rotZ: pose.rotZ });

  // Shades drop from above the head onto the face, and lift off again when done ends.
  shadesOn += ((state === 'done' && coolDone ? 1 : 0) - shadesOn) * ease(5);
  shades.visible = shadesOn > 0.01;
  shades.position.y = (1 - shadesOn) * 1.6;

  // Label border follows the (already smoothed) ring colour.
  labelColor.copy(ring.color);
  labelEl.style.setProperty('--ring', `#${labelColor.getHexString()}`);

  renderer.render(scene, camera);
  placeBubble();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// Keep the bubble just above the head, wherever the mascot bounces.
const BUBBLE_GAP = 8;
const headPos = new THREE.Vector3();
function placeBubble(): void {
  headTop.getWorldPosition(headPos).project(camera);
  const headY = canvas.offsetTop + ((1 - headPos.y) / 2) * canvas.clientHeight;
  const top = Math.max(2, headY - bubbleEl.offsetHeight - BUBBLE_GAP);
  bubbleEl.style.top = `${Math.round(top)}px`;
}

// ---------- settings button ----------
const settingsBtn = el<HTMLButtonElement>('settings-btn');
settingsBtn.addEventListener('click', () => window.buddy.openSettings());
// Dot on the button shows the LED strip connection.
const LED_DOT: Partial<Record<LedStatus, string>> = { connected: '#5BC98A', connecting: '#F2B84B', reconnecting: '#F2B84B', error: '#FF4D4D' };
window.buddy.onLedState((led) => {
  settingsBtn.style.setProperty('--led-dot', LED_DOT[led.status] || 'transparent');
  settingsBtn.title = `Settings · LED ${led.status}`;
});

// ---------- voice ----------
// Click the mascot to talk, hold him for push-to-talk, or use the global hotkey.
// What you say is transcribed on-device and pasted into the Claude Code prompt.
const HOLD_MS = 350;
const DRAG_PX = 5;

/** A mouse press that is still deciding whether it is a drag or a tap. */
interface Gesture {
  x: number;
  y: number;
  onMascot: boolean;
  dragging: boolean;
  held: boolean;
  timer: number | undefined;
}

let voiceCfg: VoiceConfig = { enabled: true, hotkey: '', locale: 'en-US', autoSend: false };
let listening = false;
let transcribing = false;
let gesture: Gesture | null = null;

window.buddy.onVoice((cfg) => { voiceCfg = cfg; });

const recorder = new VoiceRecorder({
  onLevel: (level) => { brain.listenLevel = level; },
  onAutoStop: () => { stopListening(); },
});

// The ring shows listening; everything else keeps following Claude's state.
function showListening(on: boolean): void {
  brain.setListening(on);
  brain.listenLevel = 0;
  ring.setState(on ? STATES.listening : STATES[state]);
  labelEl.textContent = on ? STATES.listening.label : STATES[state].label;
}

async function startListening(): Promise<void> {
  if (listening || transcribing || !voiceCfg.enabled) return;
  try {
    await recorder.start();
  } catch {
    say('I can\'t hear — check mic access', 5000);
    return;
  }
  listening = true;
  showListening(true);
  hideBubble();
}

async function stopListening(): Promise<void> {
  if (!listening) return;
  listening = false;
  const wav = recorder.stop();
  showListening(false);
  if (!wav) return say('That was too short', 2500);

  transcribing = true;
  say('Thinking…', Infinity);
  const res = await window.buddy.voice.transcribe(wav);
  transcribing = false;
  hideBubble();
  if (!res.ok) say(res.error, 6000);
  else if (!res.result.text) say('I didn\'t catch that', 3000);
  else say(`“${res.result.text}”`, 4000);
}

const toggleListening = (): void => { void (listening ? stopListening() : startListening()); };
window.buddy.onVoiceToggle(toggleListening);

// One gesture handles both: move the mouse and it drags the widget, otherwise it talks.
document.addEventListener('mousedown', (e) => {
  const target = e.target;
  if (e.button !== 0 || !(target instanceof Element) || target.closest('button')) return;
  gesture = { x: e.screenX, y: e.screenY, onMascot: target === canvas, dragging: false, held: false, timer: undefined };
  window.buddy.dragStart();
  gesture.timer = setTimeout(() => {
    if (gesture && !gesture.dragging && gesture.onMascot) {
      gesture.held = true;
      startListening();
    }
  }, HOLD_MS);
});

window.addEventListener('mousemove', (e) => {
  if (!gesture) return;
  const dx = e.screenX - gesture.x;
  const dy = e.screenY - gesture.y;
  if (!gesture.dragging && Math.hypot(dx, dy) > DRAG_PX) {
    gesture.dragging = true;
    clearTimeout(gesture.timer);
  }
  if (gesture.dragging) window.buddy.dragMove(dx, dy);
});

window.addEventListener('mouseup', () => {
  if (!gesture) return;
  clearTimeout(gesture.timer);
  const done = gesture;
  gesture = null;
  if (done.dragging) return;
  if (done.held) stopListening();        // push-to-talk released
  else if (done.onMascot) toggleListening();
});
