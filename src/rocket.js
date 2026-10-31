/**
 * Mô hình tên lửa hai tầng: khối lượng biến đổi khi cháy nhiên liệu, lực đẩy phụ
 * thuộc áp suất khí quyển, tách tầng, dù hãm, nhiệt vỏ và các ngưỡng hư hỏng.
 */

import {
  STAGES,
  PAYLOAD,
  EARTH,
  G0,
  AERO,
  LIMITS,
  EMISSIVITY,
  SKIN_HEAT_FACTOR,
  THERMAL_TIME_CONSTANT,
  AMBIENT_HEAT,
  NOSE_RADIUS,
  RCS,
} from './constants.js';

const STEFAN_BOLTZMANN = 5.670374419e-8;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function createRocket() {
  return {
    stages: STAGES.map((stage) => ({
      ...stage,
      fuel: stage.propMass,
      separated: false,
      mdotMax: stage.thrustVac / (stage.ispVac * G0),
      exitArea: (stage.thrustVac - stage.thrustSL) / EARTH.SEA_LEVEL_PRESSURE,
    })),
    active: 0,
    throttle: 0,
    /** Khí RCS còn lại (kg) — chỉ dùng khi động cơ tắt. */
    rcs: RCS.propMass,
    chuteDeployed: false,
    chuteOpen: 0,
    heat: AMBIENT_HEAT,
    peakHeat: AMBIENT_HEAT,
    peakGLoad: 0,
    fuelUsed: STAGES.map(() => 0),
  };
}

export function activeStage(rocket) {
  return rocket.stages[rocket.active];
}

export function hasStageLeft(rocket) {
  return rocket.stages.some((stage) => !stage.separated);
}

/** Khối lượng tức thời: cấu trúc còn lại + nhiên liệu còn lại + khí RCS + tải trọng. */
export function rocketMass(rocket) {
  let mass = PAYLOAD.mass + rocket.rcs;
  for (const stage of rocket.stages) {
    if (!stage.separated) mass += stage.dryMass + stage.fuel;
  }
  return mass;
}

/** Phần khí RCS còn lại, 0..1. */
export function rcsFraction(rocket) {
  return RCS.propMass > 0 ? clamp(rocket.rcs / RCS.propMass, 0, 1) : 0;
}

/**
 * Tiêu khí RCS theo lệnh nghiêng `demand` (|pitch|, 0..1) trong `dt` giây.
 * Trả về khối lượng khí đã dùng.
 */
export function consumeRcs(rocket, demand, dt) {
  if (rocket.rcs <= 0 || demand <= 0) return 0;
  const used = Math.min(rocket.rcs, RCS.massFlow * clamp(demand, 0, 1) * dt);
  rocket.rcs -= used;
  if (rocket.rcs <= 0) rocket.rcs = 0;
  return used;
}

export function rocketLength(rocket) {
  let length = PAYLOAD.length;
  for (const stage of rocket.stages) if (!stage.separated) length += stage.length;
  return length;
}

export function fuelFraction(rocket, index) {
  const stage = rocket.stages[index];
  if (!stage || stage.separated) return 0;
  return stage.fuel / stage.propMass;
}

export function totalFuel(rocket) {
  return rocket.stages.reduce((sum, stage) => sum + (stage.separated ? 0 : stage.fuel), 0);
}

export function totalPropellant(rocket) {
  return rocket.stages.reduce((sum, stage) => sum + stage.propMass, 0);
}

/**
 * Lực đẩy và lưu lượng nhiên liệu của tầng đang hoạt động.
 * Lực đẩy thực tế trừ đi áp lực khí quyển lên tiết diện vòi: F = F_chân_không − p·A_vòi.
 * Động cơ không thể chạy dưới 40 % công suất (giới hạn của động cơ tên lửa thật).
 */
export function engineOutput(rocket, ambientPressure, throttle = rocket.throttle) {
  const stage = activeStage(rocket);
  const idle = { on: false, thrust: 0, massFlow: 0, throttle: 0, stage };
  if (!stage || stage.separated || stage.fuel <= 0) return idle;
  if (throttle <= 0) return idle;
  const effective = clamp(throttle, stage.minThrottle, 1);
  const thrust = Math.max(0, effective * (stage.thrustVac - ambientPressure * stage.exitArea));
  if (thrust <= 0) return idle;
  return {
    on: true,
    thrust,
    massFlow: effective * stage.mdotMax,
    throttle: effective,
    stage,
  };
}

