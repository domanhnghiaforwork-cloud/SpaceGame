/**
 * Kiểm chứng số học độc lập cho SpaceGame.
 *   node verify.mjs
 *
 * Mỗi phép kiểm tra đều tính lại giá trị từ công thức gốc rồi so với mô phỏng —
 * không có giá trị nào được viết cứng thành PASS.
 */

import { EARTH, G0, STAGES, PAYLOAD, AERO, LIMITS, RCS, PAD_LANDING_RADIUS } from './src/constants.js';
import { atmosphere, dragCoefficient } from './src/atmosphere.js';
import { createWorld, nearestPad, surfaceDistance } from './src/world.js';
import {
  createSimulation,
  stepSimulation,
  orbitFromState,
  relativeVelocity,
} from './src/physics.js';
import {
  createRocket,
  rocketMass,
  totalPropellant,
  engineOutput,
  consumeFuel,
  remainingDeltaV,
  heatFlux,
} from './src/rocket.js';
import { createMission, updateMission, scoreRun, gradeFor } from './src/mission.js';

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function closeTo(name, actual, expected, tolerance, unit = '') {
  const error = Math.abs(actual - expected);
  const relative = expected === 0 ? error : error / Math.abs(expected);
  check(
    `${name}`,
    relative <= tolerance,
    `thực tế ${actual.toPrecision(6)}${unit}, mong đợi ${expected.toPrecision(6)}${unit} (sai ${(relative * 100).toFixed(3)} %)`,
  );
}

const world = createWorld();

function placeSim(padIndex, { altitude, x, y, vx, vy, theta }) {
  const sim = createSimulation(world, padIndex);
  const r = altitude + EARTH.RADIUS;
  const angle = theta ?? 0;
  sim.body.x = x ?? r * Math.cos(angle);
  sim.body.y = y ?? r * Math.sin(angle);
  // Mặc định: đứng yên so với mặt đất, tức quay cùng Trái Đất.
  sim.body.vx = vx ?? -EARTH.OMEGA * sim.body.y;
  sim.body.vy = vy ?? EARTH.OMEGA * sim.body.x;
  sim.body.theta = theta ?? Math.atan2(sim.body.y, sim.body.x);
  sim.body.omega = 0;
  sim.status = 'flying';
  sim.airborne = true;
  sim.time = 0;
  sim.trail = [];
  return sim;
}

function advance(sim, seconds, step = 0.05) {
  const steps = Math.round(seconds / step);
  for (let i = 0; i < steps; i++) stepSimulation(sim, step);
}

console.log('\nKhí quyển');
{
  const sea = atmosphere(0);
  closeTo('khối lượng riêng mực nước biển', sea.density, 1.225, 0.005, ' kg/m³');
  closeTo('áp suất mực nước biển', sea.pressure, 101325, 0.005, ' Pa');
  closeTo('vận tốc âm ở 0 m', sea.soundSpeed, 340.3, 0.01, ' m/s');
  closeTo('khối lượng riêng ở 11 km', atmosphere(11_000).density, 0.3648, 0.02, ' kg/m³');
  closeTo('áp suất ở 20 km', atmosphere(20_000).pressure, 5474.9, 0.02, ' Pa');

  let monotonic = true;
  let previous = Infinity;
  for (let h = 0; h <= 100_000; h += 500) {
    const value = atmosphere(h).density;
    if (value > previous) monotonic = false;
    previous = value;
  }
  check('mật độ giảm đơn điệu theo độ cao', monotonic);

  check('chân không trên 1 000 km', atmosphere(1_500_000).density === 0);
  check(
    'Cd đạt đỉnh ở vùng transonic',
    dragCoefficient(1.1) > dragCoefficient(0.3) && dragCoefficient(1.1) > dragCoefficient(4),
  );
  closeTo('Cd tại Mach 0,3', dragCoefficient(0.3), 0.3, 0.02);
}

