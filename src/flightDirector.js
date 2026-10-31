/**
 * Cố vấn bay: bộ luật tính toán (không dùng AI, không gọi mạng) đọc trạng thái tàu và
 * trả về khuyến nghị ga + mức an toàn.
 *
 * Nguyên tắc:
 * - Phân biệt **hướng bay**: đang đi ra xa Trái Đất (vận tốc dọc ≥ 0) thì khuyên leo/cắt
 *   ga theo độ cao mục tiêu; đang rơi về Trái Đất thì khuyên hãm.
 * - Khi rơi, chỉ hãm được nếu **mũi hướng lên** (lực đẩy ngược chiều rơi). Mũi chúc
 *   xuống thì đốt ga chỉ làm rơi nhanh hơn — phải xoay trước.
 * - Ga khuyến nghị tính từ vật lý: `a = (F·cosθ)/m − g + lực cản hướng lên`, giải ra
 *   mức ga để có gia tốc hướng lên mong muốn.
 * - “Đường bao an toàn”: quãng đường cần để hãm hẳn `v²/(2a)` so với độ cao còn lại.
 */

import { EARTH, G0, AERO, LIMITS } from './constants.js';
import { engineOutput, rocketMass } from './rocket.js';
import { atmosphere, dragCoefficient } from './atmosphere.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Vận tốc dọc mong muốn (m/s, âm = rơi) theo độ cao — hồ sơ hạ cánh. */
export function descentProfile(altitude) {
  if (altitude > 10_000) return -80;
  if (altitude > 3_000) return -35;
  if (altitude > 600) return -8;
  return -3;
}

/**
 * @returns {{
 *   throttlePct: number, action: 'throttle'|'separate'|'rotate'|'coast'|'fatal'|'landed',
 *   headline: string, detail: string, level: 'ok'|'warn'|'danger',
 *   stopDistanceM: number, marginM: number
 * }}
 */
