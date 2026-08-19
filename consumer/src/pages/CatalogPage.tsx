import { useCallback, useEffect, useRef, useState } from 'react';
import { useContextStore } from '@/stores/context.store';
import { useCartStore } from '@/stores/cart.store';
import { useUIStore } from '@/stores/ui.store';
import {
  fetchAllCategories,
  fetchProducts,
  fetchBanners,
} from '@/services/catalog.service';
import ProductCard from '@/components/ProductCard';
import CartDrawer from '@/components/CartDrawer';
import StatePanel from '@/components/StatePanel';
import Thumbnail from '@/components/Thumbnail';
import { formatApiError, isNotFoundError } from '@/utils/formatApiError';
import { formatMoney } from '@/utils/formatMoney';
import { AlertIcon, BagIcon, CloseIcon, SearchIcon } from '@/components/icons';
import type { Category, Product, Banner } from '@/api/generated/cinemaOrderingAPI.schemas';
import '../styles/pages/catalog.scss';

interface ProductWithPrice extends Product {
  basePrice?: number;
}

const SKELETON_COUNT = 6;

/**
 * Products per request. The endpoint caps `limit` at 100; this is deliberately
 * well under that so the first paint is quick on a phone on cinema wifi, and
 * "Load more" stays a real, cheap request rather than a token gesture.
 */
const PAGE_SIZE = 24;

/** Matches the previous debounce. Long enough to skip most keystrokes. */
const SEARCH_DEBOUNCE_MS = 250;

