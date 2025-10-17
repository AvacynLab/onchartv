import React from "react";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { ChatMessage } from "@/lib/types";

vi.mock("katex/dist/katex.min.css", () => ({}), { virtual: true });
vi.mock("server-only", () => ({}), { virtual: true });
vi.mock(
  "streamdown",
  () => ({
    Streamdown: ({
      children,
    }: {
      children?: React.ReactNode;
    }): React.ReactNode => children ?? null,
  }),
  { virtual: true }
);

const { DataStreamProvider } = await import("@/components/data-stream-provider");
const { PreviewMessage } = await import("@/components/message");

const noop = () => {};

function createFinanceToolMessage(): ChatMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    metadata: { createdAt: new Date().toISOString() },
    parts: [
      {
        id: "text-1",
        type: "text",
        text: "Finance artefact preview",
      },
      {
        type: "tool-tool.finance.chart.fetch",
        toolCallId: "tool-call-1",
        state: "input-available",
        input: { symbol: "AAPL", timeframe: "1D" },
        output: undefined,
        errorText: undefined,
      },
    ],
    artifacts: [],
    attachments: [],
  } as unknown as ChatMessage;
}

describe("PreviewMessage finance feature flag", () => {
  beforeAll(() => {
    (globalThis as unknown as { React: typeof React }).React = React;
    class ResizeObserverMock implements ResizeObserver {
      private readonly callback: ResizeObserverCallback;

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }

      observe(_target: Element, _options?: ResizeObserverOptions) {
        this.callback([], this as unknown as ResizeObserver);
      }

      unobserve(_target: Element) {}
      disconnect() {}
      takeRecords(): ResizeObserverEntry[] {
        return [];
      }
    }

    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  });

  afterAll(() => {
    delete (globalThis as { React?: typeof React }).React;
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("omits finance tools when the feature flag is disabled", () => {
    vi.stubEnv("NEXT_PUBLIC_FEATURE_FINANCE", "false");

    render(
      <DataStreamProvider>
        <PreviewMessage
          chatId="chat-42"
          isLoading={false}
          isReadonly={true}
          message={createFinanceToolMessage()}
          regenerate={noop as any}
          requiresScrollPadding={false}
          setMessages={noop as any}
          vote={undefined}
        />
      </DataStreamProvider>
    );

    expect(
      screen.queryByText("tool.finance.chart.fetch", {
        exact: false,
      })
    ).not.toBeInTheDocument();
  });

  it("renders finance tools when the feature flag is enabled", () => {
    vi.stubEnv("NEXT_PUBLIC_FEATURE_FINANCE", "true");

    render(
      <DataStreamProvider>
        <PreviewMessage
          chatId="chat-42"
          isLoading={false}
          isReadonly={true}
          message={createFinanceToolMessage()}
          regenerate={noop as any}
          requiresScrollPadding={false}
          setMessages={noop as any}
          vote={undefined}
        />
      </DataStreamProvider>
    );

    expect(
      screen.getByText("tool.finance.chart.fetch", {
        exact: false,
      })
    ).toBeInTheDocument();
  });
});
