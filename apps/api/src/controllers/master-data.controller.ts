import type { RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { clientService, representativeService } from '../services/master-data.service.js';
import { assignmentSchema, clientCreateSchema, clientStatusSchema, clientUpdateSchema, contactCreateSchema, contactUpdateSchema, representativeCreateSchema, representativeStatusSchema, representativeUpdateSchema, uuid } from '../validation/master-data.schemas.js';
const org = (req: Parameters<RequestHandler>[0]) => { const value = req.header('x-organization-id'); if (!value) throw new AppError(400, 'ORGANIZATION_CONTEXT_REQUIRED', 'x-organization-id is required'); return uuid.parse(value); };
const id = (value: string | string[] | undefined) => uuid.parse(Array.isArray(value) ? value[0] : value);
export const representatives: Record<string, RequestHandler> = {
  list: async (req, res) => res.json({ data: await representativeService.list(org(req), req.query.search as string | undefined, req.query.status as string | undefined) }),
  get: async (req, res) => res.json({ data: await representativeService.get(org(req), id(req.params.id)) }),
  create: async (req, res) => res.status(201).json({ data: await representativeService.create(org(req), representativeCreateSchema.parse(req.body)) }),
  update: async (req, res) => res.json({ data: await representativeService.update(org(req), id(req.params.id), representativeUpdateSchema.parse(req.body)) }),
  status: async (req, res) => res.json({ data: await representativeService.update(org(req), id(req.params.id), representativeStatusSchema.parse(req.body)) }),
  assignedClients: async (req, res) => res.json({ data: await clientService.assignments.list(org(req), id(req.params.id)) }),
  assignClient: async (req, res) => res.status(201).json({ data: await clientService.assignments.assign(org(req), id(req.params.id), id(req.params.clientId), assignmentSchema.parse(req.body).notes) }),
  unassignClient: async (req, res) => { await clientService.assignments.remove(org(req), id(req.params.id), id(req.params.clientId)); res.status(204).send(); }
};
export const clients: Record<string, RequestHandler> = {
  list: async (req, res) => res.json({ data: await clientService.list(org(req), req.query.search as string | undefined, req.query.type as string | undefined, req.query.status as string | undefined, req.query.industryTypeId as string | undefined) }),
  get: async (req, res) => res.json({ data: await clientService.get(org(req), id(req.params.id)) }),
  create: async (req, res) => res.status(201).json({ data: await clientService.create(org(req), clientCreateSchema.parse(req.body)) }),
  update: async (req, res) => res.json({ data: await clientService.update(org(req), id(req.params.id), clientUpdateSchema.parse(req.body)) }),
  status: async (req, res) => res.json({ data: await clientService.update(org(req), id(req.params.id), clientStatusSchema.parse(req.body)) }),
  contacts: async (req, res) => res.json({ data: await clientService.contacts.list(org(req), id(req.params.clientId)) }),
  createContact: async (req, res) => res.status(201).json({ data: await clientService.contacts.create(org(req), id(req.params.clientId), contactCreateSchema.parse(req.body)) }),
  updateContact: async (req, res) => res.json({ data: await clientService.contacts.update(org(req), id(req.params.clientId), id(req.params.contactId), contactUpdateSchema.parse(req.body)) }),
  deleteContact: async (req, res) => { await clientService.contacts.remove(org(req), id(req.params.clientId), id(req.params.contactId)); res.status(204).send(); }
};