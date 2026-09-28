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

// ===========================================================================
// Phase 4 — Browser Action Engine
// ===========================================================================

/**
 * The fixed allowlist of browser actions the system can execute.
 *
 * SECURITY: This is a closed discriminated union. The AI (and any client) may
 * ONLY produce values that fit one of these shapes — never arbitrary
 * JavaScript, shell, or free-form instructions. Every action is validated
 * against the Zod schemas in `./schemas.ts` before it is trusted or executed.
 * Adding a new capability means adding a new member here AND its schema.
 */
export type BrowserAction =
  | {
      type: "navigate";
      /** Absolute URL. Validated to be https + same-domain at execution time. */
      url: string;
    }
  | {
      type: "click";
      selector: string;
      description: string;
    }
  | {
      type: "fill";
      selector: string;
      value: string;
      description: string;
    }
  | {
      type: "select";
      selector: string;
      value: string;
      description: string;
    }
  | {
      type: "scroll";
      direction: "up" | "down";
      /** Pixels to scroll. Optional; a sensible default is used when omitted. */
      amount?: number;
    }
  | {
      type: "wait";
      milliseconds: number;
    }
  | {
      type: "hover";
      selector: string;
      description: string;
    }
  | {
      type: "press";
      /** A single key or key combo, e.g. "Enter", "Escape", "Control+A". */
      key: string;
    }
  | {
      type: "screenshot";
      name: string;
    };

/** The action `type` discriminant, handy for exhaustiveness and UI. */
export type BrowserActionType = BrowserAction["type"];

/**
 * Optional post-action expected state, attached to a PlannedBrowserAction.
 *
 * This is kept SEPARATE from the BrowserAction discriminated union so the
 * strict Zod allowlist schemas are unchanged. The expected state is used only
 * during recording-time verification — it is never executed.
 */
export interface ExpectedState {
  /** Human-readable description of what the page should show after the action. */
  description: string;
  /**
   * Strings that should be visible in the page body after the action.
   * Rule-based check runs these before the vision model.
   */
  visibleText?: string[];
  /** When true, a screenshot is always captured regardless of action outcome. */
  screenshotRequired?: boolean;
}

/**
 * A planned action as stored/reviewed, with an id and safety metadata layered
 * on top of the raw action. `requiresHumanApproval` flags potentially
 * destructive intent (see security.ts); such actions are surfaced to the user
 * and are NOT auto-executed.
 */
export interface PlannedBrowserAction {
  id: string;
  action: BrowserAction;
  /** Human-readable summary for the preview UI. */
  summary: string;
  /**
   * True when the action looks destructive/sensitive (delete, checkout,
   * logout, payment, etc.). Flagged rather than executed automatically.
   */
  requiresHumanApproval: boolean;
  /** Why it was flagged, when it was. */
  approvalReason?: string;
  /**
   * Optional Phase 9 quality-check spec. When present, the verification loop
   * runs after executing this action. Absence means "no check required".
   */
  expectedState?: ExpectedState;
}

/** The set of planned actions for a single storyboard scene. */
export interface SceneActionSet {
  sceneId: string;
  order: number;
  title: string;
  actions: PlannedBrowserAction[];
}

export type ActionPlanStatus = "draft" | "approved";

/**
 * The full Phase 4 action plan for a demo: one action set per storyboard
 * scene, plus approval state. Recording (a later phase) must not start until
 * this is approved.
 */
export interface ActionPlan {
  scenes: SceneActionSet[];
  status: ActionPlanStatus;
  generatedAt: string;
  approvedAt?: string;
  /** True if any scene contains an action requiring human approval. */
  hasFlaggedActions: boolean;
}

/**
 * The result of executing a single BrowserAction. Every executed action
 * returns one of these — successes and failures alike (errors are never
 * silently swallowed).
 */
export interface ActionExecutionResult {
  success: boolean;
  action: BrowserAction;
  message?: string;
  screenshotPath?: string;
}

// ===========================================================================
// Phase 5 — Deterministic Browser Recording
// ===========================================================================

/** Details of an action failure captured during recording (never swallowed). */
export interface RecordingActionFailure {
  sceneId: string;
  /** Human-readable action summary. */
  action: string;
  message: string;
  /** Screenshot captured at the moment of failure, if one could be taken. */
  screenshotPath?: string;
  timestamp: string;
}

/**
 * The recording outcome for a single scene: timing, scene-boundary
 * screenshots, and whether every action in the scene succeeded.
 */
export interface RecordingSceneResult {
  sceneId: string;
  title: string;
  order: number;
  /** ISO timestamp when the scene started executing. */
  startTime: string;
  /** ISO timestamp when the scene finished. */
  endTime: string;
  /** Start and end screenshots (and any failure screenshot) for the scene. */
  screenshotPaths: string[];
  success: boolean;
  /** Error message if the scene failed. */
  error?: string;
}

