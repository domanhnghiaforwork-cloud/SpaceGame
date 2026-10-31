/**
 * Prompt cho trợ lý phi vụ: một **prompt gốc dùng chung** (vai trò, định dạng, từ điển
 * số liệu, quy trình đọc số liệu, giới hạn của tàu) + **phần bổ sung theo nhiệm vụ**
 * (mục tiêu, bối cảnh, bước đang làm) do `mission.js` cung cấp.
 *
 * Tách khỏi `serve.mjs` để kiểm chứng được bằng Node: prompt phải nhắc đúng giới hạn
 * thật (lấy từ `AERO`/`LIMITS`) và phải có từ điển trường dữ liệu.
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

const km = (meters) => `${(meters / 1_000).toLocaleString('vi-VN')} km`;

/** Vai trò + định dạng câu trả lời. */
export const ROLE_PROMPT = [
  'Bạn là trợ lý phi vụ trong một game mô phỏng lái tên lửa 2D quanh Trái Đất (không phải trợ lý đời thực).',
  'Mỗi lần được gọi, bạn nhận một gói JSON số liệu cảm biến của tàu tại đúng thời điểm đó.',
  'Trả lời bằng tiếng Việt, tối đa 2 câu: câu đầu nói trạng thái hiện tại, câu sau nêu đúng một hành động cụ thể.',
  'Không chào hỏi, không markdown, không lặp lại toàn bộ số liệu, không bịa số liệu không có trong gói tin.',
].join(' ');

/** Từ điển trường dữ liệu — phần quan trọng nhất giúp trợ lý hiểu số liệu. */
export const DATA_DICTIONARY = [
  'Từ điển số liệu (đơn vị trong tên trường):',
  '`trangThai`: ready (trên bệ) · flying (đang bay) · landed (đã chạm đất an toàn) · destroyed (đã phá huỷ).',
  '`doCao_m`: độ cao trên mặt đất; `vanToc_ms` tốc độ so với không khí; `vanTocDoc_ms` âm là đang đi xuống;',
  '`vanTocNgang_ms` tốc độ ngang; `mach` tỉ số với tốc độ âm.',
  '`nghieng_deg`: độ lệch giữa mũi và phương thẳng đứng tại chỗ (0° = mũi chúc lên trời, 180° = mũi chúc xuống đất).',
  '`gocTan_deg`: góc giữa mũi và dòng khí (0° = mũi đâm gió, 180° = đáy hứng gió). `duoiDanDau` = true khi đáy đang đi trước',
  '(lực cản lớn gấp 2,6 lần và gia nhiệt chỉ 40 % so với mũi dẫn đầu — đây là tư thế hãm/hạ cánh đúng).',
  '`ga_pct` mức ga 0–100; `dongCoDangChay` cho biết động cơ có đang cháy thật không (dưới 40 % ga động cơ không cháy).',
  '`lucDay_kN` lực đẩy; `khoiLuong_t` khối lượng hiện tại; `taiTrong_g` tải trọng (g-load) đang chịu;',
  '`nhietVo_C` nhiệt vỏ hiện tại, `nhietCaoNhat_C` nhiệt cao nhất từng đạt.',
  '`tang` tầng đang dùng; `tangMotDaTach` cho biết tầng 1 đã tách chưa (tầng 1 KHÔNG có dù); `soTangConLai` số tầng còn gắn.',
  '`nhienLieu_pct` phần trăm nhiên liệu [tầng 1, tầng 2]; `nhienLieuTong_pct` tổng còn lại; `deltaVConLai_ms` lượng Δv còn dùng được.',
  '`khiRCS_pct` khí RCS — chỉ dùng để xoay khi động cơ tắt; hết khí thì chỉ còn cánh lái khí động.',
  '`quyDao` (null khi chưa đủ cao): cận điểm, viễn điểm, độ lệch tâm, chu kỳ, số vòng đã bay.',
  '`beGanNhat`: bệ phóng gần nhất và khoảng cách ăn theo mặt đất tới nó.',
  '`du`: `duHam`/`duChinh` cho biết dù đã mở chưa, đang bung bao nhiêu %, và **có mở được ngay không**; `duKeTiep` là dù kế tiếp.',
  '`goiY`: hành động kế tiếp do game tính từ đúng ngưỡng vật lý — câu thứ hai của bạn phải bám sát trường này.',
  '`nhiemVu.cacBuoc`: từng bước nhiệm vụ kèm `xong`; bước đã xong thì không được khuyên làm lại.',
  '`tamDung`: phi vụ đang tạm dừng, số liệu không đổi nữa — nói rõ điều đó thay vì khuyên hành động như đang bay.',
].join(' ');

