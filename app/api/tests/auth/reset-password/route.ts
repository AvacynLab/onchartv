import { NextResponse } from "next/server";
import { z } from "zod";

import { getUser, updateTestUserPassword } from "@/lib/db/queries";

const RESET_SCHEMA = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

const PLAYWRIGHT_FLAGS = new Set(["true", "1"]);

function isAutomationEnvironment(): boolean {
  return (
    PLAYWRIGHT_FLAGS.has(process.env.PLAYWRIGHT ?? "false") ||
    PLAYWRIGHT_FLAGS.has(process.env.CI_PLAYWRIGHT ?? "false")
  );
}

export async function POST(request: Request) {
  if (!isAutomationEnvironment()) {
    return NextResponse.json(
      {
        error: {
          code: "forbidden",
          message:
            "Password resets are only available in the hermetic Playwright environment.",
        },
      },
      { status: 403 }
    );
  }

  let payload: z.infer<typeof RESET_SCHEMA>;
  try {
    payload = RESET_SCHEMA.parse(await request.json());
  } catch (error) {
    const message =
      error instanceof z.ZodError ? error.message : "Invalid request payload";

    return NextResponse.json(
      {
        error: { code: "invalid_request", message },
      },
      { status: 400 }
    );
  }

  const [existingUser] = await getUser(payload.email);
  if (!existingUser) {
    return NextResponse.json(
      {
        error: {
          code: "not_found",
          message: "No test account was found for the provided email address.",
        },
      },
      { status: 404 }
    );
  }

  const didUpdate = await updateTestUserPassword(
    payload.email,
    payload.password
  );

  if (!didUpdate) {
    return NextResponse.json(
      {
        error: {
          code: "update_failed",
          message: "Failed to refresh the stored credentials for the test user.",
        },
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ status: "updated" });
}