/**
 * The full result of a recording run. Stored on the DemoJob so the UI can show
 * the video and per-scene outcomes.
 */
export interface RecordingResult {
  success: boolean;
  /** Public path to the recorded video (served via the record API), or null. */
  videoPath: string | null;
  /** Total recording duration in milliseconds. */
  duration: number;
  scenes: RecordingSceneResult[];
  /** All scene-boundary screenshots collected, in order. */
  screenshots: string[];
  /** Any action failures, with full context. Empty on full success. */
  errors: RecordingActionFailure[];
  /** When the recording finished (ISO 8601). */
  recordedAt: string;
  /** Viewport used, for reference. */
  viewport: { width: number; height: number };
  /**
   * Phase 9: per-action verification results, keyed by sceneId → actionId.
   * Populated only for actions that had an expectedState.
   */
  verifications?: Record<string, Record<string, ActionVerification>>;
}

// ===========================================================================
// Phase 9 — AI-Assisted Browser Quality Control
// ===========================================================================

/** Snapshot of the page captured immediately after an action. */
export interface PageState {
  url: string;
  title: string;
  visibleText: string;
  screenshotBase64: string | null;
  screenshotPath: string | null;
  capturedAt: string;
}

/** The three outcomes the verification model is allowed to return. */
export type VerificationStatus = "PASS" | "FAIL" | "UNCERTAIN";

/**
 * SECURITY: The verification model may ONLY return one of these three words and
 * supporting text. It cannot trigger any Playwright operation. The executor
 * remains the SOLE component allowed to run browser actions.
 */
export interface VerificationResult {
  status: VerificationStatus;
  /** Why the model gave this verdict. */
  reason: string;
  /** Specific observable evidence from the page. */
  evidence: string;
  /** Which check produced this result: rule-based or vision model. */
  checkType: "rule" | "vision";
}

/** Outcome of one action after the full verification loop. */
export type VerifiedOutcome =
  | "PASS"             // verified as correct
  | "FAIL"             // failed, no more retries
  | "RETRIED_PASS"     // failed initially, passed after retry
  | "HUMAN_REVIEW"     // exhausted retries, awaiting human decision
  | "SKIPPED_BY_USER"  // user chose to skip during human review
  | "NO_CHECK";        // action had no expectedState — no verification run

/** Full verification record attached to an ActionExecutionResult. */
export interface ActionVerification {
  /** Outcome after all retries. */
  outcome: VerifiedOutcome;
  /** Number of retry/repair attempts made (0 = first attempt passed or failed). */
  retryCount: number;
  /** State captured immediately after the action. */
  pageState: PageState | null;
  /** The verification result (may be from rule check or vision model). */
  verificationResult: VerificationResult | null;
  /** True when the vision model was invoked (for cost-tracking). */
  visionModelUsed: boolean;
  /** Human review context — populated only when outcome is HUMAN_REVIEW. */
  humanReview?: HumanReviewContext;
}

/** Context attached to any action flagged for human review. */
export interface HumanReviewContext {
  sceneId: string;
  actionSummary: string;
  expectedState: ExpectedState;
  /** The last page state before human review was triggered. */
  actualState: PageState | null;
  /** The last verification failure reason. */
  failReason: string;
  screenshotPath: string | null;
  /** Populated once the user makes a decision. */
  decision?: "RETRY" | "SKIP" | "ABORT";
  decidedAt?: string;
}

/**
 * Quality report for a full recording run. Surfaces to the dashboard.
 */
export interface QualityReport {
  jobId: string;
  totalActions: number;
  passedActions: number;
  failedActions: number;
  retriedActions: number;
  skippedActions: number;
  humanReviewActions: number;
  /** Actions that had an expectedState / were checked (pass + fail + retried). */
  verifiedActions: number;
  /** verifiedActions / totalActions (0..1). */
  verificationRate: number;
  visionModelCallCount: number;
  /** True when any action requires a human decision before rendering. */
  blocksRendering: boolean;
  generatedAt: string;
  sceneReports: SceneQualityReport[];
}

export interface SceneQualityReport {
  sceneId: string;
  title: string;
  totalActions: number;
  passedActions: number;
  failedActions: number;
  humanReviewActions: number;
  actions: ActionQualityItem[];
}

export interface ActionQualityItem {
  actionId: string;
  summary: string;
  outcome: VerifiedOutcome;
  retryCount: number;
  visionModelUsed: boolean;
  screenshotPath: string | null;
  failReason?: string;
  humanReview?: HumanReviewContext;
}
