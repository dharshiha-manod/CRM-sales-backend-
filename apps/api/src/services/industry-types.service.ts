import * as repo from '../repositories/industry-types.repository.js';

export const industryTypeService = {
  list: repo.listIndustryTypes,
  get: repo.getIndustryType,
  create: repo.createIndustryType,
  update: repo.updateIndustryType,
  productTags: {
    list: repo.listProductIndustryTypes,
    set: repo.setProductIndustryTypes
  }
};