import * as repository from '../repositories/organization-settings.repository.js';

export const organizationSettingsService = {
  get: repository.getOrganizationSettings,
  save: repository.saveOrganizationSettings,
};
