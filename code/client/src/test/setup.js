import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';

// findBy* / waitFor mặc định chờ 1 giây: khi chạy song song hàng chục file test, lần dựng đầu có thể lâu hơn nên test lúc qua lúc không.
configure({ asyncUtilTimeout: 4000 });

// jsdom chưa cài <dialog>.showModal()/close() (trình duyệt thật có). Bù lại đủ để test thấy hộp thoại mở / đóng.
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}
