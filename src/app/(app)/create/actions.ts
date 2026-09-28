"use server";

import { redirect } from "next/navigation";
import { demoSettingsSchema } from "@/lib/validation";
import { getRepository } from "@/lib/repository";
import type { DemoSettings } from "@/types";

export interface CreateDemoState {
  errors?: Record<string, string>;
  message?: string;
}

/**
 * Server Action for the create-demo form.
 *
 * For this milestone it does NOT call any AI, browser automation, or video
 * service. It validates the input with Zod, creates a mock job in the
 * repository, and redirects to that job's detail page.
 */
export async function createDemoAction(
  _prevState: CreateDemoState,
  formData: FormData
): Promise<CreateDemoState> {
  const raw = {
    websiteUrl: String(formData.get("websiteUrl") ?? ""),
    purpose: String(formData.get("purpose") ?? ""),
    audience: String(formData.get("audience") ?? ""),
    duration: String(formData.get("duration") ?? ""),
    language: String(formData.get("language") ?? ""),
    voice: String(formData.get("voice") ?? ""),
    additionalInstructions:
      String(formData.get("additionalInstructions") ?? "") || undefined,
  };

  const parsed = demoSettingsSchema.safeParse(raw);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !errors[key]) {
        errors[key] = issue.message;
      }
    }
    return { errors, message: "Please fix the highlighted fields." };
  }

  const settings: DemoSettings = parsed.data;
  const job = await getRepository().create(settings);

  // Redirect throws internally; nothing after this runs.
  redirect(`/demo/${job.id}`);
}
