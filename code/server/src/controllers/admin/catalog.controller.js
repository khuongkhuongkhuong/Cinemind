import * as catalogAdmin from '../../services/adminCatalog.service.js';
import * as promotionAdmin from '../../services/adminPromotion.service.js';
import { ok } from '../../utils/response.js';

const noContent = (res) => res.status(204).end();

// ---- Thể loại ----
export const listGenres = async (req, res) => ok(res, await catalogAdmin.listGenres());
export const createGenre = async (req, res) => ok(res, await catalogAdmin.createGenre(req.body), 201);
export const updateGenre = async (req, res) => ok(res, await catalogAdmin.updateGenre({ genreId: req.params.id, ...req.body }));
export const deleteGenre = async (req, res) => { await catalogAdmin.deleteGenre({ genreId: req.params.id }); noContent(res); };

// ---- Combo ----
export const listCombos = async (req, res) => ok(res, await catalogAdmin.listCombos());
export const createCombo = async (req, res) => ok(res, await catalogAdmin.createCombo(req.body), 201);
export const updateCombo = async (req, res) => ok(res, await catalogAdmin.updateCombo({ comboId: req.params.id, ...req.body }));
export const deleteCombo = async (req, res) => { await catalogAdmin.deleteCombo({ comboId: req.params.id }); noContent(res); };

// ---- Khuyến mãi ----
export const listPromotions = async (req, res) => ok(res, await promotionAdmin.listPromotions());
export const createPromotion = async (req, res) => ok(res, await promotionAdmin.createPromotion(req.body), 201);
export const updatePromotion = async (req, res) => ok(res, await promotionAdmin.updatePromotion({ promotionId: req.params.id, ...req.body }));
export const deletePromotion = async (req, res) => { await promotionAdmin.deletePromotion({ promotionId: req.params.id }); noContent(res); };