export function directorAdvice(sim, { targetAltitude = 0 } = {}) {
  const last = sim.last ?? {};
  const rocket = sim.rocket;
  // Lấy độ cao từ hình học: `last` chỉ được cập nhật sau bước vật lý đầu tiên.
  const radiusNow = Math.hypot(sim.body.x, sim.body.y);
  const altitude = Math.max(
    0,
    radiusNow - EARTH.RADIUS - (last.clearance ?? 0),
  );
  const vertical = last.verticalSpeed ?? 0;
  const speed = last.speed ?? 0;
  const mass = last.mass ?? rocketMass(rocket);
  const gravity = EARTH.MU / (radiusNow * radiusNow);

  const idle = {
    throttlePct: 0,
    action: 'coast',
    headline: 'GA 0 %',
    detail: '',
    level: 'ok',
    stopDistanceM: 0,
    marginM: altitude,
  };

  if (sim.status === 'destroyed') {
    return { ...idle, action: 'fatal', headline: 'TÀU ĐÃ HỎNG', detail: 'Bấm R để bay lại', level: 'danger' };
  }
  if (sim.status === 'ready') {
    return {
      ...idle,
      throttlePct: 100,
      action: 'throttle',
      headline: 'GA 100 %',
      detail: 'Giữ W tới 100 % để tên lửa rời bệ phóng',
      level: 'ok',
    };
  }
  if (sim.status === 'landed') {
    return { ...idle, action: 'landed', headline: 'ĐÃ HẠ CÁNH', detail: 'Xem bảng điểm', level: 'ok' };
  }

  // Hình học: mũi có hướng lên không, lực đẩy chiếu lên phương thẳng đứng được bao nhiêu.
  const upAngle = Math.atan2(sim.body.y, sim.body.x);
  let tilt = sim.body.theta - upAngle;
  while (tilt > Math.PI) tilt -= Math.PI * 2;
  while (tilt < -Math.PI) tilt += Math.PI * 2;
  const noseUp = Math.cos(tilt); // 1 = mũi chúc lên trời, -1 = mũi chúc xuống đất

  const engineMax = engineOutput(rocket, last.pressure ?? 0, 1);
  const thrustMax = engineMax.on ? engineMax.thrust : 0;
  const thrustUp = (thrustMax * Math.max(0, noseUp)) / mass;
  const forces = last.forces;
  const upX = Math.cos(upAngle);
  const upY = Math.sin(upAngle);
  const dragUp = forces ? (forces.drag.x * upX + forces.drag.y * upY) / mass : 0;

  // Giới hạn G: lực đẩy + lực cản cùng chiều trục không được vượt 85 % ngưỡng phá huỷ.
  const dragMag = forces ? Math.hypot(forces.drag.x, forces.drag.y) : 0;
  const gLoadBudget = LIMITS.maxGLoad * 0.85 * G0 * mass;
  const throttleG = thrustMax > 0 ? clamp((gLoadBudget - dragMag) / thrustMax, 0, 1) : 0;

  // Gia tốc hướng lên lớn nhất đạt được khi ga 100 % (dùng để tính đường bao an toàn).
  const maxBrake = thrustUp - gravity + dragUp;
  const stopDistanceM = maxBrake > 0.2 ? (vertical * vertical) / (2 * maxBrake) : Infinity;
  const marginM = altitude - 25 - stopDistanceM;

  const tachTang = (() => {
    const stage1 = rocket.stages?.[0];
    const attached = stage1 && !stage1.separated;
    if (!attached || altitude < 800) return false; // còn trên bệ thì chưa tách
    const empty = stage1.fuel <= 0.5;
    const reached = targetAltitude > 0 && altitude >= targetAltitude;
    const pastApogee = vertical < -1;
    return empty || reached || pastApogee;
  })();

  // Pha bay: đã qua đỉnh (từng cao hơn hiện tại) thì luôn coi là pha hạ, không để một
  // nhịp hãm làm tàu nhích lên rồi lại bị khuyên đốt 100 % (gây dao động).
  // Đã đạt độ cao mục tiêu (kể cả vừa vượt qua) → cắt ga để coast.
  if (targetAltitude > 0 && altitude >= targetAltitude - 500 && vertical > 1) {
    return {
      throttlePct: 0,
      action: 'coast',
      headline: 'GA 0 %',
      detail: `Đã tới độ cao mục tiêu ${(targetAltitude / 1000).toFixed(0)} km — cắt ga để coast`,
      level: 'ok',
      stopDistanceM,
      marginM,
    };
  }

  const peak = sim.peakAltitude ?? altitude;
  const pastApogee = peak - altitude > 200;
  const climbing = vertical > 1 && !pastApogee && (targetAltitude === 0 || altitude < targetAltitude);

  // --- Đang đi RA XA Trái Đất: leo tới độ cao mục tiêu (hoặc tới khi cạn tầng 1) ---
  if (climbing) {
    if (tachTang) {
      return {
        throttlePct: 0,
        action: 'separate',
        headline: 'TÁCH TẦNG 1',
        detail: 'Bấm Space — tầng 1 không có dù',
        level: 'warn',
        stopDistanceM,
        marginM,
      };
    }
    const nearTarget = targetAltitude > 0 && altitude >= targetAltitude - 500;
    if (nearTarget) {
      return {
        throttlePct: 0,
        action: 'coast',
        headline: 'GA 0 %',
        detail: `Đã tới độ cao mục tiêu ${(targetAltitude / 1000).toFixed(0)} km — cắt ga để coast`,
        level: 'ok',
        stopDistanceM,
        marginM,
      };
    }
    // Vùng áp động lớn: giảm ga để giảm tải, đúng cách tên lửa thật bay qua max-Q.
    const maxQ = (last.dynamicPressure ?? 0) > 30_000 && altitude < 15_000;
    return {
      throttlePct: maxQ ? 70 : 100,
      action: 'throttle',
      headline: `GA ${maxQ ? 70 : 100} %`,
      detail: maxQ
        ? `Áp động cao (${Math.round((last.dynamicPressure ?? 0) / 1000)} kPa) — giảm ga qua max-Q`
        : `Leo tới ${((targetAltitude || 100_000) / 1000).toFixed(0)} km`,
      level: maxQ ? 'warn' : 'ok',
      stopDistanceM,
      marginM,
    };
  }

  // --- Đang RƠI về Trái Đất ---
  if (tachTang) {
    return {
      throttlePct: 0,
      action: 'separate',
      headline: 'TÁCH TẦNG 1',
      detail: 'Bấm Space — tầng 1 không có dù, tách ra mới hạ cánh được',
      level: 'warn',
      stopDistanceM,
      marginM,
    };
  }

  const chute = chuteReady(rocket, altitude, speed);

  // Quá thấp mà vẫn nhanh: dù không kịp bung, động cơ cũng không kịp hãm.
  if (altitude < 300 && speed > LIMITS.maxTouchSpeed * 3) {
    return {
      throttlePct: thrustMax > 0 ? 100 : 0,
      action: 'fatal',
      headline: 'QUÁ THẤP · KHÔNG CỨU ĐƯỢC',
      detail: `Còn ${Math.round(altitude)} m với ${Math.round(speed)} m/s — bấm R để bay lại`,
      level: 'danger',
      stopDistanceM,
      marginM,
    };
  }

  // Đủ điều kiện mở dù thì đó là việc nên làm ngay — dù hãm hơn hẳn việc đốt ga ở tầm thấp.
  const tooLowForChute = altitude < 400 && speed > 60;

  // Dù chỉ hiệu quả khi tàu đủ nhẹ (dù chính đưa 12,5 t về ~11 m/s; 87 t thì vẫn ~29 m/s).
  // Còn nặng thì tiếp tục hãm bằng động cơ để vừa giảm tốc vừa đốt bớt khối lượng.
  const heavyForChute = mass > 45_000;
  if (chute.canDrogue && !tooLowForChute && !heavyForChute) {
    return {
      throttlePct: 0,
      action: 'chute',
      headline: 'MỞ DÙ HÃM · GA 0 %',
      detail: `Đã dưới ${AERO.drogueDeployAltitude / 1000} km và dưới ${AERO.drogueMaxSpeed} m/s — bấm P`,
      level: 'warn',
      stopDistanceM,
      marginM,
    };
  }

  // Dù đã mở: để dù làm việc, KHÔNG đốt giữ hồ sơ (rất tốn nhiên liệu) — chỉ đốt nhịp
  // hãm cuối để chạm đất dưới ngưỡng 6 m/s.
  if ((chute.drogueOpen || chute.mainOpen) && (!heavyForChute || thrustMax <= 0)) {
    const flareAltitude = 200;
    if (altitude > flareAltitude) {
      return {
        throttlePct: 0,
        action: 'coast',
        headline: 'GA 0 % · DÙ ĐANG HÃM',
        detail: `Dù đưa tốc độ rơi về ~${Math.abs(Math.round(vertical))} m/s — còn ${Math.round(altitude)} m tới nhịp hãm cuối`,
        level: 'ok',
        stopDistanceM,
        marginM,
      };
    }
    // Sát đất: nhịp bật/tắt dứt khoát — đốt khi rơi nhanh hơn 4 m/s, tắt khi đã chậm hơn.
    const flarePct = vertical < -4 ? Math.round(Math.min(1, throttleG) * 100) : 0;
    return {
      throttlePct: flarePct,
      action: flarePct > 0 ? 'throttle' : 'coast',
      headline: flarePct > 0 ? `GA ${flarePct} % · HÃM CUỐI` : 'GA 0 %',
      detail: `Còn ${Math.round(altitude)} m · rơi ${Math.abs(vertical).toFixed(1)} m/s — hãm xuống dưới ${LIMITS.maxTouchSpeed} m/s`,
      level: 'warn',
      stopDistanceM,
      marginM,
    };
  }

  if (noseUp < 0.25) {
    return {
      throttlePct: 0,
      action: 'rotate',
      headline: 'XOAY MŨI LÊN · GA 0 %',
      detail: 'Mũi đang chúc xuống: đốt ga sẽ làm rơi nhanh hơn. Giữ A/D cho đuôi dẫn đầu',
      level: 'warn',
      stopDistanceM,
      marginM,
    };
  }

  if (marginM < 0) {
    const massT = Math.round(mass / 1_000);
    const stage = rocket.stages?.[rocket.active];
    const fuelLeft = (stage?.fuel ?? 0) > 0;
    const landableMassT = Math.round((stage?.thrustSL ?? 0) / (1.6 * G0) / 1_000);

    // Còn nhiên liệu: đốt ga để hãm và đốt bớt khối lượng — đây là cách xử lý đúng, chỉ
    // cần giữ tổng tải dưới ngưỡng G nên ga bị giới hạn bởi `throttleG`.
    if (fuelLeft && altitude > 800) {
      return {
        throttlePct: Math.max(1, Math.round(throttleG * 100)),
        action: 'throttle',
        headline: `GA ${Math.max(1, Math.round(throttleG * 100))} % · HÃM BẰNG ĐỘNG CƠ`,
        detail:
          `Còn ${massT} t nên chưa dừng hẳn được: đốt liên tục để vừa hãm vừa giảm khối lượng xuống ~${landableMassT} t ` +
          `(giữ dưới ${Math.round(LIMITS.maxGLoad * 0.85)} g), rồi hạ theo hồ sơ`,
        level: 'warn',
        stopDistanceM,
        marginM,
      };
    }

    const dragWillSlow = predictDrogueAltitude({ altitude, speed, mass, verticalSpeed: vertical });
    if (dragWillSlow !== null) {
      return {
        throttlePct: 0,
        action: 'coast',
        headline: 'GA 0 % · CHỜ MỞ DÙ',
        detail:
          `Không còn nhiên liệu hãm ở ${massT} t, nhưng lực cản sẽ kéo xuống dưới ${AERO.drogueMaxSpeed} m/s ` +
          `quanh ${(dragWillSlow / 1_000).toFixed(1)} km — rồi mở dù hãm`,
        level: 'warn',
        stopDistanceM,
        marginM,
      };
    }
    return {
      throttlePct: 0,
      action: 'fatal',
      headline: 'KHÔNG HÃM ĐƯỢC',
      detail:
        `Còn ${massT} t, không còn nhiên liệu, và lực cản cũng không kéo được xuống dưới ${AERO.drogueMaxSpeed} m/s — bấm R`,
      level: 'danger',
      stopDistanceM,
      marginM,
    };
  }

  if (thrustMax <= 0) {
    return {
      throttlePct: 0,
      action: 'coast',
      headline: 'GA 0 % · KHÔNG CÒN NHIÊN LIỆU',
      detail: 'Chỉ còn lực cản và dù — mở dù đúng ngưỡng rồi chờ chạm đất',
      level: 'warn',
      stopDistanceM,
      marginM,
    };
  }

  // Ga để tiến tới vận tốc dọc mong muốn (P trên sai số vận tốc, đổi ra gia tốc).
  const vDes = descentProfile(altitude);
  const errorUp = vDes - vertical; // dương = đang rơi nhanh hơn hồ sơ ⇒ cần hãm
  // Chỉ bao giờ đốt để HÃM. Nếu đã chậm hơn hồ sơ thì để trọng lực kéo, ga = 0 — nếu đốt
  // để "rơi nhanh hơn" thì tàu lơ lửng, đốt sạch nhiên liệu mà không xuống.
  const accelWant = clamp(errorUp / 1.2, 0, 14);
  const accelRoom = accelWant + gravity - dragUp;
  const throttle =
    accelWant > 0
      ? Math.min(clamp((accelRoom * mass) / (thrustMax * noseUp), 0, 1), throttleG)
      : 0;
  const throttlePct = Math.round(throttle * 100);

  const level = marginM < 1_500 ? 'warn' : 'ok';
  const detail =
    marginM < 1_500
      ? `Cần ${Math.round(stopDistanceM)} m để hãm · còn ${Math.round(altitude)} m — sát giới hạn`
      : `Giữ tốc độ rơi ${Math.abs(vDes)} m/s · hãm được trong ${Math.round(stopDistanceM)} m, còn ${Math.round(altitude)} m`;

  return {
    throttlePct,
    action: throttlePct > 0 ? 'throttle' : 'coast',
    headline: throttlePct > 0 ? `GA ${throttlePct} %` : 'GA 0 %',
    detail,
    level,
    stopDistanceM,
    marginM,
  };
}

