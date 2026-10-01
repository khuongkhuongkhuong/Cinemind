// Giờ lưu UTC; nghiệp vụ (ngày thường/cuối tuần, "hôm nay") tính theo giờ Việt Nam (UTC+7, không có giờ mùa hè).
export const VN_OFFSET_MS = 7 * 3600_000;

/** Đổi một mốc UTC thành Date "giả" mà các hàm getUTC* trả về đúng giờ/ngày Việt Nam. */
export function toVnClock(date) {
  return new Date(date.getTime() + VN_OFFSET_MS);
}

/** Thứ trong tuần theo giờ VN: 0 = Chủ nhật ... 6 = Thứ bảy. */
export function vnWeekday(date) {
  return toVnClock(date).getUTCDay();
}
