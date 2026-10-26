// School industry routes. Every route resolves the caller's industry and refuses to run unless it is School, so
// these endpoints can never read or write another industry's data.
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { AppError } from '../errors/app-error.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireRoles } from '../middleware/authorize.js';
import { resolveIndustryTypeId } from '../lib/industry-scope.js';
import { isSchoolIndustry } from '../lib/school.js';
import {
  createAcademicYear, createPricingRule, createTerm, deleteAcademicYear, deletePricingRule, deleteTerm, listAcademicYears, listPricingRules,
  ruleSchema, schoolLedger, schoolSalesSummary, termSchema, updateAcademicYear, updatePricingRule, updateTerm, yearSchema,
} from '../repositories/school.repository.js';

type Req = Parameters<RequestHandler>[0];
const org = (req: Req) => { const v = req.header('x-organization-id'); if (!v) throw new AppError(400, 'ORGANIZATION_CONTEXT_REQUIRED', 'x-organization-id is required'); return v; };
const schoolId = async (req: Req): Promise<string> => {
  const id = resolveIndustryTypeId(req.industryScope!, typeof req.query.industryTypeId === 'string' ? req.query.industryTypeId : null);
  if (!id || !(await isSchoolIndustry(org(req), id))) throw new AppError(422, 'NOT_SCHOOL', 'This is only available in the School industry.');
  return id;
};
const uuid = (value: unknown) => z.string().uuid().parse(Array.isArray(value) ? value[0] : value);
const idParam = (req: Req) => uuid(req.params.id);
const optionalUuid = (value: unknown) => (typeof value === 'string' && value ? z.string().uuid().parse(value) : null);
const manage = requireRoles('super_admin', 'admin', 'sales_manager');
const adminOnly = requireRoles('super_admin', 'admin');

export const schoolRouter = Router();

// Academic years + terms
schoolRouter.get('/school/academic-years', authenticate, manage, async (req, res) => res.json({ data: await listAcademicYears(org(req), await schoolId(req)) }));
schoolRouter.post('/school/academic-years', authenticate, manage, async (req, res) => res.status(201).json({ data: await createAcademicYear(org(req), req.auth!.sub!, await schoolId(req), yearSchema.parse(req.body ?? {})) }));
schoolRouter.patch('/school/academic-years/:id', authenticate, manage, async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const input = Object.keys(body).length === 1 && 'status' in body ? z.object({ status: z.enum(['active', 'closed']) }).parse(body) : yearSchema.parse(body);
  res.json({ data: await updateAcademicYear(org(req), await schoolId(req), idParam(req), input) });
});
schoolRouter.delete('/school/academic-years/:id', authenticate, adminOnly, async (req, res) => { await deleteAcademicYear(org(req), await schoolId(req), idParam(req)); res.status(204).send(); });
schoolRouter.post('/school/academic-years/:id/terms', authenticate, manage, async (req, res) => res.status(201).json({ data: await createTerm(org(req), await schoolId(req), idParam(req), termSchema.parse(req.body ?? {})) }));
schoolRouter.patch('/school/academic-years/:id/terms/:termId', authenticate, manage, async (req, res) => res.json({ data: await updateTerm(org(req), await schoolId(req), idParam(req), uuid(req.params.termId), termSchema.parse(req.body ?? {})) }));
schoolRouter.delete('/school/academic-years/:id/terms/:termId', authenticate, manage, async (req, res) => res.json({ data: await deleteTerm(org(req), await schoolId(req), idParam(req), uuid(req.params.termId)) }));

// Specific pricing & discount rules
schoolRouter.get('/school/pricing-rules', authenticate, manage, async (req, res) => res.json({ data: await listPricingRules(org(req), await schoolId(req)) }));
schoolRouter.post('/school/pricing-rules', authenticate, manage, async (req, res) => res.status(201).json({ data: await createPricingRule(org(req), req.auth!.sub!, await schoolId(req), ruleSchema.parse(req.body ?? {})) }));
schoolRouter.patch('/school/pricing-rules/:id', authenticate, manage, async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const input = Object.keys(body).length === 1 && 'status' in body ? z.object({ status: z.enum(['active', 'inactive']) }).parse(body) : ruleSchema.parse(body);
  res.json({ data: await updatePricingRule(org(req), await schoolId(req), idParam(req), input) });
});
schoolRouter.delete('/school/pricing-rules/:id', authenticate, manage, async (req, res) => { await deletePricingRule(org(req), await schoolId(req), idParam(req)); res.status(204).send(); });

// School-wise sales & collection (derived from real orders + collections, optionally for one academic year / term)
schoolRouter.get('/school/sales-summary', authenticate, manage, async (req, res) =>
  res.json({ data: await schoolSalesSummary(org(req), await schoolId(req), { academicYearId: optionalUuid(req.query.academicYearId), termId: optionalUuid(req.query.termId) }) }));
schoolRouter.get('/school/schools/:id/ledger', authenticate, manage, async (req, res) =>
  res.json({ data: await schoolLedger(org(req), await schoolId(req), idParam(req), { academicYearId: optionalUuid(req.query.academicYearId), termId: optionalUuid(req.query.termId) }) }));
