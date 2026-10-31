/**
 * Hằng số vật lý Trái Đất và thông số tên lửa.
 * Mọi đơn vị là SI: mét, giây, kilôgam, Newton, radian.
 */

export const DEG = Math.PI / 180;
export const G0 = 9.80665;

export const EARTH = {
  RADIUS: 6_371_000,
  MU: 3.986004418e14,
  OMEGA: 7.2921159e-5,
  ATM_TOP: 1_000_000,
  SEA_LEVEL_PRESSURE: 101_325,
  SEA_LEVEL_DENSITY: 1.225,
};

/** Ba bệ phóng trên đường xích đạo, cách nhau 120°. */
export const PAD_ANGLES = [0, 120, 240].map((deg) => deg * DEG);
export const PAD_RADIUS = 45;
/** Bán kính khu hạ cánh quanh mỗi bệ phóng (m). */
export const PAD_LANDING_RADIUS = 5_000;

/**
 * Hai tầng tên lửa lấy thông số theo Falcon 9 Block 5 (thu nhỏ phần tải).
 * `thrustSL` dùng để suy ra diện tích vòi: F_chân_không − F_mặt_đất = p₀·A_vòi.
 */
export const STAGES = [
  {
    name: 'Tầng 1',
    dryMass: 25_600,
    propMass: 411_000,
    thrustVac: 8_227_000,
    thrustSL: 7_607_000,
    ispVac: 311,
    minThrottle: 0.4,
    length: 42.6,
    diameter: 3.7,
    hasChute: false,
  },
  {
    name: 'Tầng 2',
    dryMass: 4_500,
    propMass: 107_500,
    thrustVac: 981_000,
    thrustSL: 914_000,
    ispVac: 348,
    minThrottle: 0.4,
    length: 12.6,
    diameter: 3.7,
    hasChute: true,
  },
];

export const PAYLOAD = { mass: 8_000, length: 9.0, diameter: 3.7 };

export const AERO = {
  referenceArea: Math.PI * (3.7 / 2) ** 2,
  /**
   * Hệ số lực khí động ngang (lực nâng): F⊥ = q·A·CN·sin(góc tấn)·cos(góc tấn), tắt
   * khi góc tấn ≥ 90°. Cố ý để nhỏ: mô hình không mô phỏng điểm đặt lực (CP sau CG)
   * nên lực này chỉ đẩy ngang mà không kèm mô men — hệ số lớn làm quỹ đạo vào lại khí
   * quyển đổi hẳn và chuyến bay tham chiếu của `smoke-test` mất lái (xem SPEC).
   */
  sideForceCoefficient: 0.05,
  /**
   * Hai tầng dù: dù hãm (drogue) mở sớm để giảm tốc từ từ, dù chính mở thấp hơn và
   * đưa tốc độ rơi về ~11 m/s (đủ để một nhịp hãm ngắn là chạm đất dưới 6 m/s).
   * Diện tích ở đây là Cd·A hiệu dụng, không phải diện tích hình học của tán dù.
   */
  drogueDragArea: 90,
  drogueDeployAltitude: 12_000,
  drogueMaxSpeed: 450,
  /** Dù chính tự bung khi đã có dù hãm và xuống dưới mốc này (hỗ trợ hạ cánh). */
  mainChuteAutoAltitude: 4_000,
  mainChuteDeployAltitude: 8_000,
  mainChuteMaxSpeed: 120,
  chuteDragArea: 1_600,
  chuteDeployAltitude: 8_000,
  chuteMaxSpeed: 120,
  chuteOpenTime: 3,
  baseFirstDragFactor: 2.6,
  baseFirstHeatFactor: 0.4,
};

export const LIMITS = {
  maxTouchSpeed: 6,
  maxTouchTilt: 12 * DEG,
  maxGLoad: 12,
  maxHeat: 2_000,
  maxAltitude: 20_000_000,
  warnHeat: 1_300,
  warnGLoad: 8,
};

export const ATTITUDE = {
  gimbalAuthority: 0.55,
  /** Cánh lái khí động tăng quyền điều khiển khi mật độ động áp cao. */
  finAuthority: 0.55,
  damping: 2.0,
  maxRate: 0.6,
  stabilityTorque: 0.3,
};

/**
 * Bình khí RCS: lo việc nghiêng khi động cơ tắt (đang cháy thì gimbal lo, không tốn khí).
 * 40 kg với 0,667 kg/s cho khoảng 60 giây đốt liên tục; hết khí thì chỉ còn cánh lái khí động.
 */
export const RCS = {
  propMass: 40,
  massFlow: 0.667,
  authority: 0.16,
  /** Dưới mức lệnh này coi là xung trim ngắn: có mô men nhưng không đáng kể khí. */
  deadband: 0.25,
};

/**
 * Gia nhiệt khí động theo Sutton–Graves: q = 1,83e-4·√(ρ/R_mũi)·v³ (W/m²).
 * Nhiệt độ vỏ tiến tới cân bằng bức xạ T⁴ = εσT⁴ với hằng số thời gian nhiệt.
 */
export const NOSE_RADIUS = 1.5;
export const EMISSIVITY = 0.85;
export const SKIN_HEAT_FACTOR = 0.25;
export const THERMAL_TIME_CONSTANT = 12;
export const AMBIENT_HEAT = 15;

/** Giới hạn tua thời gian; thanh trượt chạy theo thang log giữa hai mốc này. */
export const WARP_RANGE = { min: 1, max: 1_000 };
