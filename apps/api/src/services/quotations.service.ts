import * as repository from '../repositories/quotations.repository.js';

export const quotationService = {
  createFromRequirement: repository.createFromRequirement,
  get: repository.getQuotation,
  list: repository.listQuotations,
  update: repository.updateQuotation,
  convertToOrder: repository.convertToOrder,
};