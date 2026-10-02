import '@testing-library/jest-dom/vitest';

// jsdom chưa cài <dialog>.showModal()/close() (trình duyệt thật có). Bù lại đủ để test thấy hộp thoại mở / đóng.
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}
