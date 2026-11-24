import * as repo from '../repositories/targets.repository.js';

export const targetsService = {
  list: repo.listTargets,
  mine: repo.listMyTargets,
  get: repo.getTarget,
  create: repo.createTarget,
  update: repo.updateTarget,
  setLifecycle: repo.setLifecycle,
  adjust: repo.adjustTarget,
  remove: repo.deleteTarget,
};