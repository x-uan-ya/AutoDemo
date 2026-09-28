import { z } from "zod";

/**
 * Strict Zod schemas for the Phase 4 browser action allowlist.
 *
 * SECURITY: This module is the gate between untrusted input (AI output, client
 * edits) and the executor. Anything that does not match one of these exact
 * shapes is rejected. In particular we refuse strings that look like attempts
 * to smuggle code or reach dangerous surfaces:
 *   - arbitrary JavaScript / eval / Function constructor
 *   - shell commands
 *   - filesystem access
 *   - network/fetch/XHR
 *   - browser extension / iframe injection
 *   - javascript:, data:, file:, chrome:, about: URLs
 *
 * The schemas use `.strict()` so unknown keys (a common injection vector) are
 * rejected rather than silently ignored.
 */

// ---------------------------------------------------------------------------
// Dangerous-content guards
// ---------------------------------------------------------------------------

/**
 * Patterns that must never appear in any selector, value, key, or name. These
 * are deliberately broad: the fields they guard are for CSS selectors, plain
 * text input, and labels — none of which legitimately contain code or scheme
 * prefixes.
 */
const DANGEROUS_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /javascript:/i, label: "javascript: URL" },
  { re: /\bdata:/i, label: "data: URL" },
  { re: /\bvbscript:/i, label: "vbscript: URL" },
  { re: /<\s*script/i, label: "script tag" },
  { re: /<\s*iframe/i, label: "iframe tag" },
  { re: /\beval\s*\(/i, label: "eval()" },
  { re: /new\s+Function\s*\(/i, label: "Function constructor" },
  { re: /\bfetch\s*\(/i, label: "fetch()" },
  { re: /XMLHttpRequest/i, label: "XMLHttpRequest" },
  { re: /\brequire\s*\(/i, label: "require()" },
  { re: /\bimport\s*\(/i, label: "dynamic import()" },
  { re: /process\.(env|exit|argv)/i, label: "process access" },
  { re: /child_process/i, label: "child_process" },
  { re: /\bexec(Sync)?\s*\(/i, label: "exec()" },
  { re: /\bspawn\s*\(/i, label: "spawn()" },
  { re: /require\(['"]fs['"]\)|node:fs|readFileSync|writeFileSync/i, label: "filesystem access" },
  { re: /localStorage|sessionStorage|document\.cookie/i, label: "storage/cookie access" },
  { re: /window\.|document\.write|innerHTML/i, label: "DOM scripting" },
  { re: /on\w+\s*=/i, label: "inline event handler" },
];

/**
 * A string schema that rejects any of the dangerous patterns above. Used for
 * every free-text field an action can carry.
 */
function safeString(max: number) {
  return z
    .string()
    .min(1)
    .max(max)
    .superRefine((val, ctx) => {
      for (const { re, label } of DANGEROUS_PATTERNS) {
        if (re.test(val)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Rejected: value contains a disallowed pattern (${label}).`,
          });
          return;
        }
      }
    });
}

/**
 * A URL for the `navigate` action. Must be an absolute https URL. We reject
 * every non-https scheme here; same-domain / SSRF checks happen at execution
 * time (they need the approved website URL and DNS resolution).
 */
const navigateUrlSchema = z
  .string()
  .min(1)
  .max(2048)
  .superRefine((val, ctx) => {
    let parsed: URL;
    try {
      parsed = new URL(val);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "navigate.url must be an absolute URL.",
      });
      return;
    }
    // Only https is permitted for navigation targets. This blocks javascript:,
    // data:, file:, chrome:, about:, http:, etc. at the schema layer.
    if (parsed.protocol !== "https:") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `navigate.url must use https (got "${parsed.protocol}").`,
      });
    }
  });

// ---------------------------------------------------------------------------
// Per-action schemas (strict: unknown keys rejected)
// ---------------------------------------------------------------------------

export const navigateActionSchema = z
  .object({ type: z.literal("navigate"), url: navigateUrlSchema })
  .strict();

export const clickActionSchema = z
  .object({
    type: z.literal("click"),
    selector: safeString(500),
    description: safeString(300),
  })
  .strict();

export const fillActionSchema = z
  .object({
    type: z.literal("fill"),
    selector: safeString(500),
    // Fill values are typed into inputs; still guarded against code smuggling.
    value: safeString(2000),
    description: safeString(300),
  })
  .strict();

export const selectActionSchema = z
  .object({
    type: z.literal("select"),
    selector: safeString(500),
    value: safeString(500),
    description: safeString(300),
  })
  .strict();

export const scrollActionSchema = z
  .object({
    type: z.literal("scroll"),
    direction: z.enum(["up", "down"]),
    amount: z.number().int().positive().max(100000).optional(),
  })
  .strict();

export const waitActionSchema = z
  .object({
    type: z.literal("wait"),
    // Bounded so a plan cannot stall the executor indefinitely.
    milliseconds: z.number().int().min(0).max(30000),
  })
  .strict();

export const hoverActionSchema = z
  .object({
    type: z.literal("hover"),
    selector: safeString(500),
    description: safeString(300),
  })
  .strict();

export const pressActionSchema = z
  .object({
    type: z.literal("press"),
    // Restrict to a conservative set of key names / simple combos.
    key: z
      .string()
      .min(1)
      .max(40)
      .regex(
        /^[A-Za-z0-9]+(\+[A-Za-z0-9]+)*$/,
        "press.key must be a key name or combo like 'Enter' or 'Control+A'."
      ),
  })
  .strict();

export const screenshotActionSchema = z
  .object({
    type: z.literal("screenshot"),
    // Screenshot names become part of a filename; restrict to safe chars to
    // prevent path traversal or command-like names.
    name: z
      .string()
      .min(1)
      .max(80)
      .regex(
        /^[A-Za-z0-9._-]+$/,
        "screenshot.name may only contain letters, numbers, dot, dash, underscore."
      ),
  })
  .strict();

/** The discriminated-union schema for a single browser action. */
export const browserActionSchema = z.discriminatedUnion("type", [
  navigateActionSchema,
  clickActionSchema,
  fillActionSchema,
  selectActionSchema,
  scrollActionSchema,
  waitActionSchema,
  hoverActionSchema,
  pressActionSchema,
  screenshotActionSchema,
]);

/** A list of actions (bounded to keep plans sane). */
export const browserActionsSchema = z.array(browserActionSchema).max(50);

/**
 * Tool input schema for the AI provider: the model may only return actions in
 * this exact shape. Kept aligned with the Zod union by hand.
 */
export const ACTIONS_TOOL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    scenes: {
      type: "array",
      description: "One entry per storyboard scene, in order.",
      items: {
        type: "object",
        properties: {
          sceneId: { type: "string" },
          actions: {
            type: "array",
            description:
              "Allowlisted browser actions for the scene. No JavaScript.",
            items: {
              type: "object",
              properties: {
                type: {
                  type: "string",
                  enum: [
                    "navigate",
                    "click",
                    "fill",
                    "select",
                    "scroll",
                    "wait",
                    "hover",
                    "press",
                    "screenshot",
                  ],
                },
                url: { type: "string" },
                selector: { type: "string" },
                value: { type: "string" },
                description: { type: "string" },
                direction: { type: "string", enum: ["up", "down"] },
                amount: { type: "number" },
                milliseconds: { type: "number" },
                key: { type: "string" },
                name: { type: "string" },
              },
              required: ["type"],
            },
          },
        },
        required: ["sceneId", "actions"],
      },
    },
  },
  required: ["scenes"],
} as const;

/** Response shape the model must produce (validated action-by-action). */
export const actionPlanResponseSchema = z.object({
  scenes: z
    .array(
      z.object({
        sceneId: z.string().min(1),
        actions: browserActionsSchema,
      })
    )
    .max(20),
});

export type ActionPlanResponse = z.infer<typeof actionPlanResponseSchema>;

/**
 * Validate an arbitrary value as a single BrowserAction. Returns a typed
 * result so callers can reject bad input without throwing.
 */
export function parseBrowserAction(value: unknown) {
  return browserActionSchema.safeParse(value);
}
