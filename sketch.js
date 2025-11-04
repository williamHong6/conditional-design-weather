import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// ---------- DOM ----------
const statusEl = document.getElementById('status');
const citySelect = document.getElementById('citySelect');
const refreshBtn = document.getElementById('refreshBtn');
const forceSnowChk = document.getElementById('forceSnowChk');
const snowIntensitySlider = document.getElementById('snowIntensity');
const API_KEY = document.querySelector('meta[name="owm-api-key"]').content;

// ---------- Three setup ----------
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e1116);
scene.fog = new THREE.Fog(0x0e1116, 10, 40);

const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 5000);
camera.position.set(2.5, 2.0, 3.0);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// lights
scene.add(new THREE.HemisphereLight(0xffffff, 0x1a2030, 1.0));
const dir = new THREE.DirectionalLight(0xffffff, 1.1);
dir.position.set(5, 10, 7);
scene.add(dir);

// ---------- Model ----------
const loader = new GLTFLoader();
const MODEL_URL = new URL('./models/shanghai1.glb', import.meta.url).href;

loader.load(
  MODEL_URL,
  (gltf) => {
    const model = gltf.scene || gltf.scenes[0];
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3(); box.getSize(size);
    const center = new THREE.Vector3(); box.getCenter(center);
    model.position.sub(center);
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim > 0) model.scale.setScalar(1.5 / maxDim);
    model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(model);
  },
  undefined,
  (err) => console.error('GLB load error:', err)
);

// ---------- Weather particles ----------
const weather = {
  mode: 'Clear',     // 'Clear' | 'Rain' | 'Snow'
  intensity: 0.6,    // 0 ~ 1.5
  windX: 0.2,
  windZ: 0.0,
  areaSize: 40,
  height: 25,
  _system: null,
  _update: null,
  _forceSnow: false,
};

// soft round sprite for snow
function makeCircleTexture(res = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = res;
  const g = c.getContext('2d');
  const r = res / 2;
  const grd = g.createRadialGradient(r, r, 0, r, r, r);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.beginPath();
  g.arc(r, r, r, 0, Math.PI * 2);
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  return tex;
}
const snowTex = makeCircleTexture(64);

function clearWeather() {
  if (weather._system) {
    scene.remove(weather._system);
    weather._system.geometry.dispose();
    weather._system.material.dispose();
    weather._system = null;
    weather._update = null;
  }
}

function createRain() {
  clearWeather();
  const count = Math.floor(4000 * weather.intensity);
  const geom = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3);
  const half = weather.areaSize / 2;

  for (let i = 0; i < count; i++) {
    const ix = i * 3;
    pos[ix + 0] = THREE.MathUtils.randFloatSpread(weather.areaSize);
    pos[ix + 1] = Math.random() * weather.height + 5;
    pos[ix + 2] = THREE.MathUtils.randFloatSpread(weather.areaSize);
    vel[ix + 0] = weather.windX + THREE.MathUtils.randFloatSpread(0.05);
    vel[ix + 1] = -THREE.MathUtils.randFloat(12, 22);
    vel[ix + 2] = weather.windZ + THREE.MathUtils.randFloatSpread(0.05);
  }
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setAttribute('velocity', new THREE.BufferAttribute(vel, 3));

  const mat = new THREE.PointsMaterial({
    color: 0x77aaff,
    size: 0.05,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });

  const points = new THREE.Points(geom, mat);
  points.frustumCulled = false;
  scene.add(points);
  weather._system = points;

  weather._update = (dt) => {
    const p = geom.getAttribute('position');
    const v = geom.getAttribute('velocity');
    for (let i = 0; i < p.count; i++) {
      const ix = i * 3;
      p.array[ix + 0] += v.array[ix + 0] * dt;
      p.array[ix + 1] += v.array[ix + 1] * dt;
      p.array[ix + 2] += v.array[ix + 2] * dt;

      if (p.array[ix + 1] < -2) {
        p.array[ix + 0] = THREE.MathUtils.randFloatSpread(weather.areaSize);
        p.array[ix + 1] = weather.height;
        p.array[ix + 2] = THREE.MathUtils.randFloatSpread(weather.areaSize);
      }
      if (p.array[ix + 0] > half) p.array[ix + 0] -= weather.areaSize;
      if (p.array[ix + 0] < -half) p.array[ix + 0] += weather.areaSize;
      if (p.array[ix + 2] > half) p.array[ix + 2] -= weather.areaSize;
      if (p.array[ix + 2] < -half) p.array[ix + 2] += weather.areaSize;
    }
    p.needsUpdate = true;
  };
}

