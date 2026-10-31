/**
 * Nhiệm vụ tuần tự bốn bước và cách chấm điểm cuối phiên.
 * Mọi ngưỡng ở đây là hợp đồng với giao diện: HUD, màn hình kết quả và verify.mjs
 * đều đọc từ cùng một chỗ.
 */

import { LIMITS, PAD_LANDING_RADIUS, DEG } from './constants.js';
import { totalFuel, totalPropellant } from './rocket.js';
import { isOnPad, earthPosition } from './physics.js';
import { nearestPad, toEarthFrame } from './world.js';

const TAU = Math.PI * 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export const LAUNCH_ALTITUDE = 1_000;
export const ORBIT_MIN_PERIAPSIS = 150_000;
export const ORBIT_MAX_ECCENTRICITY = 0.08;

export const MISSION_STEPS = [
  { id: 'launch', title: 'Cất cánh an toàn', detail: 'Rời bệ phóng và lên cao hơn 1 km' },
  { id: 'orbit', title: 'Đạt quỹ đạo', detail: 'Cận điểm trên 150 km, độ lệch tâm dưới 0,08' },
  { id: 'lap', title: 'Bay đủ một vòng', detail: 'Hoàn thành 360° quanh Trái Đất' },
  { id: 'landing', title: 'Hạ cánh xuống bệ phóng', detail: 'Chạm đất trong khu hạ cánh bán kính 5 km' },
];

export function createMission() {
  return {
    steps: MISSION_STEPS.map((step) => ({ ...step, state: 'pending', completedAt: null })),
    failed: false,
    failedReason: '',
    finishedAt: null,
    guidance: 'Nhấn GIỮ phím W để tăng lực đẩy, tên lửa sẽ rời bệ phóng.',
  };
}

function stepById(mission, id) {
  return mission.steps.find((step) => step.id === id);
}

function complete(mission, id, sim) {
  const step = stepById(mission, id);
  if (!step || step.state === 'done') return;
  step.state = 'done';
  step.completedAt = sim.time;
}

export function updateMission(mission, sim) {
  if (mission.failed || sim.status === 'destroyed') {
    if (!mission.failed) {
      mission.failed = true;
      mission.failedReason = sim.failure;
      mission.finishedAt = sim.time;
    }
    return mission;
  }

  const orbit = sim.last.orbit;

  if (stepById(mission, 'launch').state !== 'done' && sim.last.altitudeAboveGround > LAUNCH_ALTITUDE) {
    complete(mission, 'launch', sim);
    mission.guidance = 'Nghiêng dần sang phải (phím D) để chuyển từ bay thẳng đứng sang bay ngang.';
  }

  if (
    orbit &&
    orbit.periapsis > ORBIT_MIN_PERIAPSIS &&
    orbit.eccentricity < ORBIT_MAX_ECCENTRICITY
  ) {
    if (stepById(mission, 'orbit').state !== 'done') {
      complete(mission, 'orbit', sim);
      mission.guidance = 'Quỹ đạo đã tròn. Tăng tua thời gian (T) để bay hết một vòng.';
    }
  }

  if (stepById(mission, 'orbit').state === 'done' && Math.abs(sim.orbitAngle) >= TAU) {
    if (stepById(mission, 'lap').state !== 'done') {
      complete(mission, 'lap', sim);
      mission.guidance = 'Đã đủ một vòng. Giảm độ cao, mở dù và hạ cánh xuống bệ gần nhất.';
    }
  }

  if (stepById(mission, 'lap').state === 'done' && sim.status === 'landed' && isOnPad(sim)) {
    if (stepById(mission, 'landing').state !== 'done') {
      complete(mission, 'landing', sim);
      mission.finishedAt = sim.time;
      mission.guidance = 'Phi vụ hoàn tất. Xem bảng điểm bên dưới.';
    }
  }

  if (stepById(mission, 'launch').state !== 'done') {
    mission.guidance = 'Nhấn GIỮ phím W để tăng lực đẩy, tên lửa sẽ rời bệ phóng.';
  }

  return mission;
}

