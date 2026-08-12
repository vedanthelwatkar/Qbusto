import { useCartStore } from '@/stores/cart.store';
import { formatMoney } from '@/utils/formatMoney';
import '../styles/components/product-card.scss';

interface ProductCardProps {
  id: number;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  price?: number;
  weight?: string | null;
}

export default function ProductCard({
  id,
  name,
  description,
  imageUrl,
  price = 0,
  weight,
}: ProductCardProps) {
  const addItem = useCartStore((state) => state.addItem);

  const handleAddToCart = () => {
    addItem(id, name, price);
  };

  return (
    <div className="product-card">
      <div className="product-image-container">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={name}
            className="product-image"
            loading="lazy"
          />
        ) : (
          <div className="product-image-placeholder">No Image</div>
        )}
      </div>

      <div className="product-info">
        <h3 className="product-name">{name}</h3>

        {description && (
          <p className="product-description">{description}</p>
        )}

        <div className="product-footer">
          {weight && <span className="product-weight">{weight}</span>}
          {price > 0 && <span className="product-price">₹{formatMoney(price)}</span>}
          <button
            className="btn-add"
            onClick={handleAddToCart}
            aria-label={`Add ${name} to cart`}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
