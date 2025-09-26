import { createOpenAI } from "@ai-sdk/openai";
import { customProvider, extractReasoningMiddleware, wrapLanguageModel } from "ai";
import { isTestEnvironment } from "../constants";

const OPENAI_MODEL_ID = "gpt-5-nano";
const isClient = typeof window !== "undefined";
const openaiApiKey = process.env.OPENAI_API_KEY;
const isPlaywrightEnvironment = Boolean(process.env.PLAYWRIGHT && process.env.PLAYWRIGHT.toLowerCase() !== "false");

function createMockProvider() {
  const models = isTestEnvironment
    ? require("./models.test")
    : require("./models.mock");
  const {
    artifactModel,
    chatModel,
    reasoningModel,
    titleModel,
  } = models;
  return customProvider({
    languageModels: {
      "chat-model": chatModel,
      "chat-model-reasoning": reasoningModel,
      "title-model": titleModel,
      "artifact-model": artifactModel,
    },
  });
}

const shouldUseMocks =
  isClient || isTestEnvironment || isPlaywrightEnvironment;

if (!isClient) {
  console.log('[providers] env', {
    PLAYWRIGHT: process.env.PLAYWRIGHT,
    PLAYWRIGHT_TEST_BASE_URL: process.env.PLAYWRIGHT_TEST_BASE_URL,
    shouldUseMocks,
    isTestEnvironment,
    isPlaywrightEnvironment,
    openaiApiKey: Boolean(openaiApiKey),
  });
}

if (!shouldUseMocks && !openaiApiKey) {
  throw new Error("OPENAI_API_KEY is not set");
}

const openaiProvider = !shouldUseMocks
  ? createOpenAI({ apiKey: openaiApiKey! })
  : null;

export const myProvider = shouldUseMocks
  ? createMockProvider()
  : customProvider({
      languageModels: {
        "chat-model": openaiProvider!.languageModel(OPENAI_MODEL_ID),
        "chat-model-reasoning": wrapLanguageModel({
          model: openaiProvider!.languageModel(OPENAI_MODEL_ID),
          middleware: extractReasoningMiddleware({ tagName: "think" }),
        }),
        "title-model": openaiProvider!.languageModel(OPENAI_MODEL_ID),
        "artifact-model": openaiProvider!.languageModel(OPENAI_MODEL_ID),
      },
    });