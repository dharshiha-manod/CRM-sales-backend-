import * as repository from '../repositories/quotation-email-templates.repository.js';
export const quotationEmailTemplateService = { get: repository.getQuotationEmailTemplate, save: repository.saveQuotationEmailTemplate };
