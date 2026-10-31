/**
 * Tua thời gian: mức người chơi đặt từ thanh trượt và mức thực tế được áp dụng.
 *
 * Hàm thuần (chỉ đọc trạng thái mô phỏng) nên `verify.mjs` kiểm được — và đó là chỗ
 * giao diện lấy lý do khi tốc độ bị hạ, để người chơi không thấy thanh trượt “không
 * hoạt động” khi thực ra nó vẫn đổi ngay nhưng bị giới hạn an toàn.
 */

import { WARP_RANGE } from './constants.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Những mốc làm tốc độ tua bị hạ, kèm giới hạn tương ứng. */
export const WARP_CAPS = [
  { max: 1, belowAltitude: 3_000, reason: 'dưới 3 km hoặc đang có dù' },
  { max: 10, belowAltitude: 120_000, reason: 'dưới 120 km' },
];

/** Tốc độ tua thực tế sau khi áp các giới hạn an toàn. */
export function effectiveWarp(sim, warpRequested) {
  let warp = Math.max(WARP_RANGE.min, Number(warpRequested) || WARP_RANGE.min);
  const altitude = sim.last?.altitudeAboveGround ?? 0;
  if (altitude < 3_000 || (sim.rocket?.chuteOpen ?? 0) > 0.5) warp = Math.min(warp, 1);
  else if (altitude < 120_000) warp = Math.min(warp, 10);
  if ((sim.last?.thrust ?? 0) > 0) warp = Math.min(warp, 10);
  return clamp(warp, WARP_RANGE.min, WARP_RANGE.max);
}

/** Lý do tốc độ tua đang bị hạ so với mức đặt (chuỗi rỗng nếu không bị hạ). */
export function warpCapReason(sim) {
  const altitude = sim.last?.altitudeAboveGround ?? 0;
  if (altitude < 3_000 || (sim.rocket?.chuteOpen ?? 0) > 0.5) return 'dưới 3 km hoặc đang có dù';
  if (altitude < 120_000) return 'dưới 120 km';
  if ((sim.last?.thrust ?? 0) > 0) return 'đang cháy động cơ';
  return '';
}
