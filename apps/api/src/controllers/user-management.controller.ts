import type { RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { userManagementService } from '../services/user-management.service.js';
import { userCreateSchema, userMembershipSchema, userPasswordResetSchema, userStatusSchema, userUpdateSchema } from '../validation/user-management.schemas.js';

const organizationId = (req: Parameters<RequestHandler>[0]) => {
  const value = req.header('x-organization-id');
  if (!value) throw new AppError(400, 'ORGANIZATION_CONTEXT_REQUIRED', 'x-organization-id is required');
  return value;
};

// Who is making this request -- needed for self-protection rules.
const actorOf = (req: Parameters<RequestHandler>[0]) => {
  const userId = req.auth?.sub;
  if (!userId || !req.organizationRole) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in again.');
  return { userId, role: req.organizationRole };
};
const idParam = (req: Parameters<RequestHandler>[0]) => {
  const id = String(req.params.id ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError(400, 'INVALID_ID', 'Invalid user id.');
  return id;
};

export const users: Record<string, RequestHandler> = {
  // Admin/Super Admin pass ?industryTypeId= to scope the list to one
  // industry (their selector) -- their global role means no server-side
  // lock is applied, so this is purely their own choice, not a boundary.
  list: async (req, res) => {
    const industryTypeId = typeof req.query.industryTypeId === 'string' ? req.query.industryTypeId : undefined;
    res.json({ data: await userManagementService.listUsers(organizationId(req), industryTypeId) });
  },
  roles: async (_req, res) => res.json({ data: await userManagementService.listRoles() }),
  saveMembership: async (req, res) => res.status(201).json({ data: await userManagementService.saveMembership(organizationId(req), userMembershipSchema.parse(req.body)) }),
  create: async (req, res) => {
    const input = userCreateSchema.parse(req.body);
    if (input.roleCode === 'super_admin' && req.organizationRole !== 'super_admin') throw new AppError(403, 'SUPER_ADMIN_REQUIRED', 'Only a Super Admin can create another Super Admin.');
    res.status(201).json({ data: await userManagementService.createUser(organizationId(req), input) });
  },
  update: async (req, res) => res.json({ data: await userManagementService.updateUser(organizationId(req), idParam(req), actorOf(req), userUpdateSchema.parse(req.body)) }),
  setStatus: async (req, res) => res.json({ data: await userManagementService.setUserStatus(organizationId(req), idParam(req), actorOf(req), userStatusSchema.parse(req.body).status) }),
  resetPassword: async (req, res) => res.json({ data: await userManagementService.resetUserPassword(organizationId(req), idParam(req), actorOf(req), userPasswordResetSchema.parse(req.body).password) }),
  remove: async (req, res) => res.json({ data: await userManagementService.deleteUser(organizationId(req), idParam(req), actorOf(req)) })
};
