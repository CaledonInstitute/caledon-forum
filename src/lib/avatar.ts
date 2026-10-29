import { publicUrl, safeFetch, readLimited, rasterType } from './security';

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
export function avatarUrl(value: string): string {
  if (value.length > 2048) throw new Error('Profile image URL must be at most 2,048 characters.');
  try { return publicUrl(value).href; }
  catch { throw new Error('Use a public HTTPS link for your profile image.'); }
}
export async function fetchAvatar(value: string) {
  try {
    const response = await safeFetch(avatarUrl(value), 'image/jpeg,image/png,image/gif,image/webp');
    const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const bytes = await readLimited(response, MAX_AVATAR_BYTES);
    if (!rasterType(bytes, type)) throw new Error('Use a JPEG, PNG, GIF, or WebP image.');
    return { bytes, type };
  } catch (error) {
    if (error instanceof Error && /too large/.test(error.message)) throw new Error('Profile image must be 2 MB or smaller.');
    if (error instanceof Error && error.message === 'Use a JPEG, PNG, GIF, or WebP image.') throw error;
    throw new Error('Unable to load your profile image. Check that the link is public and points directly to an image.');
  }
}
