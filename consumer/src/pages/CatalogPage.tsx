import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useContextStore } from '@/stores/context.store';
import { useCartStore } from '@/stores/cart.store';
import { useUIStore } from '@/stores/ui.store';
import {
  fetchAllCategories,
  fetchAllProducts,
  fetchBanners,
  fetchCinema,
} from '@/services/catalog.service';
import ProductCard from '@/components/ProductCard';
import CheckoutDrawer from '@/components/CheckoutDrawer';
import StatePanel from '@/components/StatePanel';
import Thumbnail from '@/components/Thumbnail';
import {
  CatalogBannerSkeleton,
  CatalogRailSkeleton,
  CatalogSectionsSkeleton,
  CatalogWelcomeSkeleton,
} from '@/components/CatalogSkeleton';
import { resolveImageUrl } from '@/utils/imageUrl';
import { formatApiError, isNotFoundError } from '@/utils/formatApiError';
import { formatMoney } from '@/utils/formatMoney';
import { AlertIcon, BagIcon } from '@/components/icons';
import type { Category, Product, Banner } from '@/api/generated/cinemaOrderingAPI.schemas';
import '../styles/pages/catalog.scss';

/**
 * The fixed "All Time Favourite" section, as the catalogue API reports it.
 *
 * Negative because it is not a categories row and must never collide with one -
 * see backend constants.ALL_TIME_FAVOURITE. It arrives in the category list
 * like any other entry, so the rail and the scroll anchors need no special
 * case; only the section's contents are found differently.
 */
const ALL_TIME_FAVOURITE_ID = -1;

interface ProductWithPrice extends Product {
  basePrice?: number;
}

/**
 * The menu is ONE continuous list, grouped into category sections in the rail's
 * order: reaching the end of a category simply continues into the next, and the
 * list ends when every category is exhausted. There is no "All items" entry -
 * the whole menu is always present - and the rail scrolls to a section rather
 * than refetching a filtered page.
 *
 * Everything is therefore loaded once per cinema (see fetchAllProducts, which
 * pages against the server's own total rather than assuming one page covers
 * it). A cinema carries on the order of a hundred items, so this is a single
 * cheap load instead of pagination machinery the data does not need.
 */

/** How long each header banner stays on screen before the next one. */
const BANNER_ROTATE_MS = 3000;

/**
 * How long a rail tap's scroll is given to settle before the rail is allowed to
 * follow the observer again. Smooth scrolling has no completion callback that
 * is safe to rely on - `scrollend` is still missing from Safari, which is what
 * the venue runs on - so this is a duration rather than an event.
 */
const RAIL_FOLLOW_RESUME_MS = 700;

/**
 * Scroll ONE pane, and nothing else.
 *
 * `scrollIntoView` walks up the tree and scrolls every scrollable ancestor it
 * finds, the document included. On iOS that is how tapping a rail entry could
 * drag the whole page off-screen and leave the customer staring at blank
 * background with only the cart bar in view. Setting `scrollTop` on the pane
 * itself cannot move anything above it.
 */
function scrollPaneTo(pane: HTMLElement, top: number) {
  pane.scrollTo({
    top: Math.max(0, top),
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
  });
}

