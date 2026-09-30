// Voxel mascot with movable joints. apply(c) poses it from a channel object (see poses.js).
import * as THREE from '../../../../node_modules/three/build/three.module.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Box with rounded corners: clamp vertices to an inner box, push back out by r.
function roundedBox(w, h, d, r) {
  const g = new THREE.BoxGeometry(w, h, d, 4, 4, 4);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    c.set(clamp(v.x, r - w / 2, w / 2 - r), clamp(v.y, r - h / 2, h / 2 - r), clamp(v.z, r - d / 2, d / 2 - r));
    v.sub(c);
    if (v.lengthSq() > 0) v.setLength(r);
    pos.setXYZ(i, c.x + v.x, c.y + v.y, c.z + v.z);
  }
  g.computeVertexNormals();
  return g;
}

const LEG_H = 0.3;
const TORSO_H = 0.26;
const HEAD = { w: 1.5, h: 1.0, d: 1.0 }; // slightly oversized head
const EYE_Y = 0.6;
const BASE_TURN = -0.25; // slight turn for depth
const TILT = 0.04; // natural head tilt (asymmetry)

export function createRig(bodyMat) {
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1b1b1f, roughness: 0.5 });
  const box = (parent, w, h, d, x, y, z, mat = bodyMat) => {
    // Body blocks get soft corners; face decals stay crisp.
    const r = mat === bodyMat ? Math.min(0.055, Math.min(w, h, d) * 0.3) : 0;
    const m = new THREE.Mesh(r > 0 ? roundedBox(w, h, d, r) : new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const group = (parent, x = 0, y = 0, z = 0) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  };

  // Origin sits between the feet so squash and hops stay grounded.
  const root = new THREE.Group();

  // Legs pivot at the hip; left pair / right pair move together. Feet stick out a bit.
  const legs = [-0.45, -0.16, 0.16, 0.45].map((x) => {
    const pivot = group(root, x, LEG_H, 0.1);
    box(pivot, 0.15, LEG_H, 0.15, 0, -LEG_H / 2, 0);
    box(pivot, 0.19, 0.07, 0.24, 0, -LEG_H + 0.035, 0.04);
    pivot.userData.side = x < 0 ? 'L' : 'R';
    return pivot;
  });

  const torso = group(root, 0, LEG_H, 0);
  box(torso, 1.0, TORSO_H, 0.75, 0, TORSO_H / 2, 0);

  // Arms hang from the shoulders and end in oversized block hands.
  const arm = (side) => {
    const pivot = group(torso, side * 0.86, 0.62, 0);
    box(pivot, 0.2, 0.3, 0.24, 0, -0.15, 0);
    box(pivot, 0.28, 0.24, 0.3, 0, -0.38, 0);
    pivot.userData.baseY = 0.62 + (side > 0 ? 0.03 : 0); // one shoulder a touch higher
    return pivot;
  };
  const armL = arm(-1);
  const armR = arm(1);

  // Flexible neck: the head rotates on its own pivot.
  const neck = group(torso, 0, TORSO_H, 0);
  const head = group(neck);
  box(head, HEAD.w, HEAD.h, HEAD.d, 0, HEAD.h / 2, 0);
  const face = HEAD.d / 2 + 0.01;

  const eyeBase = [-0.34, 0.34];
  const glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const eyes = eyeBase.map((x) => {
    const eye = box(head, 0.17, 0.17, 0.04, x, EYE_Y, face, darkMat);
    box(eye, 0.05, 0.05, 0.01, 0.04, 0.045, 0.025, glintMat); // glint
    return eye;
  });

  // Eyebrows pivot at their centre so they can tilt.
  const brows = [-1, 1].map((side) => {
    const g = group(head, side * 0.34, EYE_Y + 0.19, face);
    box(g, 0.26, 0.055, 0.04, 0, 0, 0, darkMat);
    g.userData.side = side;
    return g;
  });

  // Cheek blush.
  const blushMat = new THREE.MeshStandardMaterial({ color: 0xc75b47, roughness: 0.8 });
  const blushes = [-1, 1].map((side) => box(head, 0.17, 0.1, 0.04, side * 0.52, 0.38, face, blushMat));

  // Antenna: springy stalk + tip, driven by the brain's wobble spring.
  const antenna = group(head, 0, HEAD.h - 0.02, 0);
  box(antenna, 0.055, 0.24, 0.055, 0, 0.12, 0);
  box(antenna, 0.13, 0.13, 0.13, 0, 0.29, 0);

  // "> <" eyes for happy moments.
  const happyEyes = [-1, 1].map((s) => {
    const g = group(head, s * 0.34, EYE_Y, face + 0.01);
    for (const dir of [1, -1]) {
      const bar = box(g, 0.2, 0.06, 0.04, 0, dir * 0.04, 0, darkMat);
      bar.rotation.z = s * dir * 0.46;
    }
    return g;
  });

  // Voxel smile (U shape) and an open mouth for yawns / surprise.
  const smile = group(head, 0, 0.3, face);
  box(smile, 0.2, 0.05, 0.04, 0, 0, 0, darkMat);
  for (const s of [-1, 1]) box(smile, 0.06, 0.06, 0.04, s * 0.13, 0.04, 0, darkMat);
  const mouth = box(head, 0.16, 0.14, 0.04, 0, 0.3, face, darkMat);

  // Anchors used by the renderer.
  const headTop = group(head, 0, HEAD.h + 0.45, 0);
  const faceAnchor = group(head, 0, EYE_Y, 0); // sunglasses attach here

  const tiny = (v) => Math.max(v, 0.0001); // scale 0 breaks normals

  function apply(c) {
    root.position.set(c.x, c.y, c.z);
    root.rotation.set(c.rotX, BASE_TURN + c.rotY, c.rotZ);
    root.scale.set(1 - c.squash * 0.5, 1 + c.squash, 1 - c.squash * 0.5);

    torso.rotation.set(c.torsoX, 0, c.torsoZ);
    head.rotation.set(c.headX, c.headY, TILT + c.headZ);

    armL.rotation.set(-c.armLX, 0, -c.armLZ);
    armR.rotation.set(-c.armRX, 0, c.armRZ);
    armL.position.y = armL.userData.baseY + c.shoulderL;
    armR.position.y = armR.userData.baseY + c.shoulderR;

    for (const leg of legs) {
      const lift = leg.userData.side === 'L' ? c.legL : c.legR;
      leg.rotation.x = -lift * 0.7;
      leg.position.y = LEG_H + lift * 0.06;
    }

    // Eyes: look direction, widen, lids/blink; cross-fade to happy eyes.
    const open = tiny(1 - Math.min(1, c.lid + c.blink * 0.95));
    const square = tiny(1 - c.happy);
    eyes.forEach((eye, i) => {
      eye.position.x = eyeBase[i] + c.eyeX * 0.07;
      eye.position.y = EYE_Y + c.eyeY * 0.06;
      eye.scale.set(square * c.eyeScale, square * c.eyeScale * open, 1);
    });
    for (const g of happyEyes) g.scale.setScalar(tiny(c.happy));

    smile.scale.set(tiny(c.smile * (1 - c.mouthOpen)), tiny(c.smile * (1 - c.mouthOpen)), 1);
    mouth.scale.set(tiny(c.mouthOpen), tiny(c.mouthOpen), 1);

    for (const b of brows) {
      b.position.y = EYE_Y + 0.19 + c.browY * 0.07;
      b.rotation.z = b.userData.side < 0 ? c.browAngle * 0.45 : -c.browAngle * 0.45;
    }
    for (const b of blushes) b.scale.setScalar(tiny(c.blush));
    antenna.rotation.set(c.antennaX, 0, c.antennaZ);
  }

  return { root, head, headTop, faceAnchor, apply };
}
