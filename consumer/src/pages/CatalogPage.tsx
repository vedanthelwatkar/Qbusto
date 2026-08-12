import { useEffect, useState, useMemo } from 'react';
import { useContextStore } from '@/stores/context.store';
import { useCartStore } from '@/stores/cart.store';
import { useUIStore } from '@/stores/ui.store';
import { fetchCategories, fetchProducts, fetchBanners } from '@/services/catalog.service';
import ProductCard from '@/components/ProductCard';
import CartDrawer from '@/components/CartDrawer';
import { formatApiError } from '@/utils/formatApiError';
import type { Category, Product, Banner } from '@/api/generated/cinemaOrderingAPI.schemas';
import '../styles/pages/catalog.scss';

interface ProductWithPrice extends Product {
  basePrice?: number;
}

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

  // Filter products by category and search
  const filteredProducts = useMemo(() => {
    return (products || []).filter((product) => {
      const matchesCategory =
        selectedCategoryId === null ||
        product.categoryId === selectedCategoryId;
      const matchesSearch =
        searchQuery === '' ||
        (product.name?.toLowerCase() || '').includes(
          searchQuery.toLowerCase()
        );
      return matchesCategory && matchesSearch;
    });
  }, [products, selectedCategoryId, searchQuery]);

  if (loading) {
    return (
      <div className="catalog">
        <div className="catalog-loading">Loading menu...</div>
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className="catalog">
        <div className="catalog-error">
          <p>{errorMessage}</p>
          <button onClick={() => window.location.reload()}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="catalog">
      {/* Header Banner */}
      {headerBanner && headerBanner.imageUrl && (
        <div className="catalog-banner">
          <img
            src={headerBanner.imageUrl}
            alt="Promotional banner"
            loading="lazy"
          />
        </div>
      )}

      {/* Main Layout: Categories Left + Products Right */}
      <div className="catalog-layout">
        {/* Sidebar: Categories */}
        <aside className="catalog-sidebar">
          <div className="category-list">
            <button
              className={`category-item ${selectedCategoryId === null ? 'active' : ''}`}
              onClick={() => setSelectedCategoryId(null)}
            >
              <div className="category-image">
                <span style={{ fontSize: '24px' }}>📁</span>
              </div>
              <span className="category-name">All</span>
            </button>
            {categories.map((category) => (
              <button
                key={category.id}
                className={`category-item ${selectedCategoryId === category.id ? 'active' : ''}`}
                onClick={() => setSelectedCategoryId(category.id || null)}
              >
                <div className="category-image">
                  {category.imageUrl ? (
                    <img src={category.imageUrl} alt={category.name} loading="lazy" />
                  ) : (
                    <span style={{ fontSize: '24px' }}>📦</span>
                  )}
                </div>
                <span className="category-name">{category.name}</span>
              </button>
            ))}
          </div>
        </aside>

        {/* Main: Search + Products with Inner Banner Background */}
        <main
          className="catalog-main"
          style={
            innerBanner?.imageUrl
              ? { backgroundImage: `url(${innerBanner.imageUrl})` }
              : {}
          }
        >
          {/* Search */}
          <div className="catalog-search">
            <input
              type="text"
              className="search-input"
              placeholder="Search menu"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search products"
            />
          </div>

          {/* Products Area */}
          <div className="catalog-products-area">
            {/* Product Grid */}
            <div className="products-grid">
              {filteredProducts.length > 0 ? (
                filteredProducts.map((product) => {
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
                })
              ) : (
                <div className="no-products">
                  {searchQuery ? 'No products found' : 'No products available'}
                </div>
              )}
            </div>
          </div>
        </main>
      </div>

      {/* Cart Drawer */}
      <CartDrawer />

      {/* Sticky Cart Button */}
      {itemCount > 0 && !cartOpen && (
        <button
          className="sticky-cart-btn"
          onClick={toggleCart}
          aria-label={`View cart with ${itemCount} items`}
        >
          <span className="cart-count">{itemCount}</span>
          <span className="cart-total">₹{estimatedSubtotal.toFixed(2)}</span>
        </button>
      )}
    </div>
  );
}
