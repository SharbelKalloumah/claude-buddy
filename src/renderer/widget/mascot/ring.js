// Status halo around the mascot: glow, travelling pulse, tick marks, comet dots and sparkles.
import * as THREE from '../../../../node_modules/three/build/three.module.js';

const R = 1.45;
const TICKS = 18;
const COMETS = 3;
const TRAIL = 6;
const SPARKS = 12;
const WHITE = new THREE.Color(0xffffff);

export function createRing({ ring: hex, ringSpeed }) {
  const color = new THREE.Color(hex);
  const targetColor = new THREE.Color(hex);
  let speed = ringSpeed;
  let targetSpeed = ringSpeed;

  // group = tilt + wobble; inner groups spin.
  const group = new THREE.Group();
  group.rotation.set(-1.2, 0, 0.2);
  group.position.y = 0.05;

  const bandMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.95, roughness: 0.35 });
  const band = new THREE.Mesh(new THREE.TorusGeometry(R, 0.05, 14, 96), bandMat);
  group.add(band);

  // Fat additive torus behind the band reads as a soft glow.
  const haloMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false });
  group.add(new THREE.Mesh(new THREE.TorusGeometry(R, 0.18, 10, 64), haloMat));

  // Ticks just outside the band; they're what makes the rotation readable.
  const tickMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9 });
  const ticks = new THREE.Group();
  group.add(ticks);
  for (let i = 0; i < TICKS; i++) {
    const a = (i / TICKS) * Math.PI * 2;
    const tick = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.09, 0.03), tickMat);
    tick.position.set(Math.cos(a) * (R + 0.085), Math.sin(a) * (R + 0.085), 0);
    tick.rotation.z = a;
    ticks.add(tick);
  }

  // A bright arc that sweeps around the band.
  const pulseMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false });
  const pulse = new THREE.Mesh(new THREE.TorusGeometry(R, 0.085, 10, 28, 0.8), pulseMat);
  group.add(pulse);

  // Comet dots (visible while working): a head plus a fading trail along the ring.
  const trailMats = Array.from({ length: TRAIL }, (_, i) => new THREE.MeshBasicMaterial({
    transparent: true, opacity: 0.55 * (1 - i / TRAIL), blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  const headMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const comets = Array.from({ length: COMETS }, (_, i) => {
    const parts = [new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), headMat)];
    for (let k = 0; k < TRAIL; k++) {
      parts.push(new THREE.Mesh(new THREE.SphereGeometry(0.075 * (1 - k / TRAIL) * 0.85, 8, 6), trailMats[k]));
    }
    for (const p of parts) group.add(p);
    return { parts, phase: (i / COMETS) * Math.PI * 2 };
  });

  // Sparkles fired outward from the band by burst(); each needs its own fading material.
  const sparks = Array.from({ length: SPARKS }, () => {
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.07), mat);
    mesh.visible = false;
    group.add(mesh);
    return { mesh, vel: new THREE.Vector3(), t: 1 };
  });

  let spinA = 0;
  let pulseA = 0;
  let cometA = 0;
  let lagX = 0;
  let prevX = 0;
  let prevY = 0;
  let wob = 0;
  let wobV = 0;
  let ripple = 0;

  function burst() {
    let fired = 0;
    for (const s of sparks) {
      if (s.t < 1) continue;
      const a = Math.random() * Math.PI * 2;
      s.t = 0;
      s.mesh.visible = true;
      s.mesh.position.set(Math.cos(a) * R, Math.sin(a) * R, 0);
      s.vel.set(Math.cos(a) * 1.3, Math.sin(a) * 1.3, (Math.random() - 0.5) * 0.6);
      if (++fired >= 8) break;
    }
  }

  function update(dt, { t, w, x = 0, y = 0, rotZ = 0 }) {
    const ease = (r) => 1 - Math.exp(-r * dt);
    color.lerp(targetColor, ease(5));
    speed += (targetSpeed - speed) * ease(3);

    bandMat.color.copy(color);
    bandMat.emissive.copy(color);
    haloMat.color.copy(color);
    tickMat.color.copy(color);
    pulseMat.color.copy(color).lerp(WHITE, 0.55);

    // Spin (ticks make it visible) and the sweeping pulse.
    spinA += speed * dt;
    ticks.rotation.z = spinA;
    pulseA += (speed * 0.5 + 2.2 + w.needs_input * 6) * dt;
    pulse.rotation.z = pulseA;
    pulseMat.opacity = Math.max(0, 0.32 + 0.26 * Math.sin(t * 6) + w.needs_input * 0.35);
    haloMat.opacity = 0.1 + 0.05 * Math.sin(t * 2) + w.needs_input * 0.14 + w.done * 0.07;
    tickMat.opacity = 0.5 + 0.45 * w.working + 0.3 * w.needs_input;

    // Comets ride the ring while he works.
    cometA += (speed * 0.6 + 1.5) * dt;
    const cometScale = Math.max(w.working, 0.0001);
    for (const comet of comets) {
      comet.parts.forEach((part, k) => {
        const a = cometA + comet.phase - k * 0.12;
        part.position.set(Math.cos(a) * R, Math.sin(a) * R, 0);
        part.scale.setScalar(cometScale);
        part.visible = w.working > 0.01;
      });
    }

    for (const s of sparks) {
      if (s.t >= 1) continue;
      s.t += dt * 1.6;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.vel.multiplyScalar(Math.max(0, 1 - 2.5 * dt));
      s.mesh.rotation.x += dt * 6;
      s.mesh.rotation.y += dt * 4;
      s.mesh.material.opacity = Math.max(0, 1 - s.t);
      s.mesh.scale.setScalar(1 - s.t * 0.5);
      if (s.t >= 1) s.mesh.visible = false;
    }

    // Follow him with a beat of lag, and tip with his sideways motion.
    lagX += (x - lagX) * ease(9);
    group.position.x = lagX;
    const vx = (x - prevX) / Math.max(dt, 1e-4);
    prevX = x;
    wobV += ((-vx * 0.09 - wob) * 60 - wobV * 7) * dt;
    wob = Math.max(-0.3, Math.min(0.3, wob + wobV * dt));
    group.rotation.z = 0.2 + wob + rotZ * 0.3;

    // Ripple outward when he lands.
    if (prevY > 0.05 && y <= 0.015) ripple = 1;
    prevY = y;
    ripple = Math.max(0, ripple - dt * 3.5);
    const alert = w.needs_input * (0.08 + Math.sin(t * 10) * 0.08);
    group.scale.setScalar(1 + alert + Math.sin(ripple * Math.PI) * 0.07);
  }

  return {
    group,
    color,
    burst,
    update,
    setState({ ring, ringSpeed: s }) {
      targetColor.set(ring);
      targetSpeed = s;
    },
  };
}
