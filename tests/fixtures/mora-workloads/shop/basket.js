export function basketSummary(lines) {
  const subtotal = lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
  return {count:lines.reduce((sum, line) => sum + line.quantity, 0),subtotal,total:subtotal};
}
