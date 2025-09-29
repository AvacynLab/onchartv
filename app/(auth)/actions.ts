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
      redirectTo: redirectTo ?? "/",
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

    const signInResponse = await signIn("credentials", {
      email: validatedData.email,
      password: validatedData.password,
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
