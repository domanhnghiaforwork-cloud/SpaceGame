/**
 * Ghép các module: vòng lặp game, tua thời gian, điều khiển và màn hình kết quả.
 */

import { WARP_RANGE } from './constants.js';
import { createWorld, toEarthFrame } from './world.js';
import { createSimulation, stepSimulation } from './physics.js';
import { createCamera, updateCamera, toggleCameraMode, CAMERA_MODES } from './camera.js';
import { drawScene } from './render.js';
import { createMission, updateMission, scoreRun, missionComplete } from './mission.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { createFullscreen } from './fullscreen.js';
import { spawnSeparatedStage } from './debris.js';
import { createEndHold } from './endHold.js';
import { separateStage, deployChute, remainingDeltaV } from './rocket.js';

const BEST_KEY = 'spacegame.best';
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
/** Hằng số thời gian để xung RCS/gimbal đạt mức yêu cầu thay vì nhảy bậc. */
const PITCH_SPOOL = 0.22;
/** Giữ hiệu ứng nổ trên màn hình bao lâu (thời gian thực) trước khi hiện kết quả. */
const EXPLOSION_HOLD_MS = 3_000;

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d', { alpha: false });

const world = createWorld();
const camera = createCamera();
const hud = createHud();
const audio = createAudio();
const cameraButton = document.querySelector('.cam-toggle');
const forcesButton = document.querySelector('.forces-toggle');

/** Nút “Lớp lực” chỉ phản chiếu cờ trong `game`, không giữ trạng thái riêng. */
function syncForcesButton() {
  if (!forcesButton) return;
  forcesButton.classList.toggle('is-on', game.forces);
  forcesButton.setAttribute('aria-pressed', String(game.forces));
}

/** Giữ nhãn/trạng thái nút góc nhìn khớp với camera (cùng cách làm với nút toàn màn hình). */
function syncCameraButton() {
  if (!cameraButton) return;
  const near = camera.mode === CAMERA_MODES.near;
  const label = near ? 'Góc nhìn gần' : 'Góc nhìn xa';
  cameraButton.classList.toggle('is-near', near);
  cameraButton.setAttribute('aria-pressed', String(near));
  cameraButton.setAttribute('aria-label', label);
  cameraButton.title = `${label} (C)`;
}

const endHold = createEndHold({ holdMs: EXPLOSION_HOLD_MS, onElapsed: () => finish() });
const fullscreen = createFullscreen({
  button: document.querySelector('.fs-toggle'),
  onError: (message) => toast(message),
});

const game = {
  sim: null,
  mission: null,
  warp: WARP_RANGE.min,
  forces: false,
  paused: false,
  score: null,
  resultShown: false,
  best: loadBest(),
  lastTrailTime: 0,
  destroyedAtReal: 0,
  view: { width: 900, height: 640 },
  toast: { text: '', until: 0 },
  warned: { heat: false, g: false },
};

function loadBest() {
  try {
    const raw = window.localStorage.getItem(BEST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && Number.isFinite(parsed.score)) return parsed;
  } catch {
    /* chế độ riêng tư hoặc file:// — bỏ qua */
  }
  return null;
}

function saveBest(score) {
  try {
    window.localStorage.setItem(BEST_KEY, JSON.stringify(score));
  } catch {
    /* không lưu được thì thôi */
  }
}

function reset() {
  game.sim = createSimulation(world, 0);
  game.sim.trail = [];
  game.mission = createMission();
  setWarp(WARP_RANGE.min, { syncSlider: true });
  game.paused = false;
  game.score = null;
  game.resultShown = false;
  game.lastTrailTime = 0;
  game.toast = { text: '', until: 0 };
  game.warned.heat = false;
  game.warned.g = false;
  game.destroyedAtReal = 0;
  endHold.cancel();
  hud.hideResult();
  document.body.classList.remove('paused');
  updateCamera(camera, game.sim, 1, game.view.width, game.view.height);
}

function toast(text, seconds = 3) {
  game.toast = { text, until: performance.now() + seconds * 1_000 };
}

