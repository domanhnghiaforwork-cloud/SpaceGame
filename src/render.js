/**
 * Vẽ toàn bộ cảnh 2D lên canvas. Cảnh được dựng trong hệ quay cùng Trái Đất để
 * mặt đất và bệ phóng đứng yên, còn tên lửa luôn ở tâm màn hình.
 */

import { EARTH, DEG, PAD_RADIUS, LIMITS } from './constants.js';
import { nearestPad, toEarthFrame } from './world.js';
import { earthPosition } from './physics.js';
import { rocketLength } from './rocket.js';
import { worldToScreen, screenAngle } from './camera.js';

const TAU = Math.PI * 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a, b, t) => a + (b - a) * t;
const rgb = (r, g, b) => `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;

function makeStars(count) {
  const stars = [];
  let seed = 20260214;
  const random = () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed / 2_147_483_648;
  };
  for (let i = 0; i < count; i++) {
    stars.push({
      x: random(),
      y: random(),
      r: 0.4 + random() * 1.3,
      a: 0.35 + random() * 0.65,
      twinkle: random() * TAU,
    });
  }
  return stars;
}

const STARS = makeStars(320);

const CONTINENTS = [
  [-24, 18, 0.9],
  [26, 44, 0.93],
  [54, 96, 0.88],
  [104, 140, 0.94],
  [150, 186, 0.9],
  [196, 232, 0.92],
  [240, 274, 0.87],
  [282, 312, 0.93],
  [318, 350, 0.89],
].map(([start, end, inner]) => ({ start: start * DEG, end: end * DEG, inner }));

function drawSky(ctx, width, height, altitude) {
  const dayness = clamp01(1 - altitude / 70_000);
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, rgb(mix(7, 52, dayness), mix(10, 104, dayness), mix(19, 158, dayness)));
  gradient.addColorStop(0.55, rgb(mix(9, 92, dayness), mix(13, 150, dayness), mix(25, 198, dayness)));
  gradient.addColorStop(1, rgb(mix(11, 168, dayness), mix(15, 200, dayness), mix(28, 226, dayness)));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  if (dayness > 0.05) {
    const glow = ctx.createRadialGradient(
      width * 0.82,
      height * 0.08,
      0,
      width * 0.82,
      height * 0.08,
      Math.max(width, height) * 0.8,
    );
    glow.addColorStop(0, `rgba(255, 243, 214, ${0.3 * dayness})`);
    glow.addColorStop(1, 'rgba(255, 243, 214, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
  }
}

function drawStars(ctx, width, height, altitude, time) {
  const alpha = clamp01((altitude - 18_000) / 45_000);
  if (alpha <= 0.01) return;
  for (const star of STARS) {
    const flicker = 0.75 + 0.25 * Math.sin(time * 1.4 + star.twinkle);
    ctx.fillStyle = `rgba(226, 240, 255, ${star.a * alpha * flicker})`;
    ctx.beginPath();
    ctx.arc(star.x * width, star.y * height, star.r, 0, TAU);
    ctx.fill();
  }
}

function surfaceScreenPoints(camera, angle, radiusPx, width, height) {
  const earth = worldToScreen(camera, 0, 0);
  const span = (Math.hypot(width, height) / 2 + 80) / Math.max(radiusPx, 1) + 1e-7;
  const points = [];
  const samples = 96;
  for (let i = 0; i <= samples; i++) {
    const phi = angle - span + (2 * span * i) / samples;
    const theta = screenAngle(camera, phi);
    points.push({
      x: earth.x + radiusPx * Math.cos(theta),
      y: earth.y + radiusPx * Math.sin(theta),
    });
  }
  return points;
}

function drawPlanet(ctx, camera, width, height) {
  const earth = worldToScreen(camera, 0, 0);
  const radiusPx = EARTH.RADIUS * camera.scale;

  if (radiusPx > Math.max(width, height) * 1.6) {
    const angle = Math.atan2(camera.y, camera.x);
    const points = surfaceScreenPoints(camera, angle, radiusPx, width, height);
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (const point of points) ctx.lineTo(point.x, point.y);
    ctx.lineTo(points[points.length - 1].x, height + 240);
    ctx.lineTo(points[0].x, height + 240);
    ctx.closePath();
    const gradient = ctx.createLinearGradient(0, height * 0.35, 0, height);
    gradient.addColorStop(0, '#35704d');
    gradient.addColorStop(0.05, '#27503a');
    gradient.addColorStop(0.35, '#1b2b2c');
    gradient.addColorStop(1, '#0a0f14');
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (const point of points) ctx.lineTo(point.x, point.y);
    ctx.strokeStyle = 'rgba(158, 220, 176, 0.9)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    return;
  }

  const glow = ctx.createRadialGradient(earth.x, earth.y, radiusPx * 0.98, earth.x, earth.y, radiusPx * 1.14);
  glow.addColorStop(0, 'rgba(96, 178, 255, 0.4)');
  glow.addColorStop(0.45, 'rgba(72, 142, 220, 0.16)');
  glow.addColorStop(1, 'rgba(72, 142, 220, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(earth.x, earth.y, radiusPx * 1.14, 0, TAU);
  ctx.fill();

  const ocean = ctx.createRadialGradient(
    earth.x - radiusPx * 0.35,
    earth.y - radiusPx * 0.4,
    radiusPx * 0.05,
    earth.x,
    earth.y,
    radiusPx,
  );
  ocean.addColorStop(0, '#22669f');
  ocean.addColorStop(0.55, '#14456f');
  ocean.addColorStop(1, '#082135');
  ctx.fillStyle = ocean;
  ctx.beginPath();
  ctx.arc(earth.x, earth.y, radiusPx, 0, TAU);
  ctx.fill();

  for (const continent of CONTINENTS) {
    const a0 = screenAngle(camera, continent.start);
    const a1 = screenAngle(camera, continent.end);
    const backwards = a0 > a1;
    ctx.beginPath();
    ctx.arc(earth.x, earth.y, radiusPx, a0, a1, backwards);
    ctx.arc(earth.x, earth.y, radiusPx * continent.inner, a1, a0, !backwards);
    ctx.closePath();
    ctx.fillStyle = '#2f6d4d';
    ctx.fill();
  }

  ctx.strokeStyle = 'rgba(150, 210, 255, 0.6)';
  ctx.lineWidth = Math.max(1, radiusPx * 0.004);
  ctx.beginPath();
  ctx.arc(earth.x, earth.y, radiusPx, 0, TAU);
  ctx.stroke();
}

function drawPads(ctx, camera, world, width, height, nearest) {
  const scale = camera.scale;
  for (const pad of world.pads) {
    const screen = worldToScreen(camera, pad.x, pad.y);
    if (screen.x < -400 || screen.x > width + 400 || screen.y < -400 || screen.y > height + 400) continue;
    const size = PAD_RADIUS * 2 * scale;
    const isTarget = nearest.pad.index === pad.index;

    ctx.save();
    ctx.translate(screen.x, screen.y);
    ctx.rotate(Math.PI / 2 - (pad.angle + camera.rotation));

    if (size > 24) {
      const heightPx = Math.max(4, 7 * scale);
      const half = size / 2;
      ctx.fillStyle = '#2b3440';
      ctx.fillRect(-half, 0, size, heightPx);
      ctx.fillStyle = '#4b5c72';
      ctx.fillRect(-half, -1.5, size, 2.5);
      ctx.fillStyle = isTarget ? '#f5a524' : '#8899ab';
      ctx.fillRect(-2, -3, 4, 3);

      const towerHeight = Math.max(10, 62 * scale);
      const towerWidth = Math.max(2, 4 * scale);
      ctx.fillStyle = '#39485a';
      ctx.fillRect(-half * 0.72, -towerHeight, towerWidth, towerHeight);
      ctx.fillStyle = isTarget ? 'rgba(245,165,36,0.9)' : 'rgba(136,153,171,0.8)';
      ctx.fillRect(-half * 0.72, -towerHeight, towerWidth, 3);
    } else {
      ctx.fillStyle = isTarget ? '#f5a524' : '#66788c';
      ctx.beginPath();
      ctx.arc(0, 0, 3.2, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    if (size <= 60) {
      ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = isTarget ? 'rgba(245,165,36,0.95)' : 'rgba(150,168,188,0.8)';
      ctx.fillText(pad.name, screen.x, screen.y - 10);
    }
  }
}

function drawTrail(ctx, camera, trail) {
  if (!trail || trail.length < 2) return;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < trail.length; i++) {
    const screen = worldToScreen(camera, trail[i].x, trail[i].y);
    if (i === 0) ctx.moveTo(screen.x, screen.y);
    else ctx.lineTo(screen.x, screen.y);
  }
  ctx.strokeStyle = 'rgba(34, 211, 238, 0.25)';
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(125, 235, 255, 0.8)';
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.restore();
}

/** Ngọn lửa động cơ trong toạ độ thân tên lửa (đuôi ở −half, thổi về phía −x). */
function drawFlame(ctx, half, width, throttle, flicker) {
  const intensity = clamp01(throttle);
  if (intensity <= 0.01) return;
  const plume = (12 + 52 * intensity) * (0.9 + 0.25 * flicker);
  const halfWidth = width * 0.55 * (0.85 + 0.45 * flicker);

  const gradient = ctx.createLinearGradient(-half, 0, -half - plume, 0);
  gradient.addColorStop(0, 'rgba(255, 255, 248, 0.95)');
  gradient.addColorStop(0.16, 'rgba(255, 218, 132, 0.92)');
  gradient.addColorStop(0.5, 'rgba(255, 138, 42, 0.75)');
  gradient.addColorStop(1, 'rgba(255, 80, 20, 0)');

  ctx.beginPath();
  ctx.moveTo(-half, -halfWidth);
  ctx.quadraticCurveTo(-half - plume * 0.55, -halfWidth * 0.5, -half - plume, 0);
  ctx.quadraticCurveTo(-half - plume * 0.55, halfWidth * 0.5, -half, halfWidth);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();
}

/** Màu phát xạ của vỏ theo tỉ lệ nhiệt: đỏ sẫm → cam → vàng → trắng nóng. */
const HEAT_COLORS = [
  [0, [150, 34, 18]],
  [0.35, [226, 74, 24]],
  [0.7, [255, 158, 64]],
  [1, [255, 246, 224]],
];

function heatColor(ratio, alpha = 1) {
  const t = clamp01(ratio);
  let low = HEAT_COLORS[0];
  let high = HEAT_COLORS[HEAT_COLORS.length - 1];
  for (let i = 1; i < HEAT_COLORS.length; i++) {
    if (t <= HEAT_COLORS[i][0]) {
      low = HEAT_COLORS[i - 1];
      high = HEAT_COLORS[i];
      break;
    }
  }
  const span = high[0] - low[0] || 1;
  const k = (t - low[0]) / span;
  const r = Math.round(mix(low[1][0], high[1][0], k));
  const g = Math.round(mix(low[1][1], high[1][1], k));
  const b = Math.round(mix(low[1][2], high[1][2], k));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function drawRocketBody(ctx, sim) {
  const rocket = sim.rocket;
  const length = rocketLength(rocket);
  const half = length / 2;
  const width = 3.7;
  const flicker = 0.5 + 0.5 * Math.sin(performance.now() / 45);

  ctx.lineJoin = 'round';

  // Vùng quá nhiệt: hào quang đỏ bao quanh phần đuôi (nơi tấm chắn nhiệt hứng dòng khí),
  // mạnh dần khi vỏ tiến gần ngưỡng phá huỷ.
  const heatRatio = clamp01((rocket.heat - 400) / (LIMITS.maxHeat - 400));
  if (heatRatio > 0.01) {
    const pulse = 0.85 + 0.15 * Math.sin(performance.now() / 180);
    const haloX = -half * 0.45;
    const haloRadius = length * (0.55 + 0.25 * heatRatio);
    const halo = ctx.createRadialGradient(haloX, 0, 0, haloX, 0, haloRadius);
    halo.addColorStop(0, heatColor(heatRatio, 0.55 * pulse));
    halo.addColorStop(0.45, heatColor(heatRatio * 0.8, 0.26 * pulse));
    halo.addColorStop(1, heatColor(heatRatio * 0.6, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.ellipse(haloX, 0, haloRadius, haloRadius * 0.55, 0, 0, TAU);
    ctx.fill();
  }

  let cursor = -half;
  for (const stage of rocket.stages) {
    if (stage.separated) continue;
    const bodyGradient = ctx.createLinearGradient(0, -width / 2, 0, width / 2);
    bodyGradient.addColorStop(0, '#cfd9e4');
    bodyGradient.addColorStop(0.42, '#f6fafd');
    bodyGradient.addColorStop(1, '#8c9bab');
    ctx.fillStyle = bodyGradient;
    ctx.beginPath();
    ctx.roundRect(cursor, -width / 2, stage.length, width, 0.5);
    ctx.fill();

    ctx.fillStyle = 'rgba(28, 40, 54, 0.8)';
    ctx.fillRect(cursor + stage.length * 0.2, -width / 2, 0.5, width);
    ctx.fillRect(cursor + stage.length * 0.78, -width / 2, 0.35, width);
    cursor += stage.length;
  }

  const noseLength = half - cursor;
  if (noseLength > 0.1) {
    ctx.beginPath();
    ctx.moveTo(cursor, -width / 2);
    ctx.quadraticCurveTo(cursor + noseLength * 0.72, -width * 0.34, half, 0);
    ctx.quadraticCurveTo(cursor + noseLength * 0.72, width * 0.34, cursor, width / 2);
    ctx.closePath();
    const noseGradient = ctx.createLinearGradient(0, -width / 2, 0, width / 2);
    noseGradient.addColorStop(0, '#b7c5d4');
    noseGradient.addColorStop(0.5, '#eef4fa');
    noseGradient.addColorStop(1, '#7f8e9f');
    ctx.fillStyle = noseGradient;
    ctx.fill();
    ctx.strokeStyle = 'rgba(20, 30, 42, 0.55)';
    ctx.lineWidth = 0.18;
    ctx.stroke();
  }

  if (!rocket.stages[0].separated) {
    ctx.fillStyle = '#5c6b7c';
    ctx.beginPath();
    ctx.moveTo(-half + 0.6, -width / 2);
    ctx.lineTo(-half - 0.5, -width * 1.35);
    ctx.lineTo(-half + 3.4, -width / 2);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-half + 0.6, width / 2);
    ctx.lineTo(-half - 0.5, width * 1.35);
    ctx.lineTo(-half + 3.4, width / 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#3d4b5c';
    ctx.beginPath();
    ctx.moveTo(-half + 0.1, -width * 0.42);
    ctx.lineTo(-half - 1.6, -width * 0.62);
    ctx.lineTo(-half - 1.6, width * 0.62);
    ctx.lineTo(-half + 0.1, width * 0.42);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.fillStyle = '#3d4b5c';
    ctx.beginPath();
    ctx.moveTo(-half + 0.1, -width * 0.3);
    ctx.lineTo(-half - 1.1, -width * 0.45);
    ctx.lineTo(-half - 1.1, width * 0.45);
    ctx.lineTo(-half + 0.1, width * 0.3);
    ctx.closePath();
    ctx.fill();
  }

  if (rocket.chuteOpen > 0.02) {
    const open = rocket.chuteOpen;
    const anchor = half + 2;
    const distance = 6 + 28 * open;
    ctx.strokeStyle = 'rgba(200, 214, 230, 0.75)';
    ctx.lineWidth = 0.22;
    for (const offset of [-1, 0, 1]) {
      ctx.beginPath();
      ctx.moveTo(half - 0.4, offset * 0.4);
      ctx.lineTo(anchor + distance, offset * 4 * open);
      ctx.stroke();
    }
    const canopy = ctx.createLinearGradient(anchor, 0, anchor + distance, 0);
    canopy.addColorStop(0, '#f5a524');
    canopy.addColorStop(1, '#ffe6a8');
    ctx.fillStyle = canopy;
    ctx.beginPath();
    ctx.ellipse(anchor + distance, 0, distance * 0.45, 9 * open, 0, Math.PI / 2, (3 * Math.PI) / 2);
    ctx.fill();
  }

  if (sim.last.thrust > 0) {
    drawFlame(ctx, half, width, rocket.throttle, flicker);
  }

  if (heatRatio > 0.01) {
    // Thân nóng sáng: mạnh nhất ở tấm chắn nhiệt, lan dần lên trên và đổi sang trắng
    // khi gần 2 000 °C.
    const hotLength = length * (0.35 + 0.45 * heatRatio);
    const tint = ctx.createLinearGradient(-half, 0, -half + hotLength, 0);
    tint.addColorStop(0, heatColor(heatRatio, 0.9));
    tint.addColorStop(0.55, heatColor(heatRatio * 0.75, 0.5));
    tint.addColorStop(1, heatColor(heatRatio * 0.5, 0));
    ctx.fillStyle = tint;
    ctx.beginPath();
    ctx.roundRect(-half, -width / 2, hotLength, width, 0.6);
    ctx.fill();

    // Viền phát sáng quanh phần đang nóng để vùng quá nhiệt đọc được cả khi thân nhỏ.
    ctx.strokeStyle = heatColor(heatRatio, 0.7);
    ctx.lineWidth = 0.22;
    ctx.beginPath();
    ctx.roundRect(-half - 0.1, -width / 2 - 0.1, hotLength, width + 0.2, 0.7);
    ctx.stroke();
  }
}

const MIN_ROCKET_PIXELS = 46;
/** Mảnh vỡ vẫn phải nhìn thấy được khi camera đã lùi xa (nhỏ hơn tên lửa cho dễ phân biệt). */
const MIN_DEBRIS_PIXELS = 28;

/** Vẽ mảnh tách tầng: thân xoay chậm, phát sáng khi nóng, tóe bụi khi chạm đất. */
function drawDebris(ctx, camera, sim) {
  for (const piece of sim.debris) {
    const point = toEarthFrame(piece.x, piece.y, sim.time);
    const screen = worldToScreen(camera, point.x, point.y);
    if (
      screen.x < -120 ||
      screen.x > camera.width + 120 ||
      screen.y < -120 ||
      screen.y > camera.height + 120
    ) {
      continue;
    }

    const drawScale = Math.max(camera.scale, MIN_DEBRIS_PIXELS / piece.length);
    const angle = piece.theta - EARTH.OMEGA * sim.time;
    const half = piece.length / 2;
    const width = piece.diameter;
    const fade = piece.status === 'falling' ? 0 : clamp01(1 - piece.timer / 1.6);

    ctx.save();
    ctx.translate(screen.x, screen.y);
    ctx.rotate(screenAngle(camera, angle));
    ctx.scale(drawScale, drawScale);

    // Thân tầng đã dùng: xám hơn, không còn sáng bóng như tên lửa.
    const bodyGradient = ctx.createLinearGradient(0, -width / 2, 0, width / 2);
    bodyGradient.addColorStop(0, '#6f7d8c');
    bodyGradient.addColorStop(0.45, '#94a3b2');
    bodyGradient.addColorStop(1, '#4a5766');
    ctx.fillStyle = bodyGradient;
    ctx.beginPath();
    ctx.roundRect(-half, -width / 2, piece.length, width, 0.4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(12, 20, 30, 0.85)';
    ctx.lineWidth = 0.2;
    ctx.stroke();

    // Hai càng hạ cánh ở đuôi để nhận ra đây là tầng 1.
    ctx.fillStyle = '#3d4b5c';
    ctx.beginPath();
    ctx.moveTo(-half + 0.4, -width / 2);
    ctx.lineTo(-half - 1.2, -width * 1.2);
    ctx.lineTo(-half + 2.6, -width / 2);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-half + 0.4, width / 2);
    ctx.lineTo(-half - 1.2, width * 1.2);
    ctx.lineTo(-half + 2.6, width / 2);
    ctx.closePath();
    ctx.fill();

    // Gia nhiệt khi lao vào khí quyển: viền đỏ quanh vùng hứng nhiệt.
    const heatRatio = clamp01((piece.heat - 400) / (LIMITS.maxHeat - 400));
    if (heatRatio > 0.01) {
      const glow = ctx.createLinearGradient(-half, 0, -half + piece.length * 0.6, 0);
      glow.addColorStop(0, `rgba(255, 90, 30, ${0.9 * heatRatio})`);
      glow.addColorStop(1, 'rgba(255, 90, 30, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.roundRect(-half, -width / 2, piece.length * 0.6, width, 0.5);
      ctx.fill();
    }
    if (piece.status === 'burned') {
      ctx.fillStyle = `rgba(255, 140, 50, ${0.5 * fade})`;
      ctx.beginPath();
      ctx.arc(0, 0, piece.length * 0.9, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    // Bụi khi chạm đất.
    if (piece.status === 'landed' && fade > 0) {
      const radius = 6 + 26 * (1 - fade);
      ctx.save();
      ctx.fillStyle = `rgba(196, 178, 150, ${0.35 * fade})`;
      ctx.beginPath();
      ctx.ellipse(screen.x, screen.y, radius, radius * 0.45, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }
}

function drawRocket(ctx, camera, sim) {
  const length = rocketLength(sim.rocket);
  // Tên lửa luôn đủ lớn để nhìn thấy dù camera đã lùi rất xa để thấy cả Trái Đất.
  const drawScale = Math.max(camera.scale, MIN_ROCKET_PIXELS / length);
  const angle = sim.body.theta - EARTH.OMEGA * sim.time;

  // Quầng tối nhẹ giúp tên lửa trắng vẫn nổi bật trên nền trời sáng.
  const halo = Math.max(28, length * drawScale * 0.75);
  const glow = ctx.createRadialGradient(0, 0, halo * 0.25, 0, 0, halo);
  glow.addColorStop(0, 'rgba(6, 10, 16, 0.34)');
  glow.addColorStop(1, 'rgba(6, 10, 16, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, halo, 0, TAU);
  ctx.fill();

  ctx.save();
  ctx.rotate(screenAngle(camera, angle));
  ctx.scale(drawScale, drawScale);
  drawRocketBody(ctx, sim);
  ctx.restore();
}

/** Nhiễu xác định theo chỉ số — đủ ngẫu nhiên cho hạt lửa mà chạy lại vẫn giống nhau. */
function noise(i) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Hiệu ứng nổ tại tâm sân khấu (tên lửa luôn ở tâm): chớp sáng, cầu lửa loang ra,
 * vòng xung kích, tia lửa văng và khói tan dần. `age` tính bằng giây.
 */
function drawExplosion(ctx, width, height, age) {
  const cx = width / 2;
  const cy = height / 2;

  const flash = Math.max(0, 1 - age / 0.22);
  if (flash > 0.01) {
    const radius = 90 + 260 * (1 - flash);
    const burst = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    burst.addColorStop(0, `rgba(255, 255, 240, ${0.85 * flash})`);
    burst.addColorStop(0.45, `rgba(255, 210, 130, ${0.5 * flash})`);
    burst.addColorStop(1, 'rgba(255, 150, 60, 0)');
    ctx.fillStyle = burst;
    ctx.fillRect(0, 0, width, height);
  }

  if (age < 2.2) {
    const grow = Math.min(1, age / 0.8);
    const fade = clamp01(1 - (age - 0.5) / 1.7);
    const radius = 26 + 170 * Math.pow(grow, 0.55);
    const fire = ctx.createRadialGradient(cx, cy, radius * 0.05, cx, cy, radius);
    fire.addColorStop(0, `rgba(255, 252, 235, ${0.95 * fade})`);
    fire.addColorStop(0.35, `rgba(255, 196, 92, ${0.85 * fade})`);
    fire.addColorStop(0.7, `rgba(240, 108, 32, ${0.55 * fade})`);
    fire.addColorStop(1, 'rgba(120, 40, 10, 0)');
    ctx.fillStyle = fire;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, TAU);
    ctx.fill();
  }

  if (age < 1.1) {
    const ring = Math.min(1, age / 1.1);
    ctx.strokeStyle = `rgba(255, 226, 178, ${0.5 * (1 - ring)})`;
    ctx.lineWidth = Math.max(1, 5 * (1 - ring));
    ctx.beginPath();
    ctx.arc(cx, cy, 24 + 230 * Math.pow(ring, 0.7), 0, TAU);
    ctx.stroke();
  }

  for (let i = 0; i < 18; i++) {
    if (age > 1.4) break;
    const angle = noise(i) * TAU;
    const speed = 130 + noise(i + 31) * 300;
    const distance = speed * Math.min(age, 1.4) * (1 - 0.3 * Math.min(age, 1.4));
    const alpha = clamp01(1 - age / 1.4);
    const x = cx + Math.cos(angle) * distance;
    const y = cy + Math.sin(angle) * distance;
    const size = 1.4 + noise(i + 61) * 2.4;
    ctx.fillStyle = `rgba(255, ${Math.round(170 + 60 * noise(i + 91))}, 90, ${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, TAU);
    ctx.fill();
  }

  if (age > 0.25 && age < 3.2) {
    for (let i = 0; i < 8; i++) {
      const drift = noise(i + 13) * TAU;
      const rise = 30 + 96 * Math.min(age, 3.2);
      const spread = 26 + noise(i + 47) * 120;
      const alpha = clamp01((1 - age / 3.2) * 0.4);
      const x = cx + Math.cos(drift) * spread * (0.4 + age * 0.5);
      const y = cy + Math.sin(drift) * spread * (0.4 + age * 0.5) - rise * 0.4;
      const radius = 16 + 34 * Math.min(age, 2);
      const puff = ctx.createRadialGradient(x, y, 0, x, y, radius);
      puff.addColorStop(0, `rgba(96, 104, 116, ${alpha})`);
      puff.addColorStop(1, 'rgba(60, 66, 76, 0)');
      ctx.fillStyle = puff;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, TAU);
      ctx.fill();
    }
  }
}

