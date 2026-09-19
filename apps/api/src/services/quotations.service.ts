import * as repository from '../repositories/quotations.repository.js';

export const quotationService = {
  createFromRequirement: repository.createFromRequirement,
  get: repository.getQuotation,
  list: repository.listQuotations,
  update: repository.updateQuotation,
  send: repository.sendQuotation,
  publicGet: repository.getPublicQuotation,
  publicDecision: repository.recordPublicDecision,
  approve: repository.approveQuotation,
  deny: repository.denyQuotation,
  convertToOrder: repository.convertToOrder,
};
