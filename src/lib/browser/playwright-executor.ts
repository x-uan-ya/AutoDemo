import { chromium, type Browser, type Page, type Route } from "playwright";
import type { BrowserAction, ActionExecutionResult } from "./types";
import { browserActionSchema } from "./schemas";
import { checkNavigationTarget, flagDestructiveAction } from "./action-security";

/**
 * Phase 4 safe Playwright executor.
 *
 * Executes an allowlisted BrowserAction[] against ONLY the approved website.
 * Every action returns an ActionExecutionResult — successes and failures alike.
 * Errors are never silently ignored.
 *
 * SECURITY:
 *  - Each action is re-validated against the strict schema before running.
 *  - `navigate` targets are checked against the approved domain + SSRF/scheme
 *    blocklist (checkNavigationTarget). Off-domain / internal navigations fail.
 *  - The network layer aborts any non-http(s) request scheme.
 *  - Destructive actions (checkout/delete/logout/...) are refused here unless
 *    explicitly allowed by the caller; by default they are NOT auto-executed.
 *  - Before click/fill/select/hover we verify the target exists and is visible,
 *    with a bounded timeout.
 */

const DEFAULT_ACTION_TIMEOUT_MS = 10_000;
const NAV_TIMEOUT_MS = 30_000;
const VIEWPORT = { width: 1280, height: 800 };

export interface ExecutorOptions {
  /** The approved website; all navigation is scoped to this domain. */
  websiteUrl: string;
  /** Per-action timeout in ms. */
  actionTimeoutMs?: number;
  /**
   * When false (default), actions flagged as destructive are refused. When
   * true, the caller has taken responsibility (e.g. explicit human approval).
   */
  allowFlaggedActions?: boolean;
  /** Directory screenshots are written to (created if missing). */
  screenshotDir?: string;
}

export interface ExecutionRun {
  results: ActionExecutionResult[];
  /** True when every action succeeded. */
  ok: boolean;
}

/**
 * Execute a sequence of actions in a single browser session. Returns a result
 * per action. Execution continues after a failed action (so the caller sees
 * the full picture); callers may choose to stop on first failure by inspecting
 * results as they go is not supported here — this is a batch runner.
 */
export async function executeActions(
  actions: BrowserAction[],
  options: ExecutorOptions
): Promise<ExecutionRun> {
  const timeout = options.actionTimeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS;
  const results: ActionExecutionResult[] = [];

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
        "Mozilla/5.0 (compatible; AutoDemoActionEngine/1.0; +https://autodemo.example/bot)",
    });
    context.setDefaultTimeout(timeout);
    context.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);

    // SECURITY: only http/https requests may leave the page; everything else
    // (e.g. custom schemes) is aborted at the network layer.
    await context.route("**/*", (route: Route) => {
      const scheme = route.request().url().split(":", 1)[0]?.toLowerCase();
      if (scheme === "http" || scheme === "https") route.continue();
      else route.abort();
    });

    const page = await context.newPage();

    for (const raw of actions) {
      // Re-validate every action right before executing it. Never trust that
      // upstream validation happened.
      const parsed = browserActionSchema.safeParse(raw);
      if (!parsed.success) {
        results.push({
          success: false,
          action: raw,
          message: `Rejected by schema: ${parsed.error.issues[0]?.message}`,
        });
        continue;
      }
      const action = parsed.data;

      // Refuse destructive actions unless explicitly allowed.
      const flag = flagDestructiveAction(action);
      if (flag && !options.allowFlaggedActions) {
        results.push({
          success: false,
          action,
          message: `Skipped: action requires human approval (${flag}).`,
        });
        continue;
      }

      results.push(await runOne(page, action, options, timeout));
    }

    return { results, ok: results.every((r) => r.success) };
  } catch (err) {
    // A failure setting up the browser itself: record it against no action.
    const message = err instanceof Error ? err.message : String(err);
    results.push({
      success: false,
      action: { type: "wait", milliseconds: 0 },
      message: `Executor error: ${message}`,
    });
    return { results, ok: false };
  } finally {
    if (browser) await browser.close().catch(() => undefined);
  }
}

/** Execute a single action, returning a structured result. */
async function runOne(
  page: Page,
  action: BrowserAction,
  options: ExecutorOptions,
  timeout: number
): Promise<ActionExecutionResult> {
  try {
    switch (action.type) {
      case "navigate": {
        // SECURITY: scope navigation to the approved domain + block internal
        // hosts and non-https schemes.
        const check = checkNavigationTarget(action.url, options.websiteUrl);
        if (!check.allowed) {
          return { success: false, action, message: `Blocked navigation: ${check.reason}` };
        }
        const resp = await page.goto(action.url, { waitUntil: "domcontentloaded" });
        const status = resp?.status() ?? 0;
        if (status >= 400) {
          return { success: false, action, message: `Navigation returned HTTP ${status}.` };
        }
        return { success: true, action, message: `Navigated to ${action.url}` };
      }

      case "click": {
        await assertVisible(page, action.selector, timeout);
        await page.click(action.selector, { timeout });
        return { success: true, action, message: `Clicked ${action.selector}` };
      }

      case "fill": {
        await assertVisible(page, action.selector, timeout);
        await page.fill(action.selector, action.value, { timeout });
        return { success: true, action, message: `Filled ${action.selector}` };
      }

      case "select": {
        await assertVisible(page, action.selector, timeout);
        await page.selectOption(action.selector, action.value, { timeout });
        return { success: true, action, message: `Selected in ${action.selector}` };
      }

      case "hover": {
        await assertVisible(page, action.selector, timeout);
        await page.hover(action.selector, { timeout });
        return { success: true, action, message: `Hovered ${action.selector}` };
      }

      case "scroll": {
        const amount = action.amount ?? 500;
        const delta = action.direction === "down" ? amount : -amount;
        await page.mouse.wheel(0, delta);
        return { success: true, action, message: `Scrolled ${action.direction}` };
      }

      case "wait": {
        await page.waitForTimeout(action.milliseconds);
        return { success: true, action, message: `Waited ${action.milliseconds}ms` };
      }

      case "press": {
        await page.keyboard.press(action.key);
        return { success: true, action, message: `Pressed ${action.key}` };
      }

      case "screenshot": {
        // Screenshot name is schema-restricted to safe filename chars.
        const path = options.screenshotDir
          ? `${options.screenshotDir}/${action.name}.png`
          : undefined;
        const buf = await page.screenshot({ path, fullPage: false });
        return {
          success: true,
          action,
          message: `Captured screenshot "${action.name}" (${buf.length} bytes)`,
          screenshotPath: path,
        };
      }
    }
  } catch (err) {
    // Do NOT swallow errors — surface them in the result.
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, action, message };
  }
}

/**
 * Assert a target exists and is visible before we act on it. Uses a bounded
 * wait; throws (caught by runOne) with a clear message if not satisfied.
 */
async function assertVisible(
  page: Page,
  selector: string,
  timeout: number
): Promise<void> {
  const locator = page.locator(selector).first();
  const count = await locator.count();
  if (count === 0) {
    throw new Error(`Target not found: ${selector}`);
  }
  // waitFor throws on timeout if the element never becomes visible.
  await locator.waitFor({ state: "visible", timeout });
}
