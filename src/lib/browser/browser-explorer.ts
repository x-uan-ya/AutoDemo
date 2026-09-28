import {
  chromium,
  type Browser,
  type Page,
  type Route,
} from "playwright";
import { validateExploreUrl } from "./url-validator";
import {
  ExplorerError,
  type ExploredButton,
  type ExploredForm,
  type ExploredHeading,
  type ExploredLink,
  type ExploredNavItem,
  type ExploredScreenshot,
  type WebsiteExploration,
} from "./types";

/**
 * Website Explorer.
 *
 * Opens a public https website in headless Chromium and collects a passive
 * snapshot: title, meta description, visible headings/buttons/links, forms,
 * navigation, and two screenshots. It never clicks, types, or submits — it
 * only reads what the page renders.
 *
 * Security notes:
 *  - The URL is validated (SSRF checks) before launch.
 *  - Requests to non-http(s) schemes are aborted at the network layer.
 *  - After load, the FINAL url is re-validated so a redirect cannot land the
 *    browser on an internal host.
 */

const NAV_TIMEOUT_MS = 30_000;
const OVERALL_TIMEOUT_MS = 45_000;
const VIEWPORT = { width: 1280, height: 800 };
/** Cap collected list sizes so a huge page cannot produce a huge payload. */
const MAX_ITEMS = 100;

export interface ExploreOptions {
  /** Override the navigation timeout (ms). */
  timeoutMs?: number;
}

export async function exploreWebsite(
  rawUrl: string,
  options: ExploreOptions = {}
): Promise<WebsiteExploration> {
  // 1. Validate before opening anything.
  const validated = await validateExploreUrl(rawUrl);

  const navTimeout = options.timeoutMs ?? NAV_TIMEOUT_MS;
  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });

    const context = await browser.newContext({
      viewport: VIEWPORT,
      javaScriptEnabled: true,
      userAgent:
        "Mozilla/5.0 (compatible; AutoDemoExplorer/1.0; +https://autodemo.example/bot)",
    });
    context.setDefaultNavigationTimeout(navTimeout);
    context.setDefaultTimeout(navTimeout);

    // Network guard: allow only http/https requests. Images are allowed
    // (enabled by default); dangerous schemes are aborted.
    await context.route("**/*", (route: Route) => {
      const scheme = route.request().url().split(":", 1)[0]?.toLowerCase();
      if (scheme === "http" || scheme === "https") {
        route.continue();
      } else {
        route.abort();
      }
    });

    const page = await context.newPage();

    const result = await withTimeout(
      collectFromPage(page, validated.url),
      OVERALL_TIMEOUT_MS,
      () =>
        new ExplorerError(
          "timeout",
          "The website took too long to respond."
        )
    );

    return result;
  } catch (err) {
    throw normalizeError(err);
  } finally {
    if (browser) {
      await browser.close().catch(() => {
        /* ignore close errors */
      });
    }
  }
}

async function collectFromPage(
  page: Page,
  requestedUrl: string
): Promise<WebsiteExploration> {
  const response = await page.goto(requestedUrl, {
    waitUntil: "domcontentloaded",
  });

  const statusCode = response ? response.status() : null;
  if (statusCode !== null && statusCode >= 400) {
    throw new ExplorerError(
      "http_error",
      `The website responded with HTTP ${statusCode}.`
    );
  }

  const finalUrl = page.url();

  // Re-validate the final URL: a redirect must not land us on an internal
  // host. If it does, refuse rather than returning data.
  await assertFinalUrlSafe(finalUrl);

  // Give late content a brief moment, but do not fail if the network never
  // fully idles (many sites keep long-lived connections open).
  await page
    .waitForLoadState("networkidle", { timeout: 5_000 })
    .catch(() => undefined);

  const extracted = await page.evaluate(extractPageData, { maxItems: MAX_ITEMS });

  const screenshots = await captureScreenshots(page);

  return {
    url: requestedUrl,
    finalUrl,
    title: extracted.title,
    description: extracted.description,
    headings: extracted.headings,
    buttons: extracted.buttons,
    links: extracted.links,
    forms: extracted.forms,
    navigation: extracted.navigation,
    screenshots,
    statusCode,
    exploredAt: new Date().toISOString(),
  };
}

async function assertFinalUrlSafe(finalUrl: string): Promise<void> {
  try {
    await validateExploreUrl(finalUrl);
  } catch {
    throw new ExplorerError(
      "blocked_url",
      "The website redirected to a location that is not allowed."
    );
  }
}

async function captureScreenshots(
  page: Page
): Promise<ExploredScreenshot[]> {
  const shots: ExploredScreenshot[] = [];

  const viewportBuf = await page.screenshot({ fullPage: false, type: "png" });
  shots.push({
    kind: "viewport",
    dataUrl: `data:image/png;base64,${viewportBuf.toString("base64")}`,
    width: VIEWPORT.width,
    height: VIEWPORT.height,
  });

  const fullBuf = await page.screenshot({ fullPage: true, type: "png" });
  // Height of a full-page shot is dynamic; report 0 to signal "full page".
  shots.push({
    kind: "fullPage",
    dataUrl: `data:image/png;base64,${fullBuf.toString("base64")}`,
    width: VIEWPORT.width,
    height: 0,
  });

  return shots;
}

