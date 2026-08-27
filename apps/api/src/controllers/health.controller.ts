import type { RequestHandler } from 'express';
export const health: RequestHandler = (_req, res) => { res.status(200).json({ data: { status: 'ok', service: 'field-sales-api' } }); };
