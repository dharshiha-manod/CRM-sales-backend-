import type { RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { resolveIndustryTypeId } from '../lib/industry-scope.js';
import { quotationEmailTemplateService } from '../services/quotation-email-templates.service.js';
import { quotationEmailTemplateSchema } from '../validation/quotation-email-templates.schemas.js';

const org = (req: Parameters<RequestHandler>[0]) => { const value = req.header('x-organization-id'); if (!value) throw new AppError(400, 'ORGANIZATION_CONTEXT_REQUIRED', 'x-organization-id is required'); return value; };
const industry = (req: Parameters<RequestHandler>[0]) => { const requested = typeof req.query.industryTypeId === 'string' ? req.query.industryTypeId : undefined; const value = resolveIndustryTypeId(req.industryScope!, requested); if (!value) throw new AppError(400, 'INDUSTRY_CONTEXT_REQUIRED', 'industryTypeId is required for quotation email settings.'); return value; };

export const quotationEmailTemplates: Record<string, RequestHandler> = {
  get: async (req, res) => res.json({ data: await quotationEmailTemplateService.get(org(req), industry(req), req.industryScope!) }),
  save: async (req, res) => { const input = quotationEmailTemplateSchema.parse(req.body); const allowed = resolveIndustryTypeId(req.industryScope!, input.industryTypeId); if (allowed !== input.industryTypeId) throw new AppError(403, 'INDUSTRY_NOT_ASSIGNED', 'You are not assigned to this industry.'); res.json({ data: await quotationEmailTemplateService.save(org(req), input, req.industryScope!) }); },
};