console.log('\nTrọng lực và quán tính');
{
  const r = EARTH.RADIUS + 200_000;
  const sim = placeSim(0, { altitude: 200_000, x: r, y: 0 });
  const v0 = sim.body.vx;
  stepSimulation(sim, 1);
  const measured = sim.body.vx - v0;
  const expected = -EARTH.MU / (r * r);
  closeTo('gia tốc trọng lực ở 200 km', measured, expected, 0.001, ' m/s²');

  const surface = EARTH.MU / (EARTH.RADIUS * EARTH.RADIUS);
  closeTo('g tại bán kính Trái Đất = μ/R²', surface, 9.8203, 0.001, ' m/s²');

  // Rơi tự do trong chân không: lệch về phía đông do Coriolis.
  const drop = placeSim(0, { altitude: 200_000 });
  const rel = relativeVelocity(drop.body.x, drop.body.y, drop.body.vx, drop.body.vy);
  drop.body.vx -= rel.x;
  drop.body.vy -= rel.y;
  drop.status = 'flying';
  advance(drop, 60, 0.02);
  const after = relativeVelocity(drop.body.x, drop.body.y, drop.body.vx, drop.body.vy);
  const radius = Math.hypot(drop.body.x, drop.body.y);
  const tangential = (after.x * -drop.body.y + after.y * drop.body.x) / radius;
  check(
    'Coriolis làm vật rơi lệch về phía đông',
    tangential > 1,
    `vận tốc ngang ${tangential.toFixed(3)} m/s`,
  );
}

console.log('\nLực đẩy và Tsiolkovsky');
{
  const rocket = createRocket();
  const m0 = rocketMass(rocket);
  const expectedMass =
    PAYLOAD.mass +
    RCS.propMass +
    STAGES.reduce((sum, stage) => sum + stage.dryMass + stage.propMass, 0);
  closeTo('khối lượng ban đầu', m0, expectedMass, 1e-12, ' kg');

  const vacuum = 0;
  let dv = 0;
  const dt = 0.01;
  let guard = 0;
  while (engineOutput(rocket, vacuum, 1).on && guard < 200_000) {
    const engine = engineOutput(rocket, vacuum, 1);
    dv += (engine.thrust / rocketMass(rocket)) * dt;
    consumeFuel(rocket, engine.massFlow, dt);
    guard += 1;
  }
  const m1 = rocketMass(rocket);
  const tsiolkovsky = STAGES[0].ispVac * G0 * Math.log(m0 / m1);
  closeTo('Δv tầng 1 theo tích phân = Tsiolkovsky', dv, tsiolkovsky, 0.002, ' m/s');
  closeTo('khối lượng khô sau khi cháy hết tầng 1', m1, m0 - STAGES[0].propMass, 1e-9, ' kg');

  closeTo('lực đẩy ở mực nước biển', engineOutput(createRocket(), 101_325, 1).thrust, STAGES[0].thrustSL, 0.0005, ' N');
  closeTo('lực đẩy trong chân không', engineOutput(createRocket(), 0, 1).thrust, STAGES[0].thrustVac, 1e-9, ' N');

  const fresh = createRocket();
  check('Δv còn lại đủ để lên quỹ đạo', remainingDeltaV(fresh) > 9_000, `${remainingDeltaV(fresh).toFixed(0)} m/s`);
  closeTo('ga dưới ngưỡng bị đẩy lên mức tối thiểu', engineOutput(fresh, 0, 0.05).throttle, STAGES[0].minThrottle, 1e-12);
}

