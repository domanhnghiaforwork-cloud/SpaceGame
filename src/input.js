/**
 * Nhập liệu: bàn phím và nút bấm trên màn hình. Các nút giữ (ga, nghiêng) dùng
 * pointer events nên chơi được bằng chuột, cảm ứng hoặc bàn phím.
 */

export const HOLD_ACTIONS = ['throttleUp', 'throttleDown', 'pitchLeft', 'pitchRight'];

const KEY_TO_HOLD = {
  KeyW: 'throttleUp',
  ArrowUp: 'throttleUp',
  KeyS: 'throttleDown',
  ArrowDown: 'throttleDown',
  KeyA: 'pitchLeft',
  ArrowLeft: 'pitchLeft',
  KeyD: 'pitchRight',
  ArrowRight: 'pitchRight',
};

const KEY_TO_ACTION = {
  Space: 'separate',
  KeyP: 'chute-drogue',
  KeyO: 'chute-main',
  Equal: 'zoom-in',
  NumpadAdd: 'zoom-in',
  Minus: 'zoom-out',
  NumpadSubtract: 'zoom-out',
  KeyK: 'pause',
  KeyC: 'camera',
  KeyF: 'forces',
  Escape: 'exit-fullscreen',
  KeyR: 'restart',
  KeyE: 'end',
  KeyM: 'mute',
};

/** Tên hiển thị của các phím không phải chữ/số. */
const SPECIAL_KEY_LABELS = {
  Space: 'Space',
  Escape: 'Esc',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

const isLetterOrDigit = (code) => code.startsWith('Key') || code.startsWith('Digit');

/** Mã phím (`event.code`) → chữ in trên nút, ví dụ `KeyW` → `W`, `Escape` → `Esc`. */
export function keyLabel(code) {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return SPECIAL_KEY_LABELS[code] ?? code;
}

/**
 * Phím chính của mỗi thao tác: ưu tiên phím chữ/số để nhãn nút ngắn và dễ đọc
 * (`W` thay vì `↑`), nếu không có mới lấy phím khai báo đầu tiên. Suy ra từ chính
 * hai bảng phím trên, nên đổi phím ở đây là đổi luôn nhãn trên nút.
 */
function primaryKeyLabels(keyMap) {
  const codes = new Map();
  for (const [code, name] of Object.entries(keyMap)) {
    const current = codes.get(name);
    if (!current || (!isLetterOrDigit(current) && isLetterOrDigit(code))) codes.set(name, code);
  }
  return Object.fromEntries([...codes].map(([name, code]) => [name, keyLabel(code)]));
}

export const SHORTCUTS = {
  hold: primaryKeyLabels(KEY_TO_HOLD),
  action: primaryKeyLabels(KEY_TO_ACTION),
};

/** In phím tắt vào cuối nhãn các nút có `data-hold` / `data-action`, dạng `Ga lên (W)`. */
export function applyKeyLabels(doc = document) {
  doc.querySelectorAll('[data-hold], [data-action]').forEach((button) => {
    const label = button.dataset.hold
      ? SHORTCUTS.hold[button.dataset.hold]
      : SHORTCUTS.action[button.dataset.action];
    if (!label) return;
    let hint = button.querySelector('.key');
    if (!hint) {
      hint = doc.createElement('span');
      hint.className = 'key';
      button.append(hint);
    }
    hint.textContent = `(${label})`;
  });
}

export function createInput(handlers = {}, doc = document) {
  const holds = Object.fromEntries(HOLD_ACTIONS.map((name) => [name, false]));
  const heldButtons = new Map();

  const setHold = (name, value) => {
    if (!(name in holds)) return;
    holds[name] = value;
  };

  const onKeyDown = (event) => {
    if (event.repeat) {
      if (KEY_TO_HOLD[event.code]) event.preventDefault();
      if (KEY_TO_ACTION[event.code] === 'separate') event.preventDefault();
      return;
    }
    const hold = KEY_TO_HOLD[event.code];
    if (hold) {
      setHold(hold, true);
      event.preventDefault();
      return;
    }
    const action = KEY_TO_ACTION[event.code];
    if (action) {
      if (event.code === 'Space') event.preventDefault();
      handlers.onAction?.(action);
    }
  };

  const onKeyUp = (event) => {
    const hold = KEY_TO_HOLD[event.code];
    if (hold) {
      setHold(hold, false);
      event.preventDefault();
    }
  };

  const releaseAll = () => {
    for (const name of HOLD_ACTIONS) setHold(name, false);
    for (const [button, name] of heldButtons) {
      button.classList.remove('held');
      setHold(name, false);
    }
    heldButtons.clear();
  };

  // Lăn chuột để zoom ở góc nhìn xa.
  const onWheel = (event) => {
    if (!handlers.onZoom) return;
    handlers.onZoom(event.deltaY);
    event.preventDefault();
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', releaseAll);
  doc.addEventListener('wheel', onWheel, { passive: false });

  const bindButton = (button) => {
    const hold = button.dataset.hold;
    if (hold) {
      const press = (event) => {
        event.preventDefault();
        button.setPointerCapture?.(event.pointerId);
        setHold(hold, true);
        button.classList.add('held');
        heldButtons.set(button, hold);
        handlers.onFirstGesture?.();
      };
      const release = () => {
        setHold(hold, false);
        button.classList.remove('held');
        heldButtons.delete(button);
      };
      button.addEventListener('pointerdown', press);
      button.addEventListener('pointerup', release);
      button.addEventListener('pointerleave', release);
      button.addEventListener('pointercancel', release);
      return;
    }

    const action = button.dataset.action;
    if (action) {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        handlers.onFirstGesture?.();
        handlers.onAction?.(action);
      });
    }
  };

  doc.querySelectorAll('[data-hold], [data-action]').forEach(bindButton);
  applyKeyLabels(doc);

  return {
    holds,
    releaseAll,
    destroy() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', releaseAll);
      doc.removeEventListener('wheel', onWheel);
    },
  };
}
