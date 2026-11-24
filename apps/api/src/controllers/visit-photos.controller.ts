import type { RequestHandler } from 'express';
import { z } from 'zod';
import { AppError } from '../errors/app-error.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { fieldActivityService } from '../services/field-activity.service.js';

const bodySchema = z.object({
  dataUrl: z.string().max(950_000).regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/, 'Upload a JPG, PNG or WebP image.'),
  caption: z.string().trim().max(500).optional().nullable(),
});

export const visitPhotos: Record<string, RequestHandler> = {
  upload: async (req, res) => {
    const organizationId = req.header('x-organization-id');
    if (!organizationId) throw new AppError(400, 'ORGANIZATION_CONTEXT_REQUIRED', 'x-organization-id is required');
    const visitId = z.string().uuid().parse(req.params.id);
    const rep = await fieldActivityService.currentRepresentative(organizationId, req.auth!.sub!);
    const { dataUrl, caption } = bodySchema.parse(req.body);
    const [, type, base64] = dataUrl.match(/^data:image\/(jpeg|png|webp);base64,(.+)$/) ?? [];
    const bytes = Buffer.from(base64 ?? '', 'base64');
    if (bytes.length === 0) throw new AppError(422, 'IMAGE_EMPTY', 'The photo is empty.');

    const { data: visit, error: visitError } = await supabaseAdmin.from('field_visits').select('id').eq('id', visitId).eq('organization_id', organizationId).eq('representative_id', rep.id).maybeSingle();
    if (visitError) throw visitError;
    if (!visit) throw new AppError(404, 'VISIT_NOT_FOUND', 'Visit not found.');

    const bucket = 'visit-photos';
    const { data: existing } = await supabaseAdmin.storage.getBucket(bucket);
    if (!existing) {
      const { error: bucketError } = await supabaseAdmin.storage.createBucket(bucket, { public: true, fileSizeLimit: 1_000_000 });
      if (bucketError && !/already exists/i.test(bucketError.message)) throw new AppError(500, 'IMAGE_STORAGE_UNAVAILABLE', `Could not prepare photo storage: ${bucketError.message}`);
    }
    const path = `${organizationId}/${visitId}/${crypto.randomUUID()}.${type === 'jpeg' ? 'jpg' : type}`;
    const { error } = await supabaseAdmin.storage.from(bucket).upload(path, bytes, { contentType: `image/${type}`, upsert: false });
    if (error) throw new AppError(500, 'IMAGE_UPLOAD_FAILED', `Could not save the photo: ${error.message}`);
    const photoUrl = supabaseAdmin.storage.from(bucket).getPublicUrl(path).data.publicUrl;

    const activity = await fieldActivityService.createVisitActivity(organizationId, rep.id as string, visitId, { purpose: 'Visit photo', notes: caption ?? null, photoUrl });
    res.status(201).json({ data: { url: photoUrl, activity } });
  },
};