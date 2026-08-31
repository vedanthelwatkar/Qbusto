/**
 * The catalogue's loading state.
 *
 * Every piece here is built out of the REAL component's own class names -
 * `.catalog__banner`, `.catalog__category`, `.product-card` - with the
 * shimmer applied to the leaves rather than to a separate set of
 * skeleton-shaped boxes. That is deliberate and is the whole point of this
 * file: the previous skeleton hardcoded its own geometry (a full-width square
 * image, two text lines, no button) and had drifted well away from the card it
 * was standing in for, so the page visibly jumped when the data landed. A
 * skeleton that borrows the layout it is imitating cannot drift, because
 * changing the card changes the skeleton in the same edit.
 *
 * All of it is `aria-hidden`: the pane that contains it carries a single
 * `aria-busy` / "Loading menu" label, and announcing forty empty boxes on top
 * of that tells a screen-reader user nothing.
 */

/** Enough rail entries to fill a phone screen without inventing a scrollbar. */
const RAIL_COUNT = 6;
/** Two sections, so the grouped shape of the real list is legible. */
const SECTION_COUNT = 2;
/** A full two-column row, plus one, so the grid reads as a grid. */
const CARDS_PER_SECTION = 4;

/**
 * The header banner's fixed 780x120 frame.
 *
 * Reserved during loading even though a cinema MAY have no header banner: the
 * strip is a fixed 120px whenever one exists, and every configured cinema runs
 * at least one, so holding the space is right in the common case and wrong
 * only for a cinema that has not been given artwork yet.
 */
export function CatalogBannerSkeleton() {
  return (
    <div className="catalog__banner" aria-hidden="true">
      <div className="skeleton catalog__banner-slide is-active" />
    </div>
  );
}

/**
 * The welcome strip, minus its gold.
 *
 * The real strip is solid `--color-primary` with the cinema's name on it.
 * Painting that gold before the name is known would assert the bar is ready;
 * the modifier drops it back to a neutral surface so it reads as pending, at
 * exactly the height the gold bar will occupy.
 */
export function CatalogWelcomeSkeleton() {
  return (
    <div className="catalog__welcome catalog__welcome--skeleton" aria-hidden="true">
      <span className="skeleton catalog__welcome-line" />
    </div>
  );
}

/** The category rail: a 62px thumb plate and a label, per the real button. */
export function CatalogRailSkeleton() {
  return (
    <>
      {Array.from({ length: RAIL_COUNT }).map((_, index) => (
        <div className="catalog__category" key={index} aria-hidden="true">
          <span className="catalog__category-thumb skeleton" />
          <span className="skeleton catalog__skeleton-line catalog__skeleton-line--label" />
        </div>
      ))}
    </>
  );
}

/**
 * One product card's silhouette.
 *
 * `.product-card` and its children supply the padding, the border, the
 * `min(120px, 100%)` media square and the 40px action height, so this matches
 * the card to the pixel on every breakpoint without repeating a single one of
 * those numbers.
 */
function ProductCardSkeleton() {
  return (
    <article className="product-card" aria-hidden="true">
      <div className="product-card__media skeleton" />

      <div className="product-card__body">
        <div className="product-card__heading">
          <span className="skeleton catalog__skeleton-line" />
        </div>

        <div className="product-card__footer">
          <span className="skeleton catalog__skeleton-line catalog__skeleton-line--price" />
          <span className="skeleton catalog__skeleton-action" />
        </div>
      </div>
    </article>
  );
}

/**
 * The product pane: category sections, each a heading over a two-column grid -
 * the same structure the loaded menu renders, so nothing reflows when the two
 * swap.
 */
export function CatalogSectionsSkeleton() {
  return (
    <>
      {Array.from({ length: SECTION_COUNT }).map((_, section) => (
        <section className="catalog__section" key={section} aria-hidden="true">
          <div className="skeleton catalog__skeleton-title" />

          <div className="catalog__grid">
            {Array.from({ length: CARDS_PER_SECTION }).map((_, card) => (
              <ProductCardSkeleton key={card} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