/** Trừ nhiên liệu theo lưu lượng đã dùng trong bước thời gian `dt`. */
export function consumeFuel(rocket, massFlow, dt) {
  const stage = activeStage(rocket);
  if (!stage || stage.separated || massFlow <= 0) return 0;
  const used = Math.min(stage.fuel, massFlow * dt);
  stage.fuel -= used;
  rocket.fuelUsed[rocket.active] += used;
  if (stage.fuel <= 0) {
    stage.fuel = 0;
    rocket.throttle = 0;
  }
  return used;
}

export function separateStage(rocket) {
  const stage = activeStage(rocket);
  if (!stage || stage.separated) return false;
  if (rocket.active >= rocket.stages.length - 1) return false;
  stage.separated = true;
  rocket.active += 1;
  rocket.throttle = 0;
  return true;
}

export function canDeployChute(rocket, altitude, airspeed) {
  const stage = activeStage(rocket);
  if (!stage || !stage.hasChute) return { ok: false, reason: 'Tầng này không có dù' };
  if (rocket.chuteDeployed) return { ok: false, reason: 'Dù đã mở' };
  if (altitude > AERO.chuteDeployAltitude) return { ok: false, reason: 'Còn quá cao để mở dù' };
  if (airspeed > AERO.chuteMaxSpeed) return { ok: false, reason: 'Quá nhanh — hãy cháy động cơ giảm tốc trước' };
  return { ok: true, reason: '' };
}

export function deployChute(rocket, altitude, airspeed) {
  const check = canDeployChute(rocket, altitude, airspeed);
  if (!check.ok) return check;
  rocket.chuteDeployed = true;
  return { ok: true, reason: '' };
}

export function updateChute(rocket, dt) {
  const target = rocket.chuteDeployed ? 1 : 0;
  const rate = 1 / AERO.chuteOpenTime;
  rocket.chuteOpen += clamp(target - rocket.chuteOpen, -rate * dt, rate * dt);
}

/** Thông lượng nhiệt Sutton–Graves tại điểm tới hạn, W/m². */
export function heatFlux(density, airspeed) {
  if (density <= 0 || airspeed <= 0) return 0;
  return 1.83e-4 * Math.sqrt(density / NOSE_RADIUS) * airspeed ** 3;
}

/** Nhiệt độ cân bằng bức xạ của vỏ (Kelvin → °C) ứng với thông lượng q. */
export function equilibriumHeat(q) {
  if (q <= 0) return AMBIENT_HEAT;
  const skinFlux = SKIN_HEAT_FACTOR * q;
  const kelvin = (skinFlux / (EMISSIVITY * STEFAN_BOLTZMANN)) ** 0.25;
  return kelvin - 273.15;
}

export function updateThermal(rocket, density, airspeed, dt, heatScale = 1) {
  const target = Math.max(AMBIENT_HEAT, equilibriumHeat(heatFlux(density, airspeed) * heatScale));
  const blend = Math.min(1, dt / THERMAL_TIME_CONSTANT);
  rocket.heat += (target - rocket.heat) * blend;
  if (rocket.heat > rocket.peakHeat) rocket.peakHeat = rocket.heat;
}

export function trackGLoad(rocket, gLoad) {
  if (gLoad > rocket.peakGLoad) rocket.peakGLoad = gLoad;
}

/** Δv còn lại theo phương trình Tsiolkovsky cho từng tầng chưa tách. */
export function remainingDeltaV(rocket) {
  let mass = rocketMass(rocket);
  let dv = 0;
  for (let i = rocket.active; i < rocket.stages.length; i++) {
    const stage = rocket.stages[i];
    if (stage.separated || stage.fuel <= 0) continue;
    const after = mass - stage.fuel;
    dv += stage.ispVac * G0 * Math.log(mass / after);
    mass = after - stage.dryMass;
  }
  return dv;
}

export function resetRocket() {
  return createRocket();
}

export { LIMITS };
