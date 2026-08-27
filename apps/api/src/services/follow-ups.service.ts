import * as repository from '../repositories/follow-ups.repository.js';
export const followUpService = { createFromVisit: repository.createFromVisit, list: repository.listFollowUps, update: repository.updateFollowUp };
