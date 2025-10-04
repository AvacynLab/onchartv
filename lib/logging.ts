/**
 * @file Structured logging helpers that redact sensitive values before
 * emitting them to the console. The functions defined here are safe to use
 * across server routes and background tasks to guarantee we never leak
 * secrets (API keys, tokens, cookies...) to shared logs.
 */

const REDACTED_VALUE = "[redacted]";
const CIRCULAR_REFERENCE = "[circular]";

const SENSITIVE_KEY_PATTERNS = [
  /auth/i,
  /token/i,
  /secret/i,
  /password/i,
  /cookie/i,
  /key$/i,
  /api[-_]?key/i,
];

const SENSITIVE_VALUE_PATTERNS = [
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/i,
  /sk-[A-Za-z0-9]{10,}/i,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/, // PEM formatted keys
];

const MAX_STACK_LINES = 5;

/**
 * Structured payload returned by the logger helpers so tests can assert the
 * final shape without reading from stdout.
 */
export interface StructuredLogEntry {
  level: "error" | "warn";
  context: string;
  timestamp: string;
  message?: string;
  data?: unknown;
  extra?: unknown;
}

/**
 * Sanitises arbitrary payloads for safe logging. Sensitive keys are redacted
 * and strings that match well known credential formats are replaced with a
 * neutral placeholder. The original value is never mutated.
 */
export function sanitizeForLogging(value: unknown, seen = new WeakSet()): unknown {
  if (typeof value === "string") {
    return sanitizeString(value);
  }

  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "undefined"
  ) {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "function") {
    return "[function]";
  }

  if (value instanceof Error) {
    if (seen.has(value)) {
      return CIRCULAR_REFERENCE;
    }

    seen.add(value);

    const base: Record<string, unknown> = {
      name: sanitizeString(value.name ?? "Error"),
      message: sanitizeString(value.message ?? ""),
    };

    if (typeof value.stack === "string") {
      base.stack = value.stack
        .split("\n")
        .slice(0, MAX_STACK_LINES)
        .join("\n");
    }

    // Capture any custom fields the error instance exposes so we can iterate
    // over them without violating TypeScript's structural expectations.
    const extraProperties = value as unknown as Record<string, unknown>;

    for (const key of Object.getOwnPropertyNames(value)) {
      if (key === "name" || key === "message" || key === "stack") {
        continue;
      }

      const propertyValue = extraProperties[key];

      base[key] = shouldRedactKey(key)
        ? REDACTED_VALUE
        : sanitizeForLogging(propertyValue, seen);
    }

    return base;
  }

  if (typeof value === "object") {
    if (seen.has(value as object)) {
      return CIRCULAR_REFERENCE;
    }

    seen.add(value as object);

    if (Array.isArray(value)) {
      return value.map((item) => sanitizeForLogging(item, seen));
    }

    const prototype = Object.getPrototypeOf(value);

    if (!prototype || prototype === Object.prototype) {
      const result: Record<string, unknown> = {};

      for (const [key, nestedValue] of Object.entries(
        value as Record<string, unknown>
      )) {
        if (shouldRedactKey(key)) {
          result[key] = REDACTED_VALUE;
          continue;
        }

        result[key] = sanitizeForLogging(nestedValue, seen);
      }

      return result;
    }

    return value;
  }

  return value;
}

/**
 * Emits a structured warning log with sanitised payloads and returns the
 * entry so call sites can unit test emitted data if necessary.
 */
export function logWarning(
  context: string,
  warning: unknown,
  extra?: Record<string, unknown>
): StructuredLogEntry {
  return emitStructuredLog("warn", context, warning, extra);
}

/**
 * Emits a structured error log with sanitised payloads and returns the entry
 * so server routes can share the final payload with tests.
 */
export function logError(
  context: string,
  error: unknown,
  extra?: Record<string, unknown>
): StructuredLogEntry {
  return emitStructuredLog("error", context, error, extra);
}

function emitStructuredLog(
  level: StructuredLogEntry["level"],
  context: string,
  primary: unknown,
  extra?: Record<string, unknown>
): StructuredLogEntry {
  const sanitizedPrimary = sanitizeForLogging(primary);
  const sanitizedExtra =
    typeof extra === "undefined" ? undefined : sanitizeForLogging(extra);

  const payload: StructuredLogEntry = {
    level,
    context,
    timestamp: new Date().toISOString(),
  };

  if (typeof sanitizedPrimary === "string") {
    payload.message = sanitizedPrimary;
  } else if (typeof sanitizedPrimary !== "undefined") {
    payload.data = sanitizedPrimary;
  }

  if (typeof sanitizedExtra !== "undefined") {
    payload.extra = sanitizedExtra;
  }

  const emitter = level === "error" ? console.error : console.warn;
  emitter(`[${context}]`, payload);

  return payload;
}

function sanitizeString(value: string): string {
  if (SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
    return REDACTED_VALUE;
  }

  return value;
}

function shouldRedactKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}
