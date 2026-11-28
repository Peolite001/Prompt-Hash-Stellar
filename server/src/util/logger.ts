/**
 * Compatibility shim for legacy services that imported the old logger path.
 * The legacy call sites pass arbitrary positional arguments, so adapt them to
 * the structured logger instead of changing those untouched modules.
 */
import { logger as structuredLogger } from "../services/structuredLogger.js";

function toContext(args: unknown[]): Record<string, unknown> {
  if (args.length === 0) return {};
  if (typeof args[args.length - 1] === "object" && args[args.length - 1] !== null) {
    return { details: args.slice(0, -1), ...(args[args.length - 1] as Record<string, unknown>) };
  }
  return { details: args };
}

export const logger = {
  info: (message: string, ...args: unknown[]) =>
    structuredLogger.info(message, toContext(args)),
  warn: (message: string, ...args: unknown[]) =>
    structuredLogger.warn(message, toContext(args)),
  error: (message: string, ...args: unknown[]) =>
    structuredLogger.error(message, toContext(args)),
  debug: (message: string, ...args: unknown[]) =>
    structuredLogger.debug(message, toContext(args)),
};
