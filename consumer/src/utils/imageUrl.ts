/**
 * Turning a stored image value into something an `<img src>` can load.
 *
 * A product, category or banner image is one of two things:
 *
 *   https://example.com/popcorn.jpg     an external URL, used as-is
 *   /uploads/products/9f2c….webp        a file on the QBusto server
 *
 * The second form is an application path on the **backend**, and this app is
 * served from a different origin. Without rewriting it, the browser would ask
 * this app's own host for the image and get nothing, so a picture uploaded by
 * staff would appear broken while an external one worked.
 *
 * Kept deliberately small and dependency-free: it is called on every card in
 * the catalogue.
 */

/** Must match the backend's upload prefix. */
const UPLOAD_PREFIX = '/uploads/';

function apiOrigin(): string {
  return (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');
}

/**
 * Resolve a stored image value to a loadable URL.
 *
 * Anything that is not one of our own upload paths is returned untouched, so
 * every existing external URL keeps behaving exactly as it did.
 */
export function resolveImageUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;

  const trimmed = value.trim();
  if (!trimmed) return undefined;

  return trimmed.startsWith(UPLOAD_PREFIX) ? `${apiOrigin()}${trimmed}` : trimmed;
}
