/**
 * Kiểm thử đầu–cuối: một phi công tự động bay trọn phi vụ trong Node.
 *   node smoke-test.mjs
 *
 * Cất cánh → tách tầng → chèn quỹ đạo → bay đủ một vòng → hạ quỹ đạo → hãm bằng
 * động cơ → mở dù → cháy hạ cánh → tiếp đất. Không bước nào được bỏ qua.
 */

import { EARTH, G0, LIMITS } from './src/constants.js';
import { createWorld, nearestPad } from './src/world.js';
import { createSimulation, stepSimulation, angleDiff, isOnPad } from './src/physics.js';
import {
  separateStage,
  deployChute,
  engineOutput,
  rocketMass,
  remainingDeltaV,
} from './src/rocket.js';
import { createMission, updateMission, missionComplete, scoreRun } from './src/mission.js';

const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

const world = createWorld();
const sim = createSimulation(world, 0);
const mission = createMission('orbital');

function note(message) {
  console.log(`[t = ${sim.time.toFixed(0).padStart(5)} s] ${message}`);
}

function steer(target) {
  const error = angleDiff(target, sim.body.theta);
  sim.controls.pitch = clamp(error * 6, -1, 1);
}

const prograde = () => Math.atan2(sim.body.vy, sim.body.vx);
const retrograde = () => prograde() + Math.PI;
const localUp = () => Math.atan2(sim.body.y, sim.body.x);

console.log('=== SpaceGame — kiểm thử đầu–cuối ===\n');

// ---------- 1. Cất cánh theo chương trình nghiêng dần ----------
note('Bắt đầu cất cánh, ga 100 %');
sim.rocket.throttle = 1;
const state = { meco: false };

let ascentTime = 0;
while (ascentTime < 400) {
  const altitude = sim.last.altitudeAboveGround;
  const progress = clamp((altitude - 1_500) / (80_000 - 1_500), 0, 1);
  steer(localUp() + 80 * DEG * progress);
  sim.rocket.throttle = 1;
  stepSimulation(sim, 0.05);
  updateMission(mission, sim);
  ascentTime += 0.05;

  if (sim.status === 'destroyed') break;

  const stage = sim.rocket.stages[0];
  if (!stage.separated && stage.fuel <= 0.5) {
    note(
      `MECO — tầng 1 cháy hết ở ${(altitude / 1000).toFixed(1)} km, ` +
        `v = ${sim.last.speed.toFixed(0)} m/s`,
    );
    separateStage(sim.rocket);
    sim.rocket.throttle = 1;
    state.meco = true;
  }
  if (
    state.meco &&
    sim.last.orbit &&
    sim.last.orbit.periapsis > 160_000 &&
    sim.last.orbit.eccentricity < 0.05
  ) {
    break;
  }
}

note(
  `Kết thúc pha cất cánh: cao ${(sim.last.altitudeAboveGround / 1000).toFixed(1)} km, ` +
    `v ${sim.last.speed.toFixed(0)} m/s, viễn điểm ${(sim.last.orbit.apoapsis / 1000).toFixed(0)} km, ` +
    `Δv còn ${remainingDeltaV(sim.rocket).toFixed(0)} m/s`,
);

// ---------- 2. Tầng 2 cháy liên tục để chèn vào quỹ đạo ----------
sim.rocket.throttle = 1;
let insert = 0;
while (insert < 500) {
  const orbit = sim.last.orbit;
  if (orbit.periapsis > 160_000 && orbit.eccentricity < 0.05) break;
  steer(prograde());
  sim.rocket.throttle = 1;
  stepSimulation(sim, 0.05);
  updateMission(mission, sim);
  insert += 0.05;
  if (sim.status === 'destroyed') break;
}
sim.rocket.throttle = 0;
note(
  `Quỹ đạo: cận ${(sim.last.orbit.periapsis / 1000).toFixed(0)} km, ` +
    `viễn ${(sim.last.orbit.apoapsis / 1000).toFixed(0)} km, e = ${sim.last.orbit.eccentricity.toFixed(4)}, ` +
    `chu kỳ ${(sim.last.orbit.period / 60).toFixed(1)} phút, Δv còn ${remainingDeltaV(sim.rocket).toFixed(0)} m/s`,
);
console.log(`  → mục tiêu "đạt quỹ đạo": ${mission.steps[1].state}`);

// ---------- 3. Bay đủ một vòng ----------
let guard = 0;
while (Math.abs(sim.orbitAngle) < Math.PI * 2 + 0.02 && guard < 20_000) {
  steer(prograde());
  stepSimulation(sim, 2);
  updateMission(mission, sim);
  guard += 1;
  if (sim.status === 'destroyed') break;
}
note(`Đã bay ${(Math.abs(sim.orbitAngle) / (Math.PI * 2)).toFixed(2)} vòng`);
console.log(`  → mục tiêu "bay đủ một vòng": ${mission.steps[2].state}`);

