/**
 * Lõi vật lý: hệ quán tính địa tâm, tích phân Runge–Kutta bậc 4.
 * Trọng lực Newton, lực đẩy có hiệu chỉnh áp suất, lực cản của khí quyển quay
 * cùng Trái Đất (nên hiệu ứng Coriolis xuất hiện tự nhiên), mô men điều khiển,
 * gia nhiệt khí động và tiếp đất.
 */

import {
  EARTH,
  G0,
  AERO,
  ATTITUDE,
  LIMITS,
  RCS,
  PAD_LANDING_RADIUS,
} from './constants.js';
import { atmosphere, dragCoefficient } from './atmosphere.js';
import {
  createRocket,
  rocketMass,
  rocketLength,
  engineOutput,
  consumeFuel,
  consumeRcs,
  updateThermal,
  updateChute,
  trackGLoad,
} from './rocket.js';
import { nearestPad, toEarthFrame, relativeVelocity } from './world.js';
import { stepDebris } from './debris.js';

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

/** Vận tốc so với mặt đất/mặt khí quyển — định nghĩa nằm ở world.js, xuất lại cho tương thích. */
export { relativeVelocity };

/**
 * Gia tốc trọng trường ở bán kính `r` tính từ tâm Trái Đất (m/s²): g = μ/r².
 * Một chỗ duy nhất cho cả HUD và nhãn các vòng độ cao.
 */
export function gravityAt(radius) {
  return EARTH.MU / (radius * radius);
}

export function createSimulation(world, padIndex = 0) {
  const pad = world.pads[padIndex];
  const rocket = createRocket();
  const radius = EARTH.RADIUS + clearance(rocket, 0);
  const angle = pad.angle;
  return {
    time: 0,
    world,
    padIndex,
    pad,
    rocket,
    body: {
      x: radius * Math.cos(angle),
      y: radius * Math.sin(angle),
      vx: -EARTH.OMEGA * radius * Math.sin(angle),
      vy: EARTH.OMEGA * radius * Math.cos(angle),
      theta: angle,
      omega: 0,
    },
    status: 'ready',
    failure: '',
    controls: { pitch: 0 },
    last: {
      altitude: 0,
      altitudeAboveGround: 0,
      speed: 0,
      verticalSpeed: 0,
      horizontalSpeed: 0,
      airspeed: 0,
      mach: 0,
      dynamicPressure: 0,
      thrust: 0,
      mass: rocketMass(rocket),
      gLoad: 0,
      tilt: 0,
      clearance: clearance(rocket, 0),
      orbit: null,
    },
    orbitAngle: 0,
    lastPolarAngle: angle,
    bestEccentricity: Infinity,
    peakAltitude: 0,
    peakSpeed: 0,
    peakDynamicPressure: 0,
    touchdown: null,
    impact: null,
    airborne: false,
    events: [],
    debris: [],
    trail: [],
  };
}

/**
 * Hướng tên lửa so với dòng khí. Khi bay ngược (đuôi dẫn đầu) tấm chắn nhiệt ở
 * đáy vỏ hứng dòng khí: lực cản tăng, thông lượng nhiệt giảm.
 */
export function flowAttitude(body, env) {
  if (env.airspeed < 1e-6) return { aoa: 0, baseFactor: 0 };
  const flowAngle = Math.atan2(env.vry, env.vrx);
  const aoa = angleDiff(body.theta, flowAngle);
  const baseFactor = clamp((Math.abs(aoa) - Math.PI / 2) / (Math.PI / 2), 0, 1);
  return { aoa, baseFactor };
}

function environment(state) {
  const r = Math.hypot(state.x, state.y);
  const altitude = r - EARTH.RADIUS;
  const atmo = atmosphere(altitude);
  const rel = relativeVelocity(state.x, state.y, state.vx, state.vy);
  const airspeed = Math.hypot(rel.x, rel.y);
  return { r, altitude, atmo, vrx: rel.x, vry: rel.y, airspeed, mach: airspeed / atmo.soundSpeed };
}

