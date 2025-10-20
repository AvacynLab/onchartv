import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

type MockRegisterActionState = {
  status:
    | "idle"
    | "in_progress"
    | "success"
    | "failed"
    | "user_exists"
    | "invalid_data";
  redirectTo?: string;
};

// Mock the experimental next/form helper so the auth form renders as a standard form element.
vi.mock("next/form", () => ({
  __esModule: true,
  default: ({
    action,
    children,
    ...rest
  }: React.ComponentPropsWithoutRef<"form"> & {
    action?:
      | string
      | ((formData: FormData) => void | Promise<void>);
  }) => (
    <form
      {...rest}
      onSubmit={(event) => {
        event.preventDefault();
        if (typeof action === "function") {
          void action(new FormData(event.currentTarget));
        }
      }}
    >
      {children}
    </form>
  ),
}));

const replaceMock = vi.fn();
const assignMock = vi.fn();
let originalLocation: Location;
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
  }),
}));

const updateSessionMock = vi.fn();
vi.mock("next-auth/react", () => ({
  useSession: () => ({ update: updateSessionMock }),
}));

const registerActionMock = vi.hoisted(() =>
  vi.fn<
    (
      state: MockRegisterActionState,
      formData: FormData
    ) => Promise<MockRegisterActionState>
  >()
);
vi.mock("server-only", () => ({}));
vi.mock("@/app/(auth)/actions", () => ({
  register: registerActionMock,
}));
const toastMock = vi.hoisted(() => vi.fn());
vi.mock("@/components/toast", () => ({
  toast: toastMock,
}));

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");

  return {
    ...actual,
    useActionState: <State, Payload extends FormData>(
      action: (state: State, formData: Payload) => Promise<State> | State,
      initialState: State
    ) => {
      const [state, setState] = actual.useState(initialState);

      const dispatch = async (formData: Payload) => {
        const result = await action(state, formData);
        setState(result);
        return result;
      };

      return [state, dispatch] as const;
    },
  } satisfies typeof import("react");
});

// The component under test is imported after the mocks so it receives the stubbed dependencies.
import RegisterPage from "@/app/(auth)/register/page";

describe("RegisterPage", () => {
  const originalSetTimeout = global.setTimeout;
  let setTimeoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    (globalThis as unknown as { React?: typeof React }).React = React;
    setTimeoutSpy = vi
      .spyOn(global, "setTimeout")
      .mockImplementation((callback: Parameters<typeof setTimeout>[0], _delay?: number, ...args) => {
        return originalSetTimeout(callback as TimerHandler, 0, ...args);
      });
    registerActionMock.mockReset();
    updateSessionMock.mockReset();
    replaceMock.mockReset();
    assignMock.mockReset();
    originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        assign: assignMock,
        href: "http://localhost/register",
        origin: "http://localhost",
        pathname: "/register",
      } as unknown as Location,
    });
  });

  afterEach(() => {
    setTimeoutSpy.mockRestore();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  it("refreshes the session and redirects to chat after a successful registration", async () => {
    registerActionMock.mockResolvedValue({
      status: "success",
      redirectTo: "/chat/registered",
    } satisfies MockRegisterActionState);
    updateSessionMock.mockResolvedValue(undefined);

    render(<RegisterPage />);

    await act(async () => {
      const emailInput = screen.getByPlaceholderText("user@acme.com");
      fireEvent.input(emailInput, { target: { value: "fresh@example.com" } });
      const passwordInput = screen.getByLabelText("Password");
      fireEvent.input(passwordInput, { target: { value: "hunter2!" } });
      fireEvent.click(screen.getByRole("button", { name: /Sign Up/ }));
    });

    expect(registerActionMock).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(updateSessionMock).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith("/chat/registered");
    });

    await waitFor(() => {
      expect(assignMock).toHaveBeenCalledWith("http://localhost/chat/registered");
    });

    expect(assignMock.mock.calls[0]?.[0]).toBe(
      "http://localhost/chat/registered"
    );
  });
});
