/** What a basket costs with tax, in dollars and cents. Each item has a price and a quantity. */
export function total(items, taxRate) {
  const subtotal = items.reduce((sum, item) => sum + item.price, 0);
  return Math.round(subtotal * (1 + taxRate));
}

/** An amount as the shop shows it, such as $4.50. */
export function money(amount) {
  return "$" + amount;
}