/** Gia tốc và gia tốc góc tại một trạng thái (dùng cho bốn bước RK4). */
function derive(state, rocket, engine, env, pitch) {
  const r3 = env.r * env.r * env.r;
  const mass = rocketMass(rocket);

  const gravityX = (-EARTH.MU * state.x) / r3;
  const gravityY = (-EARTH.MU * state.y) / r3;

  const cd = dragCoefficient(env.mach);
  const { baseFactor } = flowAttitude(state, env);
  const shieldFactor = 1 + (AERO.baseFirstDragFactor - 1) * baseFactor;
  const dragArea = (AERO.referenceArea * cd + AERO.chuteDragArea * rocket.chuteOpen) * shieldFactor;
  const dynamicPressure = 0.5 * env.atmo.density * env.airspeed * env.airspeed;
  const dragForce = dynamicPressure * dragArea;

  let dragAx = 0;
  let dragAy = 0;
  if (env.airspeed > 1e-6) {
    dragAx = (-dragForce * env.vrx) / env.airspeed / mass;
    dragAy = (-dragForce * env.vry) / env.airspeed / mass;
  }

  const thrustAccel = engine.thrust / mass;
  const thrustAx = thrustAccel * Math.cos(state.theta);
  const thrustAy = thrustAccel * Math.sin(state.theta);

  const finAuthority = ATTITUDE.finAuthority * clamp(dynamicPressure / 20_000, 0, 1);
  // Gimbal lo phần nghiêng khi động cơ đang cháy (không tốn khí); động cơ tắt thì RCS làm,
  // và RCS chỉ còn mô men khi trong bình còn khí. Hết khí: chỉ trông vào cánh lái khí động.
  const thrusterAuthority = engine.on
    ? ATTITUDE.gimbalAuthority
    : rocket.rcs > 0
      ? RCS.authority
      : 0;
  let alpha =
    clamp(pitch, -1, 1) * (thrusterAuthority + finAuthority) - ATTITUDE.damping * state.omega;

  if (env.airspeed > 10 && env.atmo.density > 1e-9) {
    const { aoa } = flowAttitude(state, env);
    const strength = clamp(dynamicPressure / 20_000, 0, 1.5);
    alpha -= ATTITUDE.stabilityTorque * Math.sin(aoa) * strength;
  }

  return {
    dx: state.vx,
    dy: state.vy,
    dvx: gravityX + dragAx + thrustAx,
    dvy: gravityY + dragAy + thrustAy,
    dtheta: state.omega,
    domega: alpha,
    dragAx,
    dragAy,
    thrustAx,
    thrustAy,
    dragForce,
    thrustForce: engine.thrust,
    dynamicPressure,
    dragArea,
  };
}

function rk4(body, rocket, engine, env, pitch, dt) {
  const k1 = derive(body, rocket, engine, env, pitch);

  const s2 = {
    x: body.x + (k1.dx * dt) / 2,
    y: body.y + (k1.dy * dt) / 2,
    vx: body.vx + (k1.dvx * dt) / 2,
    vy: body.vy + (k1.dvy * dt) / 2,
    theta: body.theta + (k1.dtheta * dt) / 2,
    omega: body.omega + (k1.domega * dt) / 2,
  };
  const k2 = derive(s2, rocket, engine, env, pitch);

  const s3 = {
    x: body.x + (k2.dx * dt) / 2,
    y: body.y + (k2.dy * dt) / 2,
    vx: body.vx + (k2.dvx * dt) / 2,
    vy: body.vy + (k2.dvy * dt) / 2,
    theta: body.theta + (k2.dtheta * dt) / 2,
    omega: body.omega + (k2.domega * dt) / 2,
  };
  const k3 = derive(s3, rocket, engine, env, pitch);

  const s4 = {
    x: body.x + k3.dx * dt,
    y: body.y + k3.dy * dt,
    vx: body.vx + k3.dvx * dt,
    vy: body.vy + k3.dvy * dt,
    theta: body.theta + k3.dtheta * dt,
    omega: body.omega + k3.domega * dt,
  };
  const k4 = derive(s4, rocket, engine, env, pitch);

  const sixth = dt / 6;
  body.x += sixth * (k1.dx + 2 * k2.dx + 2 * k3.dx + k4.dx);
  body.y += sixth * (k1.dy + 2 * k2.dy + 2 * k3.dy + k4.dy);
  body.vx += sixth * (k1.dvx + 2 * k2.dvx + 2 * k3.dvx + k4.dvx);
  body.vy += sixth * (k1.dvy + 2 * k2.dvy + 2 * k3.dvy + k4.dvy);
  body.theta += sixth * (k1.dtheta + 2 * k2.dtheta + 2 * k3.dtheta + k4.dtheta);
  body.omega += sixth * (k1.domega + 2 * k2.domega + 2 * k3.domega + k4.domega);

  body.omega = clamp(body.omega, -ATTITUDE.maxRate, ATTITUDE.maxRate);
  body.theta = (((body.theta + Math.PI) % TAU) + TAU) % TAU - Math.PI;

  return k1;
}

/** Khoảng cách từ tâm khối tới điểm thấp nhất của tên lửa theo phương thẳng đứng. */
export function clearance(rocket, tilt = 0) {
  const half = rocketLength(rocket) / 2;
  return half * Math.cos(Math.abs(tilt)) + 2;
}

