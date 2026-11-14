import { prisma } from '../config/prisma.js';

/**
 * Dòng bảng giá gốc theo định dạng + loại ngày (BR-12).
 * @param {{ format: 'F2D'|'F3D'|'IMAX', dayType: 'WEEKDAY'|'WEEKEND' }} key
 * @returns {Promise<object|null>} PriceRule hoặc null
 */
export const findPriceRule = ({ format, dayType }, db = prisma) =>
  db.priceRule.findUnique({ where: { format_dayType: { format, dayType } } });
