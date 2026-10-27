import type { RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';
import { productService } from '../services/products.service.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { productCreateSchema, productImageSchema, productUpdateSchema, productStockChangeSchema } from '../validation/products.schemas.js';
const org = (req: Parameters<RequestHandler>[0]) => { const value = req.header('x-organization-id'); if (!value) throw new AppError(400, 'ORGANIZATION_CONTEXT_REQUIRED', 'x-organization-id is required'); return value; };
const id = (value: string | string[] | undefined) => { const result = Array.isArray(value) ? value[0] : value; if (!result) throw new AppError(400, 'INVALID_ID', 'A resource id is required'); return result; };
const scope = (req: Parameters<RequestHandler>[0]) => { if (!req.industryScope) throw new AppError(500, 'INDUSTRY_SCOPE_MISSING', 'Industry scope was not resolved for this request.'); return req.industryScope; };
export const products: Record<string, RequestHandler> = {
  list: async (req, res) => res.json({ data: await productService.list(org(req), req.query.search as string | undefined, req.query.status as string | undefined, req.query.industryTypeId as string | undefined, scope(req)) }),
  create: async (req, res) => res.status(201).json({ data: await productService.create(org(req), productCreateSchema.parse(req.body), scope(req)) }),
  update: async (req, res) => res.json({ data: await productService.update(org(req), id(req.params.id), productUpdateSchema.parse(req.body), scope(req)) }),
  uploadImage: async (req, res) => {
    const organizationId = org(req);
    const { dataUrl } = productImageSchema.parse(req.body);
    const [, type, base64] = dataUrl.match(/^data:image\/(jpeg|png|webp);base64,(.+)$/) ?? [];
    const bytes = Buffer.from(base64 ?? '', 'base64');
    if (bytes.length === 0 || bytes.length > 1_000_000) throw new AppError(422, 'IMAGE_TOO_LARGE', 'The image is too large. Use a picture under 1 MB.');
    const bucket = 'product-images';
    const { data: existing } = await supabaseAdmin.storage.getBucket(bucket);
    if (!existing) {
      const { error: bucketError } = await supabaseAdmin.storage.createBucket(bucket, { public: true, fileSizeLimit: 1_000_000 });
      if (bucketError && !/already exists/i.test(bucketError.message)) throw new AppError(500, 'IMAGE_STORAGE_UNAVAILABLE', `Could not prepare image storage: ${bucketError.message}`);
    }
    const path = `${organizationId}/${crypto.randomUUID()}.${type === 'jpeg' ? 'jpg' : type}`;
    const { error } = await supabaseAdmin.storage.from(bucket).upload(path, bytes, { contentType: `image/${type}`, upsert: false });
    if (error) throw new AppError(500, 'IMAGE_UPLOAD_FAILED', `Could not save the image: ${error.message}`);
    res.status(201).json({ data: { url: supabaseAdmin.storage.from(bucket).getPublicUrl(path).data.publicUrl } });
  },
  changeStock: async (req, res) => res.json({ data: await productService.changeStock(org(req), id(req.params.id), productStockChangeSchema.parse(req.body), scope(req)) }),
  remove: async (req, res) => { await productService.remove(org(req), id(req.params.id), scope(req)); res.status(204).end(); }
};