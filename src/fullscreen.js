/**
 * Toàn màn hình cho cả trang.
 *
 * Đích là <html> chứ không phải .app: khi một phần tử vào chế độ toàn màn hình, các
 * phần tử khác của body không còn được vẽ — chọn .app sẽ làm màn hình kết quả
 * (#result, một sibling của .app) biến mất đúng lúc phi vụ kết thúc.
 *
 * Nút bấm không tự giữ trạng thái: mọi thay đổi đều đọc lại từ trình duyệt qua
 * fullscreenchange, nên Esc, F11 hay thoát bằng thanh công cụ đều cập nhật nút đúng.
 */

/** Trả về cặp tên API/tiền tố phù hợp với trình duyệt (chuẩn hoặc webkit). */
function resolveApi(doc) {
  const root = doc.documentElement;
  const standard = 'fullscreenEnabled' in doc;
  return {
    supported: Boolean(standard ? doc.fullscreenEnabled : doc.webkitFullscreenEnabled),
    current: () => doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null,
    request: standard ? root.requestFullscreen?.bind(root) : root.webkitRequestFullscreen?.bind(root),
    exit: standard ? doc.exitFullscreen?.bind(doc) : doc.webkitExitFullscreen?.bind(doc),
  };
}

export function createFullscreen({ button, doc = document, onError } = {}) {
  const api = resolveApi(doc);
  const usable = api.supported && Boolean(api.request) && Boolean(api.exit);
  const isActive = () => api.current() !== null;

  const sync = () => {
    const active = isActive();
    const label = active ? 'Thoát toàn màn hình' : 'Toàn màn hình';
    button.classList.toggle('is-fullscreen', active);
    button.setAttribute('aria-pressed', String(active));
    button.setAttribute('aria-label', label);
    button.title = label;
  };

  if (!usable) {
    button.hidden = true;
    return {
      supported: false,
      isActive: () => false,
      toggle() {},
      exit() {},
      destroy() {},
    };
  }

  const fail = () => onError?.('Trình duyệt từ chối toàn màn hình');

  async function enter() {
    try {
      const pending = api.request();
      if (pending?.then) await pending;
    } catch {
      // Chính sách trình duyệt hoặc người dùng từ chối.
      fail();
    }
  }

  async function exit() {
    if (!isActive()) return;
    try {
      const pending = api.exit();
      if (pending?.then) await pending;
    } catch {
      /* Esc của trình duyệt có thể đã thoát trước đó — không phải lỗi. */
    }
  }

  const toggle = () => (isActive() ? exit() : enter());

  doc.addEventListener('fullscreenchange', sync);
  doc.addEventListener('webkitfullscreenchange', sync);
  sync();

  return {
    supported: true,
    isActive,
    toggle,
    exit,
    destroy() {
      doc.removeEventListener('fullscreenchange', sync);
      doc.removeEventListener('webkitfullscreenchange', sync);
    },
  };
}
