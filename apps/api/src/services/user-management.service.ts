import * as repository from '../repositories/user-management.repository.js';

export const userManagementService = {
  listUsers: repository.listOrganizationUsers,
  listRoles: repository.listRoles,
  saveMembership: repository.saveMembership,
  createUser: repository.createOrganizationUser,
  updateUser: repository.updateOrganizationUser,
  setUserStatus: repository.setOrganizationUserStatus,
  resetUserPassword: repository.resetOrganizationUserPassword,
  deleteUser: repository.deleteOrganizationUser
};
