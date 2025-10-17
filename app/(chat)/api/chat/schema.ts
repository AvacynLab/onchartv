import { z } from "zod";

const textPartSchema = z.object({
  type: z.enum(["text"]),
  text: z.string().min(1).max(2000),
});

const filePartSchema = z.object({
  type: z.enum(["file"]),
  mediaType: z.enum(["image/jpeg", "image/png"]),
  name: z.string().min(1).max(100),
  url: z
    .string()
    .min(1)
    .max(2048)
    .refine((value) => {
      /**
       * Playwright uploads rely on a bundled placeholder that lives under the
       * `/playwright/` prefix so tests stay hermetic. Production uploads return
       * fully-qualified HTTPS URLs, which `new URL` accepts. Allow either form
       * so we can validate requests without blocking the mocked previews.
       */
      try {
        const parsed = new URL(value);
        return parsed.protocol === "https:" || parsed.protocol === "http:";
      } catch {
        return value.startsWith("/playwright/");
      }
    }, "Attachment URL must be absolute or a Playwright fixture path."),
});

const partSchema = z.union([textPartSchema, filePartSchema]);

const metadataSchema = z
  .object({
    clientTextSignature: z.string().optional(),
  })
  .passthrough()
  .optional();

export const postRequestBodySchema = z.object({
  id: z.string().uuid(),
  message: z.object({
    id: z.string().uuid(),
    role: z.enum(["user"]),
    parts: z.array(partSchema),
    metadata: metadataSchema,
  }),
  selectedChatModel: z.enum(["chat-model", "chat-model-reasoning"]),
  selectedVisibilityType: z.enum(["public", "private"]),
});

export type PostRequestBody = z.infer<typeof postRequestBodySchema>;
