import { Router } from 'express';
import * as ctrl from '../../controllers/admin/pricing.controller.js';
import { validate } from '../../middlewares/validate.js';
import { pricingSchema } from '../../validators/admin.pricing.schema.js';
import { bannerIdParam, createBannerSchema, updateBannerSchema } from '../../validators/admin.banner.schema.js';

export const pricingRoutes = Router();
pricingRoutes.get('/', ctrl.getPricing);
pricingRoutes.put('/', validate(pricingSchema), ctrl.setPricing);

export const bannerRoutes = Router();
bannerRoutes.get('/', ctrl.listBanners);
bannerRoutes.post('/', validate(createBannerSchema), ctrl.createBanner);
bannerRoutes.put('/:id', validate(bannerIdParam, 'params'), validate(updateBannerSchema), ctrl.updateBanner);
bannerRoutes.delete('/:id', validate(bannerIdParam, 'params'), ctrl.deleteBanner);