function handleGround(sim, dt, env) {
  const { body, rocket } = sim;
  const r = Math.hypot(body.x, body.y);
  const upX = body.x / r;
  const upY = body.y / r;
  const tanX = -upY;
  const tanY = upX;
  const localUpAngle = Math.atan2(body.y, body.x);
  const tilt = angleDiff(body.theta, localUpAngle);
  const bottom = clearance(rocket, tilt);
  const surface = EARTH.RADIUS;

  if (r - bottom > surface + 0.05) return false;

  const rel = relativeVelocity(body.x, body.y, body.vx, body.vy);
  const radialSpeed = rel.x * upX + rel.y * upY;
  let tangentialSpeed = rel.x * tanX + rel.y * tanY;
  const groundSpeed = Math.hypot(rel.x, rel.y);
  const engine = engineOutput(rocket, env.atmo.pressure);

  const wanted = (surface + bottom) / r;
  body.x *= wanted;
  body.y *= wanted;

  // Ràng buộc mặt đất: không xuyên xuống dưới, ma sát cản chuyển động ngang.
  const radialAfter = Math.max(0, radialSpeed);
  const friction = 0.8 * G0 * dt;
  if (Math.abs(tangentialSpeed) <= friction) tangentialSpeed = 0;
  else tangentialSpeed -= Math.sign(tangentialSpeed) * friction;

  const relX = upX * radialAfter + tanX * tangentialSpeed;
  const relY = upY * radialAfter + tanY * tangentialSpeed;
  body.vx = relX - EARTH.OMEGA * body.y;
  body.vy = relY + EARTH.OMEGA * body.x;

  // Còn trên bệ, chưa cất cánh: chưa xét hư hỏng hay tiếp đất.
  if (!sim.airborne) return true;

  if (!sim.impact) {
    sim.impact = { speed: groundSpeed, tilt, time: sim.time };
    if (groundSpeed > LIMITS.maxTouchSpeed) {
      destroy(sim, 'Tốc độ chạm đất quá cao');
    } else if (Math.abs(tilt) > LIMITS.maxTouchTilt) {
      destroy(sim, 'Thân tên lửa nghiêng quá góc khi chạm đất');
    }
  }

  if (sim.status === 'destroyed') return true;

  const resting = Math.hypot(relX, relY) < 0.8;
  const thrustBeatsWeight = engine.on && engine.thrust > rocketMass(rocket) * G0;

  if (!sim.touchdown && resting) {
    sim.touchdown = {
      speed: sim.impact.speed,
      tilt: sim.impact.tilt,
      time: sim.time,
      x: body.x,
      y: body.y,
    };
    sim.status = 'landed';
  } else if (sim.status === 'landed' && thrustBeatsWeight) {
    sim.status = 'flying';
    sim.touchdown = null;
    sim.impact = null;
  }
  return true;
}

export function destroy(sim, reason) {
  if (sim.status === 'destroyed') return;
  sim.status = 'destroyed';
  sim.failure = reason;
  sim.rocket.throttle = 0;
  sim.destroyedAt = sim.time;
  sim.events.push({ type: 'destroyed', reason, time: sim.time });
}

