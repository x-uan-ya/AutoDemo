import type { WebsiteExploration } from "@/lib/browser/types";

/**
 * Prompt construction for Feature Discovery.
 *
 * The single most important rule: the model must only describe features that
 * are supported by observable evidence (DOM data, visible text, screenshots).
 * It must NOT infer backend systems, integrations, or capabilities that are
 * not visible on the page. The system prompt states this explicitly and the
 * user prompt supplies only observable data.
 */

export const FEATURE_DISCOVERY_SYSTEM_PROMPT = `You are a product analyst for AutoDemo, a tool that turns websites into demo videos.

Your job: from a SINGLE captured web page, identify the product features a viewer could see and understand from what is actually on the page.

STRICT EVIDENCE RULES — follow all of them:
1. Only report a feature if it is supported by concrete, observable evidence from the provided data: page headings, visible text, buttons, links, forms, navigation, or the screenshots.
2. Do NOT invent or infer backend functionality, databases, APIs, integrations, security, scalability, or anything not visible on the page. If you cannot see it, do not claim it.
3. Every feature MUST include an "evidence" array citing the specific observed items (e.g. "Heading: Portfolio Analysis", "Button: Analyze", "Nav link: Pricing", "Screenshot: chart panel").
4. Prefer fewer, well-supported features over many speculative ones.
5. Set "confidence" lower when evidence is thin or ambiguous. Set "importance" by how central the feature appears to be to the product.
6. Set "safeToDemo" to false for anything that would require logging in, paying, or submitting a form that changes data (sign up, checkout, delete). Set it to true for features that can be shown by passive navigation and scrolling.
7. Names must be concrete product features, not generic page parts. Avoid "Navigation bar", "Footer", "Cookie banner" unless they represent a genuine product capability.

Return ONLY structured data via the provided tool. Do not add commentary.`;

/**
 * Build the user message text from the exploration data. Screenshots are
 * attached separately as image content blocks by the provider.
 */
export function buildFeatureDiscoveryUserText(
  exploration: WebsiteExploration,
  context?: { purpose?: string; audience?: string }
): string {
  const lines: string[] = [];

  lines.push(`# Page under analysis`);
  lines.push(`Final URL: ${exploration.finalUrl}`);
  lines.push(`Title: ${exploration.title || "(none)"}`);
  if (exploration.description) {
    lines.push(`Meta description: ${exploration.description}`);
  }

  if (context?.purpose || context?.audience) {
    lines.push("");
    lines.push(`# Demo context (for prioritization only, not evidence)`);
    if (context.purpose) lines.push(`Demo purpose: ${context.purpose}`);
    if (context.audience) lines.push(`Target audience: ${context.audience}`);
  }

  lines.push("");
  lines.push(`# Observable page data`);

  lines.push(sectionList("Headings", exploration.headings.map((h) => `H${h.level}: ${h.text}`)));
  lines.push(sectionList("Buttons", exploration.buttons.map((b) => b.text)));
  lines.push(
    sectionList(
      "Navigation",
      exploration.navigation.map((n) => n.text)
    )
  );
  lines.push(
    sectionList(
      "Links",
      exploration.links.map((l) => l.text + (l.external ? " (external)" : ""))
    )
  );
  lines.push(
    sectionList(
      "Forms",
      exploration.forms.map(
        (f) =>
          `${f.method} form with fields: ${
            f.fields.map((fld) => fld.label || fld.name || fld.type).join(", ") ||
            "(none)"
          }`
      )
    )
  );

  lines.push("");
  lines.push(
    `The screenshots (viewport and full page) are attached as images. Use them together with the data above.`
  );
  lines.push("");
  lines.push(
    `Identify the product features. Cite evidence for each. Do not report anything you cannot observe.`
  );

  return lines.join("\n");
}

function sectionList(label: string, items: string[]): string {
  const trimmed = items.map((s) => s.trim()).filter((s) => s.length > 0);
  if (trimmed.length === 0) return `\n## ${label}\n(none)`;
  // Cap to keep the prompt bounded on very large pages.
  const capped = trimmed.slice(0, 60);
  const bullet = capped.map((s) => `- ${s}`).join("\n");
  const more = trimmed.length > capped.length ? `\n- ...(${trimmed.length - capped.length} more)` : "";
  return `\n## ${label}\n${bullet}${more}`;
}
