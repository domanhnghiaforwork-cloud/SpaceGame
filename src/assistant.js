/**
 * Trợ lý phi vụ: gom số liệu cảm biến của tàu, gửi định kỳ tới `/api/assistant` (proxy
 * trong `serve.mjs`) và hiện câu trả lời ngắn trong panel ở góc phải trên sân khấu.
 *
 * `buildSnapshot` là hàm thuần — không chạm DOM — nên kiểm chứng được bằng Node.
 * API key nằm ở server; ở đây không bao giờ giữ key.
 */

import { earthPosition } from './physics.js';
import { nearestPad } from './world.js';
import { fuelFraction, rcsFraction, activeStage, nextChute } from './rocket.js';
import { AERO, LIMITS } from './constants.js';

const STORAGE_SECONDS = 'spacegame.assistant.seconds';
const DEFAULT_SECONDS = 5;
const MIN_SECONDS = 2;
const MAX_SECONDS = 60;

const round = (value, digits = 0) => {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};

/**
 * Trạng thái dù + gợi ý hành động kế tiếp, tính từ đúng ngưỡng trong `AERO`.
 * Trợ lý phải dựa vào đây để không khuyên lại một mốc đã đạt.
 */
export function chuteStatus(rocket, altitude, speed) {
  const hasChute = Boolean(activeStage(rocket)?.hasChute);
  const drogueOpen = Boolean(rocket.drogueDeployed);
  const mainOpen = Boolean(rocket.chuteDeployed);
  const canDrogue =
    hasChute && !drogueOpen && altitude <= AERO.drogueDeployAltitude && speed <= AERO.drogueMaxSpeed;
  const canMain =
    hasChute && !mainOpen && altitude <= AERO.mainChuteDeployAltitude && speed <= AERO.mainChuteMaxSpeed;
  return {
    chiTang2CoDu: hasChute,
    duHam: { daMo: drogueOpen, moPct: Math.round(rocket.drogueOpen * 100), coTheMo: canDrogue },
    duChinh: { daMo: mainOpen, moPct: Math.round(rocket.chuteOpen * 100), coTheMo: canMain },
    duKeTiep: nextChute(rocket),
    tuDongMoDuChinh_duoi_m: AERO.mainChuteAutoAltitude,
  };
}

/**
 * Gợi ý hành động kế tiếp theo tình trạng hiện tại — phần “luật” để trợ lý bám vào,
 * tránh chuyện nó nhắc lại một bước đã xong.
 */
export function suggestedAction({ sim, chute, last, rocket }) {
  if (sim.status === 'destroyed') return 'Tên lửa đã bị phá huỷ; bấm R để chơi lại.';
  const altitude = last.altitudeAboveGround ?? 0;
  const speed = last.speed ?? 0;
  const vertical = last.verticalSpeed ?? 0;
  const tilt = Math.abs(last.tilt ?? 0) * (180 / Math.PI);

  if (rocket.heat > LIMITS.warnHeat) return 'Giảm gia nhiệt: quay đuôi dẫn đầu và giữ góc tấn nhỏ.';
  if (chute.duHam.coTheMo) return 'Bấm P ngay để bung dù hãm — đã đủ thấp và đủ chậm.';
  if (chute.duChinh.coTheMo && chute.duHam.daMo) return 'Bấm P để bung dù chính.';
  if (!chute.duHam.daMo && altitude > AERO.drogueDeployAltitude && vertical < -40) {
    return 'Cắt ga, quay đuôi dẫn đầu để hãm; chờ xuống dưới 12 km mới mở dù hãm.';
  }
  if (!chute.duHam.daMo && speed > AERO.drogueMaxSpeed) {
    return `Còn quá nhanh để mở dù (${Math.round(speed)} m/s > ${AERO.drogueMaxSpeed} m/s): hãm bằng động cơ trước.`;
  }
  if (altitude < 3_000 && vertical < -8) return 'Cháy động cơ để chạm đất dưới 6 m/s.';
  if (altitude < 500 && speed > LIMITS.maxTouchSpeed) return `Còn ${Math.round(speed)} m/s: đốt động cơ ngay để hạ dưới ${LIMITS.maxTouchSpeed} m/s.`;
  if (tilt > 20) return 'Quay thân về đúng hướng bay để tránh chạm đất nghiêng quá góc.';
  if (!chute.chiTang2CoDu && altitude < 30_000 && altitude > 1_500) {
    return 'Tách tầng 1 (Space) để phần còn lại có dù trước khi xuống thấp.';
  }
  if (!chute.duHam.daMo && chute.chiTang2CoDu) return 'Giữ đuôi dẫn đầu, xuống thấp và chậm rồi mở dù.';
  return 'Giữ tư thế ổn định và tiếp tục hạ độ cao từ từ.';
}