console.log('\nLực cản');
{
  const altitude = 10_000.0;
  const atmo = atmosphere(altitude);
  const rocket = createRocket();
  rocket.chuteOpen = 0;
  const sim = placeSim(0, { altitude, x: EARTH.RADIUS + altitude, y: 0, vx: 0, vy: 800 });
  const relBefore = relativeVelocity(sim.body.x, sim.body.y, sim.body.vx, sim.body.vy);
  const airspeedBefore = Math.hypot(relBefore.x, relBefore.y);
  const mass = rocketMass(rocket);
  const cd = dragCoefficient(airspeedBefore / atmo.soundSpeed);
  const expectedDecel =
    (0.5 * atmo.density * airspeedBefore * airspeedBefore * cd * AERO.referenceArea) / mass;

  advance(sim, 0.02, 0.005);
  const relAfter = relativeVelocity(sim.body.x, sim.body.y, sim.body.vx, sim.body.vy);
  const airspeedAfter = Math.hypot(relAfter.x, relAfter.y);
  check(
    'lực cản làm giảm vận tốc trong khí quyển',
    airspeedAfter < airspeedBefore,
    `${airspeedBefore.toFixed(1)} → ${airspeedAfter.toFixed(1)} m/s so với không khí`,
  );
  const measuredDecel = (airspeedBefore - airspeedAfter) / 0.02;
  closeTo('độ giảm tốc do lực cản khớp ½ρv²CdA/m', measuredDecel, expectedDecel, 0.02, ' m/s²');

  const chute = createRocket();
  chute.stages[0].separated = true;
  chute.active = 1;
  chute.stages[1].fuel = 0;
  const chuteMass = rocketMass(chute);
  const dragArea = AERO.referenceArea * 0.3 + AERO.chuteDragArea;
  const terminal = Math.sqrt((2 * chuteMass * G0) / (atmo.density * dragArea));
  check(
    'vận tốc rơi ổn định với dù sau khi tách tầng 1',
    terminal > 10 && terminal < 60,
    `${terminal.toFixed(1)} m/s ở 10 km (khối lượng ${(chuteMass / 1000).toFixed(1)} t)`,
  );
  const noChute = Math.sqrt((2 * chuteMass * G0) / (atmo.density * AERO.referenceArea * 0.3));
  check('dù làm chậm rơi hơn hẳn', terminal < noChute * 0.35, `không dù ${noChute.toFixed(0)} m/s`);
}

console.log('\nQuỹ đạo Kepler');
{
  const altitude = 400_000;
  const r = EARTH.RADIUS + altitude;
  const vCirc = Math.sqrt(EARTH.MU / r);
  const sim = placeSim(0, { altitude, x: r, y: 0, vx: 0, vy: vCirc, theta: Math.PI / 2 });
  const orbit0 = orbitFromState(sim.body.x, sim.body.y, sim.body.vx, sim.body.vy);
  check('quỹ đạo tròn có độ lệch tâm ~ 0', orbit0.eccentricity < 1e-6, `e = ${orbit0.eccentricity.toExponential(2)}`);
  closeTo('chu kỳ quỹ đạo 400 km', orbit0.period, 2 * Math.PI * Math.sqrt(r ** 3 / EARTH.MU), 1e-9, ' s');

  const energy0 = orbit0.energy;
  const steps = Math.round(orbit0.period / 2);
  for (let i = 0; i < steps; i++) stepSimulation(sim, 2);
  const orbit1 = orbitFromState(sim.body.x, sim.body.y, sim.body.vx, sim.body.vy);
  // Ở 400 km vẫn còn chút khí quyển nên năng lượng giảm rất nhẹ; sai khác ~1e-9.
  closeTo('bảo toàn năng lượng riêng sau một vòng (có lực cản loãng)', orbit1.energy, energy0, 2e-9, ' J/kg');
  closeTo('bảo toàn mô men động lượng', orbit1.angularMomentum, orbit0.angularMomentum, 1e-9, ' m²/s');
  const radiusError = Math.abs(Math.hypot(sim.body.x, sim.body.y) - r);
  check('bán kính giữ nguyên sau một vòng', radiusError < 2_000, `lệch ${radiusError.toFixed(1)} m`);
  check(
    'đã bay đủ một vòng',
    Math.abs(sim.orbitAngle) > Math.PI * 1.9,
    `${((sim.orbitAngle / (2 * Math.PI)) * 100).toFixed(1)} % vòng`,
  );

  // Chân không tuyệt đối: năng lượng và mô men động lượng phải bảo toàn tới sai số số học.
  const vacuumRadius = EARTH.RADIUS + 1_500_000;
  const vacuum = placeSim(0, {
    altitude: 1_500_000,
    x: vacuumRadius,
    y: 0,
    vx: 0,
    vy: Math.sqrt(EARTH.MU / vacuumRadius),
    theta: Math.PI / 2,
  });
  const vacuum0 = orbitFromState(vacuum.body.x, vacuum.body.y, vacuum.body.vx, vacuum.body.vy);
  const vacuumSteps = Math.round(vacuum0.period / 2);
  for (let i = 0; i < vacuumSteps; i++) stepSimulation(vacuum, 2);
  const vacuum1 = orbitFromState(vacuum.body.x, vacuum.body.y, vacuum.body.vx, vacuum.body.vy);
  closeTo('bảo toàn năng lượng trong chân không', vacuum1.energy, vacuum0.energy, 1e-12, ' J/kg');
  closeTo('bảo toàn mô men động lượng trong chân không', vacuum1.angularMomentum, vacuum0.angularMomentum, 1e-12, ' m²/s');

  const a = 9_000_000;
  const re = 7_000_000;
  const vEllipse = Math.sqrt(EARTH.MU * (2 / re - 1 / a));
  const ellipse = orbitFromState(re, 0, 0, vEllipse);
  const expectedE = 1 - re / a;
  closeTo('độ lệch tâm quỹ đạo elip', ellipse.eccentricity, expectedE, 1e-6);
  closeTo(
    'chu kỳ theo định luật 3 Kepler',
    ellipse.period,
    2 * Math.PI * Math.sqrt(a ** 3 / EARTH.MU),
    1e-9,
    ' s',
  );
}

