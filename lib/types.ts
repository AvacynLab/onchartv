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

export type ChatMessage = UIMessage<
  MessageMetadata,
  CustomUIDataTypes,
  ChatTools
>;

export type Attachment = {
  name: string;
  url: string;
  contentType: string;
};
