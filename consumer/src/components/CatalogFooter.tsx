import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import {
  BuildingIcon,
  CloseIcon,
  DocumentIcon,
  MailIcon,
  NonVegMarkIcon,
  PhoneIcon,
  TermsIcon,
  VegMarkIcon,
} from '@/components/icons';
import { trapTab } from '@/utils/focusTrap';
import { resolveImageUrl } from '@/utils/imageUrl';
import type { Cinema } from '@/api/generated/cinemaOrderingAPI.schemas';
import '../styles/components/catalog-footer.scss';

interface CatalogFooterProps {
  cinema: Cinema | null;
}

interface InfoPanelProps {
  titleId: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * A small modal for either footer link. Dialog behaviour mirrors
 * ProductInfoModal - the app's existing pattern for a portalled dialog: focus
 * moves to the close button, Tab is trapped, Escape closes, focus returns to
 * whatever opened it. The gold header bar matches the cinema's own brand
 * treatment (the reference "About Cinema" / "Terms & Conditions" cards).
 */
function InfoPanel({ titleId, title, onClose, children }: InfoPanelProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (panelRef.current) trapTab(event, panelRef.current);
    };

    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);

      const target = returnFocusRef.current;
      if (target && document.contains(target)) target.focus();
    };
  }, [onClose]);

  return createPortal(
    <>
      <div className="catalog-footer-overlay" onClick={onClose} aria-hidden="true" />

      <div
        className="catalog-footer-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={panelRef}
      >
        <header className="catalog-footer-panel__header">
          <h2 className="catalog-footer-panel__title" id={titleId}>
            {title}
          </h2>
          <button
            type="button"
            className="catalog-footer-panel__close"
            onClick={onClose}
            ref={closeRef}
            aria-label={`Close ${title}`}
          >
            <CloseIcon size={20} />
          </button>
        </header>

        <div className="catalog-footer-panel__body">{children}</div>
      </div>
    </>,
    document.body
  );
}

interface AboutRow {
  label: string;
  value: string;
  icon: ReactNode;
}

function AboutCinemaPanel({ cinema, onClose }: { cinema: Cinema; onClose: () => void }) {
  const rows: AboutRow[] = [];

  if (cinema.name) rows.push({ label: 'Cinema Name', value: cinema.name, icon: <BuildingIcon size={20} /> });
  if (cinema.gstNumber)
    rows.push({ label: 'GST No.', value: cinema.gstNumber, icon: <DocumentIcon size={20} /> });
  if (cinema.fssaiNumber)
    rows.push({ label: 'FSSAI No.', value: cinema.fssaiNumber, icon: <DocumentIcon size={20} /> });
  if (cinema.content?.contactNo)
    rows.push({ label: 'Contact no.', value: cinema.content.contactNo, icon: <PhoneIcon size={20} /> });
  if (cinema.content?.mailId)
    rows.push({ label: 'Mail Id', value: cinema.content.mailId, icon: <MailIcon size={20} /> });

  return (
    <InfoPanel titleId="about-cinema-title" title="About Cinema" onClose={onClose}>
      {rows.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          {cinema.content?.iconUrl ? (
            <img
              src={resolveImageUrl(cinema.content.iconUrl)}
              alt={cinema.name}
              style={{ width: 100, height: 100, objectFit: 'contain' }}
            />
          ) : null}
          <dl className="catalog-footer-panel__facts">
            {rows.map((row) => (
              <div className="catalog-footer-panel__fact" key={row.label}>
                <span className="catalog-footer-panel__fact-icon">{row.icon}</span>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : (
        <p className="catalog-footer-panel__empty">Cinema details are not available right now.</p>
      )}
    </InfoPanel>
  );
}

function TermsPanel({ points, onClose }: { points: string[]; onClose: () => void }) {
  return (
    <InfoPanel titleId="terms-conditions-title" title="Terms & Conditions" onClose={onClose}>
      <div className="catalog-footer-panel__terms-icon">
        <TermsIcon size={44} />
      </div>

      {points.length > 0 ? (
        <>
          <div className="catalog-footer-panel__terms-rule" aria-hidden="true" />
          <ol className="catalog-footer-panel__terms">
            {points.map((point, index) => (
              // Points have no stable id of their own; they are a fixed,
              // staff-authored list re-fetched whole on every load, not an
              // editable collection this component reorders.
              <li key={`${index}-${point}`}>
                <span className="catalog-footer-panel__terms-badge">{index + 1}</span>
                <span>{point}</span>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <p className="catalog-footer-panel__empty">No terms have been added yet.</p>
      )}
    </InfoPanel>
  );
}

/**
 * The bottom-of-menu footer: the FSSAI veg/non-veg disclaimer, and the
 * "About Cinema" / "Terms & Conditions" links each cinema can configure from
 * the Dashboard. Rendered inline in the catalogue's scrolling content, not
 * fixed - it is the end of the page, not a persistent bar.
 */
export default function CatalogFooter({ cinema }: CatalogFooterProps) {
  const [openPanel, setOpenPanel] = useState<'about' | 'terms' | null>(null);

  return (
    <footer className="catalog-footer">
      <nav className="catalog-footer__links" aria-label="Cinema information">
        <button type="button" className="catalog-footer__link" onClick={() => setOpenPanel('about')}>
          <BuildingIcon size={16} />
          About Cinema
        </button>
        <span className="catalog-footer__divider" aria-hidden="true" />
        <button type="button" className="catalog-footer__link" onClick={() => setOpenPanel('terms')}>
          <TermsIcon size={16} />
          T&amp;C
        </button>
      </nav>

      <div className="catalog-footer__disclaimer">
        <span className="catalog-footer__mark">
          <VegMarkIcon size={14} />
          VEG
        </span>
        <span className="catalog-footer__mark">
          <NonVegMarkIcon size={14} />
          NON-VEG
        </span>
        <p className="catalog-footer__note">
          All images are for representation purposes only. Actual product may vary.
        </p>
      </div>

      {openPanel === 'about' && cinema ? (
        <AboutCinemaPanel cinema={cinema} onClose={() => setOpenPanel(null)} />
      ) : null}

      {openPanel === 'terms' ? (
        <TermsPanel points={cinema?.content?.tncPoints ?? []} onClose={() => setOpenPanel(null)} />
      ) : null}
    </footer>
  );
}