console.log('\nTiếp đất và hư hỏng');
{
  const gentle = placeSim(0, { altitude: 35 });
  gentle.body.vy -= 1;
  advance(gentle, 40, 0.02);
  check('tiếp đất nhẹ thì hạ cánh an toàn', gentle.status === 'landed', `trạng thái: ${gentle.status}`);

  const hard = placeSim(0, { altitude: 400 });
  hard.body.vy = -40;
  advance(hard, 30, 0.02);
  check('chạm đất quá nhanh thì phá huỷ', hard.status === 'destroyed', hard.failure);

  const tilted = placeSim(0, { altitude: 5 });
  tilted.body.vy -= 1;
  tilted.body.theta = tilted.body.theta + Math.PI / 3;
  advance(tilted, 20, 0.02);
  check('chạm đất khi nghiêng quá góc thì phá huỷ', tilted.status === 'destroyed', tilted.failure);

  const expectedFlux = 1.83e-4 * Math.sqrt(3.097e-4 / 1.5) * 7_800 ** 3;
  closeTo('thông lượng nhiệt Sutton–Graves ở 60 km', heatFlux(3.097e-4, 7_800), expectedFlux, 1e-9, ' W/m²');

  // Tại góc cực 0: +x là phương thẳng đứng, +y là phương đông.
  const heat = placeSim(0, { altitude: 70_000, x: EARTH.RADIUS + 70_000, y: 0, vx: -400, vy: 7_700 });
  advance(heat, 40, 0.02);
  check('vào lại khí quyển làm vỏ nóng lên', heat.rocket.heat > 150, `${heat.rocket.heat.toFixed(0)} °C sau 40 s`);

  const hot = createRocket();
  hot.heat = LIMITS.maxHeat + 50;
  const hotSim = placeSim(0, { altitude: 50_000, x: EARTH.RADIUS + 50_000, y: 0, vx: 0, vy: -100 });
  hotSim.rocket = hot;
  stepSimulation(hotSim, 0.02);
  check('vỏ vượt ngưỡng nhiệt thì phá huỷ', hotSim.status === 'destroyed', hotSim.failure);
}

