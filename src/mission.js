/**
 * Hai nhiệm vụ và cách chấm điểm cuối phiên.
 *
 * Mọi ngưỡng ở đây là hợp đồng với giao diện: HUD, màn hình kết quả, trợ lý phi vụ và
 * verify.mjs đều đọc từ cùng một chỗ.
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
export const SUBORBITAL_TARGET_ALTITUDE = 20_000;

const formatKm = (meters) => `${(meters / 1_000).toLocaleString('vi-VN')} km`;

export const MISSIONS = {
  suborbital: {
    id: 'suborbital',
    order: 1,
    name: 'Nhiệm vụ 1 · Lên 100 km rồi hạ cánh',
    short: 'Nhiệm vụ 1',
    goal: `Bay lên trên ${formatKm(SUBORBITAL_TARGET_ALTITUDE)} rồi hạ cánh an toàn ở bất kỳ đâu.`,
    orbital: false,
    targetAltitude: SUBORBITAL_TARGET_ALTITUDE,
    steps: [
      { id: 'launch', title: 'Cất cánh an toàn', detail: 'Rời bệ phóng và lên cao hơn 1 km' },
      {
        id: 'altitude',
        title: `Lên trên ${formatKm(SUBORBITAL_TARGET_ALTITUDE)}`,
        detail: 'Đây là chuyến bay dưới quỹ đạo, không cần vào quỹ đạo',
      },
      {
        id: 'landing',
        title: 'Hạ cánh an toàn',
        detail: 'Chạm đất dưới 6 m/s, nghiêng dưới 12°',
      },
    ],
    /** Bối cảnh gửi kèm cho trợ lý để nó hiểu đúng nhiệm vụ. */
    assistantContext:
      'Đây là chuyến bay dưới quỹ đạo: mục tiêu là đạt độ cao rồi quay về hạ cánh, KHÔNG cần chèn quỹ đạo hay bay đủ một vòng. Hãy gợi ý về mức ga, độ cao cần đạt, thời điểm cắt ga, tư thế đuôi dẫn đầu khi rơi và cách hãm hạ cánh.',
    guidance: {
      ready: 'Nhấn GIỮ phím W để tăng lực đẩy, tên lửa sẽ rời bệ phóng.',
      climb: `Giữ ga tối đa tới trên ${formatKm(SUBORBITAL_TARGET_ALTITUDE)}, rồi cắt ga cho tên lửa rơi lại.`,
      descend:
        'Đã đủ độ cao. Tách tầng 1 (Space) — tầng 1 không có dù. Trên cao: cắt ga và quay đuôi dẫn đầu để lực cản hãm. Nếu đã xuống thấp mà vẫn nhanh: hướng mũi lên và đốt động cơ (ga trên 40 %) để hãm. Mở dù hãm khi đã dưới 12 km VÀ dưới 450 m/s, dù chính tự bung dưới 4 km.',
      done: 'Đã hạ cánh an toàn. Xem bảng điểm bên dưới.',
    },
  },

  orbital: {
    id: 'orbital',
    order: 2,
    name: 'Nhiệm vụ 2 · Một vòng quỹ đạo',
    short: 'Nhiệm vụ 2',
    goal: 'Chèn quỹ đạo trên 150 km với độ lệch tâm dưới 0,08, bay đủ một vòng rồi hạ cánh xuống khu hạ cánh của bệ gần nhất.',
    orbital: true,
    targetAltitude: ORBIT_MIN_PERIAPSIS,
    steps: [
      { id: 'launch', title: 'Cất cánh an toàn', detail: 'Rời bệ phóng và lên cao hơn 1 km' },
      {
        id: 'orbit',
        title: 'Đạt quỹ đạo',
        detail: 'Cận điểm trên 150 km, độ lệch tâm dưới 0,08',
      },
      { id: 'lap', title: 'Bay đủ một vòng', detail: 'Hoàn thành 360° quanh Trái Đất' },
      {
        id: 'landing',
        title: 'Hạ cánh xuống bệ phóng',
        detail: 'Chạm đất trong khu hạ cánh bán kính 5 km',
      },
    ],
    assistantContext:
      'Đây là phi vụ quỹ đạo: mục tiêu là chèn quỹ đạo tròn trên 150 km, bay đủ một vòng rồi hạ quỹ đạo và hạ cánh xuống bệ gần nhất. Hãy gợi ý về nghiêng dần khi cất cánh, tách tầng, cháy đúng hướng (prograde/retrograde), gia nhiệt khi vào lại khí quyển và điểm rơi.',
    guidance: {
      ready: 'Nhấn GIỮ phím W để tăng lực đẩy, tên lửa sẽ rời bệ phóng.',
      climb: 'Nghiêng dần sang phải (phím D) để chuyển từ bay thẳng đứng sang bay ngang.',
      orbit: 'Quỹ đạo đã tròn. Kéo thanh tua thời gian để bay hết một vòng.',
      lap:
        'Đã đủ một vòng. Giảm độ cao; nếu còn tầng 1 thì tách (Space) để có dù, quay đuôi dẫn đầu khi vào khí quyển, mở dù hãm dưới 12 km và dưới 450 m/s, rồi hạ cánh xuống bệ gần nhất.',
      done: 'Phi vụ hoàn tất. Xem bảng điểm bên dưới.',
    },
  },
};

export const DEFAULT_MISSION_ID = 'suborbital';

export function missionDefinition(id = DEFAULT_MISSION_ID) {
  return MISSIONS[id] ?? MISSIONS[DEFAULT_MISSION_ID];
}