function finish() {
  if (game.score || !game.sim) return;
  game.score = scoreRun(game.sim, game.mission);
  if (!game.best || game.score.total > game.best.score) {
    game.best = { score: game.score.total, grade: game.score.grade };
    saveBest(game.best);
  }
  game.resultShown = true;
  hud.showResult(game.score, game.sim, game.mission, game.best);
  audio.setEngine(0, 0);
  if (game.sim.status === 'destroyed') audio.warning();
  else audio.confirm();
}

function onAction(name) {
  audio.start();
  const sim = game.sim;
  switch (name) {
    case 'separate': {
      if (sim.status === 'destroyed') break;
      if (sim.status === 'ready' || sim.last.altitudeAboveGround < 200) {
        toast('Chưa thể tách tầng khi còn quá gần bệ phóng');
        break;
      }
      if (separateStage(sim.rocket)) {
        spawnSeparatedStage(sim);
        audio.confirm();
        toast(`Đã tách tầng, hiện dùng ${sim.rocket.stages[sim.rocket.active].name}`);
      } else {
        toast('Không thể tách tầng lúc này');
      }
      break;
    }
    case 'chute': {
      if (sim.status === 'destroyed') break;
      const result = deployChute(sim.rocket, sim.last.altitudeAboveGround, sim.last.speed);
      if (result.ok) {
        audio.confirm();
        toast(result.kind === 'drogue' ? 'Dù hãm đã bung' : 'Dù chính đã bung');
      } else {
        audio.warning();
        toast(result.reason);
      }
      break;
    }
    case 'pause': {
      game.paused = !game.paused;
      document.body.classList.toggle('paused', game.paused);
      break;
    }
    case 'forces': {
      game.forces = !game.forces;
      syncForcesButton();
      break;
    }
    case 'camera': {
      toggleCameraMode(camera);
      syncCameraButton();
syncForcesButton();
      break;
    }
    case 'fullscreen': {
      fullscreen.toggle();
      break;
    }
    case 'exit-fullscreen': {
      fullscreen.exit();
      break;
    }
    case 'restart': {
      reset();
      break;
    }
    case 'end': {
      finish();
      break;
    }
    case 'close-result': {
      hud.hideResult();
      break;
    }
    case 'mute': {
      const muted = audio.toggleMute();
      toast(muted ? 'Đã tắt âm thanh' : 'Đã bật âm thanh');
      break;
    }
    default:
      break;
  }
}

const warpSlider = document.getElementById('warp-slider');
const warpValue = document.getElementById('warp-value');

function formatWarp(warp) {
  return warp >= 100 ? String(Math.round(warp)) : String(Math.round(warp * 10) / 10);
}

/** Đặt mức tua mong muốn (1×–1000×); `syncSlider` dùng khi chơi lại. */
function setWarp(warp, { syncSlider = false } = {}) {
  game.warp = clamp(warp, WARP_RANGE.min, WARP_RANGE.max);
  if (warpValue) warpValue.textContent = `${formatWarp(game.warp)}×`;
  if (syncSlider && warpSlider) warpSlider.value = String(Math.log10(game.warp));
}

if (warpSlider) {
  warpSlider.addEventListener('input', () => {
    setWarp(10 ** Number(warpSlider.value));
  });
  setWarp(game.warp, { syncSlider: true });
}

const input = createInput({
  onAction,
  onFirstGesture: () => audio.start(),
});

function updateControls(realDt) {
  const sim = game.sim;
  const rocket = sim.rocket;
  const rate = 1.15;
  if (input.holds.throttleUp) rocket.throttle = clamp(rocket.throttle + rate * realDt, 0, 1);
  if (input.holds.throttleDown) rocket.throttle = clamp(rocket.throttle - rate * realDt, 0, 1);
  // Lệnh nghiêng tăng/giảm dần như xung thruster thật, không phải bật/tắt tức thì.
  const wanted = (input.holds.pitchRight ? 1 : 0) - (input.holds.pitchLeft ? 1 : 0);
  sim.controls.pitch += (wanted - sim.controls.pitch) * (1 - Math.exp(-realDt / PITCH_SPOOL));
}

