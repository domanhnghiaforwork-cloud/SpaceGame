/**
 * Khí quyển Trái Đất: khối lượng riêng, áp suất, nhiệt độ, vận tốc âm và hệ số cản
 * theo Mach. Bảng theo Khí quyển Chuẩn Quốc tế (ISA), nội suy hàm mũ giữa các mốc.
 */

import { EARTH } from './constants.js';

const GAMMA = 1.4;
const R_AIR = 287.052_874;

/** [độ cao m, khối lượng riêng kg/m³, áp suất Pa, nhiệt độ K] */
const PROFILE = [
  [0, 1.225, 101_325, 288.15],
  [1_000, 1.1117, 89_876, 281.65],
  [2_000, 1.0066, 79_501, 275.15],
  [3_000, 0.9093, 70_121, 268.65],
  [4_000, 0.8194, 61_660, 262.15],
  [5_000, 0.7364, 54_048, 255.65],
  [6_000, 0.6601, 47_217, 249.15],
  [7_000, 0.59, 41_105, 242.65],
  [8_000, 0.5258, 35_652, 236.15],
  [9_000, 0.4671, 30_801, 229.65],
  [10_000, 0.4135, 26_500, 223.15],
  [11_000, 0.3648, 22_699, 216.65],
  [15_000, 0.1948, 12_045, 216.65],
  [20_000, 0.08803, 5_474.9, 216.65],
  [25_000, 0.04008, 2_511.0, 221.55],
  [30_000, 0.01841, 1_171.9, 226.51],
  [40_000, 0.003996, 277.52, 250.35],
  [50_000, 0.001027, 75.944, 270.65],
  [60_000, 3.097e-4, 20.314, 247.02],
  [70_000, 8.283e-5, 5.1925, 219.58],
  [80_000, 1.846e-5, 1.0525, 198.64],
  [90_000, 3.416e-6, 0.16017, 186.87],
  [100_000, 5.606e-7, 0.031503, 195.08],
  [120_000, 1.9e-8, 2.5e-3, 300],
  [150_000, 2.1e-9, 4.5e-6, 600],
  [200_000, 2.5e-10, 2.5e-7, 800],
  [300_000, 1.9e-11, 1.7e-8, 900],
  [500_000, 5e-13, 2e-10, 900],
  [1_000_000, 1e-15, 1e-12, 900],
];

/** Hệ số cản Cd theo Mach; tăng vọt ở vùng transonic. */
const CD_TABLE = [
  [0, 0.3],
  [0.8, 0.3],
  [1.0, 0.58],
  [1.1, 0.62],
  [1.5, 0.52],
  [2, 0.42],
  [3, 0.34],
  [5, 0.3],
  [10, 0.28],
];

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Nội suy tuyến tính theo trục x trên bảng [x, y]. */
export function linear(table, x) {
  if (x <= table[0][0]) return table[0][1];
  const last = table[table.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < table.length; i++) {
    const [x1, y1] = table[i];
    if (x <= x1) {
      const [x0, y0] = table[i - 1];
      return lerp(y0, y1, (x - x0) / (x1 - x0));
    }
  }
  return last[1];
}

/** Nội suy log-tuyến tính (khí quyển giảm theo hàm mũ giữa hai mốc). */
function logLinear(x, pick) {
  if (x <= 0) return pick(PROFILE[0]);
  if (x >= EARTH.ATM_TOP) return 0;
  for (let i = 1; i < PROFILE.length; i++) {
    const h1 = PROFILE[i][0];
    if (x <= h1) {
      const rowA = PROFILE[i - 1];
      const rowB = PROFILE[i];
      const t = (x - rowA[0]) / (h1 - rowA[0]);
      const a = pick(rowA);
      const b = pick(rowB);
      if (a <= 0 || b <= 0) return 0;
      return a * (b / a) ** t;
    }
  }
  return 0;
}

function temperature(h) {
  for (let i = 1; i < PROFILE.length; i++) {
    if (h <= PROFILE[i][0]) {
      const [h0, , , t0] = PROFILE[i - 1];
      const [h1, , , t1] = PROFILE[i];
      return lerp(t0, t1, (h - h0) / (h1 - h0));
    }
  }
  return 900;
}

/**
 * Toàn bộ trạng thái khí quyển tại độ cao `h` (mét).
 * Trên 1 000 km coi là chân không tuyệt đối.
 */
export function atmosphere(h) {
  const alt = h < 0 ? 0 : h;
  if (alt >= EARTH.ATM_TOP) {
    return { density: 0, pressure: 0, temperature: 900, soundSpeed: Math.sqrt(GAMMA * R_AIR * 900) };
  }
  const density = logLinear(alt, (row) => row[1]);
  const pressure = logLinear(alt, (row) => row[2]);
  const t = temperature(alt);
  return { density, pressure, temperature: t, soundSpeed: Math.sqrt(GAMMA * R_AIR * t) };
}

export function dragCoefficient(mach) {
  return linear(CD_TABLE, mach);
}

/** Độ cao mà tại đó khối lượng riêng còn `fraction` của mực nước biển. */
export function scaleHeight() {
  return 8_500;
}
