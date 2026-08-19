import { useState } from 'react';
import { ImageIcon } from '@/components/icons';

interface ThumbnailProps {
  src?: string | null;
  /** Empty string for decorative art whose meaning is already in nearby text. */
  alt?: string;
  imgClassName?: string;
  placeholderClassName?: string;
  iconSize?: number;
}

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
 */
export default function Thumbnail({
  src,
  alt = '',
  imgClassName,
  placeholderClassName,
  iconSize = 24,
}: ThumbnailProps) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <span className={placeholderClassName} aria-hidden="true">
        <ImageIcon size={iconSize} />
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={imgClassName}
      loading="lazy"
      // Decode off the main thread so a large image cannot jank a scroll.
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}
