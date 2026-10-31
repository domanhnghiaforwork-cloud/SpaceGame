/**
 * Giữ hiệu ứng nổ trên màn hình một lúc trước khi kết thúc phi vụ.
 *
 * Tách khỏi vòng lặp khung hình để hành vi có thể kiểm chứng độc lập: hẹn giờ một
 * lần duy nhất, huỷ được khi chơi lại, và không phụ thuộc số khung hình (tab nền
 * vẫn kết thúc đúng lúc).
 */

export function createEndHold({ holdMs, onElapsed, schedule = setTimeout, cancel = clearTimeout }) {
  let timer = 0;

  return {
    /** Đặt hẹn giờ nếu chưa có. Trả về true khi thực sự đặt mới. */
    start() {
      if (timer) return false;
      timer = schedule(() => {
        timer = 0;
        onElapsed();
      }, holdMs);
      return true;
    },

    /** Huỷ hẹn giờ đang chờ (dùng khi chơi lại). */
    cancel() {
      if (!timer) return false;
      cancel(timer);
      timer = 0;
      return true;
    },

    get pending() {
      return Boolean(timer);
    },
  };
}
