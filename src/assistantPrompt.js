/**
 * Câu chữ cho system prompt của trợ lý phi vụ.
 *
 * Tách khỏi `serve.mjs` để kiểm chứng được bằng Node: prompt phải nhắc đúng giới hạn
 * thật (lấy từ `AERO`/`LIMITS`) và phải có luật đọc số liệu hiện tại trước khi khuyên.
 */

import { AERO, LIMITS } from './constants.js';

export const ASSISTANT_MODEL = 'deepseek-chat';

/** Giới hạn dù, đọc từ cùng nguồn với vật lý để prompt không lệch. */
export const CHUTE_LIMITS = {
  drogue: {
    altitude: AERO.drogueDeployAltitude,
    speed: AERO.drogueMaxSpeed,
    dragArea: AERO.drogueDragArea,
  },
  main: {
    altitude: AERO.mainChuteDeployAltitude,
    speed: AERO.mainChuteMaxSpeed,
    autoAltitude: AERO.mainChuteAutoAltitude,
    dragArea: AERO.chuteDragArea,
  },
  openTime: AERO.chuteOpenTime,
};

export const BASE_PROMPT = [
  'Bạn là trợ lý phi vụ trong một game mô phỏng lái tên lửa 2D quanh Trái Đất.',
  'Bạn nhận số liệu cảm biến của tàu và trả lời bằng tiếng Việt, tối đa 2 câu:',
  'câu đầu nói trạng thái hiện tại, câu sau nêu đúng một hành động cụ thể nên làm ngay.',
  'Trong dữ liệu có trường `goiY` do game tính từ tình trạng hiện tại: câu thứ hai PHẢI nói đúng hành động đó',
  '(được diễn đạt lại cho tự nhiên, nhưng không được đổi ý hay khuyên việc khác).',
  'Các bước nhiệm vụ đã đánh dấu xong trong `nhiemVu.cacBuoc` là đã đạt — không được khuyên làm lại',
  '(ví dụ đã lên trên độ cao mục tiêu thì không khuyên leo tiếp).',
  'Luôn đọc số liệu hiện tại trước khi khuyên: nếu một mốc đã đạt (ví dụ độ cao đã dưới ngưỡng mở dù)',
  'thì không được khuyên "chờ tới khi" mốc đó nữa, mà phải nói việc kế tiếp.',
  'Kiểm tra trạng thái dù trong `du` trước khi khuyên mở dù: dù đã mở thì đừng khuyên mở lại;',
  'nếu `du.duHam.coTheMo` hoặc `du.duChinh.coTheMo` là true thì đó chính là việc nên làm ngay.',
  'Không chào hỏi, không markdown, không lặp lại toàn bộ số liệu, không bịa số liệu không có trong dữ liệu.',
  'Cũng không suy diễn trạng thái không có trong dữ liệu: ví dụ ga_pct còn trên 0 thì không được nói "đã cắt ga",',
  'và dù chưa mở thì không được nói "dù đã bung".',
  'Trường `tamDung` cho biết phi vụ đang tạm dừng: khi đó số liệu không đổi nữa, hãy nói rõ là đang tạm dừng',
  'thay vì khuyên hành động như đang bay.',
].join(' ');

const km = (meters) => `${(meters / 1_000).toLocaleString('vi-VN')} km`;

/** Ghép bối cảnh nhiệm vụ + giới hạn thật vào system prompt. */
export function systemPromptFor(mission) {
  const limits = [
    `Giới hạn của tàu: gia tốc phá huỷ ${LIMITS.maxGLoad} g (cảnh báo ${LIMITS.warnGLoad} g),`,
    `nhiệt vỏ phá huỷ ${LIMITS.maxHeat} °C (cảnh báo ${LIMITS.warnHeat} °C),`,
    `chạm đất phải dưới ${LIMITS.maxTouchSpeed} m/s và nghiêng dưới ${(LIMITS.maxTouchTilt * 180 / Math.PI).toFixed(0)}°.`,
    `Dù hãm chỉ mở được dưới ${km(CHUTE_LIMITS.drogue.altitude)} và dưới ${CHUTE_LIMITS.drogue.speed} m/s;`,
    `dù chính dưới ${km(CHUTE_LIMITS.main.altitude)} và dưới ${CHUTE_LIMITS.main.speed} m/s,`,
    `và tự bung khi đã có dù hãm mà xuống dưới ${km(CHUTE_LIMITS.main.autoAltitude)}.`,
    'Chỉ tầng 2 có dù, nên phải tách tầng 1 trước khi mở dù.',
  ].join(' ');

  if (!mission || typeof mission !== 'object') return `${BASE_PROMPT} ${limits}`;

  const parts = [
    `Nhiệm vụ hiện tại: ${mission.ten ?? mission.id ?? 'không rõ'}.`,
    mission.mucTieu ? `Mục tiêu: ${mission.mucTieu}.` : '',
    mission.boiCanh ? `Bối cảnh: ${mission.boiCanh}.` : '',
    mission.buocDangLam ? `Bước đang làm: ${mission.buocDangLam}.` : '',
    mission.huongDan ? `Hướng dẫn trong game: ${mission.huongDan}.` : '',
    'Chỉ khuyên những việc phục vụ đúng mục tiêu của nhiệm vụ này.',
    mission.buocDangLam ? `Bước kế tiếp cần làm: ${mission.buocDangLam}.` : '',
  ];
  return `${BASE_PROMPT} ${parts.filter(Boolean).join(' ')} ${limits}`;
}