/**
 * Dự đoán độ cao mà tốc độ rơi xuống dưới ngưỡng mở dù hãm, giả định đuôi dẫn đầu.
 * Tích phân 1 chiều rất nhẹ (chỉ chạy mỗi khung hình), dùng đúng `atmosphere` và
 * `dragCoefficient` của game. `null` = lực cản không đủ trước khi chạm đất.
 */
export function predictDrogueAltitude({ altitude, speed, mass, verticalSpeed = -1 }) {
  if (!(altitude > 0) || !(speed > 0) || !(mass > 0)) return null;
  if (speed <= AERO.drogueMaxSpeed) return altitude;
  if (verticalSpeed >= 0) return null;

  let height = altitude;
  let velocity = speed;
  const dt = 0.2;

  for (let step = 0; step < 25_000 && height > 0; step++) {
    const atmo = atmosphere(height);
    const cd = dragCoefficient(velocity / atmo.soundSpeed);
    const dragArea = AERO.referenceArea * cd * AERO.baseFirstDragFactor;
    const dragAccel = (0.5 * atmo.density * velocity * velocity * dragArea) / mass;
    velocity += (G0 - dragAccel) * dt;
    if (velocity < 0) velocity = 0;
    height -= velocity * dt;
    if (velocity <= AERO.drogueMaxSpeed) return Math.max(0, height);
  }
  return null;
}

