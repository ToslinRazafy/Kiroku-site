import * as THREE from 'three';

/* =================================================================
   Kiroku — scroll-driven 3D scene
   -----------------------------------------------------------------
   Structure:
     1. Feature detection (WebGL / reduced motion / device tier)
     2. Scene setup (renderer, camera, lights)
     3. World objects (globe, rings, starfield, drifting particles)
     4. Camera path (one waypoint per section, lerped by scroll)
     5. Render loop
     6. Page chrome (nav state, scroll reveal, resize)
   ================================================================= */

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isSmallScreen = window.innerWidth < 768;
const isLowPower = isSmallScreen || navigator.hardwareConcurrency <= 4;

function supportsWebGL() {
  try {
    const canvas = document.createElement('canvas');
    return !!(window.WebGLRenderingContext &&
      (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
  } catch (e) {
    return false;
  }
}

if (!supportsWebGL()) {
  document.getElementById('scene').classList.add('hidden');
  document.getElementById('no-webgl-fallback').classList.remove('hidden');
} else {
  initScene();
}

function initScene() {
  const canvas = document.getElementById('scene');

  // --- 1. Renderer -------------------------------------------------
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !isLowPower,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isLowPower ? 1.5 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  // --- 2. Scene & camera --------------------------------------------
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    0.1,
    2000
  );
  camera.position.set(0, 0, 70);

  const ambient = new THREE.AmbientLight(0x7c83fd, 0.6);
  scene.add(ambient);
  const keyLight = new THREE.PointLight(0xff8fb3, 1.4, 300);
  keyLight.position.set(40, 20, 60);
  scene.add(keyLight);

  // --- 3. World objects ----------------------------------------------

  // The globe: a dotted sphere (a "library of stars") plus a faint
  // wireframe shell for structure, and a soft inner glow.
  const globeGroup = new THREE.Group();
  scene.add(globeGroup);

  const dotCount = isLowPower ? 1400 : 3200;
  const dotGeometry = new THREE.BufferGeometry();
  const dotPositions = new Float32Array(dotCount * 3);
  const dotColors = new Float32Array(dotCount * 3);
  const colorA = new THREE.Color(0x7c83fd); // indigo
  const colorB = new THREE.Color(0xff8fb3); // sakura
  const radius = 14;

  for (let i = 0; i < dotCount; i++) {
    // Fibonacci sphere distribution for an even "data point" spread.
    const t = i / dotCount;
    const inclination = Math.acos(1 - 2 * t);
    const azimuth = Math.PI * (1 + Math.sqrt(5)) * i;
    const x = radius * Math.sin(inclination) * Math.cos(azimuth);
    const y = radius * Math.sin(inclination) * Math.sin(azimuth);
    const z = radius * Math.cos(inclination);
    dotPositions.set([x, y, z], i * 3);

    const mixed = colorA.clone().lerp(colorB, (y / radius + 1) / 2);
    dotColors.set([mixed.r, mixed.g, mixed.b], i * 3);
  }
  dotGeometry.setAttribute('position', new THREE.BufferAttribute(dotPositions, 3));
  dotGeometry.setAttribute('color', new THREE.BufferAttribute(dotColors, 3));

  const dotMaterial = new THREE.PointsMaterial({
    size: 0.35,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    sizeAttenuation: true,
  });
  const globeDots = new THREE.Points(dotGeometry, dotMaterial);
  globeGroup.add(globeDots);

  const wireGeometry = new THREE.SphereGeometry(radius * 0.98, 24, 16);
  const wireMaterial = new THREE.MeshBasicMaterial({
    color: 0x7c83fd,
    wireframe: true,
    transparent: true,
    opacity: 0.05,
  });
  globeGroup.add(new THREE.Mesh(wireGeometry, wireMaterial));

  const glowGeometry = new THREE.SphereGeometry(radius * 1.15, 24, 16);
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: 0x342a55,
    transparent: true,
    opacity: 0.18,
    side: THREE.BackSide,
  });
  globeGroup.add(new THREE.Mesh(glowGeometry, glowMaterial));

  // Two orbit rings, evoking data / seasons circling the library.
  const ringColors = [0xff8fb3, 0x7c83fd];
  const rings = ringColors.map((color, i) => {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius * (1.5 + i * 0.25), 0.05, 8, 128),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35 })
    );
    ring.rotation.x = Math.PI / 2.4 + i * 0.4;
    ring.rotation.y = i * 0.6;
    globeGroup.add(ring);
    return ring;
  });

  // Starfield: a large shell of faint points for depth.
  const starCount = isLowPower ? 900 : 2200;
  const starGeometry = new THREE.BufferGeometry();
  const starPositions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const r = 200 + Math.random() * 600;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    starPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    starPositions[i * 3 + 2] = r * Math.cos(phi);
  }
  starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  const starMaterial = new THREE.PointsMaterial({
    color: 0xf4f2ee,
    size: 0.9,
    transparent: true,
    opacity: 0.55,
  });
  scene.add(new THREE.Points(starGeometry, starMaterial));

  // Drifting "data" particles closer to the camera, for parallax depth.
  const driftCount = isLowPower ? 60 : 160;
  const driftGeometry = new THREE.BufferGeometry();
  const driftPositions = new Float32Array(driftCount * 3);
  const driftSpeeds = new Float32Array(driftCount);
  for (let i = 0; i < driftCount; i++) {
    driftPositions[i * 3] = (Math.random() - 0.5) * 120;
    driftPositions[i * 3 + 1] = (Math.random() - 0.5) * 120;
    driftPositions[i * 3 + 2] = (Math.random() - 0.5) * 120;
    driftSpeeds[i] = 0.02 + Math.random() * 0.05;
  }
  driftGeometry.setAttribute('position', new THREE.BufferAttribute(driftPositions, 3));
  const driftMaterial = new THREE.PointsMaterial({
    color: 0xff8fb3,
    size: 0.5,
    transparent: true,
    opacity: 0.5,
  });
  const driftParticles = new THREE.Points(driftGeometry, driftMaterial);
  scene.add(driftParticles);

  // --- 4. Camera path --------------------------------------------------
  // One waypoint per section, in document order. Scroll progress (0-1)
  // picks a position along this path; we lerp both the "real" progress
  // and the rendered camera state so movement stays cinematic rather
  // than glued to the scrollbar.
  const sections = Array.from(document.querySelectorAll('.scene-section'));

  const cameraPath = [
    { pos: new THREE.Vector3(0, 4, 70), look: new THREE.Vector3(0, 0, 0), fov: 45 },   // hero — far, grand
    { pos: new THREE.Vector3(18, 2, 40), look: new THREE.Vector3(0, 0, 0), fov: 42 },  // about — approaching
    { pos: new THREE.Vector3(-22, 6, 30), look: new THREE.Vector3(0, 0, 0), fov: 40 }, // features — orbiting
    { pos: new THREE.Vector3(0, -4, 26), look: new THREE.Vector3(0, 2, 0), fov: 38 },  // preview — close, low
    { pos: new THREE.Vector3(24, -2, 34), look: new THREE.Vector3(0, 0, 0), fov: 40 }, // how it works
    { pos: new THREE.Vector3(0, 8, 55), look: new THREE.Vector3(0, 0, 0), fov: 44 },   // download — pulling back
  ];

  let targetProgress = 0;
  let smoothProgress = 0;

  function computeProgress() {
    const doc = document.documentElement;
    const max = doc.scrollHeight - window.innerHeight;
    targetProgress = max > 0 ? Math.min(Math.max(window.scrollY / max, 0), 1) : 0;
  }
  computeProgress();
  window.addEventListener('scroll', computeProgress, { passive: true });

  function sampleCameraPath(t) {
    const steps = cameraPath.length - 1;
    const scaled = t * steps;
    const i = Math.min(Math.floor(scaled), steps - 1);
    const localT = scaled - i;
    const a = cameraPath[i];
    const b = cameraPath[Math.min(i + 1, steps)];
    return {
      pos: a.pos.clone().lerp(b.pos, localT),
      look: a.look.clone().lerp(b.look, localT),
      fov: THREE.MathUtils.lerp(a.fov, b.fov, localT),
    };
  }

  // --- 5. Render loop ---------------------------------------------------
  const clock = new THREE.Clock();
  const lerpFactor = prefersReducedMotion ? 1 : 0.06;

  function animate() {
    requestAnimationFrame(animate);
    const dt = clock.getDelta();

    smoothProgress += (targetProgress - smoothProgress) * lerpFactor;
    const state = sampleCameraPath(smoothProgress);

    camera.position.lerp(state.pos, prefersReducedMotion ? 1 : 0.12);
    camera.fov += (state.fov - camera.fov) * 0.12;
    camera.updateProjectionMatrix();
    camera.lookAt(state.look);

    const idleSpeed = prefersReducedMotion ? 0.02 : 0.06;
    globeGroup.rotation.y += dt * idleSpeed;
    rings.forEach((ring, i) => {
      ring.rotation.z += dt * (0.03 + i * 0.015);
    });

    if (!prefersReducedMotion) {
      const positions = driftGeometry.attributes.position.array;
      for (let i = 0; i < driftCount; i++) {
        positions[i * 3 + 1] += driftSpeeds[i] * dt * 6;
        if (positions[i * 3 + 1] > 60) positions[i * 3 + 1] = -60;
      }
      driftGeometry.attributes.position.needsUpdate = true;
    }

    renderer.render(scene, camera);
  }
  animate();

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

/* =================================================================
   Page chrome: nav opacity, scroll-reveal, footer year
   ================================================================= */

const nav = document.getElementById('site-nav');
function updateNavState() {
  nav.classList.toggle('scrolled', window.scrollY > 40);
}
updateNavState();
window.addEventListener('scroll', updateNavState, { passive: true });

const revealTargets = document.querySelectorAll('.reveal');
if (prefersReducedMotion) {
  revealTargets.forEach((el) => el.classList.add('is-visible'));
} else {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.2, rootMargin: '0px 0px -8% 0px' }
  );
  revealTargets.forEach((el) => observer.observe(el));
}
