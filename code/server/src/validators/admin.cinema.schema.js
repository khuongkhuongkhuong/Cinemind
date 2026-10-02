import { z } from 'zod';

const phone = z.string().trim().regex(/^0\d{9}$/, 'Số điện thoại gồm 10 chữ số, bắt đầu bằng 0');
const fields = {
  cityId: z.uuid('cityId không hợp lệ'),
  name: z.string().trim().min(1, 'Vui lòng nhập tên rạp').max(100),
  address: z.string().trim().min(1, 'Vui lòng nhập địa chỉ').max(255),
  phone: phone.nullable(),
  isActive: z.boolean(),
};

export const createCinemaSchema = z.object({
  cityId: fields.cityId, name: fields.name, address: fields.address,
  phone: fields.phone.optional(), isActive: fields.isActive.optional(),
}).strict();

export const updateCinemaSchema = z.object(
  Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.optional()])),
).strict().refine((v) => Object.keys(v).length > 0, { message: 'Cần ít nhất một trường để sửa.' });