export function missionComplete(mission) {
  return mission.steps.every((step) => step.state === 'done');
}

export function landingDistance(sim) {
  const point = sim.touchdown
    ? toEarthFrame(sim.touchdown.x, sim.touchdown.y, sim.touchdown.time)
    : earthPosition(sim);
  return nearestPad(sim.world, point.x, point.y).distance;
}

const SCORE_WEIGHTS = {
  fuel: 25,
  orbit: 25,
  landing: 25,
  touchdown: 25,
};

/** Bốn tiêu chí, mỗi tiêu chí tối đa 25 điểm, tổng 100. */
export function scoreRun(sim, mission) {
  const rocket = sim.rocket;
  const orbit = sim.last.orbit ?? { eccentricity: 1 };

  const propellantLeft = totalPropellant(rocket) > 0 ? totalFuel(rocket) / totalPropellant(rocket) : 0;
  const fuelPoints = SCORE_WEIGHTS.fuel * clamp01(propellantLeft / 0.08);

  const eccentricity = Math.min(orbit.eccentricity, 1);
  const orbitPoints = SCORE_WEIGHTS.orbit * clamp01((0.1 - eccentricity) / 0.095);

  const distance = landingDistance(sim);
  const landingPoints = SCORE_WEIGHTS.landing * clamp01(1 - distance / 20_000);

  let touchdownPoints = 0;
  if (sim.touchdown) {
    const speedQuality = clamp01(1 - sim.touchdown.speed / LIMITS.maxTouchSpeed);
    const tiltQuality = clamp01(1 - Math.abs(sim.touchdown.tilt) / LIMITS.maxTouchTilt);
    touchdownPoints = SCORE_WEIGHTS.touchdown * (0.7 * speedQuality + 0.3 * tiltQuality);
  }

  const alive = sim.status !== 'destroyed';
  const total = alive
    ? Math.round(fuelPoints + orbitPoints + landingPoints + touchdownPoints)
    : 0;

  return {
    fuel: Math.round(fuelPoints),
    orbit: Math.round(orbitPoints),
    landing: Math.round(landingPoints),
    touchdown: Math.round(touchdownPoints),
    total,
    grade: gradeFor(total),
    breakdown: [
      {
        label: 'Nhiên liệu còn lại',
        points: Math.round(fuelPoints),
        max: SCORE_WEIGHTS.fuel,
        detail: `${(propellantLeft * 100).toFixed(1)} % tổng nhiên liệu`,
      },
      {
        label: 'Độ tròn quỹ đạo',
        points: Math.round(orbitPoints),
        max: SCORE_WEIGHTS.orbit,
        detail: `Độ lệch tâm nhỏ nhất ${eccentricity.toFixed(4)}`,
      },
      {
        label: 'Độ chính xác hạ cánh',
        points: Math.round(landingPoints),
        max: SCORE_WEIGHTS.landing,
        detail: `Cách tâm bệ ${formatDistance(distance)}`,
      },
      {
        label: 'Chất lượng tiếp đất',
        points: Math.round(touchdownPoints),
        max: SCORE_WEIGHTS.touchdown,
        detail: sim.touchdown
          ? `${sim.touchdown.speed.toFixed(1)} m/s · nghiêng ${(Math.abs(sim.touchdown.tilt) / DEG).toFixed(1)}°`
          : 'Không có dữ liệu tiếp đất',
      },
    ],
  };
}

export function gradeFor(total) {
  if (total >= 90) return 'A';
  if (total >= 75) return 'B';
  if (total >= 60) return 'C';
  if (total >= 45) return 'D';
  if (total >= 25) return 'E';
  return 'F';
}

export function formatDistance(meters) {
  if (!Number.isFinite(meters)) return '—';
  if (meters < 1_000) return `${meters.toFixed(0)} m`;
  return `${(meters / 1_000).toFixed(1)} km`;
}

export { PAD_LANDING_RADIUS };
