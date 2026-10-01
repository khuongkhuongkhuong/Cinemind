/** Bỏ dấu tiếng Việt + chữ thường: "Nhà Bà Nữ" -> "nha ba nu" (dùng cho searchKey). */
export function removeAccents(str) {
  return str
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

/** "Nhà Bà Nữ" -> "nha-ba-nu" */
export function slugify(str) {
  return removeAccents(str)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
