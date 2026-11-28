/**
 * Express 5 types route params and query values as `string | string[]`
 * (and query values may also be nested query objects). Controllers consume
 * these as single strings, so repeated values use the first entry.
 */
export function paramString(value: unknown): string {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : "";
  }
  return typeof value === "string" ? value : "";
}
