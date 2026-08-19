import { useCartStore } from '@/stores/cart.store';
import { formatMoney } from '@/utils/formatMoney';
import Thumbnail from '@/components/Thumbnail';
import { MinusIcon, PlusIcon } from '@/components/icons';
import '../styles/components/product-card.scss';

interface ProductCardProps {
  id: number;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  /** Absent/null when the cinema has no valid pricing row for this product. */
  price?: number | null;
  weight?: string | null;
}

/**
 * A genuine ₹0 product is sellable; a missing, null or non-finite price is not.
 * Defaulting the latter to 0 would add the item at ₹0 and understate the
 * estimated subtotal, so the two cases must stay distinct.
 */
function hasValidPrice(price: number | null | undefined): price is number {
  return typeof price === 'number' && Number.isFinite(price) && price >= 0;
}

export default function ProductCard({
  id,
  name,
  description,
  imageUrl,
  price,
  weight,
}: ProductCardProps) {
  const addItem = useCartStore((state) => state.addItem);
  const updateQuantity = useCartStore((state) => state.updateQuantity);
  // Selecting the number (not the item object) keeps this re-render-stable.
  const quantity = useCartStore(
    (state) => state.items.find((i) => i.productId === id)?.quantity ?? 0
  );

  const inCart = quantity > 0;
  const priceIsValid = hasValidPrice(price);

  return (
    <article className={`product-card${inCart ? ' product-card--in-cart' : ''}`}>
      <div className="product-card__media">
        <Thumbnail
          src={imageUrl}
          alt={name}
          imgClassName="product-card__image"
          placeholderClassName="product-card__placeholder"
          iconSize={28}
        />

        {inCart && (
          <span className="product-card__badge" aria-hidden="true">
            {quantity}
          </span>
        )}
      </div>

      <div className="product-card__body">
        <h3 className="product-card__name">{name}</h3>

        {description && <p className="product-card__description">{description}</p>}

        {weight && <span className="product-card__weight">{weight}</span>}

        <div className="product-card__footer">
          <span className="product-card__price">
            {priceIsValid ? (
              formatMoney(price)
            ) : (
              <span className="product-card__price--na">Unavailable</span>
            )}
          </span>

          {!priceIsValid ? (
            <button
              type="button"
              className="product-card__add"
              disabled
              aria-label={`${name} is unavailable`}
            >
              Unavailable
            </button>
          ) : inCart ? (
            <div className="product-card__stepper">
              <button
                type="button"
                className="product-card__step"
                onClick={() => updateQuantity(id, quantity - 1)}
                aria-label={
                  quantity === 1
                    ? `Remove ${name} from cart`
                    : `Decrease quantity of ${name}`
                }
              >
                <MinusIcon size={18} />
              </button>

              <span className="product-card__qty" aria-live="polite">
                <span className="sr-only">{name} quantity: </span>
                {quantity}
              </span>

              <button
                type="button"
                className="product-card__step"
                onClick={() => updateQuantity(id, quantity + 1)}
                aria-label={`Increase quantity of ${name}`}
              >
                <PlusIcon size={18} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="product-card__add"
              onClick={() => addItem(id, name, price)}
              aria-label={`Add ${name} to cart`}
            >
              Add
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
