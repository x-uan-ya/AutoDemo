/**
 * Types for the Website Explorer capability.
 *
 * The explorer performs PASSIVE analysis only: it loads a page and reads what
 * is already there. It does not click, submit, or otherwise interact with the
 * site. These types describe the structured data returned from that read.
 */

export interface ExploredHeading {
  /** Heading level 1..6 (from h1..h6). */
  level: number;
  text: string;
}

export interface ExploredButton {
  text: string;
  /** button | a[role=button] | input[type=submit|button] */
  kind: "button" | "link-button" | "input";
}

export interface ExploredLink {
  text: string;
  href: string;
  /** True when the link points to a different origin than the final URL. */
  external: boolean;
}

export interface ExploredFormField {
  name: string;
  type: string;
  label?: string;
  required: boolean;
}

export interface ExploredForm {
  /** Resolved action URL, or empty string when the form has no action. */
  action: string;
  method: string;
  fields: ExploredFormField[];
}

export interface ExploredNavItem {
  text: string;
  href: string;
}

export interface ExploredScreenshot {
  kind: "fullPage" | "viewport";
  /** data: URL (base64 PNG) so it can be rendered directly in the client. */
  dataUrl: string;
  width: number;
  height: number;
}

/**
 * The structured result of exploring a single page.
 */
export interface WebsiteExploration {
  /** The URL that was requested. */
  url: string;
  /** The URL actually landed on after redirects. */
  finalUrl: string;
  title: string;
  description: string | null;
  headings: ExploredHeading[];
  buttons: ExploredButton[];
  links: ExploredLink[];
  forms: ExploredForm[];
  navigation: ExploredNavItem[];
  screenshots: ExploredScreenshot[];
  /** HTTP status of the main response, when available. */
  statusCode: number | null;
  /** When the exploration completed (ISO 8601). */
  exploredAt: string;
}

/**
 * Categorized explorer errors, so the API can map them to helpful messages
 * without leaking internal detail.
 */
export type ExplorerErrorCode =
  | "invalid_url"
  | "blocked_url"
  | "timeout"
  | "unreachable"
  | "http_error"
  | "browser_error";

export class ExplorerError extends Error {
  code: ExplorerErrorCode;

  constructor(code: ExplorerErrorCode, message: string) {
    super(message);
    this.name = "ExplorerError";
    this.code = code;
  }
}
