import type { DemoJob, PlanScene } from "@/types";
import type {
  ActionPlan,
  BrowserAction,
  PlannedBrowserAction,
  SceneActionSet,
} from "./types";
import { browserActionSchema } from "./schemas";
import { flagDestructiveAction } from "./action-security";

/**
 * Phase 4 Action Planner.
 *
 * Converts an approved storyboard into a structured, allowlisted list of
 * BrowserAction per scene. This module is deliberately deterministic and
 * rule-based: the AI is never asked to emit code, only (optionally) to choose
 * among allowlisted shapes. Keeping the mapping here means the security and
 * validation guarantees do not depend on model behavior.
 *
 * SECURITY: every action produced is validated with `browserActionSchema`
 * before it leaves this module, and destructive intent is flagged via
 * `flagDestructiveAction`. AI-provider logic (if used later) lives in the AI
 * layer, not here — this file has no provider imports.
 *
 * SELECTOR STRATEGY (most→least robust), applied when we synthesize selectors
 * from evidence:
 *   1. data-testid
 *   2. accessible role/name  (Playwright: role= / getByRole)
 *   3. label
 *   4. visible text          (Playwright: text= / :has-text())
 *   5. stable CSS
 * We avoid nth-child, generated class names, random ids, and deep CSS chains.
 */

function actionId(): string {
  return "act_" + Math.random().toString(36).slice(2, 10);
}

/**
 * Evidence strings look like "Heading: Portfolio Analysis", "Button: Analyze",
 * "Nav link: Pricing", "Form: GET with fields search". Parse them into a
 * lightweight structure so we can build robust selectors.
 */
interface ParsedEvidence {
  kind: "heading" | "button" | "link" | "nav" | "form" | "other";
  text: string;
}

function parseEvidence(evidence: string): ParsedEvidence {
  const m = evidence.match(/^([^:]+):\s*(.+)$/);
  if (!m) return { kind: "other", text: evidence.trim() };
  const label = m[1].toLowerCase();
  const text = m[2].trim();
  if (label.includes("heading")) return { kind: "heading", text };
  if (label.includes("button")) return { kind: "button", text };
  if (label.includes("nav")) return { kind: "nav", text };
  if (label.includes("link")) return { kind: "link", text };
  if (label.includes("form")) return { kind: "form", text };
  return { kind: "other", text };
}