/**
 * Tốc độ tua thực tế sau khi game tự hạ: thanh trượt giữ mức người chơi đặt, còn
 * chip “Tua” trên header hiện con số đang chạy thật.
 */
export function effectiveWarp(sim, warpRequested) {
  let warp = Math.max(WARP_RANGE.min, Number(warpRequested) || WARP_RANGE.min);
  const altitude = sim.last.altitudeAboveGround ?? 0;
  if (altitude < 3_000 || sim.rocket.chuteOpen > 0.5) warp = Math.min(warp, 1);
  else if (altitude < 120_000) warp = Math.min(warp, 10);
  if (sim.last.thrust > 0) warp = Math.min(warp, 10);
  return warp;
}

function advance(realDt) {
  const sim = game.sim;
  if (sim.status === 'destroyed' || !realDt) return;

  const warp = effectiveWarp(sim, game.warp);
  const simDt = realDt * warp;
  const maxStep = (sim.last.altitudeAboveGround ?? 0) < 120_000 ? 0.1 : 5;
  const steps = Math.max(1, Math.min(600, Math.ceil(simDt / maxStep)));
  const h = simDt / steps;

  for (let i = 0; i < steps; i++) {
    if (sim.status === 'destroyed') break;
    stepSimulation(sim, h);
    updateMission(game.mission, sim);
  }

  if (sim.time - game.lastTrailTime > 0.5) {
    const point = toEarthFrame(sim.body.x, sim.body.y, sim.time);
    sim.trail.push(point);
    if (sim.trail.length > 2_400) sim.trail.shift();
    game.lastTrailTime = sim.time;
  }

  if (!game.warned.heat && sim.rocket.heat > 600) {
    game.warned.heat = true;
    audio.warning();
  }
  if (!game.warned.g && sim.last.gLoad > 8) {
    game.warned.g = true;
    audio.warning();
  }
}

function checkEnd(now) {
  if (game.resultShown) return;
  if (game.sim.status === 'destroyed') {
    // Nổ rồi mới kết thúc: giữ hiệu ứng trên màn hình vài giây để người chơi thấy
    // chuyện gì vừa xảy ra, không nhảy thẳng vào bảng điểm. Đếm bằng hẹn giờ chứ
    // không bằng số khung hình — khung hình có thể bị bỏ khi tab nền.
    if (!game.destroyedAtReal) {
      game.destroyedAtReal = now;
      endHold.start();
    }
    return;
  }
  if (missionComplete(game.mission)) finish();
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  game.view.width = rect.width;
  game.view.height = rect.height;
}

let lastFrame = performance.now();

function frame(now) {
  const realDt = Math.min((now - lastFrame) / 1_000, 0.06);
  lastFrame = now;

  if (!game.paused) {
    updateControls(realDt);
    advance(realDt);
    checkEnd(now);
  }

  updateCamera(camera, game.sim, Math.max(realDt, 0.016), game.view.width, game.view.height);
  drawScene(ctx, game.view, game.sim, camera, {
    explosionMs: game.destroyedAtReal ? now - game.destroyedAtReal : null,
    forces: game.forces,
  });

  const engineOn = game.sim.last.thrust > 0;
  audio.setEngine(engineOn ? game.sim.rocket.throttle : 0, game.sim.last.density ?? 0);

  hud.update(game.sim, game.mission, {
    warp: Math.round(effectiveWarp(game.sim, game.warp)),
    best: game.best,
    deltaV: remainingDeltaV(game.sim.rocket),
    toast: performance.now() < game.toast.until ? game.toast.text : '',
  });

  requestAnimationFrame(frame);
}

resize();
reset();
syncCameraButton();
new ResizeObserver(resize).observe(canvas.parentElement);
window.addEventListener('resize', resize);
requestAnimationFrame(frame);

window.spacegame = { game, camera, hud, reset, finish, fullscreen, syncCameraButton, syncForcesButton };