function createSnow() {
  clearWeather();
  const count = Math.floor(2500 * weather.intensity);
  const geom = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3);
  const half = weather.areaSize / 2;

  for (let i = 0; i < count; i++) {
    const ix = i * 3;
    pos[ix + 0] = THREE.MathUtils.randFloatSpread(weather.areaSize);
    pos[ix + 1] = Math.random() * weather.height + 5;
    pos[ix + 2] = THREE.MathUtils.randFloatSpread(weather.areaSize);

    vel[ix + 0] = weather.windX * 0.4 + THREE.MathUtils.randFloatSpread(0.2);
    vel[ix + 1] = -THREE.MathUtils.randFloat(1.2, 2.2);
    vel[ix + 2] = weather.windZ * 0.4 + THREE.MathUtils.randFloatSpread(0.2);
  }
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setAttribute('velocity', new THREE.BufferAttribute(vel, 3));

  const mat = new THREE.PointsMaterial({
    map: snowTex,
    color: 0xffffff,
    size: 0.18,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  });

  const points = new THREE.Points(geom, mat);
  points.frustumCulled = false;
  scene.add(points);
  weather._system = points;

  let tAccum = 0;
  weather._update = (dt) => {
    tAccum += dt;
    const p = geom.getAttribute('position');
    const v = geom.getAttribute('velocity');
    for (let i = 0; i < p.count; i++) {
      const ix = i * 3;
      const sway = Math.sin(tAccum * 0.8 + i * 0.3) * 0.15;
      p.array[ix + 0] += (v.array[ix + 0] + sway * 0.2) * dt;
      p.array[ix + 1] += v.array[ix + 1] * dt;
      p.array[ix + 2] += v.array[ix + 2] * dt;

      if (p.array[ix + 1] < -2) {
        p.array[ix + 0] = THREE.MathUtils.randFloatSpread(weather.areaSize);
        p.array[ix + 1] = weather.height;
        p.array[ix + 2] = THREE.MathUtils.randFloatSpread(weather.areaSize);
      }
      if (p.array[ix + 0] > half) p.array[ix + 0] -= weather.areaSize;
      if (p.array[ix + 0] < -half) p.array[ix + 0] += weather.areaSize;
      if (p.array[ix + 2] > half) p.array[ix + 2] -= weather.areaSize;
      if (p.array[ix + 2] < -half) p.array[ix + 2] += weather.areaSize;
    }
    p.needsUpdate = true;
  };
}

function applyWeather() {
  if (weather._forceSnow) {
    // Force snow: take slider value
    weather.mode = 'Snow';
    weather.intensity = parseFloat(snowIntensitySlider.value);
    createSnow();
    return;
  }
  if (weather.mode === 'Clear') clearWeather();
  else if (weather.mode === 'Rain') createRain();
  else if (weather.mode === 'Snow') createSnow();
}

// ---------- OpenWeather ----------
function updateWeatherFromAPI(json) {
  // wind (OpenWeather deg = where wind comes from) -> particle flow (where it goes)
  const speed = json.wind?.speed ?? 0;
  const deg = json.wind?.deg ?? 0;
  const rad = THREE.MathUtils.degToRad(deg) + Math.PI; // reverse direction
  weather.windX = Math.sin(rad) * speed * 0.2;
  weather.windZ = Math.cos(rad) * speed * 0.2;

  // intensity estimate
  let intensity = 0.4;
  const rain1h = json.rain?.['1h'];
  const snow1h = json.snow?.['1h'];
  if (typeof rain1h === 'number') {
    intensity = THREE.MathUtils.clamp(rain1h / 2.5, 0.2, 1.5);
  } else if (typeof snow1h === 'number') {
    intensity = THREE.MathUtils.clamp(snow1h / 1.5, 0.2, 1.5);
  } else if (typeof json.clouds?.all === 'number') {
    intensity = THREE.MathUtils.mapLinear(json.clouds.all, 0, 100, 0.2, 0.9);
  }
  weather.intensity = intensity;

  // decide mode if not forcing snow
  const main = json.weather?.[0]?.main || 'Clear';
  if (!weather._forceSnow) {
    if (main === 'Rain' || main === 'Drizzle' || main === 'Thunderstorm') {
      weather.mode = 'Rain';
    } else if (main === 'Snow') {
      weather.mode = 'Snow';
    } else {
      weather.mode = 'Clear';
    }
  }

  // apply particles
  applyWeather();

  // UI status
  const name = json.name || '';
  const desc = json.weather?.[0]?.description || main;
  const temp = json.main?.temp;
  statusEl.textContent =
    `${name ? name + ' · ' : ''}${desc}, ` +
    (typeof temp === 'number' ? `Temp ${temp}°C, ` : '') +
    `Wind ${speed} m/s (dir ${Math.round(deg)}°)` +
    (weather._forceSnow ? ` · Forced Snow (intensity ${parseFloat(snowIntensitySlider.value).toFixed(2)})` : '');
}

async function fetchByCity(q) {
  statusEl.textContent = 'Fetching weather…';
  const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(q)}&appid=${API_KEY}&units=metric&lang=en`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  updateWeatherFromAPI(json);
}

// ---------- Events ----------
citySelect.addEventListener('change', async () => {
  try {
    await fetchByCity(citySelect.value);
  } catch (err) {
    console.error(err);
    statusEl.textContent = `Fetch failed: ${err.message}`;
  }
});
refreshBtn.addEventListener('click', async () => {
  try {
    await fetchByCity(citySelect.value);
  } catch (err) {
    console.error(err);
    statusEl.textContent = `Fetch failed: ${err.message}`;
  }
});

forceSnowChk.addEventListener('change', () => {
  weather._forceSnow = forceSnowChk.checked;
  snowIntensitySlider.disabled = !weather._forceSnow;
  applyWeather();
});
snowIntensitySlider.addEventListener('input', () => {
  if (weather._forceSnow) {
    applyWeather();
    statusEl.textContent = `Forced Snow · intensity ${parseFloat(snowIntensitySlider.value).toFixed(2)}`;
  }
});

// ---------- Init ----------
(async function init() {
  try {
    await fetchByCity(citySelect.value); // default: San Francisco
  } catch (err) {
    console.error(err);
    statusEl.textContent = `Init weather failed: ${err.message}`;
  }
})();

// ---------- Resize & render ----------
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const clock = new THREE.Clock();
(function animate() {
  const dt = Math.min(clock.getDelta(), 0.033);
  controls.update();
  if (weather._update) weather._update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
})();
