/** Splits `items` into consecutive batches of at most `size` items. */
export function toBatches<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error(`Batch size must be a positive integer, got ${size}`);
  }
  const batches: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    batches.push(items.slice(start, start + size));
  }
  return batches;
}
