/**
 * Âm thanh tổng hợp bằng WebAudio: tiếng gầm động cơ (nhiễu lọc), tiếng cảnh báo.
 * Không dùng tệp âm thanh nên toàn bộ game vẫn chỉ gồm vài tệp văn bản.
 */

export function createAudio() {
  let context = null;
  let master = null;
  let engineGain = null;
  let engineFilter = null;
  let rumbleGain = null;
  let muted = false;
  let ready = false;

  function build() {
    if (ready) return;
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return;
    context = new AudioCtor();
    master = context.createGain();
    master.gain.value = muted ? 0 : 0.55;
    master.connect(context.destination);

    const length = context.sampleRate * 2;
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    }

    const noise = context.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    engineFilter = context.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 320;
    engineFilter.Q.value = 0.8;

    engineGain = context.createGain();
    engineGain.gain.value = 0;

    noise.connect(engineFilter).connect(engineGain).connect(master);
    noise.start();

    const rumble = context.createOscillator();
    rumble.type = 'sawtooth';
    rumble.frequency.value = 42;
    rumbleGain = context.createGain();
    rumbleGain.gain.value = 0;
    rumble.connect(rumbleGain).connect(master);
    rumble.start();

    ready = true;
  }

  function start() {
    build();
    if (context && context.state === 'suspended') context.resume();
  }

  function setEngine(throttle, density) {
    if (!ready) return;
    const air = Math.min(1, Math.max(0, density / 0.4));
    const level = Math.min(1, Math.max(0, throttle)) * (0.25 + 0.75 * air);
    const now = context.currentTime;
    engineGain.gain.setTargetAtTime(level * 0.5, now, 0.08);
    rumbleGain.gain.setTargetAtTime(level * 0.16, now, 0.1);
    engineFilter.frequency.setTargetAtTime(220 + 900 * level * air, now, 0.12);
  }

  function tone(frequency, duration, gainValue = 0.12, type = 'square') {
    if (!ready) return;
    const now = context.currentTime;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(gainValue, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain).connect(master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  function warning() {
    tone(880, 0.22, 0.09, 'square');
    setTimeout(() => tone(660, 0.26, 0.09, 'square'), 260);
  }

  function confirm() {
    tone(520, 0.12, 0.08, 'triangle');
    setTimeout(() => tone(780, 0.16, 0.07, 'triangle'), 110);
  }

  function toggleMute() {
    muted = !muted;
    if (ready) master.gain.setTargetAtTime(muted ? 0 : 0.55, context.currentTime, 0.05);
    return muted;
  }

  return {
    start,
    setEngine,
    warning,
    confirm,
    toggleMute,
    isMuted: () => muted,
    isReady: () => ready,
  };
}
