/**
 * Format a rupee amount (JSON number from backend) for display.
 * Backend returns DECIMAL(10,2) as JSON number (e.g., 250 or 250.5)
 * Display as "₹250.00" or "₹250.50"
 */
export function formatMoney(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
