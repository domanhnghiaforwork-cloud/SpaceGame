/**
 * Camera 2D: giữ tên lửa ở tâm màn hình và tự động thu nhỏ theo độ cao, từ vài
 * trăm mét quanh bệ phóng tới toàn bộ Trái Đất khi đã vào quỹ đạo.
 */

import { toEarthFrame } from './world.js';

const MIN_SCALE = 7.2e-5;
const MAX_SCALE = 2.2;
const REFERENCE_SIZE = 900;
/** Góc nhìn gần: tỉ lệ cố định, khung rộng khoảng 350–500 m tuỳ bề ngang canvas. */
const NEAR_SCALE = 2.4;

export const CAMERA_MODES = { far: 'far', near: 'near' };

export function createCamera() {
  return {
    x: 0,
    y: 0,
    rotation: 0,
    /** 'far' tự thu nhỏ theo độ cao, 'near' khoá tỉ lệ để luôn thấy chi tiết. */
    mode: CAMERA_MODES.far,
    /** Hệ số zoom tay (0,5×–3×), chỉ áp dụng ở góc nhìn xa. */
    zoom: 1,
    scale: MAX_SCALE,
    targetScale: MAX_SCALE,
    width: 0,
    height: 0,
  };
}

/** Đặt góc nhìn; chuyển mượt nhờ cùng cơ chế làm mịn của updateCamera. */
export function setCameraMode(camera, mode) {
  camera.mode = mode === CAMERA_MODES.near ? CAMERA_MODES.near : CAMERA_MODES.far;
  return camera.mode;
}

/** Hệ số zoom tay trong khoảng cho phép. */
export const ZOOM_RANGE = { min: 0.5, max: 3 };

/** Đặt zoom tay (chỉ có tác dụng ở góc nhìn xa). Trả về giá trị sau khi kẹp. */
export function setZoom(camera, zoom) {
  camera.zoom = Math.min(ZOOM_RANGE.max, Math.max(ZOOM_RANGE.min, Number(zoom) || 1));
  return camera.zoom;
}

export function toggleCameraMode(camera) {
  return setCameraMode(camera, camera.mode === CAMERA_MODES.near ? CAMERA_MODES.far : CAMERA_MODES.near);
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
  camera.targetScale =
    camera.mode === CAMERA_MODES.near
      ? NEAR_SCALE * sizeFactor
      : scaleForAltitude(altitude) * sizeFactor * camera.zoom;
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
