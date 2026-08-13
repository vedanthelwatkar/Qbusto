import { useEffect, useState, useMemo } from 'react';
import { useContextStore } from '@/stores/context.store';
import { useCartStore } from '@/stores/cart.store';
import { useUIStore } from '@/stores/ui.store';
import { fetchCategories, fetchProducts, fetchBanners } from '@/services/catalog.service';
import ProductCard from '@/components/ProductCard';
import CartDrawer from '@/components/CartDrawer';
import { formatApiError } from '@/utils/formatApiError';
import { formatMoney } from '@/utils/formatMoney';
import { AlertIcon, BagIcon, CloseIcon, ImageIcon, SearchIcon } from '@/components/icons';
import type { Category, Product, Banner } from '@/api/generated/cinemaOrderingAPI.schemas';
import '../styles/pages/catalog.scss';

interface ProductWithPrice extends Product {
  basePrice?: number;
}

const SKELETON_COUNT = 6;

export default function CatalogPage() {
  const cinemaId = useContextStore((state) => state.cinemaId) as number;
  const itemCount = useCartStore((state) => state.itemCount());
  const estimatedSubtotal = useCartStore((state) => state.estimatedSubtotal());
  const { cartOpen, toggleCart, errorMessage, setError } = useUIStore();

  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<ProductWithPrice[]>([]);
  const [headerBanner, setHeaderBanner] = useState<Banner | null>(null);
  const [innerBanner, setInnerBanner] = useState<Banner | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Load categories, products, and banners on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);

        // Fetch categories
        const categoriesData = await fetchCategories(cinemaId);
        setCategories(categoriesData.data || []);

        // Fetch header banner
        const headerBannersData = await fetchBanners(cinemaId, { type: 'H' });
        if (headerBannersData.data && headerBannersData.data.length > 0) {
          setHeaderBanner(headerBannersData.data[0]);
        }

        // Fetch inner banner
        const innerBannersData = await fetchBanners(cinemaId, { type: 'I' });
        if (innerBannersData.data && innerBannersData.data.length > 0) {
          setInnerBanner(innerBannersData.data[0]);
        }

        // Fetch products (all initially)
        const productsData = await fetchProducts(cinemaId);
        setProducts(productsData.data || []);
      } catch (error) {
        setError(formatApiError(error));
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [cinemaId, setError]);

  // Debounce the search box so typing does not re-filter on every keystroke.
  useEffect(() => {
    const timeoutId = setTimeout(() => setSearchQuery(searchInput), 250);
    return () => clearTimeout(timeoutId);
  }, [searchInput]);

  // Filter products by category and search
  const filteredProducts = useMemo(() => {
    return (products || []).filter((product) => {
      const matchesCategory =
        selectedCategoryId === null || product.categoryId === selectedCategoryId;
      const matchesSearch =
        searchQuery === '' ||
        (product.name?.toLowerCase() || '').includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [products, selectedCategoryId, searchQuery]);

  // `errorMessage` is global UI state, so it can still hold an error raised by
  // another page. Gate on `loading` so a stale message can't flash here before
  // this page's own fetch has run and cleared it.
  if (errorMessage && !loading) {
    return (
      <div className="catalog">
        <div className="state-panel">
          <span className="state-panel__icon">
            <AlertIcon size={28} />
          </span>
          <h1 className="state-panel__title">We couldn&apos;t load the menu</h1>
          <p className="state-panel__body">{errorMessage}</p>
          <button className="btn btn--primary" onClick={() => window.location.reload()}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="catalog">
      {/* Header banner: full-bleed artwork across the top of the app. */}
      {headerBanner?.imageUrl && (
        <div className="catalog__banner">
          <img src={headerBanner.imageUrl} alt="" />
        </div>
      )}

      <div className="catalog__searchbar">
        <div className="catalog__search">
          <SearchIcon size={18} className="catalog__search-icon" />
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
              onClick={() => setSearchInput('')}
              aria-label="Clear search"
            >
              <CloseIcon size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Categories and products are separate scroll regions. */}
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
                {category.imageUrl ? (
                  <img src={category.imageUrl} alt="" loading="lazy" />
                ) : (
                  <ImageIcon size={22} />
                )}
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
          {loading ? (
            <div className="catalog__grid" aria-busy="true" aria-label="Loading menu">
              {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
                <div className="catalog__skeleton-card" key={i}>
                  <div className="skeleton catalog__skeleton-media" />
                  <div className="skeleton catalog__skeleton-line" />
                  <div className="skeleton catalog__skeleton-line catalog__skeleton-line--short" />
                </div>
              ))}
            </div>
          ) : filteredProducts.length > 0 ? (
            <div className="catalog__grid">
              {filteredProducts.map((product) => {
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
          ) : (
            /* Opaque panel: the empty state sits on top of the inner banner. */
            <div className="catalog__empty">
              <span className="state-panel__icon">
                <SearchIcon size={28} />
              </span>
              <h2 className="state-panel__title">
                {searchQuery ? 'No matches found' : 'Nothing on the menu yet'}
              </h2>
              <p className="state-panel__body">
                {searchQuery
                  ? `We couldn't find anything for "${searchQuery}". Try a different search.`
                  : 'This cinema has no items available right now. Please check back later.'}
              </p>
              {searchQuery && (
                <button className="btn btn--secondary" onClick={() => setSearchInput('')}>
                  Clear search
                </button>
              )}
            </div>
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