/** Số liệu gọn của tàu để gửi cho trợ lý (khoá tiếng Việt, số đã làm tròn). */
export function buildSnapshot(sim, extra = {}) {
  const last = sim.last ?? {};
  const rocket = sim.rocket;
  const stage = rocket?.stages?.[rocket.active] ?? null;
  const orbit = last.orbit ?? null;
  const forces = last.forces ?? null;
  const position = earthPosition(sim);
  const nearest = nearestPad(sim.world, position.x, position.y);

  const chute = chuteStatus(rocket, last.altitudeAboveGround ?? 0, last.speed ?? 0);

  return {
    trangThai: sim.status,
    thoiGian_s: round(sim.time),
    doCao_m: round(last.altitudeAboveGround),
    vanToc_ms: round(last.speed),
    vanTocDoc_ms: round(last.verticalSpeed, 1),
    vanTocNgang_ms: round(last.horizontalSpeed, 1),
    mach: round(last.mach, 2),
    nghieng_deg: round(((last.tilt ?? 0) * 180) / Math.PI, 1),
    ga_pct: round((rocket?.throttle ?? 0) * 100),
    lucDay_kN: round((last.thrust ?? 0) / 1_000),
    khoiLuong_t: round((last.mass ?? 0) / 1_000, 1),
    taiTrong_g: round(last.gLoad ?? 0, 2),
    nhietVo_C: round(rocket?.heat ?? 0),
    nhietCaoNhat_C: round(rocket?.peakHeat ?? 0),
    apSuat_kPa: round((last.pressure ?? 0) / 1_000, 2),
    tang: stage?.name ?? null,
    nhienLieu_pct: [0, 1].map((index) => round(fuelFraction(rocket, index) * 100)),
    khiRCS_pct: round(rcsFraction(rocket) * 100),
    quyDao: orbit
      ? {
          canDiem_km: round(orbit.periapsis / 1_000),
          vienDiem_km: Number.isFinite(orbit.apoapsis) ? round(orbit.apoapsis / 1_000) : null,
          doLechTam: round(orbit.eccentricity, 4),
          chuKy_phut: Number.isFinite(orbit.period) ? round(orbit.period / 60, 1) : null,
          daBay_vong: round(Math.abs(sim.orbitAngle) / (2 * Math.PI), 2),
        }
      : null,
    luc_kN: forces
      ? {
          trongLuc: round(Math.hypot(forces.gravity.x, forces.gravity.y) / 1_000),
          lucCan: round(Math.hypot(forces.drag.x, forces.drag.y) / 1_000),
          lucDay: round(Math.hypot(forces.thrust.x, forces.thrust.y) / 1_000),
          lucNang: round(Math.hypot(forces.lift.x, forces.lift.y) / 1_000),
        }
      : null,
    beGanNhat: {
      ten: nearest.pad.name,
      khoangCach_km: round(nearest.distance / 1_000, 1),
    },
    du: chute,
    goiY: suggestedAction({ sim, chute, last, rocket }),
    tuaThoiGian: round(extra.warp ?? 1, 0),
    tamDung: Boolean(extra.paused),
    nhiemVu: extra.mission ?? null,
  };
}

/**
 * Panel trợ lý: bật/tắt, nhịp gửi (giây), câu trả lời mới nhất, và lỗi kèm nút thử lại.
 */
