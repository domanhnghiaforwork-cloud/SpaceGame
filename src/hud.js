/**
 * Cập nhật bảng thông số, danh sách nhiệm vụ, cảnh báo và màn hình kết quả.
 * Toàn bộ nhãn hiển thị bằng tiếng Việt, số theo định dạng vi-VN.
 */

import { rcsFraction } from './rocket.js';

const formatters = new Map();

function number(value, digits = 0) {
  const key = digits;
  if (!formatters.has(key)) {
    formatters.set(
      key,
      new Intl.NumberFormat('vi-VN', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }),
    );
  }
  const safe = Number.isFinite(value) ? value : 0;
  const cleaned = Math.abs(safe) < 10 ** -(digits + 1) ? 0 : safe;
  return formatters.get(key).format(cleaned);
}

export function formatAltitude(meters) {
  if (!Number.isFinite(meters)) return '—';
  const abs = Math.abs(meters) < 1 ? 0 : Math.abs(meters);
  if (abs === 0) return '0 m';
  if (abs < 1_000) return `${number(meters, 0)} m`;
  if (abs < 100_000) return `${number(meters / 1_000, 2)} km`;
  return `${number(meters / 1_000, 1)} km`;
}

export function formatSpeed(metersPerSecond) {
  const speed = Number.isFinite(metersPerSecond) ? metersPerSecond : 0;
  if (Math.abs(speed) < 1_000) return `${number(speed, 0)} m/s`;
  return `${number(speed, 0)} m/s`;
}

