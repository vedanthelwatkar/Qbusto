import type { ReactNode } from 'react';

/**
 * The full-panel empty / error / loading state.
 *
 * Every page needed the same arrangement — a plate, a title, a line of body
 * copy, an action — and each had hand-rolled its own copy of the markup. They
 * had already drifted: the cart drawer used a <p> where the others used a
 * heading, and the catalog repeated the whole .state-panel rule set under a
 * second class name just to get an opaque background. One component keeps
 * them identical.
 *
 * Styling still lives with the shared .state-panel rules in shared.scss; this
 * owns only the structure.
 */
interface StatePanelProps {
  /** Glyph for the circular plate. Ignored when `spinner` is set. */
  icon?: ReactNode;
  /** Spinner in place of the plate, for genuine loading states. */
  spinner?: boolean;
  title?: ReactNode;
  /**
   * Heading level. A page-level state owns the page's <h1>; a state inside a
   * region — the cart sheet, the product pane — must not claim it.
   */
  titleAs?: 'h1' | 'h2' | 'p';
  body?: ReactNode;
  /** Extra content between the body and the actions. */
  children?: ReactNode;
  /** Buttons. Stacked full-width on mobile, so pass them in priority order. */
  actions?: ReactNode;
  /**
   * Opaque card rather than a bare panel. The catalog's empty state sits over
   * the inner-banner artwork and needs a surface of its own.
   */
  boxed?: boolean;
  /** Tints the plate. `error` is for genuine failures, not for empty results. */
  tone?: 'neutral' | 'error';
  role?: string;
}

export default function StatePanel({
  icon,
  spinner = false,
  title,
  titleAs = 'h1',
  body,
  children,
  actions,
  boxed = false,
  tone = 'neutral',
  role,
}: StatePanelProps) {
  const Title = titleAs;

  return (
    <div
      className={`state-panel${boxed ? ' state-panel--boxed' : ''}`}
      role={role}
      // Loading states must announce themselves; a settled empty/error panel
      // is already reachable in the document and should not interrupt.
      aria-busy={spinner || undefined}
    >
      {spinner ? (
        <span className="spinner" />
      ) : (
        icon && (
          <span
            className={`state-panel__icon${
              tone === 'error' ? ' state-panel__icon--error' : ''
            }`}
          >
            {icon}
          </span>
        )
      )}

      {title && <Title className="state-panel__title">{title}</Title>}

      {body && <p className="state-panel__body">{body}</p>}

      {children}

      {actions && <div className="state-panel__actions">{actions}</div>}
    </div>
  );
}
