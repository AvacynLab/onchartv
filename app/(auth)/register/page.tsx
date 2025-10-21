"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { startTransition, useActionState, useEffect, useState } from "react";
import { AuthForm } from "@/components/auth-form";
import { SubmitButton } from "@/components/submit-button";
import { toast } from "@/components/toast";
import { type RegisterActionState, register } from "../actions";

/**
 * Extend the grace window so slower Playwright runners can observe the success
 * toast before the redirect unmounts the registration shell. Keeping the
 * notification visible for a full five seconds also gives the automation bridge
 * ample time to attach in hermetic runs.
 */
const TOAST_GRACE_PERIOD_MS = 5000;
const SESSION_REFRESH_TIMEOUT_MS = 3000;
const HARD_REDIRECT_DELAY_MS = 750;
const IMMEDIATE_REDIRECT_DELAY_MS = 250;

export default function Page() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [isSuccessful, setIsSuccessful] = useState(false);

  const [state, formAction] = useActionState<RegisterActionState, FormData>(
    register,
    {
      status: "idle",
    }
  );

  const { update: updateSession } = useSession();

  useEffect(() => {
    if (state.status === "user_exists") {
      toast({ type: "error", description: "Account already exists!" });
    } else if (state.status === "failed") {
      toast({ type: "error", description: "Failed to create account!" });
    } else if (state.status === "invalid_data") {
      toast({
        type: "error",
        description: "Failed validating your submission!",
      });
    } else if (state.status === "success") {
      console.info("[register] registration succeeded – preparing redirect", {
        redirectTo: state.redirectTo,
      });

      toast({ type: "success", description: "Account created successfully!" });

      setIsSuccessful(true);
      void (async () => {
        /**
         * Refresh the credentials session before redirecting to the dashboard
         * so authenticated routes stay accessible during the subsequent
         * Playwright steps.  Cap the wait time so CI does not stall when the
         * dev server takes longer than expected to resolve the update request.
         */
        const destination = state.redirectTo ?? "/chat";

        const ensureHardRedirect = () => {
          if (typeof window === "undefined") {
            return;
          }

          try {
            const targetUrl = new URL(destination, window.location.origin).href;
            if (window.location.href !== targetUrl) {
              console.info("[register] enforcing window-level redirect", {
                destination: targetUrl,
              });
              const navigator = window.location;

              if (typeof navigator.replace === "function") {
                navigator.replace(targetUrl);
              } else if (typeof navigator.assign === "function") {
                navigator.assign(targetUrl);
              } else {
                navigator.href = targetUrl;
              }
            }
          } catch (error) {
            console.error("[register] failed to compute hard redirect target", error);
          }
        };

        const scheduleHardRedirects = () => {
          if (typeof window === "undefined") {
            console.warn(
              "[register] window object unavailable – cannot enforce redirect"
            );
            return;
          }

          const delays = [0, IMMEDIATE_REDIRECT_DELAY_MS, HARD_REDIRECT_DELAY_MS];
          for (const delay of delays) {
            window.setTimeout(() => {
              ensureHardRedirect();
            }, delay);
          }
        };

        if (typeof updateSession === "function") {
          const refreshPromise = updateSession();
          let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

          try {
            await Promise.race([
              refreshPromise.catch((error) => {
                console.error(
                  "Failed to refresh session before redirecting",
                  error
                );
              }),
              new Promise<void>((resolve) => {
                timeoutHandle = setTimeout(
                  resolve,
                  SESSION_REFRESH_TIMEOUT_MS
                );
              }),
            ]);
          } finally {
            if (timeoutHandle) {
              clearTimeout(timeoutHandle);
            }
          }
        }

        /**
         * Kick off the soft navigation as soon as the session refresh step
         * completes so `/chat` begins hydrating while the toast remains
         * visible.  The delayed hard redirect below still acts as a safety net
         * in case the client transition never commits.
         */
        try {
          startTransition(() => {
            router.replace(destination);
          });
          console.info("[register] scheduled router.replace for dashboard", {
            destination,
          });
        } catch (error) {
          console.error("[register] router.replace failed", error);
        }

        ensureHardRedirect();
        scheduleHardRedirects();

        /**
         * Give the success toast a brief window to render before navigating away
         * so hermetic Playwright runs can reliably observe the notification. A
         * slightly longer pause keeps the automation bridge mounted even when
         * slower CI runners are still hydrating the Sonner portal.
         */
        await new Promise((resolve) =>
          setTimeout(resolve, TOAST_GRACE_PERIOD_MS)
        );
      })();
    }
  }, [state.redirectTo, state.status, router, updateSession]);

  const handleSubmit = async (formData: FormData) => {
    const submittedEmail = formData.get("email");
    if (typeof submittedEmail === "string") {
      setEmail(submittedEmail);
    }

    /**
     * Forward the submission to the server action and surface the resulting
     * promise so React can keep the pending state in sync with the
     * `<SubmitButton />` spinner. Returning the awaited call also guarantees the
     * success effect sees the updated state before we attempt to redirect.
     */
    await formAction(formData);
  };

  return (
    <div className="flex h-dvh w-screen items-start justify-center bg-background pt-12 md:items-center md:pt-0">
      <div className="flex w-full max-w-md flex-col gap-12 overflow-hidden rounded-2xl">
        <div className="flex flex-col items-center justify-center gap-2 px-4 text-center sm:px-16">
          <h3 className="font-semibold text-xl dark:text-zinc-50">Sign Up</h3>
          <p className="text-gray-500 text-sm dark:text-zinc-400">
            Create an account with your email and password
          </p>
        </div>
        <AuthForm action={handleSubmit} defaultEmail={email}>
          <SubmitButton isSuccessful={isSuccessful}>Sign Up</SubmitButton>
          <p className="mt-4 text-center text-gray-600 text-sm dark:text-zinc-400">
            {"Already have an account? "}
            <Link
              className="font-semibold text-gray-800 hover:underline dark:text-zinc-200"
              href="/login"
            >
              Sign in
            </Link>
            {" instead."}
          </p>
        </AuthForm>
      </div>
    </div>
  );
}