function drawVelocityArrow(ctx, camera, sim) {
  const speed = sim.last.airspeed;
  if (speed < 5) return;
  const rel = {
    x: sim.body.vx + EARTH.OMEGA * sim.body.y,
    y: sim.body.vy - EARTH.OMEGA * sim.body.x,
  };
  const angle = screenAngle(camera, Math.atan2(rel.y, rel.x));
  const length = 26 + 40 * clamp01(Math.log10(1 + speed) / 4);
  ctx.save();
  ctx.translate(camera.width / 2, camera.height / 2);
  ctx.rotate(angle);
  ctx.strokeStyle = 'rgba(34, 211, 238, 0.7)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(48, 0);
  ctx.lineTo(48 + length, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(48 + length, 0);
  ctx.lineTo(48 + length - 7, -4.5);
  ctx.lineTo(48 + length - 7, 4.5);
  ctx.closePath();
  ctx.fillStyle = 'rgba(34, 211, 238, 0.85)';
  ctx.fill();
  ctx.restore();
}

function formatShortDistance(meters) {
  if (!Number.isFinite(meters)) return '—';
  if (meters < 1_000) return `${meters.toFixed(0)} m`;
  return `${(meters / 1_000).toFixed(1)} km`;
}

function drawTarget(ctx, camera, world, sim, width, height) {
  const position = earthPosition(sim);
  const nearest = nearestPad(world, position.x, position.y);
  const pad = world.pads[nearest.pad.index];
  const point = worldToScreen(camera, pad.x, pad.y);
  if (point.x < -60 || point.x > width + 60 || point.y < -60 || point.y > height + 60) return;

  const label = `${pad.name} · ${formatShortDistance(nearest.distance)}`;
  ctx.save();
  ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  const textWidth = ctx.measureText(label).width;
  ctx.fillStyle = 'rgba(8, 12, 18, 0.75)';
  ctx.beginPath();
  ctx.roundRect(point.x - textWidth / 2 - 7, point.y + 10, textWidth + 14, 20, 6);
  ctx.fill();
  ctx.strokeStyle = 'rgba(245, 165, 36, 0.55)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = 'rgba(255, 214, 140, 0.95)';
  ctx.fillText(label, point.x, point.y + 24);
  ctx.restore();
}

export function drawScene(ctx, view, sim, camera, effects = {}) {
  const { width, height } = view;
  const altitude = sim.last.altitudeAboveGround ?? 0;

  const position = earthPosition(sim);
  ctx.clearRect(0, 0, width, height);
  drawSky(ctx, width, height, altitude);
  drawStars(ctx, width, height, altitude, sim.time);
  drawPlanet(ctx, camera, width, height);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();
  drawPads(ctx, camera, sim.world, width, height, nearestPad(sim.world, position.x, position.y));
  drawTrail(ctx, camera, sim.trail);
  ctx.restore();

  const destroyed = sim.status === 'destroyed';
  if (!destroyed) {
    ctx.save();
    ctx.translate(width / 2, height / 2);
    drawRocket(ctx, camera, sim);
    ctx.restore();
  }

  // Mảnh tách tầng vẽ sau tên lửa: khi còn gần, nó phải nổi lên trên ngọn lửa
  // thay vì bị luồng xả che mất.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();
  drawDebris(ctx, camera, sim);
  ctx.restore();

  if (!destroyed) drawVelocityArrow(ctx, camera, sim);
  if (altitude < 260_000) drawTarget(ctx, camera, sim.world, sim, width, height);
  if (destroyed && Number.isFinite(effects.explosionMs)) {
    drawExplosion(ctx, width, height, effects.explosionMs / 1_000);
  }

  if (sim.rocket.heat > LIMITS.warnHeat) {
    const heatRatio = clamp01((sim.rocket.heat - LIMITS.warnHeat) / (LIMITS.maxHeat - LIMITS.warnHeat));
    const vignette = ctx.createRadialGradient(
      width / 2,
      height / 2,
      Math.min(width, height) * 0.25,
      width / 2,
      height / 2,
      Math.max(width, height) * 0.72,
    );
    vignette.addColorStop(0, 'rgba(255, 70, 20, 0)');
    vignette.addColorStop(1, `rgba(255, 70, 20, ${0.45 * heatRatio})`);
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
  }
}