export default function CatalogPage() {
  const cinemaId = useContextStore((state) => state.cinemaId) as number;
  const itemCount = useCartStore((state) => state.itemCount());
  const estimatedSubtotal = useCartStore((state) => state.estimatedSubtotal());
  const cartOpen = useUIStore((state) => state.cartOpen);
  const toggleCart = useUIStore((state) => state.toggleCart);

  // Page chrome: the category rail and the banners. Loaded once per cinema.
  const [categories, setCategories] = useState<Category[]>([]);
  const [headerBanner, setHeaderBanner] = useState<Banner | null>(null);
  const [innerBanner, setInnerBanner] = useState<Banner | null>(null);
  /**
   * Fatal for the page: without the rail there is nothing to browse. Held
   * locally rather than in the shared UI store, which was global state written
   * by checkout and read here — the cross-page bleed is why this page needed a
   * `loading` guard to stop another page's error flashing over the menu.
   */
  const [pageError, setPageError] = useState<string | null>(null);

  // The product grid, which is paginated and refetched whenever a filter moves.
  const [products, setProducts] = useState<ProductWithPrice[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [listLoading, setListLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  /** Non-fatal: the rail still works, so this shows inside the grid area. */
  const [listError, setListError] = useState<string | null>(null);

  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  /**
   * Guards against out-of-order responses. Switching category twice quickly,
   * or typing, leaves several requests in flight; without this the slowest one
   * wins and the grid ends up showing a filter the customer already left.
   * The generated client takes no abort signal, so the response is discarded
   * on arrival instead of the request being cancelled.
   */
  const requestRef = useRef(0);
  /** Tracks which filter actually moved, to pick the right pending treatment. */
  const lastCategoryRef = useRef<number | null>(null);

  // Chrome. Categories page properly — the rail is navigation, and a category
  // missing from it is unreachable.
  useEffect(() => {
    let active = true;

    const loadChrome = async () => {
      try {
        const [allCategories, headerBanners, innerBanners] = await Promise.all([
          fetchAllCategories(cinemaId),
          fetchBanners(cinemaId, { type: 'H' }),
          fetchBanners(cinemaId, { type: 'I' }),
        ]);

        if (!active) return;
        setCategories(allCategories);
        setHeaderBanner(headerBanners.data[0] ?? null);
        setInnerBanner(innerBanners.data[0] ?? null);
        setPageError(null);
      } catch (error) {
        if (!active) return;
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
   * One request for one page of products under the current filters.
   *
   * `append` distinguishes "Load more" from a filter change: the former adds to
   * the list, the latter replaces it and resets the page counter.
   */
  const loadProducts = useCallback(
    async (targetPage: number, { append }: { append: boolean }) => {
      const token = ++requestRef.current;

      if (append) setLoadingMore(true);
      else setListLoading(true);
      setListError(null);

      try {
        const response = await fetchProducts(cinemaId, {
          categoryId: selectedCategoryId ?? undefined,
          search: searchQuery || undefined,
          limit: PAGE_SIZE,
          page: targetPage,
        });

        // A newer request has since started; this result is stale.
        if (token !== requestRef.current) return;

        const incoming = response.data as ProductWithPrice[];
        setProducts((previous) => (append ? [...previous, ...incoming] : incoming));
        setTotal(response.meta?.pagination?.total ?? incoming.length);
        setPage(targetPage);
      } catch (error) {
        if (token !== requestRef.current) return;
        setListError(formatApiError(error));
        // Only a failed first page clears the grid. A failed "Load more" must
        // keep what the customer already has.
        if (!append) {
          setProducts([]);
          setTotal(0);
        }
      } finally {
        if (token === requestRef.current) {
          setListLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [cinemaId, selectedCategoryId, searchQuery]
  );

  // Debounce the search box so typing does not fire a request per keystroke.
  useEffect(() => {
    const timeoutId = setTimeout(() => setSearchQuery(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeoutId);
  }, [searchInput]);

  // Any filter change restarts at page 1.
  useEffect(() => {
    const categoryChanged = lastCategoryRef.current !== selectedCategoryId;
    lastCategoryRef.current = selectedCategoryId;

    // A different category is a different list, so the old rows are dropped
    // rather than held under the new heading — showing Beverages under
    // "Snacks", even dimmed, is untrue. Narrowing by search keeps the same
    // list, so those rows stay and are dimmed instead of flashing skeletons
    // on every keystroke.
    if (categoryChanged) {
      setProducts([]);
      setTotal(0);
    }

    loadProducts(1, { append: false });
  }, [loadProducts, selectedCategoryId]);

  const loadedAll = products.length >= total;

  const activeCategoryName =
    selectedCategoryId === null
      ? 'All items'
      : (categories.find((c) => c.id === selectedCategoryId)?.name ?? 'Items');

  const clearSearch = useCallback(() => {
    setSearchInput('');
    setSearchQuery('');
  }, []);

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

  /**
   * A category switch replaces the list with a different one, so holding the
   * old products under the new heading would be untrue — those get skeletons.
   * A search only narrows the same list, so the previous results stay put,
   * dimmed and marked busy, which avoids a skeleton flash on every keystroke.
   */
  const showSkeletons = listLoading && products.length === 0;
  const showStale = listLoading && products.length > 0;
  /** A search request is outstanding, or the debounce has yet to fire. */
  const searching = Boolean(searchInput) && (listLoading || searchInput.trim() !== searchQuery);

  return (
    <div className="catalog">
      {headerBanner?.imageUrl && (
        <div className="catalog__banner">
          <img src={headerBanner.imageUrl} alt="" />
        </div>
      )}

      <div className="catalog__searchbar">
        <div className="catalog__search">
          {/* The spinner takes the leading slot, not the trailing one: clear
              has to stay put and stay tappable while a search is running. */}
          {searching ? (
            <span className="catalog__search-icon" aria-hidden="true">
              <span className="spinner spinner--sm" />
            </span>
          ) : (
            <SearchIcon size={18} className="catalog__search-icon" />
          )}

          <input
            type="search"
            className="catalog__search-input"
            placeholder="Search the menu"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label="Search products"
          />

          {searchInput && (
            <button
              type="button"
              className="catalog__search-clear"
              onClick={clearSearch}
              aria-label="Clear search"
            >
              <CloseIcon size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="catalog__layout">
        <nav className="catalog__sidebar" aria-label="Product categories">
          <button
            type="button"
            className={`catalog__category${selectedCategoryId === null ? ' is-active' : ''}`}
            onClick={() => setSelectedCategoryId(null)}
            aria-pressed={selectedCategoryId === null}
          >
            <span className="catalog__category-thumb">
              <BagIcon size={26} />
            </span>
            <span className="catalog__category-name">All items</span>
          </button>

          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              className={`catalog__category${
                selectedCategoryId === category.id ? ' is-active' : ''
              }`}
              onClick={() => setSelectedCategoryId(category.id || null)}
              aria-pressed={selectedCategoryId === category.id}
            >
              <span className="catalog__category-thumb">
                <Thumbnail src={category.imageUrl} iconSize={22} />
              </span>
              <span className="catalog__category-name">{category.name}</span>
            </button>
          ))}
        </nav>

        <main
          className="catalog__products"
          style={
            innerBanner?.imageUrl
              ? { backgroundImage: `url(${innerBanner.imageUrl})` }
              : undefined
          }
        >
          {showSkeletons ? (
            <div aria-busy="true" aria-label="Loading menu">
              {/* Placeholder for the pane heading. Without it the grid starts
                  one row higher and everything jumps down when loading ends. */}
              <div className="catalog__pane-head">
                <div className="skeleton catalog__skeleton-title" />
              </div>

              <div className="catalog__grid">
                {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
                  <div className="catalog__skeleton-card" key={i}>
                    <div className="skeleton catalog__skeleton-media" />
                    <div className="skeleton catalog__skeleton-line" />
                    <div className="skeleton catalog__skeleton-line catalog__skeleton-line--short" />
                  </div>
                ))}
              </div>
            </div>
          ) : products.length > 0 ? (
            <>
              <div className="catalog__pane-head">
                <h1 className="catalog__pane-title">
                  {searchQuery ? `Results for "${searchQuery}"` : activeCategoryName}
                </h1>
                {/* Truthful: `total` is the server's count for these filters,
                    not the number of rows currently in the DOM. */}
                <p className="catalog__pane-count" aria-live="polite">
                  {products.length < total
                    ? `${products.length} of ${total}`
                    : total === 1
                      ? '1 item'
                      : `${total} items`}
                </p>
              </div>

              <div
                className={`catalog__grid${showStale ? ' is-stale' : ''}`}
                aria-busy={showStale || undefined}
              >
                {products.map((product) => {
                  if (!product.id) return null;
                  return (
                    <ProductCard
                      key={product.id}
                      id={product.id}
                      name={product.name || 'Unknown'}
                      description={product.description}
                      imageUrl={product.imageUrl}
                      price={product.basePrice}
                      weight={product.weight}
                    />
                  );
                })}
              </div>

              {listError && (
                <div className="alert alert--error catalog__list-error" role="alert">
                  <AlertIcon size={18} />
                  <p>{listError}</p>
                </div>
              )}

              {!loadedAll && (
                <div className="catalog__more">
                  <button
                    type="button"
                    className="btn btn--secondary"
                    onClick={() => loadProducts(page + 1, { append: true })}
                    // Also disabled while a filter change is in flight. The
                    // dimmed grid blocks its own pointer events but this
                    // button sits outside it, and `page` still refers to the
                    // outgoing filter — clicking here mid-search would append
                    // a page of the new results onto the old list.
                    disabled={loadingMore || listLoading}
                  >
                    {loadingMore ? (
                      <>
                        <span className="spinner spinner--sm" />
                        Loading…
                      </>
                    ) : (
                      `Load more (${total - products.length} left)`
                    )}
                  </button>
                </div>
              )}
            </>
          ) : listError ? (
            <StatePanel
              boxed
              icon={<AlertIcon size={28} />}
              tone="error"
              title="We couldn't load these items"
              body={listError}
              actions={
                <button
                  className="btn btn--primary"
                  onClick={() => loadProducts(1, { append: false })}
                >
                  Try again
                </button>
              }
            />
          ) : (
            <StatePanel
              boxed
              icon={<SearchIcon size={28} />}
              title={searchQuery ? 'No matches found' : 'Nothing available here'}
              body={
                searchQuery
                  ? selectedCategoryId !== null
                    ? `Nothing in ${activeCategoryName} matches "${searchQuery}".`
                    : `We couldn't find anything for "${searchQuery}". Try a different search.`
                  : selectedCategoryId !== null
                    ? `Nothing in ${activeCategoryName} is available right now. Some items are only served at certain times.`
                    : 'This cinema has no items available right now. Please check back later.'
              }
              actions={
                <>
                  {/* A search inside a category can miss an item that exists
                      one category over, so offer the wider search rather than
                      leaving the customer to work it out. */}
                  {searchQuery && selectedCategoryId !== null && (
                    <button
                      className="btn btn--primary"
                      onClick={() => setSelectedCategoryId(null)}
                    >
                      Search the whole menu
                    </button>
                  )}
                  {searchQuery && (
                    <button className="btn btn--secondary" onClick={clearSearch}>
                      Clear search
                    </button>
                  )}
                  {!searchQuery && selectedCategoryId !== null && (
                    <button
                      className="btn btn--secondary"
                      onClick={() => setSelectedCategoryId(null)}
                    >
                      Browse all items
                    </button>
                  )}
                </>
              }
            />
          )}
        </main>
      </div>

      <CartDrawer />

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
