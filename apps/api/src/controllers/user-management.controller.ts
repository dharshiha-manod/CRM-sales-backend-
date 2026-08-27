import type { RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { userManagementService } from '../services/user-management.service.js';
import { userCreateSchema, userMembershipSchema } from '../validation/user-management.schemas.js';

const organizationId = (req: Parameters<RequestHandler>[0]) => {
  const value = req.header('x-organization-id');
  if (!value) throw new AppError(400, 'ORGANIZATION_CONTEXT_REQUIRED', 'x-organization-id is required');
  return value;
};

export const users: Record<string, RequestHandler> = {
  list: async (req, res) => res.json({ data: await userManagementService.listUsers(organizationId(req)) }),
  roles: async (_req, res) => res.json({ data: await userManagementService.listRoles() }),
  saveMembership: async (req, res) => res.status(201).json({ data: await userManagementService.saveMembership(organizationId(req), userMembershipSchema.parse(req.body)) }),
  create: async (req, res) => {
    const input = userCreateSchema.parse(req.body);
    if (input.roleCode === 'super_admin' && req.organizationRole !== 'super_admin') throw new AppError(403, 'SUPER_ADMIN_REQUIRED', 'Only a Super Admin can create another Super Admin.');
    res.status(201).json({ data: await userManagementService.createUser(organizationId(req), input) });
  }
};
