/**
 * Compatibility shim for the legacy SQL-shaped services that predate the
 * Mongoose migration. Those modules are not wired into the server, but they
 * are still part of the TypeScript program, so their imports must resolve.
 *
 * Keep this intentionally inert: SQL must not be executed against MongoDB by
 * accident. New code should use the model modules directly.
 */
export interface LegacyQueryResult {
  rows: any[];
}

export const db = {
  async query(_sql: string, _params?: readonly any[]): Promise<LegacyQueryResult> {
    throw new Error(
      "SQL queries are unsupported on the MongoDB backend; use a Mongoose model instead.",
    );
  },
};
