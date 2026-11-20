// Public (no login) endpoints used by the supplier's purchase order page. Mounted under /public next to the quotation links.
import { Router } from 'express';
import { getPublicPo, markPoOpened, respondPublicPo } from '../lib/school-po-mail.js';

export const schoolPoPublicRouter = Router();
const tokenOf = (v: unknown) => String(Array.isArray(v) ? v[0] : v ?? '');

schoolPoPublicRouter.get('/school-po/:token', async (req, res, next) => {
  try { res.json({ data: await getPublicPo(tokenOf(req.params.token)) }); } catch (e) { next(e); }
});
schoolPoPublicRouter.post('/school-po/:token/opened', async (req, res, next) => {
  try { await markPoOpened(tokenOf(req.params.token)); res.json({ data: { ok: true } }); } catch (e) { next(e); }
});
schoolPoPublicRouter.post('/school-po/:token/respond', async (req, res, next) => {
  try { res.json({ data: await respondPublicPo(tokenOf(req.params.token), (req.body ?? {}) as Record<string, unknown>) }); } catch (e) { next(e); }
});