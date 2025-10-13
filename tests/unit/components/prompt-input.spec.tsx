import React from "react";
import "@testing-library/jest-dom/vitest";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PromptInputTextarea } from "@/components/elements/prompt-input";

(globalThis as unknown as { React: typeof React }).React = React;

describe("PromptInputTextarea", () => {
  it("forwarde sa ref vers l'élément textarea natif", () => {
    const ref = React.createRef<HTMLTextAreaElement>();

    render(
      <PromptInputTextarea
        data-testid="composer"
        defaultValue="Bonjour"
        ref={ref}
      />
    );

    expect(ref.current).toBeInstanceOf(HTMLTextAreaElement);
    expect(ref.current?.value).toBe("Bonjour");
  });
});