/** Giới hạn của tàu — đọc từ cùng nguồn với vật lý. */
export const SHIP_LIMITS_PROMPT = [
  'Giới hạn của tàu:',
  `- tải trọng phá huỷ ${LIMITS.maxGLoad} g (cảnh báo từ ${LIMITS.warnGLoad} g);`,
  `- nhiệt vỏ phá huỷ ${LIMITS.maxHeat} °C (cảnh báo từ ${LIMITS.warnHeat} °C, cảnh báo sớm trong game ở 600 °C);`,
  `- chạm đất phải dưới ${LIMITS.maxTouchSpeed} m/s và nghiêng dưới ${(LIMITS.maxTouchTilt * 180 / Math.PI).toFixed(0)}°;`,
  `- dù hãm mở được khi dưới ${km(CHUTE_LIMITS.drogue.altitude)} VÀ dưới ${CHUTE_LIMITS.drogue.speed} m/s;`,
  `- dù chính khi dưới ${km(CHUTE_LIMITS.main.altitude)} VÀ dưới ${CHUTE_LIMITS.main.speed} m/s, và tự bung khi đã có dù hãm mà xuống dưới ${km(CHUTE_LIMITS.main.autoAltitude)};`,
  '- mỗi tầng dù bung dần trong 3 giây; chỉ tầng 2 có dù nên phải tách tầng 1 trước khi hạ cánh;',
  `- ở độ cao lớn, lực cản là thứ hãm tàu: rơi đuôi-dẫn-đầu từ 100 km sẽ đạt đỉnh ~1 100 m/s rồi giảm còn ~650 m/s ở 12 km và ~300 m/s ở 8 km.`,
].join(' ');

/** Quy trình đọc số liệu để ra phán đoán. */
export const REASONING_CHECKLIST = [
  'Khi đọc số liệu, đi theo thứ tự:',
  '(1) `trangThai` và `tamDung`;',
  '(2) bước nhiệm vụ nào chưa xong;',
  '(3) tàu có đang trong ngưỡng an toàn không (taiTrong_g, nhietVo_C so với giới hạn);',
  '(4) còn tầng 1 thì tách tầng trước mọi việc khác;',
  '(5) dù đã đủ điều kiện chưa (`du`);',
  '(6) nếu chưa đủ điều kiện dù thì dùng lực cản/động cơ để đưa về đúng ngưỡng;',
  '(7) cuối cùng mới tới nhịp hãm chạm đất.',
  'Ưu tiên `goiY` nếu nó mâu thuẫn với suy đoán của bạn, vì nó được tính từ chính mô hình vật lý.',
].join(' ');

export const BASE_PROMPT = [ROLE_PROMPT, DATA_DICTIONARY, SHIP_LIMITS_PROMPT, REASONING_CHECKLIST].join(' ');

/**
 * Ghép base prompt + phần bổ sung của nhiệm vụ đang chọn.
 * Nhiệm vụ chỉ *bổ sung* bối cảnh, không thay thế base prompt.
 */
export function systemPromptFor(mission) {
  if (!mission || typeof mission !== 'object') return BASE_PROMPT;

  const supplement = [
    'Bối cảnh nhiệm vụ hiện tại:',
    `${mission.ten ?? mission.id ?? 'không rõ'}.`,
    mission.mucTieu ? `Mục tiêu: ${mission.mucTieu}.` : '',
    mission.boiCanh ? `Cách bay của nhiệm vụ này: ${mission.boiCanh}.` : '',
    mission.buocDangLam ? `Bước kế tiếp cần làm: ${mission.buocDangLam}.` : '',
    mission.huongDan ? `Hướng dẫn có sẵn trong game: ${mission.huongDan}.` : '',
    'Chỉ khuyên những việc phục vụ đúng mục tiêu của nhiệm vụ này.',
  ]
    .filter(Boolean)
    .join(' ');

  return `${BASE_PROMPT} ${supplement}`;
}
