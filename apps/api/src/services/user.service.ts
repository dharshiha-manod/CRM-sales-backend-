import { AppError } from '../errors/app-error.js';
import { findProfileWithMemberships } from '../repositories/user.repository.js';
export async function getCurrentUser(userId: string) { const profile = await findProfileWithMemberships(userId); if (!profile) throw new AppError(404, 'PROFILE_NOT_FOUND', 'User profile was not found'); return profile; }
