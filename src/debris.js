/**
 * Mảnh tách tầng: sau khi tách, tầng đã dùng là một vật thể riêng chịu trọng lực,
 * lực cản của khí quyển (quay cùng Trái Đất) và gia nhiệt khí động, đồng thời quay
 * chậm khi rơi. Mảnh sống trong `sim.debris` nên tua thời gian cũng bước nó như
 * tên lửa; chạm đất thì tóe bụi rồi biến mất.
 *
 * Lõi thuần, không chạm DOM — cùng ranh giới với phần mô phỏng còn lại.
 */

import { EARTH, LIMITS } from './constants.js';
import { atmosphere, dragCoefficient } from './atmosphere.js';
import { relativeVelocity } from './world.js';
import { heatFlux, equilibriumHeat } from './rocket.js';

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Mảnh rơi xoay ngang nên cản nhiều hơn thân có mũi khí động. */
const DRAG_AREA_FACTOR = 1.35;
/** Giây để bụi hoặc vệt cháy mờ hẳn sau khi chạm đất / bốc cháy. */
const FADE_TIME = 1.6;
/** Bước nội bộ tối đa khi tua nhanh, để mảnh không nhảy cóc qua mặt đất. */
const MAX_SUBSTEP = 0.5;

/** Đẩy mảnh ra sau đuôi tên lửa một chút để nhìn thấy nó rời ra. */
const SEPARATION_KICK = 2.4;

/**
 * Tạo mảnh cho tầng vừa được tách (`rocket.active - 1`). Gọi ngay sau `separateStage`.
 * Trả về mảnh vừa tạo, hoặc null nếu không có tầng nào vừa tách.
 */
export function spawnSeparatedStage(sim) {
  const index = sim.rocket.active - 1;
  const stage = sim.rocket.stages[index];
  if (index < 0 || !stage || !stage.separated) return null;

  const { body, rocket } = sim;
  const backX = -Math.cos(body.theta);
  const backY = -Math.sin(body.theta);
  const offset = stage.length / 2;

  const piece = {
    name: stage.name,
    length: stage.length,
    diameter: stage.diameter,
    mass: stage.dryMass,
    x: body.x + backX * offset,
    y: body.y + backY * offset,
    vx: body.vx + backX * SEPARATION_KICK,
    vy: body.vy + backY * SEPARATION_KICK,
    theta: body.theta,
    omega: body.omega * 0.4 + 0.12,
    heat: rocket.heat,
    status: 'falling',
    timer: 0,
    impactSpeed: 0,
    impactAngle: 0,
    separatedAt: sim.time,
  };

  sim.debris.push(piece);
  sim.events.push({ type: 'stage-separated', name: stage.name, time: sim.time });
  return piece;
}

function integrate(piece, h) {
  const r = Math.hypot(piece.x, piece.y);
  const altitude = r - EARTH.RADIUS;
  const atmo = atmosphere(altitude);
  const rel = relativeVelocity(piece.x, piece.y, piece.vx, piece.vy);
  const speed = Math.hypot(rel.x, rel.y);
  const mach = speed / atmo.soundSpeed;
  const area = Math.PI * (piece.diameter / 2) ** 2 * DRAG_AREA_FACTOR;
  const dragForce = 0.5 * atmo.density * speed * speed * dragCoefficient(mach) * area;

  const r3 = r * r * r;
  let ax = (-EARTH.MU * piece.x) / r3;
  let ay = (-EARTH.MU * piece.y) / r3;
  if (speed > 1e-6) {
    ax += (-dragForce * rel.x) / speed / piece.mass;
    ay += (-dragForce * rel.y) / speed / piece.mass;
  }

  piece.vx += ax * h;
  piece.vy += ay * h;
  piece.x += piece.vx * h;
  piece.y += piece.vy * h;

  // Mảnh xoay chậm dần khi gặp không khí, còn trong chân không thì giữ nguyên tốc độ quay.
  const spinDrag = clamp((atmo.density / EARTH.SEA_LEVEL_DENSITY) * 2, 0, 1);
  piece.omega *= 1 - 0.6 * spinDrag * h;
  piece.theta = (piece.theta + piece.omega * h) % TAU;

  const target = Math.max(15, equilibriumHeat(heatFlux(atmo.density, speed)));
  piece.heat += (target - piece.heat) * Math.min(1, h / 12);

  if (piece.heat > LIMITS.maxHeat) {
    piece.status = 'burned';
    piece.timer = 0;
    return;
  }

  // Kiểm tra chạm đất bằng bán kính SAU khi đã bước, nếu dùng bán kính trước bước
  // thì mảnh bị kẹp xuống dưới mặt đất đúng phần vừa rơi trong bước đó.
  const rAfter = Math.hypot(piece.x, piece.y);
  const surface = EARTH.RADIUS + piece.length / 2;
  if (rAfter <= surface) {
    const scale = surface / rAfter;
    piece.x *= scale;
    piece.y *= scale;
    piece.vx = 0;
    piece.vy = 0;
    piece.omega = 0;
    piece.status = 'landed';
    piece.timer = 0;
    piece.impactSpeed = speed;
  }
}

/** Bước một mảnh vỡ. `dt` có thể lớn (tua 1000×) nên chia thành bước nội bộ nhỏ. */
export function stepDebris(piece, dt) {
  if (piece.status === 'gone') return piece.status;
  if (piece.status !== 'falling') {
    piece.timer += dt;
    if (piece.timer > FADE_TIME) piece.status = 'gone';
    return piece.status;
  }

  const steps = Math.max(1, Math.ceil(dt / MAX_SUBSTEP));
  const h = dt / steps;
  for (let i = 0; i < steps && piece.status === 'falling'; i++) integrate(piece, h);
  return piece.status;
}

/** Số mảnh còn đang rơi (dùng cho HUD/nhãn nếu cần). */
export function fallingDebris(debris) {
  return debris.filter((piece) => piece.status === 'falling').length;
}