export function createMission(id = DEFAULT_MISSION_ID) {
  const definition = missionDefinition(id);
  return {
    id: definition.id,
    definition,
    steps: definition.steps.map((step) => ({ ...step, state: 'pending', completedAt: null })),
    failed: false,
    failedReason: '',
    finishedAt: null,
    guidance: definition.guidance.ready,
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

/** Bước hiện tại (bước chưa xong đầu tiên) — dùng cho HUD và bối cảnh trợ lý. */
export function currentStep(mission) {
  return mission.steps.find((step) => step.state !== 'done') ?? null;
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

  const definition = mission.definition;

  if (stepById(mission, 'launch').state !== 'done' && sim.last.altitudeAboveGround > LAUNCH_ALTITUDE) {
    complete(mission, 'launch', sim);
    mission.guidance = definition.guidance.climb;
  }

  if (definition.orbital) {
    const orbit = sim.last.orbit;
    if (
      orbit &&
      orbit.periapsis > ORBIT_MIN_PERIAPSIS &&
      orbit.eccentricity < ORBIT_MAX_ECCENTRICITY &&
      stepById(mission, 'orbit').state !== 'done'
    ) {
      complete(mission, 'orbit', sim);
      mission.guidance = definition.guidance.orbit;
    }

    if (stepById(mission, 'orbit').state === 'done' && Math.abs(sim.orbitAngle) >= TAU) {
      if (stepById(mission, 'lap').state !== 'done') {
        complete(mission, 'lap', sim);
        mission.guidance = definition.guidance.lap;
      }
    }

    if (stepById(mission, 'lap').state === 'done' && sim.status === 'landed' && isOnPad(sim)) {
      if (stepById(mission, 'landing').state !== 'done') {
        complete(mission, 'landing', sim);
        mission.finishedAt = sim.time;
        mission.guidance = definition.guidance.done;
      }
    }
  } else {
    if (
      sim.last.altitudeAboveGround > definition.targetAltitude &&
      stepById(mission, 'altitude').state !== 'done'
    ) {
      complete(mission, 'altitude', sim);
      mission.guidance = definition.guidance.descend;
    }

    // Hạ cánh "an toàn" chính là trạng thái landed: chạm quá nhanh hoặc nghiêng quá
    // góc thì mô phỏng đã phá huỷ tên lửa trước đó.
    if (stepById(mission, 'altitude').state === 'done' && sim.status === 'landed') {
      if (stepById(mission, 'landing').state !== 'done') {
        complete(mission, 'landing', sim);
        mission.finishedAt = sim.time;
        mission.guidance = definition.guidance.done;
      }
    }
  }

  if (stepById(mission, 'launch').state !== 'done') {
    mission.guidance = definition.guidance.ready;
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
  goal: 25,
  landing: 25,
  touchdown: 25,
};

/**
 * Bốn tiêu chí × 25 điểm. Nhiệm vụ quỹ đạo chấm "độ tròn quỹ đạo", nhiệm vụ dưới quỹ
 * đạo chấm "độ cao đỉnh so với mục tiêu" — cùng một thang 100 nên so sánh được.
 */
export function scoreRun(sim, mission) {
  const definition = mission?.definition ?? missionDefinition();
  const rocket = sim.rocket;
  const orbit = sim.last.orbit ?? { eccentricity: 1, periapsis: 0 };

  const propellantLeft = totalPropellant(rocket) > 0 ? totalFuel(rocket) / totalPropellant(rocket) : 0;
  const fuelPoints = SCORE_WEIGHTS.fuel * clamp01(propellantLeft / 0.08);

  const eccentricity = Math.min(orbit.eccentricity, 1);
  const peakAltitude = sim.peakAltitude ?? sim.last.altitudeAboveGround ?? 0;
  const goalPoints = definition.orbital
    ? SCORE_WEIGHTS.goal * clamp01((0.1 - eccentricity) / 0.095)
    : SCORE_WEIGHTS.goal * clamp01(peakAltitude / definition.targetAltitude);

  const distance = landingDistance(sim);
  const landingPoints = SCORE_WEIGHTS.landing * clamp01(1 - distance / 20_000);

  let touchdownPoints = 0;
  if (sim.touchdown) {
    const speedQuality = clamp01(1 - sim.touchdown.speed / LIMITS.maxTouchSpeed);
    const tiltQuality = clamp01(1 - Math.abs(sim.touchdown.tilt) / LIMITS.maxTouchTilt);
    touchdownPoints = SCORE_WEIGHTS.touchdown * (0.7 * speedQuality + 0.3 * tiltQuality);
  }

  const alive = sim.status !== 'destroyed';
  const total = alive ? Math.round(fuelPoints + goalPoints + landingPoints + touchdownPoints) : 0;

  const goalBreakdown = definition.orbital
    ? {
        label: 'Độ tròn quỹ đạo',
        points: Math.round(goalPoints),
        max: SCORE_WEIGHTS.goal,
        detail: `Độ lệch tâm nhỏ nhất ${eccentricity.toFixed(4)}`,
      }
    : {
        label: 'Độ cao đạt được',
        points: Math.round(goalPoints),
        max: SCORE_WEIGHTS.goal,
        detail: `Đỉnh ${formatKm(peakAltitude)} trên mục tiêu ${formatKm(definition.targetAltitude)}`,
      };

  return {
    fuel: Math.round(fuelPoints),
    goal: Math.round(goalPoints),
    landing: Math.round(landingPoints),
    touchdown: Math.round(touchdownPoints),
    total,
    grade: gradeFor(total),
    mission: definition.id,
    breakdown: [
      {
        label: 'Nhiên liệu còn lại',
        points: Math.round(fuelPoints),
        max: SCORE_WEIGHTS.fuel,
        detail: `${(propellantLeft * 100).toFixed(1)} % tổng nhiên liệu`,
      },
      goalBreakdown,
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
