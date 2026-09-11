import * as repository from '../repositories/requirements.repository.js';

export const requirementService = {
  create: repository.createRequirement,
  get: repository.getRequirement,
  list: repository.listRequirements,
  update: repository.updateRequirement,
};