export function formatClock(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (v) => String(v).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

const STATUS_LABEL = {
  ready: 'Trên bệ phóng',
  flying: 'Đang bay',
  landed: 'Đã tiếp đất',
  destroyed: 'Đã phá huỷ',
};

function pickWarnings(sim) {
  const warnings = [];
  const rocket = sim.rocket;
  if (sim.status === 'destroyed') {
    warnings.push({ text: sim.failure || 'Tên lửa đã bị phá huỷ', soft: false });
    return warnings;
  }
  if (rocket.heat > 600) {
    warnings.push({ text: `Nhiệt vỏ cao · ${number(rocket.heat, 0)} °C`, soft: false });
  }
  if (rocket.peakGLoad > 8 && sim.last.gLoad > 8) {
    warnings.push({ text: `Quá tải G · ${number(sim.last.gLoad, 1)} g`, soft: false });
  }
  if (
    sim.status === 'flying' &&
    sim.last.altitudeAboveGround > 0 &&
    sim.last.altitudeAboveGround < 3_000 &&
    sim.last.verticalSpeed < -12 &&
    rocket.chuteOpen < 0.2
  ) {
    warnings.push({ text: `Tốc độ rơi cao · ${number(-sim.last.verticalSpeed, 0)} m/s`, soft: false });
  }
  const stage = rocket.stages[rocket.active];
  if (stage && !stage.separated && stage.fuel / stage.propMass < 0.06 && stage.fuel > 0) {
    warnings.push({ text: `Nhiên liệu ${stage.name} sắp cạn`, soft: true });
  }
  if (rocket.chuteDeployed && sim.last.altitudeAboveGround < 60 && sim.last.speed > 6) {
    warnings.push({ text: 'Dù không đủ giảm tốc · cần cháy động cơ', soft: false });
  }
  const rcsLeft = rcsFraction(rocket);
  if (rcsLeft <= 0 && sim.last.thrust <= 0) {
    warnings.push({ text: 'Hết khí RCS · chỉ còn cánh lái khí động', soft: false });
  } else if (rcsLeft > 0 && rcsLeft < 0.2) {
    warnings.push({ text: `Khí RCS sắp cạn · còn ${number(rcsLeft * 100, 0)} %`, soft: true });
  }
  return warnings;
}

export function createHud(doc = document) {
  const el = (id) => doc.getElementById(id);

  const nodes = {
    status: el('chip-status'),
    warp: el('chip-warp'),
    time: el('chip-time'),
    alt: el('hud-alt'),
    altLarge: el('hud-alt-large'),
    speed: el('hud-speed'),
    speedLarge: el('hud-speed-large'),
    vspeed: el('hud-vspeed'),
    hspeed: el('hud-hspeed'),
    mach: el('hud-mach'),
    machLarge: el('hud-mach-large'),
    rho: el('hud-rho'),
    pressure: el('hud-pressure'),
    thrust: el('hud-thrust'),
    throttle: el('hud-throttle'),
    throttleFill: el('throttle-fill'),
    throttleValue: el('throttle-value'),
    throttleMeter: el('throttle-meter'),
    mass: el('hud-mass'),
    g: el('hud-g'),
    heat: el('hud-heat'),
    peri: el('hud-peri'),
    apo: el('hud-apo'),
    period: el('hud-period'),
    ecc: el('hud-ecc'),
    laps: el('hud-laps'),
    best: el('hud-best'),
    dv: el('hud-dv'),
    stageLabel: el('stage-label'),
    fuel1Bar: el('fuel-1-bar'),
    fuel1Val: el('fuel-1-val'),
    fuel2Bar: el('fuel-2-bar'),
    fuel2Val: el('fuel-2-val'),
    rcsBar: el('fuel-rcs-bar'),
    rcsVal: el('fuel-rcs-val'),
    guidance: el('guidance'),
    warnings: el('warning-list'),
    phase: el('hud-phase'),
    tilt: el('hud-tilt'),
    simtime: el('hud-simtime'),
    missionItems: new Map(
      Array.from(doc.querySelectorAll('#mission-list li')).map((li) => [li.dataset.step, li]),
    ),
    fuelRows: Array.from(doc.querySelectorAll('.fuel-row')),
    result: el('result'),
    resultTitle: el('result-title'),
    resultEyebrow: el('result-eyebrow'),
    resultGrade: el('result-grade'),
    resultScore: el('result-score'),
    resultBreakdown: el('result-breakdown'),
    resultNote: el('result-note'),
  };

  let lastWarningSignature = null;

  const setText = (node, text) => {
    if (node && node.textContent !== text) node.textContent = text;
  };

  function updateWarnings(sim, toastText) {
    const list = pickWarnings(sim);
    if (toastText) list.push({ text: toastText, soft: true });
    const signature = list.map((item) => `${item.soft ? 's' : 'h'}:${item.text}`).join('|');
    if (signature === lastWarningSignature) return;
    lastWarningSignature = signature;
    nodes.warnings.replaceChildren(
      ...list.map((item) => {
        const div = doc.createElement('div');
        div.className = item.soft ? 'warn soft' : 'warn';
        div.textContent = item.text;
        return div;
      }),
    );
  }

  function update(sim, mission, view) {
    const last = sim.last;
    const rocket = sim.rocket;
    const orbit = last.orbit;

    setText(nodes.status, `Trạng thái ${STATUS_LABEL[sim.status] ?? sim.status}`);
    setText(nodes.status, `Trạng thái ${STATUS_LABEL[sim.status] ?? sim.status}`);
    if (nodes.status) nodes.status.innerHTML = `Trạng thái <b>${STATUS_LABEL[sim.status] ?? sim.status}</b>`;
    if (nodes.warp) nodes.warp.innerHTML = `Tua <b>${view.warp}×</b>`;
    if (nodes.time) nodes.time.innerHTML = `Thời gian bay <b>${formatClock(sim.time)}</b>`;

    setText(nodes.alt, formatAltitude(last.altitudeAboveGround));
    setText(nodes.altLarge, formatAltitude(last.altitudeAboveGround));
    setText(nodes.speed, `${formatSpeed(last.speed)} · ${number(last.speed * 3.6, 0)} km/h`);
    setText(nodes.speedLarge, formatSpeed(last.speed));
    setText(nodes.vspeed, `${number(last.verticalSpeed, 1)} m/s`);
    setText(nodes.hspeed, `${number(last.horizontalSpeed, 1)} m/s`);
    setText(nodes.mach, number(last.mach, 2));
    setText(nodes.machLarge, number(last.mach, 2));
    setText(nodes.rho, `${last.density < 0.0001 ? last.density.toExponential(2) : number(last.density, 4)} kg/m³`);
    setText(nodes.pressure, `${number(last.pressure / 1_000, 2)} kPa`);
    setText(nodes.thrust, `${number(last.thrust / 1_000, 0)} kN`);
    setText(nodes.throttle, `${number(rocket.throttle * 100, 0)} %`);

    if (nodes.throttleFill) {
      const throttlePct = Math.max(0, Math.min(1, rocket.throttle)) * 100;
      nodes.throttleFill.style.width = `${throttlePct}%`;
      setText(nodes.throttleValue, `${number(throttlePct, 0)} %`);
      nodes.throttleMeter?.classList.toggle('below-min', throttlePct > 0 && throttlePct < 40);
    }
    setText(nodes.mass, `${number(last.mass / 1_000, 1)} t`);
    setText(nodes.g, `${number(last.gLoad, 2)} g`);
    setText(nodes.heat, `${number(rocket.heat, 0)} °C`);

    if (nodes.g) {
      nodes.g.classList.toggle('warn', last.gLoad > 8 && last.gLoad <= 12);
      nodes.g.classList.toggle('bad', last.gLoad > 12);
    }
    if (nodes.heat) {
      nodes.heat.classList.toggle('warn', rocket.heat > 600 && rocket.heat <= 1_200);
      nodes.heat.classList.toggle('bad', rocket.heat > 1_200);
    }

    const inSpace = last.altitudeAboveGround > 100_000;
    if (orbit && inSpace) {
      setText(nodes.peri, orbit.periapsis > 0 ? formatAltitude(orbit.periapsis) : '—');
      setText(nodes.apo, Number.isFinite(orbit.apoapsis) ? formatAltitude(orbit.apoapsis) : '—');
      setText(nodes.period, Number.isFinite(orbit.period) ? `${number(orbit.period / 60, 1)} phút` : '—');
      setText(nodes.ecc, number(orbit.eccentricity, 4));
    } else {
      for (const node of [nodes.peri, nodes.apo, nodes.period, nodes.ecc]) setText(node, '—');
    }
    setText(nodes.laps, `${number(Math.abs(sim.orbitAngle) / (Math.PI * 2), 2)} vòng`);
    setText(nodes.best, view.best ? `${view.best.score} điểm · hạng ${view.best.grade}` : '—');
    setText(nodes.dv, `${number(view.deltaV, 0)} m/s`);

    const stage = rocket.stages[rocket.active];
    setText(nodes.stageLabel, stage ? stage.name : '—');

    const fractions = rocket.stages.map((s) => (s.separated ? 0 : s.fuel / s.propMass));
    const bars = [nodes.fuel1Bar, nodes.fuel2Bar];
    const values = [nodes.fuel1Val, nodes.fuel2Val];
    for (let i = 0; i < 2; i++) {
      const bar = bars[i];
      if (!bar) continue;
      const pct = Math.max(0, Math.min(1, fractions[i])) * 100;
      bar.style.width = `${pct}%`;
      bar.parentElement.classList.toggle('low', pct > 0 && pct < 25);
      bar.parentElement.classList.toggle('empty', pct <= 0.5);
      setText(values[i], rocket.stages[i].separated ? 'Đã tách' : `${number(pct, 0)} %`);
      const row = nodes.fuelRows[i];
      if (row) row.classList.toggle('off', rocket.stages[i].separated);
    }

    if (nodes.rcsBar) {
      const rcsPct = rcsFraction(rocket) * 100;
      nodes.rcsBar.style.width = `${rcsPct}%`;
      nodes.rcsBar.parentElement.classList.toggle('low', rcsPct > 0 && rcsPct < 25);
      nodes.rcsBar.parentElement.classList.toggle('empty', rcsPct <= 0.5);
      setText(nodes.rcsVal, `${number(rcsPct, 0)} %`);
    }

    setText(nodes.guidance, mission.guidance);
    setText(nodes.phase, STATUS_LABEL[sim.status] ?? sim.status);
    setText(nodes.tilt, `Nghiêng ${number(Math.abs(last.tilt) * (180 / Math.PI), 1)}°`);
    setText(nodes.simtime, `${number(sim.time, 0)} s`);

    for (const step of mission.steps) {
      const li = nodes.missionItems.get(step.id);
      if (!li) continue;
      li.classList.toggle('done', step.state === 'done');
      const active = step.state !== 'done' && mission.steps.find((s) => s.state !== 'done') === step;
      li.classList.toggle('active', active);
    }

    updateWarnings(sim, view.toast);
  }

  function showResult(score, sim, mission, best) {
    nodes.result.hidden = false;
    if (sim.status === 'destroyed') {
      nodes.resultEyebrow.textContent = 'Phi vụ thất bại';
      nodes.resultTitle.textContent = sim.failure || 'Tên lửa bị phá huỷ';
    } else if (mission.steps.every((step) => step.state === 'done')) {
      nodes.resultEyebrow.textContent = 'Phi vụ hoàn tất';
      nodes.resultTitle.textContent = 'Hạ cánh thành công xuống bệ phóng';
    } else {
      nodes.resultEyebrow.textContent = 'Kết thúc sớm';
      nodes.resultTitle.textContent = 'Phi vụ chưa hoàn tất';
    }
    nodes.resultGrade.textContent = score.grade;
    nodes.resultGrade.classList.toggle('bad', score.grade === 'F' || score.grade === 'E');
    nodes.resultScore.textContent = number(score.total, 0);
    nodes.resultBreakdown.replaceChildren(
      ...score.breakdown.map((item) => {
        const li = doc.createElement('li');
        const label = doc.createElement('span');
        label.className = 'label';
        label.textContent = `${item.label} · tối đa ${item.max}`;
        const points = doc.createElement('span');
        points.className = 'points';
        points.textContent = `${item.points} điểm`;
        const detail = doc.createElement('span');
        detail.className = 'detail';
        detail.textContent = item.detail;
        li.append(label, points, detail);
        return li;
      }),
    );
    const bestLine = best ? `Kỷ lục của bạn: ${best.score} điểm (hạng ${best.grade}).` : '';
    const timeLine = `Thời gian mô phỏng: ${formatClock(sim.time)}.`;
    nodes.resultNote.textContent = [timeLine, bestLine].filter(Boolean).join(' ');
  }

  function hideResult() {
    nodes.result.hidden = true;
  }

  return { update, showResult, hideResult, nodes };
}