/**
 * Runs in the browser context. Reads visible elements only. Kept dependency-
 * free and self-contained because it is serialized and executed in the page.
 */
function extractPageData(args: { maxItems: number }): {
  title: string;
  description: string | null;
  headings: ExploredHeading[];
  buttons: ExploredButton[];
  links: ExploredLink[];
  forms: ExploredForm[];
  navigation: ExploredNavItem[];
} {
  const { maxItems } = args;

  const isVisible = (el: Element): boolean => {
    const style = window.getComputedStyle(el);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity) === 0
    ) {
      return false;
    }
    const rect = (el as HTMLElement).getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const clean = (s: string | null | undefined): string =>
    (s ?? "").replace(/\s+/g, " ").trim();

  const take = <T,>(arr: T[]): T[] => arr.slice(0, maxItems);

  const origin = window.location.origin;

  const description =
    document
      .querySelector('meta[name="description"]')
      ?.getAttribute("content") ??
    document
      .querySelector('meta[property="og:description"]')
      ?.getAttribute("content") ??
    null;

  const headings: ExploredHeading[] = take(
    Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6"))
      .filter(isVisible)
      .map((el) => ({
        level: Number(el.tagName.substring(1)),
        text: clean(el.textContent),
      }))
      .filter((h) => h.text.length > 0)
  );

  const buttons: ExploredButton[] = take(
    Array.from(
      document.querySelectorAll(
        'button, [role="button"], input[type="submit"], input[type="button"]'
      )
    )
      .filter(isVisible)
      .map((el): ExploredButton => {
        const tag = el.tagName.toLowerCase();
        let kind: ExploredButton["kind"] = "button";
        if (tag === "input") kind = "input";
        else if (tag === "a") kind = "link-button";
        const text =
          clean(el.textContent) ||
          clean((el as HTMLInputElement).value) ||
          clean(el.getAttribute("aria-label"));
        return { text, kind };
      })
      .filter((b) => b.text.length > 0)
  );

  const links: ExploredLink[] = take(
    Array.from(document.querySelectorAll("a[href]"))
      .filter(isVisible)
      .map((el): ExploredLink | null => {
        const anchor = el as HTMLAnchorElement;
        const href = anchor.href;
        if (!href || href.startsWith("javascript:")) return null;
        let external = false;
        try {
          external = new URL(href).origin !== origin;
        } catch {
          external = false;
        }
        return { text: clean(anchor.textContent), href, external };
      })
      .filter((l): l is ExploredLink => l !== null && l.text.length > 0)
  );

  const forms: ExploredForm[] = take(
    Array.from(document.querySelectorAll("form")).map((formEl): ExploredForm => {
      const form = formEl as HTMLFormElement;
      const fields = Array.from(
        form.querySelectorAll("input, select, textarea")
      )
        .filter((f) => (f as HTMLInputElement).type !== "hidden")
        .map((f) => {
          const field = f as HTMLInputElement;
          const id = field.id;
          let label = "";
          if (id) {
            label = clean(
              document.querySelector(`label[for="${id}"]`)?.textContent
            );
          }
          return {
            name: field.name || field.id || "",
            type: field.type || field.tagName.toLowerCase(),
            label: label || undefined,
            required: field.required,
          };
        })
        .slice(0, maxItems);

      return {
        action: form.action || "",
        method: (form.method || "get").toUpperCase(),
        fields,
      };
    })
  );

  const navigation: ExploredNavItem[] = take(
    Array.from(document.querySelectorAll('nav a[href], [role="navigation"] a[href]'))
      .filter(isVisible)
      .map((el): ExploredNavItem => {
        const anchor = el as HTMLAnchorElement;
        return { text: clean(anchor.textContent), href: anchor.href };
      })
      .filter((n) => n.text.length > 0)
  );

  return {
    title: clean(document.title),
    description: description ? clean(description) : null,
    headings,
    buttons,
    links,
    forms,
    navigation,
  };
}

/** Wrap a promise with a hard timeout that rejects with a supplied error. */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  makeError: () => Error
): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(makeError()), ms);
  });
  return Promise.race([promise, timeout]).finally(() =>
    clearTimeout(timer)
  ) as Promise<T>;
}

/** Map raw/Playwright errors onto categorized ExplorerErrors. */
function normalizeError(err: unknown): ExplorerError {
  if (err instanceof ExplorerError) return err;

  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  if (lower.includes("timeout") || lower.includes("timed out")) {
    return new ExplorerError("timeout", "The website took too long to respond.");
  }
  if (
    lower.includes("net::err_name_not_resolved") ||
    lower.includes("dns")
  ) {
    return new ExplorerError("unreachable", "We could not resolve that domain.");
  }
  if (
    lower.includes("net::err_connection") ||
    lower.includes("net::err_aborted") ||
    lower.includes("econnrefused") ||
    lower.includes("net::err_cert")
  ) {
    return new ExplorerError(
      "unreachable",
      "We could not connect to that website."
    );
  }

  return new ExplorerError(
    "browser_error",
    "Something went wrong while opening the website."
  );
}
