import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/app/(auth)/auth";
import { isTestEnvironment } from "@/lib/constants";

/**
 * Whitelisted MIME types accepted by the upload endpoint. Backtest scenarios
 * often rely on CSV files while the existing chat experience already supports
 * image previews, so both image and comma-separated values formats stay
 * enabled. Keeping the list explicit prevents arbitrary binary uploads.
 */
const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
]);

// Use Blob instead of File since File is not available in Node.js environment
const FileSchema = z.object({
  file: z
    .instanceof(Blob)
    .refine((file) => file.size <= 5 * 1024 * 1024, {
      message: "File size should be less than 5MB",
    })
    .refine((file) => ALLOWED_UPLOAD_MIME_TYPES.has(file.type), {
      message: "File type should be JPEG, PNG, or CSV",
    }),
});

/**
 * Handle uploads coming from the chat composer.
 *
 * In the Playwright test environment we bypass the actual Vercel Blob upload
 * to keep the suite deterministic and avoid hitting external services. The
 * mocked response mirrors the structure returned by `put` so the UI can behave
 * exactly as it would in production.
 */
export async function POST(request: Request) {
  const session = await auth();

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.user.type !== "regular") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (request.body === null) {
    return new Response("Request body is empty", { status: 400 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as Blob;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const validatedFile = FileSchema.safeParse({ file });

    if (!validatedFile.success) {
      const errorMessage = validatedFile.error.errors
        .map((error) => error.message)
        .join(", ");

      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }

    // Get filename from formData since Blob doesn't have name property
    const filename = (formData.get("file") as File).name;

    if (isTestEnvironment) {
      // Provide a deterministic mocked response when running end-to-end tests.
      // Returning a bundled placeholder asset keeps the chat preview hermetic
      // and avoids network fetches that would fail under Playwright's offline
      // configuration.
      return NextResponse.json({
        url: "/playwright/avatar-placeholder.svg",
        pathname: filename,
        contentType: file.type,
      });
    }

    const fileBuffer = await file.arrayBuffer();

    try {
      const data = await put(`${filename}`, fileBuffer, {
        access: "public",
      });

      return NextResponse.json(data);
    } catch (_error) {
      return NextResponse.json({ error: "Upload failed" }, { status: 500 });
    }
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to process request" },
      { status: 500 }
    );
  }
}