export function stepSimulation(sim, dt) {
  if (sim.status === 'destroyed') {
    sim.time += dt;
    return;
  }

  if (sim.status === 'landed') {
    const env = environment(sim.body);
    const engine = engineOutput(sim.rocket, env.atmo.pressure);
    const thrustBeatsWeight = engine.on && engine.thrust > rocketMass(sim.rocket) * G0;
    if (!thrustBeatsWeight) {
      updateChute(sim.rocket, dt);
      updateThermal(sim.rocket, env.atmo.density, env.airspeed, dt, 1);
      sim.time += dt;
      return;
    }
    sim.status = 'flying';
    sim.touchdown = null;
    sim.impact = null;
    sim.airborne = true;
  }

  const env = environment(sim.body);
  const engine = engineOutput(sim.rocket, env.atmo.pressure);
  const mass = rocketMass(sim.rocket);

  const k1 = rk4(sim.body, sim.rocket, engine, env, sim.controls.pitch, dt);

  if (sim.debris.length) {
    for (let i = sim.debris.length - 1; i >= 0; i--) {
      if (stepDebris(sim.debris[i], dt) === 'gone') sim.debris.splice(i, 1);
    }
  }

  if (engine.on) consumeFuel(sim.rocket, engine.massFlow, dt);
  else {
    // Chỉ những cú nghiêng đủ lớn mới tốn khí; xung trim nhỏ coi như không đáng kể.
    const demand = Math.abs(sim.controls.pitch);
    if (demand >= RCS.deadband) consumeRcs(sim.rocket, demand, dt);
  }
  updateChute(sim.rocket, dt);
  const { baseFactor } = flowAttitude(sim.body, env);
  updateThermal(
    sim.rocket,
    env.atmo.density,
    env.airspeed,
    dt,
    1 - (1 - AERO.baseFirstHeatFactor) * baseFactor,
  );
  trackGLoad(
    sim.rocket,
    Math.hypot(k1.thrustAx + k1.dragAx, k1.thrustAy + k1.dragAy) / G0,
  );

  sim.time += dt;

  const after = environment(sim.body);
  const polar = Math.atan2(sim.body.y, sim.body.x);
  if (after.altitude > 100_000) {
    sim.orbitAngle += angleDiff(polar, sim.lastPolarAngle);
  }
  sim.lastPolarAngle = polar;

  const tilt = angleDiff(sim.body.theta, polar);
  const bottom = clearance(sim.rocket, tilt);
  const altitudeAboveGround = after.altitude - bottom;

  if (sim.status === 'ready' && altitudeAboveGround > 20) {
    sim.status = 'flying';
    sim.airborne = true;
  }

  handleGround(sim, dt, after);

  if (altitudeAboveGround > sim.peakAltitude) sim.peakAltitude = altitudeAboveGround;
  if (after.airspeed > sim.peakSpeed) sim.peakSpeed = after.airspeed;
  const q = 0.5 * after.atmo.density * after.airspeed ** 2;
  if (q > sim.peakDynamicPressure) sim.peakDynamicPressure = q;

  const orbit = orbitFromState(sim.body.x, sim.body.y, sim.body.vx, sim.body.vy);
  if (orbit.periapsis > 50_000 && orbit.eccentricity < sim.bestEccentricity) {
    sim.bestEccentricity = orbit.eccentricity;
  }

  const radialSpeed = (sim.body.vx * sim.body.x + sim.body.vy * sim.body.y) / after.r;
  const tangentialSpeed = (after.vrx * -sim.body.y + after.vry * sim.body.x) / after.r;

  sim.last = {
    altitude: after.altitude,
    altitudeAboveGround,
    speed: after.airspeed,
    verticalSpeed: radialSpeed,
    horizontalSpeed: tangentialSpeed,
    airspeed: after.airspeed,
    mach: after.mach,
    dynamicPressure: q,
    thrust: engine.thrust,
    mass,
    tilt,
    clearance: bottom,
    gravity: gravityAt(after.r),
    gLoad: Math.hypot(k1.thrustAx + k1.dragAx, k1.thrustAy + k1.dragAy) / G0,
    orbit,
    density: after.atmo.density,
    pressure: after.atmo.pressure,
  };

  if (after.altitude > LIMITS.maxAltitude) destroy(sim, 'Tên lửa rời khỏi vùng mô phỏng');
  if (sim.rocket.heat > LIMITS.maxHeat) destroy(sim, 'Vỏ tên lửa quá nhiệt');
  if (sim.rocket.peakGLoad > LIMITS.maxGLoad && sim.status === 'flying') {
    destroy(sim, 'Quá tải G phá huỷ cấu trúc');
  }
}

/** Các phần tử quỹ đạo Kepler trong mặt phẳng 2D. */
export function orbitFromState(x, y, vx, vy) {
  const r = Math.hypot(x, y);
  const v2 = vx * vx + vy * vy;
  const energy = v2 / 2 - EARTH.MU / r;
  const h = x * vy - y * vx;
  const eccSq = 1 + (2 * energy * h * h) / (EARTH.MU * EARTH.MU);
  const eccentricity = Math.sqrt(Math.max(0, eccSq));
  const a = -EARTH.MU / (2 * energy);
  const closed = energy < 0;
  return {
    energy,
    angularMomentum: h,
    semiMajorAxis: a,
    eccentricity,
    periapsis: closed ? a * (1 - eccentricity) - EARTH.RADIUS : -EARTH.RADIUS,
    apoapsis: closed ? a * (1 + eccentricity) - EARTH.RADIUS : Infinity,
    period: closed ? TAU * Math.sqrt((a * a * a) / EARTH.MU) : Infinity,
    circularSpeed: Math.sqrt(EARTH.MU / r),
  };
}

/** Vị trí hiện tại trong hệ quay cùng Trái Đất. */
export function earthPosition(sim, time = sim.time) {
  return toEarthFrame(sim.body.x, sim.body.y, time);
}

/** Đã hạ cánh trong khu hạ cánh của bệ phóng gần nhất chưa? */
export function isOnPad(sim) {
  const altitude = Math.hypot(sim.body.x, sim.body.y) - EARTH.RADIUS;
  if (altitude > 20_000) return false;
  const point = earthPosition(sim);
  const result = nearestPad(sim.world, point.x, point.y);
  return result.distance <= PAD_LANDING_RADIUS;
}
