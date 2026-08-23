/**
 * Turning a stored image value into something an `<img src>` can load.
 *
 * An image column holds one of two things:
 *
 *   https://example.com/popcorn.jpg     an external URL, used as-is
 *   /uploads/products/9f2c….webp        a file on the QBusto server
 *
 * The second form is an application path on the **backend**, and the Dashboard
 * is served from a different origin. Left alone, the browser would resolve it
 * against the Dashboard's own host and request an image that is not there, so
 * a locally uploaded picture would silently render as broken while an external
 * one worked. Everything that displays an image goes through here.
 */

/** The prefix the upload API returns. Must match the backend's PUBLIC_PREFIX. */
const UPLOAD_PREFIX = '/uploads/';

/** Backend origin, without a trailing slash so joins never double up. */
function apiOrigin(): string {
  return (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');
}

/**
 * Resolve a stored image value to a loadable URL.
 *
 * Returns undefined for an absent value so a caller can skip rendering rather
 * than emitting `<img src="">`, which browsers treat as a request for the
 * current page.
 */
export function resolveImageUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;

  const trimmed = value.trim();
  if (!trimmed) return undefined;

  // Only our own upload paths are rewritten. Anything else - an absolute URL,
  // a data: URI, a protocol-relative //host/path - is returned untouched, so
  // existing external records keep working exactly as before.
  if (trimmed.startsWith(UPLOAD_PREFIX)) {
    return `${apiOrigin()}${trimmed}`;
  }

  return trimmed;
}

/** True when the value points at a file this server stores. */
export function isLocalUpload(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().startsWith(UPLOAD_PREFIX);
}

/**
 * Whether a value is acceptable in the URL field.
 *
 * Deliberately permissive about the shape of an external URL - the backend
 * stores any string up to 500 characters and the platform has always allowed
 * that. What this rejects is a scheme that would make the stored value
 * dangerous to render: `javascript:` executes on click, and `data:` can carry
 * an SVG containing script.
 */
export function isAllowedImageUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;

  if (trimmed.startsWith(UPLOAD_PREFIX)) return true;

  return /^https?:\/\/\S+$/i.test(trimmed);
}
