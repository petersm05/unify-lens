/**
 * Asserts a queried element exists.
 *
 * Declaring the constant as non-nullable up front beats narrowing it later:
 * hoisted function declarations that capture the variable do not inherit a
 * later null check.
 */
export function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new Error(`${what} did not mount`);
  }
  return value;
}
