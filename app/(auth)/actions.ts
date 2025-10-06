"use server";

import { z } from "zod";

import { didSignInSucceed, extractRedirectPath } from "@/lib/auth/sign-in-response";
import { createUser, getUser } from "@/lib/db/queries";

import { signIn } from "./auth";

/**
 * Shared schema used to validate the data submitted by the authentication
 * forms. Keeping it here avoids the login and registration actions diverging
 * when we tweak field constraints (e.g. enforcing strong passwords).
 */
const authFormSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export type LoginActionState = {
  status: "idle" | "in_progress" | "success" | "failed" | "invalid_data";
  redirectTo?: string;
};

/**
 * Handle credential-based logins initiated from the client components.
 *
 * The function validates the form data, forwards it to NextAuth and converts
 * the provider response into a lightweight status object that the UI can
 * consume to display precise feedback messages.
 */
type SignInResponseSummary =
  | {
      kind: "response";
      status: number;
      redirected: boolean;
      url: string;
    }
  | {
      kind: "string";
      value: string;
    }
  | {
      kind: "object";
      keys: string[];
      ok?: boolean;
      error?: unknown;
      status?: number;
      url?: string;
    }
  | {
      kind: "null" | "undefined" | "number" | "boolean";
      value: null | undefined | number | boolean;
    };

/**
 * Build a serialisable snapshot of the raw `signIn` return value so that we can
 * capture what NextAuth produced when credentials validation fails. Returning a
 * lightweight structure keeps the console output readable while avoiding
 * leaking request bodies or other sensitive metadata.
 */
function summariseSignInResponse(signInResponse: unknown): SignInResponseSummary {
  if (signInResponse instanceof Response) {
    return {
      kind: "response",
      status: signInResponse.status,
      redirected: signInResponse.redirected,
      url: signInResponse.url,
    };
  }

  if (typeof signInResponse === "string") {
    return { kind: "string", value: signInResponse };
  }

  if (signInResponse && typeof signInResponse === "object") {
    const candidate = signInResponse as Record<string, unknown> & {
      ok?: unknown;
      error?: unknown;
      status?: unknown;
      url?: unknown;
    };

    return {
      kind: "object",
      keys: Object.keys(candidate).slice(0, 10),
      ok: typeof candidate.ok === "boolean" ? candidate.ok : undefined,
      error: candidate.error,
      status: typeof candidate.status === "number" ? candidate.status : undefined,
      url: typeof candidate.url === "string" ? candidate.url : undefined,
    };
  }

  if (typeof signInResponse === "number") {
    return { kind: "number", value: signInResponse };
  }

  if (typeof signInResponse === "boolean") {
    return { kind: "boolean", value: signInResponse };
  }

  return {
    kind: signInResponse === null ? "null" : "undefined",
    value: signInResponse as null | undefined,
  };
}

/**
 * Surface a structured debug log whenever NextAuth reports a failed credentials
 * sign-in. The log intentionally includes the normalised email so that we can
 * correlate the output with the persisted Playwright fixtures without exposing
 * plaintext passwords.
 */
function logFailedSignInAttempt(email: string, signInResponse: unknown): void {
  const summary = summariseSignInResponse(signInResponse);
  console.error("[auth][debug] Failed credentials sign-in", {
    email,
    response: summary,
  });
}

export const login = async (
  _: LoginActionState,
  formData: FormData
): Promise<LoginActionState> => {
  try {
    const validatedData = authFormSchema.parse({
      email: formData.get("email"),
      password: formData.get("password"),
    });

    const signInResponse = await signIn("credentials", {
      email: validatedData.email,
      password: validatedData.password,
      callbackUrl: "/",
      redirect: false,
    });

    /**
     * NextAuth returns either a `Response`, a redirect URL string or an
     * `{ ok: boolean }` object depending on the environment. Normalise the
     * result so we only surface an error toast when the credentials truly
     * failed.
     */
    if (!didSignInSucceed(signInResponse)) {
      logFailedSignInAttempt(validatedData.email, signInResponse);
      return { status: "failed" };
    }

    const redirectTo = extractRedirectPath(signInResponse, {
      baseUrl: process.env.NEXTAUTH_URL ?? "http://localhost:3000",
    });

    return {
      status: "success",
      redirectTo: redirectTo ?? "/",
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { status: "invalid_data" };
    }

    return { status: "failed" };
  }
};

/**
 * Expose the debug helper so unit tests can assert the sanitised payload
 * without relying on console side-effects. The symbol is namespaced to make it
 * clear that the function is only meant to support temporary instrumentation.
 */
export const __summariseSignInResponseForTests = summariseSignInResponse;

export type RegisterActionState = {
  status:
    | "idle"
    | "in_progress"
    | "success"
    | "failed"
    | "user_exists"
    | "invalid_data";
  redirectTo?: string;
};

/**
 * Create a new regular account and immediately sign the user in so they land
 * on the dashboard without having to resubmit their credentials.
 */
export const register = async (
  _: RegisterActionState,
  formData: FormData
): Promise<RegisterActionState> => {
  try {
    const validatedData = authFormSchema.parse({
      email: formData.get("email"),
      password: formData.get("password"),
    });

    const [user] = await getUser(validatedData.email);

    if (user) {
      return { status: "user_exists" } as RegisterActionState;
    }
    await createUser(validatedData.email, validatedData.password);

    const signInResponse = await signIn("credentials", {
      email: validatedData.email,
      password: validatedData.password,
      callbackUrl: "/",
      redirect: false,
    });

    /**
     * Credentials sign-in completes with the same union return type as the
     * regular login action. Reuse the helper so success toasts render in both
     * development and the hermetic Playwright runs where NextAuth returns
     * redirect strings.
     */
    if (!didSignInSucceed(signInResponse)) {
      return { status: "failed" };
    }

    const redirectTo = extractRedirectPath(signInResponse, {
      baseUrl: process.env.NEXTAUTH_URL ?? "http://localhost:3000",
    });

    return {
      status: "success",
      redirectTo: redirectTo ?? "/",
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { status: "invalid_data" };
    }

    return { status: "failed" };
  }
};
