/** Documentation trace primitive; no product policy is implemented in M0. */
export type SpecReference = `Spec P${number}`;
export function isSpecReference(value: string): value is SpecReference {
  return /^Spec P([1-9]|[12][0-9]|3[0-2])$/.test(value);
}
