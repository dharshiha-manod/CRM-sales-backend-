import type { RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { listCalls } from '../repositories/telephony.repository.js';

const organizationId = (req: Parameters<RequestHandler>[0]) => {
  const id = req.header('x-organization-id');
  if (!id) throw new AppError(400, 'ORGANIZATION_CONTEXT_REQUIRED', 'x-organization-id is required');
  return id;
};

export const telephony: Record<string, RequestHandler> = {
  list: async (req, res) => res.json({ data: await listCalls(organizationId(req)) }),
};