export function createAssistant({ doc = document, getSnapshot, fetchImpl = fetch } = {}) {
  const nodes = {
    toggle: doc.getElementById('assistant-on'),
    seconds: doc.getElementById('assistant-seconds'),
    reply: doc.getElementById('assistant-reply'),
    error: doc.getElementById('assistant-error'),
    retry: doc.getElementById('assistant-retry'),
    status: doc.getElementById('assistant-status'),
  };

  let enabled = false;
  let seconds = DEFAULT_SECONDS;
  let timer = 0;
  let inFlight = false;
  let configured = null;

  try {
    const saved = Number(doc.defaultView?.localStorage.getItem(STORAGE_SECONDS));
    if (Number.isFinite(saved) && saved >= MIN_SECONDS && saved <= MAX_SECONDS) seconds = saved;
  } catch {
    /* chế độ riêng tư — dùng mặc định */
  }

  const clampSeconds = (value) => Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, Math.round(value)));

  function setReply(text) {
    if (nodes.reply) nodes.reply.textContent = text;
  }

  function showError(message) {
    if (nodes.error) {
      nodes.error.textContent = message;
      nodes.error.hidden = !message;
    }
    if (nodes.retry) nodes.retry.hidden = !message;
  }

  function setStatus(text) {
    if (nodes.status) nodes.status.textContent = text;
  }

  async function ask() {
    if (!enabled || inFlight) return;
    const snapshot = getSnapshot?.();
    if (!snapshot) return;
    inFlight = true;
    setStatus('Đang hỏi…');
    try {
      const response = await fetchImpl('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telemetry: snapshot }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        showError(data.message ?? `Lỗi ${response.status}`);
        setStatus('');
        return;
      }
      showError('');
      setReply(data.reply ?? '');
      setStatus(
        `Cập nhật lúc ${new Date().toLocaleTimeString('vi-VN', { hour12: false })} · mỗi ${seconds} s`,
      );
    } catch (error) {
      showError(`Không gọi được trợ lý: ${error?.message ?? 'lỗi mạng'}`);
      setStatus('');
    } finally {
      inFlight = false;
    }
  }

  function schedule() {
    if (timer) clearInterval(timer);
    timer = 0;
    if (!enabled) return;
    timer = setInterval(ask, seconds * 1_000);
  }

  function setEnabled(value) {
    enabled = Boolean(value);
    if (nodes.toggle) nodes.toggle.checked = enabled;
    if (!enabled) {
      if (timer) clearInterval(timer);
      timer = 0;
      setStatus('');
      return;
    }
    setReply('Đang chờ số liệu đầu tiên…');
    ask();
    schedule();
  }

  function setSeconds(value) {
    seconds = clampSeconds(value);
    if (nodes.seconds) nodes.seconds.value = String(seconds);
    try {
      doc.defaultView?.localStorage.setItem(STORAGE_SECONDS, String(seconds));
    } catch {
      /* không lưu được thì thôi */
    }
    if (enabled) schedule();
  }

  async function checkConfiguration() {
    try {
      const response = await fetchImpl('/api/assistant/status');
      const data = await response.json();
      configured = Boolean(data?.configured);
      if (!configured) {
        setStatus('Chưa có DEEPSEEK_API_KEY trong .env');
      } else {
        setStatus(`Sẵn sàng · ${data.model ?? 'deepseek-chat'}`);
      }
    } catch {
      configured = null;
      setStatus('Không kiểm tra được cấu hình trợ lý');
    }
  }

  nodes.toggle?.addEventListener('change', () => setEnabled(nodes.toggle.checked));
  nodes.seconds?.addEventListener('change', () => setSeconds(Number(nodes.seconds.value)));
  nodes.retry?.addEventListener('click', () => {
    showError('');
    ask();
  });

  setSeconds(seconds);
  checkConfiguration();

  return {
    get enabled() {
      return enabled;
    },
    get seconds() {
      return seconds;
    },
    get configured() {
      return configured;
    },
    setEnabled,
    setSeconds,
    ask,
    checkConfiguration,
    snapshot: () => getSnapshot?.(),
    destroy() {
      if (timer) clearInterval(timer);
      timer = 0;
    },
  };
}