/** Escape a quote for use inside a Playwright text selector. */
function esc(text: string): string {
  return text.replace(/["\\]/g, "\\$&");
}

/**
 * Build a robust selector for an interactive element described by evidence.
 * Prefers accessible role/name and visible text (both stable across markup
 * churn) over CSS. We never emit nth-child / generated class selectors.
 */
function selectorForEvidence(ev: ParsedEvidence): string {
  const t = esc(ev.text);
  switch (ev.kind) {
    case "button":
      // Accessible role + visible text — robust and readable.
      return `role=button[name="${t}"]`;
    case "link":
    case "nav":
      return `role=link[name="${t}"]`;
    case "heading":
      return `role=heading[name="${t}"]`;
    default:
      // Fall back to visible text match.
      return `text="${t}"`;
  }
}

/**
 * Turn one storyboard scene into a sequence of allowlisted actions.
 *
 * The pattern per scene: take a screenshot for reference, then interact with
 * the scene's evidence-backed elements using safe verbs (hover/click for
 * buttons and links, a gentle scroll for headings/sections). We only ever
 * click links/buttons that came from observed evidence, and we never fill or
 * submit forms automatically.
 */
function actionsForScene(
  scene: PlanScene,
  isFirst: boolean,
  websiteUrl: string
): BrowserAction[] {
  const actions: BrowserAction[] = [];

  // The very first scene navigates to the site.
  if (isFirst) {
    actions.push({ type: "navigate", url: websiteUrl });
    actions.push({ type: "wait", milliseconds: 800 });
  }

  const parsed = scene.evidence.map(parseEvidence);

  // Interact with up to two evidence-backed elements per scene, choosing safe
  // verbs. Buttons/links get a hover then click; headings/sections get a
  // scroll into view. Forms are only scrolled to (never filled/submitted).
  let interactions = 0;
  for (const ev of parsed) {
    if (interactions >= 2) break;
    if (ev.kind === "button" || ev.kind === "link" || ev.kind === "nav") {
      const selector = selectorForEvidence(ev);
      actions.push({
        type: "hover",
        selector,
        description: `Hover ${ev.kind} "${ev.text}"`,
      });
      actions.push({
        type: "click",
        selector,
        description: `Click ${ev.kind} "${ev.text}"`,
      });
      actions.push({ type: "wait", milliseconds: 600 });
      interactions++;
    } else if (ev.kind === "heading" || ev.kind === "form" || ev.kind === "other") {
      actions.push({ type: "scroll", direction: "down", amount: 400 });
      interactions++;
    }
  }

  // If a scene had no usable evidence, at least scroll to show progression.
  if (interactions === 0) {
    actions.push({ type: "scroll", direction: "down", amount: 500 });
  }

  // Capture a screenshot at the end of the scene for the storyboard/recording.
  actions.push({
    type: "screenshot",
    name: `scene-${scene.order}`,
  });

  return actions;
}

/** Wrap a raw action with an id, summary, and destructive-intent flag. */
function toPlanned(action: BrowserAction): PlannedBrowserAction {
  const reason = flagDestructiveAction(action);
  return {
    id: actionId(),
    action,
    summary: summarize(action),
    requiresHumanApproval: reason != null,
    approvalReason: reason ?? undefined,
  };
}

/** Human-readable one-line summary for the preview UI. */
export function summarize(action: BrowserAction): string {
  switch (action.type) {
    case "navigate":
      return `Navigate to ${action.url}`;
    case "click":
      return action.description || `Click ${action.selector}`;
    case "fill":
      return action.description || `Fill ${action.selector}`;
    case "select":
      return action.description || `Select in ${action.selector}`;
    case "scroll":
      return `Scroll ${action.direction}${action.amount ? ` ${action.amount}px` : ""}`;
    case "wait":
      return `Wait ${action.milliseconds}ms`;
    case "hover":
      return action.description || `Hover ${action.selector}`;
    case "press":
      return `Press ${action.key}`;
    case "screenshot":
      return `Screenshot "${action.name}"`;
  }
}

/**
 * Generate the full action plan for an approved storyboard.
 *
 * Throws if the storyboard is missing or not approved — Phase 4 only runs once
 * the Phase 3 storyboard is approved.
 */
export function generateActionPlan(job: DemoJob): ActionPlan {
  const plan = job.plan;
  if (!plan || plan.scenes.length === 0) {
    throw new ActionPlannerError("No storyboard to build actions from.");
  }
  if (plan.status !== "approved") {
    throw new ActionPlannerError(
      "Approve the storyboard before generating browser actions."
    );
  }

  const websiteUrl = job.settings.websiteUrl;
  const orderedScenes = [...plan.scenes].sort((a, b) => a.order - b.order);

  const scenes: SceneActionSet[] = orderedScenes.map((scene, i) => {
    const raw = actionsForScene(scene, i === 0, websiteUrl);

    // SECURITY: validate every synthesized action against the strict schema.
    // If any fails, drop it rather than trust it.
    const planned: PlannedBrowserAction[] = [];
    for (const action of raw) {
      const parsed = browserActionSchema.safeParse(action);
      if (parsed.success) {
        planned.push(toPlanned(parsed.data));
      }
    }

    return {
      sceneId: scene.id,
      order: scene.order,
      title: scene.title,
      actions: planned,
    };
  });

  const hasFlaggedActions = scenes.some((s) =>
    s.actions.some((a) => a.requiresHumanApproval)
  );

  return {
    scenes,
    status: "draft",
    generatedAt: new Date().toISOString(),
    hasFlaggedActions,
  };
}

export class ActionPlannerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionPlannerError";
  }
}
