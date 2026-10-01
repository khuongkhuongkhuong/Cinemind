import { Router } from 'express';
import * as ctrl from '../../controllers/admin/catalog.controller.js';
import { validate } from '../../middlewares/validate.js';
import {
  createComboSchema, createPromotionSchema, genreSchema, idParam, updateComboSchema, updatePromotionSchema,
} from '../../validators/admin.catalog.schema.js';

// Gom thể loại, combo, khuyến mãi: đều là danh mục đơn giản (liệt kê / tạo / sửa / xóa). Gắn vào /admin/genres, /combos, /promotions.
export const genreRoutes = Router();
genreRoutes.get('/', ctrl.listGenres);
genreRoutes.post('/', validate(genreSchema), ctrl.createGenre);
genreRoutes.put('/:id', validate(idParam, 'params'), validate(genreSchema), ctrl.updateGenre);
genreRoutes.delete('/:id', validate(idParam, 'params'), ctrl.deleteGenre);

export const comboRoutes = Router();
comboRoutes.get('/', ctrl.listCombos);
comboRoutes.post('/', validate(createComboSchema), ctrl.createCombo);
comboRoutes.put('/:id', validate(idParam, 'params'), validate(updateComboSchema), ctrl.updateCombo);
comboRoutes.delete('/:id', validate(idParam, 'params'), ctrl.deleteCombo);

export const promotionRoutes = Router();
promotionRoutes.get('/', ctrl.listPromotions);
promotionRoutes.post('/', validate(createPromotionSchema), ctrl.createPromotion);
promotionRoutes.put('/:id', validate(idParam, 'params'), validate(updatePromotionSchema), ctrl.updatePromotion);
promotionRoutes.delete('/:id', validate(idParam, 'params'), ctrl.deletePromotion);
