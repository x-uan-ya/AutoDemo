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
}
