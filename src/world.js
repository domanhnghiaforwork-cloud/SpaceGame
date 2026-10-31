/**
 * Trái Đất và ba bệ phóng. Toạ độ thế giới là hệ quay cùng Trái Đất: bệ phóng
 * đứng yên tại góc cố định, còn vật lý chạy trong hệ quán tính (xem physics.js).
 */

import { EARTH, PAD_ANGLES, PAD_RADIUS } from './constants.js';

export function createWorld() {
  return {
    earthRadius: EARTH.RADIUS,
    pads: PAD_ANGLES.map((angle, index) => ({
      index,
      angle,
      x: EARTH.RADIUS * Math.cos(angle),
      y: EARTH.RADIUS * Math.sin(angle),
      radius: PAD_RADIUS,
      name: `Bệ phóng ${index + 1}`,
    })),
  };
}

export function groundRadius() {
  return EARTH.RADIUS;
}

/** Độ cao so với mực nước biển của một điểm trong hệ quay cùng Trái Đất. */
export function altitudeOf(x, y) {
  return Math.hypot(x, y) - EARTH.RADIUS;
}

/** Kinh độ (góc cực) của một điểm trong hệ quay cùng Trái Đất. */
export function groundAngle(x, y) {
  return Math.atan2(y, x);
}

/** Khoảng cách ăn theo mặt đất giữa hai điểm quanh tâm Trái Đất. */
export function surfaceDistance(angleA, angleB) {
  let d = angleA - angleB;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return Math.abs(d) * EARTH.RADIUS;
}

/** Bệ phóng gần nhất tính theo cung trên mặt đất. */
export function nearestPad(world, x, y) {
  const angle = groundAngle(x, y);
  let best = world.pads[0];
  let bestDistance = Infinity;
  for (const pad of world.pads) {
    const distance = surfaceDistance(angle, pad.angle);
    if (distance < bestDistance) {
      best = pad;
      bestDistance = distance;
    }
  }
  return { pad: best, distance: bestDistance };
}

/** Chuyển một điểm từ hệ quán tính sang hệ quay cùng Trái Đất. */export function toEarthFrame(x, y, time) {
  const a = -EARTH.OMEGA * time;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: x * c - y * s, y: x * s + y * c };
}

/** Chuyển một điểm từ hệ quay cùng Trái Đất sang hệ quán tính. */
export function toInertialFrame(x, y, time) {
  const a = EARTH.OMEGA * time;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: x * c - y * s, y: x * s + y * c };
}

/**
 * Vận tốc tương đối so với mặt đất và mặt khí quyển (khí quyển quay cùng Trái Đất).
 * Nằm ở đây vì là động học của Trái Đất, dùng chung cho tên lửa (physics.js) và mảnh vỡ.
 */
export function relativeVelocity(x, y, vx, vy) {
  return { x: vx + EARTH.OMEGA * y, y: vy - EARTH.OMEGA * x };
}
