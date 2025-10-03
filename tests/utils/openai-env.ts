/**
 * Collect the subset of OpenAI environment variables that the Playwright-managed
 * dev server needs in order to stream real completions. The helper mirrors the
 * behaviour of the Vercel AI Chatbot boilerplate where the secrets are
 * forwarded explicitly instead of relying on ambient inheritance, which keeps
 * hermetic CI runs reproducible.
 */
export function collectOpenAIEnvVars(env: NodeJS.ProcessEnv): Record<string, string> {
  const keys = [
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "OPENAI_ORGANIZATION",
    "OPENAI_PROJECT",
    "OPENAI_MODEL_ID",
    "OPENAI_REASONING_MODEL_ID",
    "OPENAI_TITLE_MODEL_ID",
    "OPENAI_ARTIFACT_MODEL_ID",
  ] as const;

  const result: Record<string, string> = {};

  for (const key of keys) {
    const value = env[key];
    if (typeof value !== "string") {
      continue;
    }

    const trimmed = value.trim();
    if (trimmed.length === 0) {
      continue;
    }

    result[key] = trimmed;
  }

  return result;
}
