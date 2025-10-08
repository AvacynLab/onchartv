import { NextResponse } from "next/server";
import { z } from "zod";

import { createUser, getUser } from "@/lib/db/queries";

/**
 * Shape of the payload accepted by the Playwright-specific registration
 * endpoint. Keeping the schema in this module avoids leaking the helper beyond
 * the hermetic testing surface.
 */
const registrationSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

const PLAYWRIGHT_ALLOWED = new Set(["true", "1"]);

function isAutomationRequest() {
  return (
    PLAYWRIGHT_ALLOWED.has(process.env.PLAYWRIGHT ?? "false") ||
    PLAYWRIGHT_ALLOWED.has(process.env.CI_PLAYWRIGHT ?? "false")
  );
}

function createForbiddenResponse() {
  return NextResponse.json(
    {
      error: {
        code: "forbidden",
        message: "Test registrations are only available during Playwright runs.",
      },
    },
    { status: 403 }
  );
}

/**
 * Surface a lightweight readiness response so the Playwright warm-up step can
 * probe the registration endpoint without triggering a 405. Returning a 200
 * status here keeps the warm-up logs clean while still documenting that only
 * POST requests will mutate state during automation runs.
 */
export async function GET() {
  if (!isAutomationRequest()) {
    return createForbiddenResponse();
  }

  return NextResponse.json({
    status: "ready",
    allowedMethods: ["POST"],
    message: "Use POST to provision test accounts during Playwright runs.",
  });
}

/**
 * Provision or reuse a test account for the Playwright suites. The handler is
 * disabled outside the hermetic automation environment to avoid exposing a
 * public registration surface that bypasses the usual UX checks.
 */
export async function POST(request: Request) {
  if (!isAutomationRequest()) {
    return createForbiddenResponse();
  }

  let parsed:
    | z.infer<typeof registrationSchema>
    | undefined;
  try {
    parsed = registrationSchema.parse(await request.json());
  } catch (error) {
    const message =
      error instanceof z.ZodError ? error.message : "Invalid request payload";

    return NextResponse.json(
      {
        error: {
          code: "invalid_request",
          message,
        },
      },
      { status: 400 }
    );
  }

  const [existingUser] = await getUser(parsed.email);

  if (existingUser) {
    return NextResponse.json({ status: "exists" });
  }

  await createUser(parsed.email, parsed.password);

  return NextResponse.json({ status: "created" });
}
