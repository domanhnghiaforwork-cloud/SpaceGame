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
  KeyP: 'chute',
  KeyT: 'warp',
  Escape: 'pause',
  KeyR: 'restart',
  KeyE: 'end',
  KeyM: 'mute',
};

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

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', releaseAll);

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

  return {
    holds,
    releaseAll,
    destroy() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', releaseAll);
    },
  };
}
