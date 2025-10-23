"use server";

import { createHash } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { didSignInSucceed, extractRedirectPath } from "@/lib/auth/sign-in-response";
import { createInitialChat, createUser, getUser } from "@/lib/db/queries";
import { logWarning } from "@/lib/logging";

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
      /**
       * Redirect newly authenticated users straight to the chat workspace so
       * Playwright and other automated flows avoid compiling the marketing
       * landing page during their warm-up. The home route pulls a large module
       * graph which previously caused 180s+ cold starts and exhausted the
       * 240s Playwright setup budget.
       */
      callbackUrl: "/chat",
      redirect: false,
    });

    /**
     * NextAuth returns either a `Response`, a redirect URL string or an
     * `{ ok: boolean }` object depending on the environment. Normalise the
     * result so we only surface an error toast when the credentials truly
     * failed.
     */
    if (!didSignInSucceed(signInResponse)) {
      return { status: "failed" };
    }

    const redirectTo = extractRedirectPath(signInResponse, {
      baseUrl: process.env.NEXTAUTH_URL ?? "http://localhost:3000",
    });

    return {
      status: "success",
      redirectTo: redirectTo ?? "/chat",
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { status: "invalid_data" };
    }

    return { status: "failed" };
  }
};

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

    /**
     * Seed an onboarding chat for the freshly created account so newcomers land
     * on a populated workspace. If we fail to retrieve the account metadata we
     * still proceed with the credentials hand-off and fall back to the generic
     * dashboard redirect to avoid trapping the user on the register screen.
     */
    const [createdUser] = await getUser(validatedData.email);

    let seededChatRedirect: string | undefined;

    if (createdUser) {
      const initialChat = await createInitialChat({
        userId: createdUser.id,
      });

      /**
       * Ensure the chat dashboard and the newly provisioned conversation render
       * up-to-date data the moment the client redirects by invalidating their
       * cached pages. This mirrors the behaviour of the regular chat creation
       * flow triggered from the sidebar.
       */
      revalidatePath("/chat");
      revalidatePath(`/chat/${initialChat.chatId}`);

      seededChatRedirect = `/chat/${initialChat.chatId}`;
    } else {
      logWarning(
        "auth:register",
        "Registration succeeded but the new user record was not immediately available; falling back to the dashboard redirect",
        {
          emailFingerprint: anonymiseEmail(validatedData.email),
        }
      );
    }

    const signInResponse = await signIn("credentials", {
      email: validatedData.email,
      password: validatedData.password,
      /**
       * Align the registration flow with the login action by dropping users on
       * the chat dashboard immediately after the credential hand-off. This
       * keeps the post-register redirect fast during hermetic runs where the
       * marketing homepage would otherwise compile synchronously.
       */
      callbackUrl: "/chat",
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

    const redirectTo =
      extractRedirectPath(signInResponse, {
        baseUrl: process.env.NEXTAUTH_URL ?? "http://localhost:3000",
      }) ?? seededChatRedirect ?? "/chat";

    return {
      status: "success",
      redirectTo,
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { status: "invalid_data" };
    }

    return { status: "failed" };
  }
};

/**
 * Generate a deterministic fingerprint for an email address before logging it
 * so we can correlate diagnostics without exposing personally identifiable
 * information in shared CI logs.
 */
function anonymiseEmail(email: string): string {
  if (email.length === 0) {
    return "[redacted]";
  }

  const digest = createHash("sha256").update(email).digest("hex");

  return `[fingerprint:${digest.slice(0, 12)}]`;
}