/** Dù có mở được ngay không (chỉ tầng 2 có dù). */
export function chuteReady(rocket, altitude, speed) {
  const hasChute = Boolean(rocket?.stages?.[rocket.active]?.hasChute);
  const drogueOpen = Boolean(rocket?.drogueDeployed);
  const mainOpen = Boolean(rocket?.chuteDeployed);
  return {
    hasChute,
    drogueOpen,
    mainOpen,
    canDrogue: hasChute && !drogueOpen && altitude <= AERO.drogueDeployAltitude && speed <= AERO.drogueMaxSpeed,
    canMain: hasChute && !mainOpen && altitude <= AERO.mainChuteDeployAltitude && speed <= AERO.mainChuteMaxSpeed,
  };
}

/** Có nên cảnh báo quá nhiệt / quá tải ngay lúc này không (dùng cho panel). */
export function limitWarnings(sim) {
  const rocket = sim.rocket;
  const heat = rocket?.heat ?? 0;
  const gLoad = sim.last?.gLoad ?? 0;
  const warnings = [];
  if (heat > LIMITS.maxHeat * 0.9) warnings.push(`Nhiệt vỏ ${Math.round(heat)} °C sát ngưỡng ${LIMITS.maxHeat} °C`);
  else if (heat > 600) warnings.push(`Nhiệt vỏ ${Math.round(heat)} °C`);
  if (gLoad > LIMITS.maxGLoad * 0.9) warnings.push(`Quá tải ${gLoad.toFixed(1)} g sát ngưỡng ${LIMITS.maxGLoad} g`);
  if ((sim.last?.speed ?? 0) > AERO.drogueMaxSpeed && (sim.last?.altitudeAboveGround ?? 0) < 12_000) {
    warnings.push('Còn quá nhanh để mở dù hãm');
  }
  return warnings;
}

export { G0 };
