/**
 * Inline SVG icons.
 *
 * Kept local rather than pulling in an icon package: the app needs a handful of
 * glyphs and the consumer bundle has a 150 KB budget.
 *
 * All icons inherit `currentColor` and are hidden from assistive tech — the
 * surrounding control is responsible for its own accessible name.
 */

interface IconProps {
  size?: number;
  className?: string;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none' as const,
  stroke: 'currentColor' as const,
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
});

export function SearchIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function CloseIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export function PlusIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function MinusIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M5 12h14" />
    </svg>
  );
}

/**
 * The standard FSSAI vegetarian mark: a green square outline with a solid
 * green dot centred inside. Fixed colours, not `currentColor` - this is a
 * regulated food-labelling symbol, not a themable glyph.
 */
export function VegMarkIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={className}
      aria-hidden="true"
      focusable={false}
    >
      <rect x="0.75" y="0.75" width="14.5" height="14.5" rx="2" fill="none" stroke="#1f8a4c" strokeWidth="1.5" />
      <circle cx="8" cy="8" r="4" fill="#1f8a4c" />
    </svg>
  );
}

/**
 * The standard FSSAI non-vegetarian mark: a brown/maroon square outline with
 * a solid triangle centred inside. Same fixed-colour reasoning as VegMarkIcon.
 */
export function NonVegMarkIcon({ size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={className}
      aria-hidden="true"
      focusable={false}
    >
      <rect x="0.75" y="0.75" width="14.5" height="14.5" rx="2" fill="none" stroke="#8a3b2f" strokeWidth="1.5" />
      <path d="M8 3.6 12.6 12.4H3.4Z" fill="#8a3b2f" />
    </svg>
  );
}

export function BuildingIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 21V4a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v17" />
      <path d="M14 10h5a1 1 0 0 1 1 1v10" />
      <path d="M9 8h1M9 12h1M9 16h1" />
      <path d="M3 21h18" />
    </svg>
  );
}

export function DocumentIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </svg>
  );
}

export function PhoneIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 5 5L14 13l5 2v3a2 2 0 0 1-2 2C10.5 20 4 13.5 4 6a2 2 0 0 1 1-2Z" />
    </svg>
  );
}

export function MailIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m4 7 8 6 8-6" />
    </svg>
  );
}

export function TermsIcon({ size = 40, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="6" y="3" width="12" height="18" rx="2" />
      <path d="M9 2h6v3H9z" />
      <path d="m8.5 9 1.5 1.5L12.5 8" />
      <path d="m8.5 13 1.5 1.5L12.5 12" />
      <path d="M14 8.5h3M14 12.5h3" />
    </svg>
  );
}

export function TrashIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
    </svg>
  );
}

export function BagIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M6 8h12l-1 12H7L6 8Z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </svg>
  );
}

export function CheckIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="m5 13 4 4L19 7" />
    </svg>
  );
}

export function TagIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M20.59 13.41 11 3.83 3.83 11l9.58 9.59a2 2 0 0 0 2.83 0l4.35-4.35a2 2 0 0 0 0-2.83Z" />
      <circle cx="7.5" cy="7.5" r="1.5" />
    </svg>
  );
}

export function LockIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="4" y="10" width="16" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export function ChevronLeftIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

export function ChevronDownIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function AlertIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5M12 16h.01" />
    </svg>
  );
}

export function InfoIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16v-5M12 8h.01" />
    </svg>
  );
}

export function ImageIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="m4 18 5-5 4 4 3-3 4 4" />
    </svg>
  );
}

export function SeatIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M6 11V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v5" />
      <path d="M4 11h16v6H4z" />
      <path d="M6 17v3M18 17v3" />
    </svg>
  );
}

export function FilmIcon({ size = 20, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M8 4v16M16 4v16M3 12h18" />
    </svg>
  );
}
