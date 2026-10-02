// Lý do một mã khuyến mãi bị từ chối (`details.reason` của lỗi PROMO_INVALID, hợp đồng API mục 1.2).
const REASONS = {
  NOT_FOUND: 'Mã không tồn tại hoặc đã bị tắt.',
  NOT_STARTED: 'Mã chưa đến thời gian áp dụng.',
  EXPIRED: 'Mã đã hết hạn.',
  USAGE_LIMIT_REACHED: 'Mã đã hết lượt sử dụng.',
  MIN_ORDER_NOT_MET: 'Đơn hàng chưa đạt giá trị tối thiểu để dùng mã này.',
  ALREADY_USED: 'Bạn đã dùng mã này rồi.',
};

export const promoReasonMessage = (reason) => REASONS[reason] ?? 'Mã khuyến mãi không dùng được.';
