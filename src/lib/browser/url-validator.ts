import { ExplorerError } from "./types";
import {
  validatePublicUrl,
  isBlockedAddress as centralIsBlockedAddress,
  UrlSecurityError,
  type UrlValidationResult as CentralResult,
} from "@/lib/security/url-validator";

/**
 * Backward-compatible SSRF validation shim for the browser layer.
 *
 * The authoritative logic now lives in `src/lib/security/url-validator.ts`
 * (the central validator). This module adapts it to the ExplorerError type the
 * explorer/executor already use, so existing call sites are unchanged.
 */

export interface UrlValidationResult {
  url: string;
  hostname: string;
  resolvedAddresses: string[];
}

/** Re-export the central IP blocklist check (used by action-security). */
export const isBlockedAddress = centralIsBlockedAddress;

/** Map a central UrlSecurityError code onto an ExplorerError code. */
function toExplorerError(err: unknown): ExplorerError {
  if (err instanceof UrlSecurityError) {
    switch (err.code) {
      case "invalid_url":
      case "too_long":
        return new ExplorerError("invalid_url", err.message);
      case "blocked_scheme":
      case "blocked_host":
      case "private_address":
        return new ExplorerError("blocked_url", err.message);
      case "unreachable":
        return new ExplorerError("unreachable", err.message);
    }
  }
  if (err instanceof ExplorerError) return err;
  return new ExplorerError("invalid_url", "That does not look like a valid URL.");
}

/**
 * Validate a URL string for exploration. Throws ExplorerError on rejection.
 * On success, returns the normalized URL and the resolved public addresses.
 */
export async function validateExploreUrl(raw: string): Promise<UrlValidationResult> {
  let result: CentralResult;
  try {
    result = await validatePublicUrl(raw);
  } catch (err) {
    throw toExplorerError(err);
  }
  return {
    url: result.url,
    hostname: result.hostname,
    resolvedAddresses: result.resolvedAddresses,
  };
}