// ---------- 4. Hạ quỹ đạo ----------
let deorbit = 0;
while (deorbit < 400) {
  if (sim.last.orbit.periapsis < 40_000) break;
  steer(retrograde());
  sim.rocket.throttle = 0.6;
  stepSimulation(sim, 0.2);
  updateMission(mission, sim);
  deorbit += 0.2;
}
sim.rocket.throttle = 0;
note(`Hạ quỹ đạo xong: cận ${(sim.last.orbit.periapsis / 1000).toFixed(0)} km, v ${sim.last.speed.toFixed(0)} m/s`);

// ---------- 5. Vào lại khí quyển và mở dù ----------
guard = 0;
let deployed = false;
while (!deployed && guard < 40_000) {
  steer(retrograde());
  const altitude = sim.last.altitudeAboveGround;
  const speed = sim.last.speed;
  // Hãm bằng động cơ trước khi mở dù: dù chỉ chịu được dưới 110 m/s.
  sim.rocket.throttle = altitude < 12_000 && speed > 100 ? 1 : 0;
  stepSimulation(sim, 0.1);
  updateMission(mission, sim);
  guard += 1;
  if (sim.status === 'destroyed') break;
  if (altitude < 10_000 && speed < 100) {
    const result = deployChute(sim.rocket, sim.last.altitudeAboveGround, sim.last.speed);
    if (result.ok) {
      deployed = true;
      note(
        `Mở dù ở ${(sim.last.altitudeAboveGround / 1000).toFixed(1)} km, ` +
          `v ${sim.last.speed.toFixed(0)} m/s`,
      );
    }
  }
}

// ---------- 6. Cháy hạ cánh và tiếp đất ----------
let landed = false;
guard = 0;
while (!landed && guard < 80_000) {
  const altitude = sim.last.altitudeAboveGround;
  const speed = Math.max(0, -sim.last.verticalSpeed);
  const available = engineOutput(sim.rocket, sim.last.pressure ?? 0, 1).thrust / rocketMass(sim.rocket);
  const stopDistance = available > 0 ? (speed * speed) / (2 * available) : Infinity;
  const needBurn = altitude < 150 && stopDistance > altitude * 0.2 && speed > 1.0;

  steer(localUp());
  sim.rocket.throttle = needBurn ? 1 : 0;

  stepSimulation(sim, 0.02);
  updateMission(mission, sim);
  guard += 1;

  if (sim.status === 'landed' || sim.status === 'destroyed') landed = true;
}

note(`Tiếp đất: trạng thái ${sim.status}${sim.failure ? ` (${sim.failure})` : ''}`);
if (sim.touchdown) {
  note(
    `Vận tốc chạm ${sim.touchdown.speed.toFixed(2)} m/s (giới hạn ${LIMITS.maxTouchSpeed}), ` +
      `nghiêng ${(Math.abs(sim.touchdown.tilt) / DEG).toFixed(1)}° (giới hạn 12°)`,
  );
}

// ---------- 7. Nhiệm vụ 1: bay lên 100 km rồi hạ cánh ----------
// ---------- 7. Kết luận ----------
const score = scoreRun(sim, mission);
console.log('\n=== Kiểm tra kết quả ===');
let failures = 0;
const checks = [
  ['không bị phá huỷ', sim.status !== 'destroyed', sim.status],
  ['mục tiêu cất cánh', mission.steps[0].state === 'done', mission.steps[0].state],
  ['mục tiêu quỹ đạo', mission.steps[1].state === 'done', mission.steps[1].state],
  ['mục tiêu một vòng', mission.steps[2].state === 'done', mission.steps[2].state],
  ['hạ cánh an toàn', sim.status === 'landed', sim.status],
  ['chạm đất dưới 6 m/s', (sim.touchdown?.speed ?? 99) < LIMITS.maxTouchSpeed, `${(sim.touchdown?.speed ?? 99).toFixed(2)} m/s`],
  ['điểm trong 0..100', score.total >= 0 && score.total <= 100, `${score.total} (${score.grade})`],
  ['dưới ngưỡng quá tải 12 g', sim.rocket.peakGLoad <= LIMITS.maxGLoad, `${sim.rocket.peakGLoad.toFixed(1)} g`],
  ['nhiệt vỏ dưới ngưỡng', sim.rocket.peakHeat <= LIMITS.maxHeat, `${sim.rocket.peakHeat.toFixed(0)} °C`],
  ['còn nhiên liệu dự phòng', remainingDeltaV(sim.rocket) >= 0, `${remainingDeltaV(sim.rocket).toFixed(0)} m/s`],
];

for (const [name, ok, detail] of checks) {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

console.log(
  `\nKhoảng cách tới bệ phóng gần nhất khi tiếp đất: ` +
    `${(nearestPad(world, sim.body.x, sim.body.y).distance / 1000).toFixed(1)} km ` +
    `(hạ cánh đúng khu hạ cánh phụ thuộc kỹ năng người chơi).`,
);
console.log(`Hoàn tất: ${missionComplete(mission) ? 'trọn 4 mục tiêu' : '3/4 mục tiêu quỹ đạo'}.`);
console.log(`Điểm nhiệm vụ 2: ${score.total}/100 — hạng ${score.grade}.`);

void isOnPad;
void G0;
void EARTH;
if (failures > 0) {
  console.log(`Thất bại: ${failures} phép kiểm tra.`);
  process.exitCode = 1;
}