export default function CatalogPage() {
  const cinemaId = useContextStore((state) => state.cinemaId) as number;
  /**
   * The channel this visit is on, and therefore the prices to show.
   *
   * The SAME value the order will carry (see orders.service.PlaceOrderInput),
   * so what the card shows is what the customer is charged. Each
   * product_pricing row holds a separate discount per channel, and a seat QR
   * can genuinely be a different rate from the lobby QR - reading the menu at
   * one price and being billed another is the bug this closes.
   */
  const source = useContextStore((state) => state.source);
  /**
   * The seat, sent alongside `source` as EVIDENCE for it.
   *
   * The backend will not price a `seat_qr` request at the seat rate unless a
   * seat is named (pricing.service.deriveSource), because the order path
   * applies exactly the same rule. Sending it keeps the two in step: without
   * it a genuine seat scan would read the lobby price here and be charged the
   * seat price at checkout, which is the mismatch this whole path exists to
   * prevent.
   */
  const seat = useContextStore((state) => state.seatLabel());
  const itemCount = useCartStore((state) => state.itemCount());
  const estimatedSubtotal = useCartStore((state) => state.estimatedSubtotal());
  const cartOpen = useUIStore((state) => state.cartOpen);
  const toggleCart = useUIStore((state) => state.toggleCart);

  // Page chrome: the category rail and the banners. Loaded once per cinema.
  const [categories, setCategories] = useState<Category[]>([]);
  /**
   * The rail loads on its own request, and the sections are built by matching
   * products to it. Products can arrive first, and rendering then would show
   * the item count and "That's the full menu" above an empty grid, because
   * every product's category is still unknown.
   */
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  /**
   * All active header banners, in `sequence` order as the API returned them.
   *
   * Previously only the first was kept and the rest were discarded, so a
   * cinema running several promotions could only ever show one of them.
   */
  const [headerBanners, setHeaderBanners] = useState<Banner[]>([]);
  const [bannerIndex, setBannerIndex] = useState(0);
  const [innerBanner, setInnerBanner] = useState<Banner | null>(null);
  /** For the "Welcome to <cinema>" strip shown above the menu. */
  const [cinemaName, setCinemaName] = useState<string | null>(null);
  /**
   * Fatal for the page: without the rail there is nothing to browse. Held
   * locally rather than in the shared UI store, which was global state written
   * by checkout and read here — the cross-page bleed is why this page needed a
   * `loading` guard to stop another page's error flashing over the menu.
   */
  const [pageError, setPageError] = useState<string | null>(null);

  // The whole menu, loaded once and grouped for display.
  const [products, setProducts] = useState<ProductWithPrice[]>([]);
  const [listLoading, setListLoading] = useState(true);
  /** Non-fatal: the rail still works, so this shows inside the grid area. */
  const [listError, setListError] = useState<string | null>(null);

  /**
   * Which section the rail highlights. Follows what is on screen rather than
   * driving the query - selecting a category scrolls, it does not refetch.
   */
  const [activeCategoryId, setActiveCategoryId] = useState<number | null>(null);
  /** One node per rendered section, for scroll-to and for the observer. */
  const sectionRefs = useRef(new Map<number, HTMLElement>());
  /** One node per rail button, so the rail can follow the active section. */
  const railRefs = useRef(new Map<number, HTMLElement>());
  /**
   * The two independent scroll regions. Held so they can be scrolled directly
   * rather than through scrollIntoView - see scrollPaneTo.
   */
  const sidebarRef = useRef<HTMLElement | null>(null);
  const productsRef = useRef<HTMLElement | null>(null);
  /** Set while a rail tap's own scroll is in flight; see the rail-follow effect. */
  const railFollowSuppressed = useRef(false);
  const railFollowTimer = useRef<number | undefined>(undefined);

  /**
   * Guards against out-of-order responses. Switching category twice quickly,
   * or typing, leaves several requests in flight; without this the slowest one
   * wins and the grid ends up showing a filter the customer already left.
   * The generated client takes no abort signal, so the response is discarded
   * on arrival instead of the request being cancelled.
   */
  const requestRef = useRef(0);

  // Chrome. Categories page properly — the rail is navigation, and a category
  // missing from it is unreachable.
  useEffect(() => {
    let active = true;

    const loadChrome = async () => {
      try {
        const [allCategories, headerBanners, innerBanners, cinema] = await Promise.all([
          fetchAllCategories(cinemaId),
          fetchBanners(cinemaId, { type: 'H' }),
          fetchBanners(cinemaId, { type: 'I' }),
          fetchCinema(cinemaId),
        ]);

        if (!active) return;
        setCategories(allCategories);
        setCategoriesLoading(false);
        setCinemaName(cinema.name ?? null);
        // A banner with no artwork cannot be a slide; keeping it would show a
        // blank frame in the rotation.
        setHeaderBanners(headerBanners.data.filter((banner) => banner.imageUrl));
        // Back to the first promotion: the previous index belonged to the
        // cinema that was on screen before this one.
        setBannerIndex(0);
        setInnerBanner(innerBanners.data[0] ?? null);
        setPageError(null);
      } catch (error) {
        if (!active) return;
        setCategoriesLoading(false);
        setPageError(
          isNotFoundError(error)
            ? 'We could not find this cinema. Please scan the QR code at your seat again.'
            : formatApiError(error)
        );
      }
    };

    loadChrome();
    return () => {
      active = false;
    };
  }, [cinemaId]);

  /**
   * Load the whole menu.
   *
   * No category and no search parameter: the rail navigates within what is
   * already here, so browsing costs no further request at all.
   */
  const loadProducts = useCallback(async () => {
    const token = ++requestRef.current;

    setListLoading(true);
    setListError(null);

    try {
      const all = await fetchAllProducts(cinemaId, { source, seat });

      // A newer request has since started; this result is stale.
      if (token !== requestRef.current) return;

      setProducts(all as ProductWithPrice[]);
    } catch (error) {
      if (token !== requestRef.current) return;
      setListError(formatApiError(error));
      setProducts([]);
    } finally {
      if (token === requestRef.current) setListLoading(false);
    }
  }, [cinemaId, source, seat]);

  // The cinema and the channel are what change the priced menu.
  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  /**
   * Which slide is showing.
   *
   * Clamped rather than used directly: switching cinema replaces the list, and
   * an index left over from a longer one would otherwise mark nothing active
   * and leave the strip blank.
   */
  const activeBanner = bannerIndex < headerBanners.length ? bannerIndex : 0;

  /**
   * Cycle through the header banners.
   *
   * A cinema schedules several promotions and expects each to be seen, so the
   * strip runs as a loop. Stopped for a single banner - there is nothing to
   * cycle - and for customers who have asked for reduced motion, who get the
   * first banner and the dots to move through the rest themselves.
   */
  useEffect(() => {
    if (headerBanners.length < 2) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const timerId = window.setTimeout(() => {
      setBannerIndex((index) => (index + 1) % headerBanners.length);
    }, BANNER_ROTATE_MS);

    return () => window.clearTimeout(timerId);
    // Re-armed for each slide rather than left running as one interval, so
    // picking a promotion with the dots gives it a full turn on screen instead
    // of whatever was left of the previous slide's.
  }, [headerBanners.length, activeBanner]);

  /**
   * The menu as sections, in the rail's category order.
   *
   * Built from what was loaded rather than requested per category, so a product
   * appears exactly once (it has one categoryId) and a category appears exactly
   * once. Categories with nothing available are dropped entirely - an empty
   * heading is noise, and the rail should not offer a section that scrolls to
   * nothing.
   */
  const sections = useMemo(() => {
    const byCategory = new Map<number, ProductWithPrice[]>();

    for (const product of products) {
      if (!product.id || product.categoryId === undefined || product.categoryId === null) continue;
      const bucket = byCategory.get(product.categoryId);
      if (bucket) bucket.push(product);
      else byCategory.set(product.categoryId, [product]);
    }

    // The fixed "All Time Favourite" section. The backend puts it at the head
    // of the category list with a negative id, because it is NOT a category row
    // - membership is per-cinema and lives on the cinema/product link, which a
    // chain-scoped category could never express. So it is the one section whose
    // products are not found by categoryId: a favourite keeps its own category
    // and appears in both places.
    return categories
      .map((category) => ({
        id: category.id as number,
        name: category.name ?? 'Items',
        items:
          category.id === ALL_TIME_FAVOURITE_ID
            ? products.filter((product) => product.isAllTimeFavourite)
            : (category.id !== undefined && byCategory.get(category.id)) || [],
      }))
      .filter((section) => section.id !== undefined && section.items.length > 0);
  }, [products, categories]);


  /**
   * Highlight whichever section is in view.
   *
   * A single observer over the section headings: the rail follows the customer
   * as they scroll from one category into the next, which is what makes the
   * continuous list navigable. `rootMargin` biases the trigger to the top of
   * the scroller so a heading counts as "current" once it reaches the top
   * rather than when it first appears at the bottom.
   */
  useEffect(() => {
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];

        if (!visible) return;
        const id = Number(visible.target.getAttribute('data-category-id'));
        if (!Number.isNaN(id)) setActiveCategoryId(id);
      },
      { rootMargin: '0px 0px -70% 0px', threshold: 0 }
    );

    for (const section of sections) {
      const node = sectionRefs.current.get(section.id);
      if (node) observer.observe(node);
    }

    return () => observer.disconnect();
  }, [sections]);

  /**
   * The rail's highlight. Derived rather than seeded in an effect: before the
   * customer scrolls, "current" simply means the first section, and writing
   * that into state on mount would be a render just to reach the value already
   * available here.
   */
  const highlightedCategoryId = activeCategoryId ?? sections[0]?.id ?? null;

  /**
   * Keep the highlighted category visible in the rail.
   *
   * The rail scrolls independently of the product pane, so on a long menu the
   * current category could be highlighted well outside the rail's own
   * viewport - the customer scrolls into DESSERTS and the rail still shows
   * APPETIZERS because it never moved. Moves only when the button is genuinely
   * out of view, so the rail does not twitch on every observer tick.
   *
   * Held still while a rail tap's own scroll is running: that scroll sweeps the
   * observer across every section it passes, and letting each tick start a
   * competing smooth scroll is what stranded the menu in blank space.
   */
  useEffect(() => {
    if (highlightedCategoryId === null) return;
    if (railFollowSuppressed.current) return;

    const rail = sidebarRef.current;
    const button = railRefs.current.get(highlightedCategoryId);
    if (!rail || !button) return;

    const railBox = rail.getBoundingClientRect();
    const buttonBox = button.getBoundingClientRect();
    const above = buttonBox.top < railBox.top;
    const below = buttonBox.bottom > railBox.bottom;
    if (!above && !below) return;

    scrollPaneTo(
      rail,
      above
        ? rail.scrollTop + (buttonBox.top - railBox.top)
        : rail.scrollTop + (buttonBox.bottom - railBox.bottom)
    );
  }, [highlightedCategoryId]);

  /** Rail click: move to the section, never refetch. */
  const goToCategory = useCallback((categoryId: number) => {
    setActiveCategoryId(categoryId);

    const pane = productsRef.current;
    const section = sectionRefs.current.get(categoryId);
    if (!pane || !section) return;

    // The rail already shows the tapped category, and the observer is about to
    // fire for every section this scroll flies past. Hold the rail still until
    // the movement settles.
    railFollowSuppressed.current = true;
    window.clearTimeout(railFollowTimer.current);
    railFollowTimer.current = window.setTimeout(() => {
      railFollowSuppressed.current = false;
    }, RAIL_FOLLOW_RESUME_MS);

    scrollPaneTo(
      pane,
      pane.scrollTop + (section.getBoundingClientRect().top - pane.getBoundingClientRect().top)
    );
  }, []);

  /** Leaving the page mid-scroll must not fire the timer into a dead component. */
  useEffect(() => () => window.clearTimeout(railFollowTimer.current), []);

  // Fatal: no rail, nothing to browse.
  if (pageError) {
    return (
      <div className="catalog">
        <StatePanel
          icon={<AlertIcon size={28} />}
          tone="error"
          title="We couldn't load the menu"
          body={pageError}
          actions={
            <button className="btn btn--primary" onClick={() => window.location.reload()}>
              Try again
            </button>
          }
        />
      </div>
    );
  }

  /** The menu loads once per cinema, so this is the only pending state left. */
  /* Both halves: the grid is grouped BY category, so products alone are not
     enough to render it. */
  const showSkeletons = listLoading || categoriesLoading;

  return (
    <div className="catalog">
      {showSkeletons ? (
        <CatalogBannerSkeleton />
      ) : (
        headerBanners.length > 0 && (
        <div className="catalog__banner">
          {/* Every slide stays mounted and stacked, and only opacity changes.
              Rendering one at a time meant each change unmounted the visible
              image and mounted the next, which then had to be fetched - so the
              strip went blank between promotions instead of crossing from one
              to the next. Here they are all loaded up front and the swap is a
              fade with nothing underneath it. */}
          {headerBanners.map((banner, index) => (
            <img
              key={banner.id}
              src={resolveImageUrl(banner.imageUrl)}
              alt=""
              className={`catalog__banner-slide${index === activeBanner ? ' is-active' : ''}`}
              // The inactive slides are still in the document, so they have to
              // be hidden from assistive tech rather than merely faded out.
              aria-hidden={index !== activeBanner}
            />
          ))}

          {headerBanners.length > 1 && (
            <div className="catalog__banner-dots" role="group" aria-label="Promotions">
              {headerBanners.map((banner, index) => (
                <button
                  key={banner.id}
                  type="button"
                  className={`catalog__banner-dot${index === activeBanner ? ' is-active' : ''}`}
                  aria-label={`Show promotion ${index + 1} of ${headerBanners.length}`}
                  aria-current={index === activeBanner}
                  onClick={() => setBannerIndex(index)}
                />
              ))}
            </div>
          )}
        </div>
        )
      )}

      {showSkeletons ? (
        <CatalogWelcomeSkeleton />
      ) : (
        cinemaName && <div className="catalog__welcome">Welcome to {cinemaName}</div>
      )}

      <div className="catalog__layout">
        <nav className="catalog__sidebar" aria-label="Product categories" ref={sidebarRef}>
          {/*
            No "All items": the list already contains every category, so the
            entry would have selected what is on screen anyway. Each button
            moves to its section instead of filtering.
          */}
          {showSkeletons ? (
            <CatalogRailSkeleton />
          ) : (
            sections.map((section) => (
            <button
              key={section.id}
              type="button"
              className={`catalog__category${
                highlightedCategoryId === section.id ? ' is-active' : ''
              }`}
              onClick={() => goToCategory(section.id)}
              aria-current={highlightedCategoryId === section.id ? 'true' : undefined}
              ref={(node) => {
                if (node) railRefs.current.set(section.id, node);
                else railRefs.current.delete(section.id);
              }}
            >
              <span className="catalog__category-thumb">
                <Thumbnail
                  src={categories.find((c) => c.id === section.id)?.imageUrl}
                  iconSize={22}
                />
              </span>
              <span className="catalog__category-name">{section.name}</span>
            </button>
            ))
          )}
        </nav>

        <main
          className="catalog__products"
          ref={productsRef}
          style={
            innerBanner?.imageUrl
              ? {
                  backgroundImage: `url(${resolveImageUrl(innerBanner.imageUrl)})`,
                }
              : undefined
          }
        >
          {showSkeletons ? (
            <div aria-busy="true" aria-label="Loading menu">
              <CatalogSectionsSkeleton />
            </div>
          ) : products.length > 0 ? (
            <>
              {/* The pane carried a "Menu" title and a running item count.
                  Both are gone from the screen - the category rail already
                  names what is being shown, and the count restated what the
                  grid itself makes obvious. The heading stays in the
                  accessible tree so the page keeps a document title. */}
              <h1 className="sr-only">Menu</h1>

              {/* One continuous list. Each category is a section in the rail's
                  order, so scrolling past the end of one simply continues into
                  the next until every category is exhausted. */}
              {sections.map((section) => (
                <section
                  key={section.id}
                  className="catalog__section"
                  data-category-id={section.id}
                  aria-labelledby={`category-${section.id}`}
                  ref={(node) => {
                    if (node) sectionRefs.current.set(section.id, node);
                    else sectionRefs.current.delete(section.id);
                  }}
                >
                  <h2 className="catalog__section-title" id={`category-${section.id}`}>
                    {section.name}
                  </h2>

                  <div className="catalog__grid">
                    {section.items.map((product) => (
                      <ProductCard
                        key={product.id}
                        id={product.id as number}
                        name={product.name || 'Unknown'}
                        description={product.description}
                        imageUrl={product.imageUrl}
                        price={product.basePrice}
                        weight={product.weight}
                      />
                    ))}
                  </div>
                </section>
              ))}

              {listError && (
                <div className="alert alert--error catalog__list-error" role="alert">
                  <AlertIcon size={18} />
                  <p>{listError}</p>
                </div>
              )}

              {/* The end of the menu, stated plainly: there is nothing more to
                  scroll for, which a bare last row does not communicate. */}
              <p className="catalog__end" role="status">
                That's the full menu
              </p>
            </>
          ) : listError ? (
            <StatePanel
              boxed
              icon={<AlertIcon size={28} />}
              tone="error"
              title="We couldn't load these items"
              body={listError}
              actions={
                <button className="btn btn--primary" onClick={() => loadProducts()}>
                  Try again
                </button>
              }
            />
          ) : (
            <StatePanel
              boxed
              icon={<AlertIcon size={28} />}
              title="Nothing available here"
              body="This cinema has no items available right now. Please check back later."
            />
          )}
        </main>
      </div>

      <CheckoutDrawer />

      {itemCount > 0 && !cartOpen && (
        <div className="catalog__cart-bar">
          <button className="catalog__cart-button" onClick={toggleCart}>
            <span className="catalog__cart-left">
              <span className="catalog__cart-icon">
                <BagIcon size={20} />
                <span className="catalog__cart-count">{itemCount}</span>
              </span>
              <span className="catalog__cart-label">
                {itemCount === 1 ? '1 item' : `${itemCount} items`}
              </span>
            </span>
            <span className="catalog__cart-right">
              <span className="catalog__cart-total">{formatMoney(estimatedSubtotal)}</span>
              <span className="catalog__cart-cta">View cart</span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
