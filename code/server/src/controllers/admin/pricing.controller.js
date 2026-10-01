import * as pricingService from '../../services/adminPricing.service.js';
import * as bannerService from '../../services/adminBanner.service.js';
import { ok } from '../../utils/response.js';

export async function getPricing(req, res) {
  ok(res, await pricingService.getPricing());
}

export async function setPricing(req, res) {
  ok(res, await pricingService.setPricing(req.body));
}

// ---- Banner (đặt chung file với bảng giá cho gọn: cả hai đều là cấu hình hiển thị / giá của hệ thống) ----
export const listBanners = async (req, res) => ok(res, await bannerService.listBanners());
export const createBanner = async (req, res) => ok(res, await bannerService.createBanner(req.body), 201);
export const updateBanner = async (req, res) => ok(res, await bannerService.updateBanner({ bannerId: req.params.id, ...req.body }));
export const deleteBanner = async (req, res) => { await bannerService.deleteBanner({ bannerId: req.params.id }); res.status(204).end(); };
