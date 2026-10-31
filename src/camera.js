/**
 * Camera 2D: giữ tên lửa ở tâm màn hình và tự động thu nhỏ theo độ cao, từ vài
 * trăm mét quanh bệ phóng tới toàn bộ Trái Đất khi đã vào quỹ đạo.
 */

import { toEarthFrame } from './world.js';

const MIN_SCALE = 7.2e-5;
const MAX_SCALE = 2.2;
const REFERENCE_SIZE = 900;

export function createCamera() {
  return {
    x: 0,
    y: 0,
    rotation: 0,
    scale: MAX_SCALE,
    targetScale: MAX_SCALE,
    width: 0,
    height: 0,
  };
}

/** Tỉ lệ điểm ảnh trên mét mong muốn tại độ cao `h` (m). */
export function scaleForAltitude(h) {
  const altitude = h < 0 ? 0 : h;
  const t = Math.log10(1 + altitude / 200) / Math.log10(1 + 400_000 / 200);
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.exp(Math.log(MAX_SCALE) + (Math.log(MIN_SCALE) - Math.log(MAX_SCALE)) * clamped);
}

export function updateCamera(camera, sim, dt, width, height) {
  camera.width = width;
  camera.height = height;
  const altitude = Math.max(0, sim.last.altitudeAboveGround ?? 0);
  const sizeFactor = Math.min(width, height) / REFERENCE_SIZE;
  camera.targetScale = scaleForAltitude(altitude) * sizeFactor;
  const blend = 1 - Math.exp(-dt / 0.45);
  camera.scale += (camera.targetScale - camera.scale) * blend;

  const point = toEarthFrame(sim.body.x, sim.body.y, sim.time);
  camera.x = point.x;
  camera.y = point.y;
  // Xoay cả cảnh để phương thẳng đứng tại vị trí tên lửa luôn hướng lên màn hình.
  camera.rotation = Math.PI / 2 - Math.atan2(point.y, point.x);
}

/** Góc trên màn hình của một hướng có góc `worldAngle` trong hệ quay cùng Trái Đất. */
export function screenAngle(camera, worldAngle) {
  return -(worldAngle + camera.rotation);
}

export function worldToScreen(camera, x, y) {
  const dx = x - camera.x;
  const dy = y - camera.y;
  const c = Math.cos(camera.rotation);
  const s = Math.sin(camera.rotation);
  const rx = dx * c - dy * s;
  const ry = dx * s + dy * c;
  return {
    x: camera.width / 2 + rx * camera.scale,
    y: camera.height / 2 - ry * camera.scale,
  };
}

export function screenToWorld(camera, x, y) {
  const dx = (x - camera.width / 2) / camera.scale;
  const dy = -(y - camera.height / 2) / camera.scale;
  const c = Math.cos(camera.rotation);
  const s = Math.sin(camera.rotation);
  return {
    x: camera.x + dx * c + dy * s,
    y: camera.y - dx * s + dy * c,
  };
}
