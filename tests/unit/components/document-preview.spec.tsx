import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Mock } from "vitest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { UIArtifact } from "@/components/artifact";
import useSWR from "swr";
import { useArtifact } from "@/hooks/use-artifact";

vi.mock("swr", () => ({
  __esModule: true,
  default: vi.fn(),
}));

vi.mock("@/hooks/use-artifact", () => ({
  useArtifact: vi.fn(),
}));

vi.mock("react-data-grid/lib/styles.css", () => ({}), { virtual: true });
vi.mock("katex/dist/katex.min.css", () => ({}), { virtual: true });
vi.mock("@/components/text-editor", () => ({
  Editor: () => <div data-testid="mock-editor" />,
}));
vi.mock("@/components/code-editor", () => ({
  CodeEditor: () => <div data-testid="mock-code-editor" />,
}));
vi.mock("@/components/image-editor", () => ({
  ImageEditor: () => <div data-testid="mock-image-editor" />,
}));
vi.mock("@/components/sheet-editor", () => ({
  SpreadsheetEditor: () => <div data-testid="mock-sheet" />,
}));
vi.mock("@/components/document", () => ({
  DocumentToolResult: () => <div data-testid="mock-document-result" />,
  DocumentToolCall: () => <div data-testid="mock-document-call" />,
}));
vi.mock("@/components/icons", () => ({
  FileIcon: () => <span data-testid="mock-file-icon" />,
  FullscreenIcon: () => <span data-testid="mock-fullscreen-icon" />,
  ImageIcon: () => <span data-testid="mock-image-icon" />,
  LoaderIcon: () => <span data-testid="mock-loader-icon" />,
}));

const useSWRMock = useSWR as unknown as Mock;
const useArtifactMock = useArtifact as unknown as Mock;

let DocumentPreview: typeof import("@/components/document-preview")["DocumentPreview"];

beforeAll(async () => {
  ({ DocumentPreview } = await import("@/components/document-preview"));
});

const baseArtifact: UIArtifact = {
  documentId: "doc-1",
  content: "Sample content",
  kind: "text",
  title: "Draft",
  status: "streaming",
  isVisible: false,
  boundingBox: {
    top: 0,
    left: 0,
    width: 0,
    height: 0,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  useSWRMock.mockReturnValue({ data: undefined, isLoading: false });
  useArtifactMock.mockReturnValue({
    artifact: baseArtifact,
    setArtifact: vi.fn(),
    metadata: null,
    setMetadata: vi.fn(),
  });
});

describe("DocumentPreview", () => {
  it("displays the document creation result when the preview is visible", () => {
    const setArtifact = vi.fn();
    useArtifactMock.mockReturnValue({
      artifact: { ...baseArtifact, isVisible: true, status: "idle" },
      setArtifact,
      metadata: null,
      setMetadata: vi.fn(),
    });

    render(
      <DocumentPreview
        args={null}
        isReadonly={false}
        result={{ id: "doc-1", title: "Report", kind: "text" }}
      />
    );

    expect(screen.getByTestId("mock-document-result")).toBeTruthy();
  });

  it("opens the artefact overlay even when no tool result is available", () => {
    const setArtifact = vi.fn();
    useArtifactMock.mockReturnValue({
      artifact: baseArtifact,
      setArtifact,
      metadata: null,
      setMetadata: vi.fn(),
    });

    const boundingBoxSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({
        x: 10,
        y: 20,
        width: 100,
        height: 200,
        bottom: 0,
        left: 10,
        right: 110,
        top: 20,
        toJSON: () => ({}),
      } as DOMRect);

    render(<DocumentPreview args={null} isReadonly={false} result={null} />);

    setArtifact.mockClear();

    const hitbox = screen.getByRole("presentation", { hidden: true });
    fireEvent.click(hitbox);

    expect(setArtifact).toHaveBeenCalledTimes(1);
    const updater = setArtifact.mock.calls[0][0];
    const updatedArtifact =
      typeof updater === "function"
        ? updater({ ...baseArtifact, isVisible: false })
        : updater;

    expect(updatedArtifact.isVisible).toBe(true);

    boundingBoxSpy.mockRestore();
  });
});
