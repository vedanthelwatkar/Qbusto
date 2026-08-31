import { useState } from 'react';
import { ImageIcon } from '@/components/icons';
import { resolveImageUrl } from '@/utils/imageUrl';

interface ThumbnailProps {
  src?: string | null;
  /** Empty string for decorative art whose meaning is already in nearby text. */
  alt?: string;
  imgClassName?: string;
  placeholderClassName?: string;
  iconSize?: number;
}

/** Which of the three states this image is in, and for WHICH url. */
type LoadState = { src: string; status: 'loaded' | 'failed' };

/**
 * An image that falls back to the placeholder glyph instead of a broken icon.
 *
 * Product and category art is uploaded by cinema staff, so a missing file or a
 * renamed key is an ordinary occurrence rather than an exceptional one. Before
 * this, a URL that 404'd left the browser's broken-image marker in the middle
 * of the card — the one thing on the page that looks like the app is faulty.
 *
 * The absent-`src` and failed-`src` cases deliberately render the same thing:
 * to a customer they are the same situation.
 *
 * A THIRD case is distinct from both: a good `src` that has not arrived yet.
 * Until it decodes the element is an empty box, which across a menu of product
 * art reads as a page that half-loaded. It carries the shared shimmer until
 * `load` fires instead, so the card looks pending rather than broken. This
 * covers a lazy image too — one below the fold shimmers until it is scrolled
 * to, which is precisely what is happening to it.
 *
 * The state is stored WITH the url it describes rather than as a bare boolean,
 * because these components are reused as the list re-renders: a plain flag
 * would leave the previous product's "already loaded" (or "failed") verdict
 * attached to the next product's image.
 */
export default function Thumbnail({
  src,
  alt = '',
  imgClassName,
  placeholderClassName,
  iconSize = 24,
}: ThumbnailProps) {
  const [state, setState] = useState<LoadState | null>(null);

  // An `/uploads/...` value is a path on the backend, not on this origin.
  // Resolving here covers every product and category image in one place.
  const resolved = resolveImageUrl(src);

  const failed = state !== null && state.src === resolved && state.status === 'failed';

  if (!resolved || failed) {
    return (
      <span className={placeholderClassName} aria-hidden="true">
        <ImageIcon size={iconSize} />
      </span>
    );
  }

  const pending = state === null || state.src !== resolved || state.status !== 'loaded';

  return (
    <img
      src={resolved}
      alt={alt}
      className={`${imgClassName ?? ''}${pending ? ' skeleton' : ''}`.trim() || undefined}
      loading="lazy"
      // Decode off the main thread so a large image cannot jank a scroll.
      decoding="async"
      onLoad={() => setState({ src: resolved, status: 'loaded' })}
      onError={() => setState({ src: resolved, status: 'failed' })}
    />
  );
}