console.log('\nNhiệm vụ và chấm điểm');
{
  const sim = createSimulation(world, 0);
  sim.trail = [];
  const mission = createMission();
  check('bắt đầu với 4 mục tiêu chưa đạt', mission.steps.every((step) => step.state === 'pending'));
  check('bắt đầu ở trạng thái trên bệ phóng', sim.status === 'ready');

  sim.body.x = (EARTH.RADIUS + 2_000) * Math.cos(0);
  sim.body.y = (EARTH.RADIUS + 2_000) * Math.sin(0);
  stepSimulation(sim, 0.05);
  updateMission(mission, sim);
  check('lên cao quá 1 km thì mục tiêu cất cánh hoàn thành', mission.steps[0].state === 'done');

  check('xếp hạng A–F đúng ngưỡng', [95, 80, 65, 50, 30, 10].map(gradeFor).join('') === 'ABCDEF');

  const finished = placeSim(0, { altitude: 35 });
  finished.body.vy -= 1;
  advance(finished, 40, 0.02);
  finished.bestEccentricity = 0.01;
  finished.orbitAngle = Math.PI * 2;
  const score = scoreRun(finished, mission);
  check('điểm nằm trong 0..100', score.total >= 0 && score.total <= 100, `${score.total} điểm, hạng ${score.grade}`);
  check('bảng điểm có đủ 4 tiêu chí', score.breakdown.length === 4);
  check(
    'tổng điểm bằng tổng bốn tiêu chí',
    Math.abs(score.total - (score.fuel + score.orbit + score.landing + score.touchdown)) <= 1,
  );

  const wreck = placeSim(0, { altitude: 200 });
  wreck.body.vy = -60;
  advance(wreck, 20, 0.02);
  const wreckScore = scoreRun(wreck, mission);
  check('tên lửa phá huỷ nhận 0 điểm', wreckScore.total === 0, `hạng ${wreckScore.grade}`);

  // Hạ cánh đúng khu hạ cánh của bệ phóng → hoàn tất mục tiêu thứ tư.
  const padSim = createSimulation(world, 0);
  padSim.trail = [];
  const padMission = createMission();
  padMission.steps[0].state = 'done';
  padMission.steps[1].state = 'done';
  padMission.steps[2].state = 'done';
  const radius = EARTH.RADIUS + 35;
  padSim.body.x = radius;
  padSim.body.y = 0;
  padSim.body.vx = 0;
  padSim.body.vy = EARTH.OMEGA * radius - 0.5;
  padSim.body.theta = 0;
  padSim.status = 'flying';
  padSim.airborne = true;
  for (let i = 0; i < 3000 && padSim.status !== 'landed'; i++) {
    stepSimulation(padSim, 0.02);
    updateMission(padMission, padSim);
  }
  check('hạ cánh đúng bệ hoàn tất mục tiêu thứ tư', padMission.steps[3].state === 'done', padSim.status);

  const pad = nearestPad(world, world.pads[1].x, world.pads[1].y);
  check('tìm đúng bệ phóng gần nhất', pad.pad.index === 1 && pad.distance < 1e-6);
  closeTo(
    'khoảng cách cung giữa hai bệ 120°',
    surfaceDistance(0, (2 * Math.PI) / 3),
    (EARTH.RADIUS * (2 * Math.PI)) / 3,
    1e-9,
    ' m',
  );
  check('khu hạ cánh nhỏ hơn khoảng cách giữa các bệ', PAD_LANDING_RADIUS < (EARTH.RADIUS * (2 * Math.PI)) / 3);
}

console.log('\nGiới hạn hư hỏng');
{
  check('ngưỡng chạm đất 6 m/s', LIMITS.maxTouchSpeed === 6);
  check('ngưỡng nghiêng 12°', Math.abs((LIMITS.maxTouchTilt * 180) / Math.PI - 12) < 1e-9);
  check('ngưỡng quá tải 12 g', LIMITS.maxGLoad === 12);
  check('tổng nhiên liệu hai tầng', totalPropellant(createRocket()) === STAGES[0].propMass + STAGES[1].propMass);
}

console.log(`\n${passed} phép kiểm tra đạt, ${failed} thất bại.`);
if (failed > 0) {
  console.log(`Thất bại: ${failures.join(', ')}`);
  process.exitCode = 1;
}
