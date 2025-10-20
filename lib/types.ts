import type { InferUITool, UIMessage } from "ai";
import { z } from "zod";
import type { ArtifactKind } from "@/components/artifact";
import type { createDocument } from "./ai/tools/create-document";
import type { FinanceTools } from "./ai/tools/finance";
import type { getWeather } from "./ai/tools/get-weather";
import type { requestSuggestions } from "./ai/tools/request-suggestions";
import type { updateDocument } from "./ai/tools/update-document";
import type { Suggestion } from "./db/schema";
import type { AppUsage } from "./usage";
import type {
  FinanceBacktestArtifact,
  FinanceChartAnnotationsArtifact,
  FinanceChartArtifact,
  FinanceFundamentalsArtifact,
  FinanceNewsArtifact,
  FinanceScreenArtifact,
} from "./finance/types";

export type DataPart = { type: "append-message"; message: string };

export const messageMetadataSchema = z
  .object({
    createdAt: z.string(),
    /**
     * Optional fingerprint supplied by the client when resubmitting an edited
     * prompt. Keeping the field in the shared schema ensures downstream code
     * can safely access it without widening the metadata type everywhere.
     */
    clientTextSignature: z.string().optional(),
  })
  .passthrough();

export type MessageMetadata = z.infer<typeof messageMetadataSchema>;

type weatherTool = InferUITool<typeof getWeather>;
type createDocumentTool = InferUITool<ReturnType<typeof createDocument>>;
type updateDocumentTool = InferUITool<ReturnType<typeof updateDocument>>;
type requestSuggestionsTool = InferUITool<
  ReturnType<typeof requestSuggestions>
>;
type financeToolSet = FinanceTools;
type financeChartFetchTool = InferUITool<financeToolSet["chartFetch"]>;
type financeChartAnnotateTool = InferUITool<financeToolSet["chartAnnotate"]>;
type financeFundamentalsTool = InferUITool<
  financeToolSet["fundamentalsFetch"]
>;
type financeNewsTool = InferUITool<financeToolSet["newsFetch"]>;
type financeBacktestTool = InferUITool<
  financeToolSet["strategyBacktest"]
>;
type financeScreenTool = InferUITool<financeToolSet["screenAssets"]>;

export type ChatTools = {
  getWeather: weatherTool;
  createDocument: createDocumentTool;
  updateDocument: updateDocumentTool;
  requestSuggestions: requestSuggestionsTool;
  "tool.finance.chart.fetch": financeChartFetchTool;
  "tool.finance.chart.annotate": financeChartAnnotateTool;
  "tool.finance.fundamentals.fetch": financeFundamentalsTool;
  "tool.finance.news.fetch": financeNewsTool;
  "tool.finance.strategy.backtest": financeBacktestTool;
  "tool.finance.screen": financeScreenTool;
};

export type CustomUIDataTypes = {
  textDelta: string;
  imageDelta: string;
  sheetDelta: string;
  codeDelta: string;
  suggestion: Suggestion;
  appendMessage: string;
  id: string;
  title: string;
  kind: ArtifactKind;
  clear: null;
  finish: null;
  usage: AppUsage;
  financeChart: FinanceChartArtifact;
  financeChartAnnotations: FinanceChartAnnotationsArtifact;
  financeFundamentals: FinanceFundamentalsArtifact;
  financeNews: FinanceNewsArtifact;
  financeBacktest: FinanceBacktestArtifact;
  financeScreen: FinanceScreenArtifact;
};

/**
 * Lifecycle states that the Vercel AI SDK emits while streaming chat bubbles.
 * The SDK currently toggles between well-known string literals such as
 * `"streaming"` and `"completed"`, yet the surface is intentionally open so
 * future releases can add more statuses (for tool-calling, hand-offs, …).
 * Using a nominal string intersection preserves autocomplete for the existing
 * states without preventing downstream callers from handling new values.
 */
export type ChatMessageStatus =
  | "streaming"
  | "completed"
  | (string & {});

export type ChatMessage = UIMessage<
  MessageMetadata,
  CustomUIDataTypes,
  ChatTools
> & { status?: ChatMessageStatus };

export type Attachment = {
  name: string;
  url: string;
  contentType: string;
};
