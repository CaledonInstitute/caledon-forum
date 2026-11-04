export function localListingId(value: string, origin: string): string | null {
  try {
    const url = new URL(value, origin);
    if (url.origin !== new URL(origin).origin || url.username || url.password) return null;
    return /^\/marketplace\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i.exec(url.pathname)?.[1].toLowerCase() || null;
  } catch {
    return null;
  }
}
