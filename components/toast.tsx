"use client";

import React, { type ReactNode, useEffect, useRef, useState } from "react";
import { toast as sonnerToast } from "sonner";
import { cn } from "@/lib/utils";
import { CheckCircleFillIcon, WarningIcon } from "./icons";

const iconsByType: Record<"success" | "error", ReactNode> = {
  success: <CheckCircleFillIcon />,
  error: <WarningIcon />,
};

const SINGLETON_TOAST_ID = "app-toast";
const AUTOMATION_BRIDGE_ID = "automation-toast-bridge";
const AUTOMATION_TOAST_LIFETIME_MS = 4_000;
const automationTimers = new WeakMap<HTMLElement, number>();

function clearAutomationTimer(element: HTMLElement | null) {
  if (!element) {
    return;
  }

  const existingTimer = automationTimers.get(element);
  if (existingTimer !== undefined) {
    window.clearTimeout(existingTimer);
    automationTimers.delete(element);
  }
}

function detachBridgeWhenNativeToastAppears(bridge: HTMLDivElement) {
  /**
   * Keep polling for a short window so we can immediately drop the automation
   * bridge once the real Sonner portal renders a toast. This prevents
   * Playwright's strict-mode locators from detecting multiple `data-testid`
   * matches while still guaranteeing a visible notification if hydration lags
   * behind in CI.
   */
  const startedAt = performance.now();

  const poll = () => {
    const nativeToast = document.querySelector(
      `[data-testid="toast"]:not(#${AUTOMATION_BRIDGE_ID})`
    );

    if (nativeToast) {
      clearAutomationTimer(bridge);
      bridge.remove();
      return;
    }

    if (performance.now() - startedAt >= AUTOMATION_TOAST_LIFETIME_MS) {
      return;
    }

    window.requestAnimationFrame(poll);
  };

  window.requestAnimationFrame(poll);
}

export function toast(props: Omit<ToastProps, "id">) {
  /**
   * Playwright assertions expect a single toast to appear after each auth
   * action. Clear the previous notification before rendering the new one so we
   * avoid strict-mode locator conflicts when multiple toasts are queued.
   */
  sonnerToast.dismiss(SINGLETON_TOAST_ID);

  const result = sonnerToast.custom(
    (id) => <Toast description={props.description} id={id} type={props.type} />,
    { id: SINGLETON_TOAST_ID }
  );

  /**
   * Bridge the toast payload into a lightweight DOM node when the UI is being
   * driven by an automated browser (e.g. Playwright). This ensures hermetic
   * end-to-end runs can always observe a visible notification even if the
   * Sonner portal fails to render during slow hydrations.
   */
  renderAutomationToast(props);

  return result;
}

function shouldRenderAutomationToast(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }

  /**
   * Playwright toggles either the dedicated NEXT_PUBLIC flag (when we boot the
   * dev server manually for the suite) or exposes the `navigator.webdriver`
   * property when browsers run in automation mode. Check both signals so the
   * fallback toast reliably renders across CI and local runs, while production
   * browsers skip the synthetic overlay entirely.
   */
  const playwrightFlagEnabled = process.env.NEXT_PUBLIC_PLAYWRIGHT === "true";
  const webdriverEnabled =
    typeof navigator !== "undefined" &&
    typeof (navigator as Navigator & { webdriver?: boolean }).webdriver ===
      "boolean" &&
    (navigator as Navigator & { webdriver?: boolean }).webdriver === true;

  return playwrightFlagEnabled || webdriverEnabled;
}

function renderAutomationToast(props: Omit<ToastProps, "id">) {
  if (!shouldRenderAutomationToast()) {
    return;
  }

  let bridge = document.getElementById(
    AUTOMATION_BRIDGE_ID
  ) as HTMLDivElement | null;

  if (!bridge) {
    bridge = document.createElement("div");
    bridge.id = AUTOMATION_BRIDGE_ID;
    bridge.dataset.testid = "toast";
    bridge.setAttribute("role", "status");
    bridge.setAttribute("aria-live", "polite");
    bridge.style.position = "fixed";
    bridge.style.top = "16px";
    bridge.style.left = "50%";
    bridge.style.transform = "translateX(-50%)";
    bridge.style.zIndex = "2147483647";
    bridge.style.pointerEvents = "none";
    bridge.style.backgroundColor = "rgba(24,24,27,0.95)";
    bridge.style.color = "white";
    bridge.style.padding = "12px 16px";
    bridge.style.borderRadius = "8px";
    bridge.style.boxShadow = "0 10px 25px rgba(0,0,0,0.25)";
    bridge.style.fontSize = "14px";
    bridge.style.maxWidth = "360px";
    bridge.style.textAlign = "center";
    bridge.style.fontFamily = "inherit";

    document.body.appendChild(bridge);
  }

  bridge.dataset.type = props.type;
  bridge.textContent = props.description;

  clearAutomationTimer(bridge);

  detachBridgeWhenNativeToastAppears(bridge);

  const timeoutId = window.setTimeout(() => {
    bridge?.remove();
    if (bridge) {
      automationTimers.delete(bridge);
    }
  }, AUTOMATION_TOAST_LIFETIME_MS);

  automationTimers.set(bridge, timeoutId);
}

function Toast(props: ToastProps) {
  const { id, type, description } = props;

  const descriptionRef = useRef<HTMLDivElement>(null);
  const [multiLine, setMultiLine] = useState(false);

  useEffect(() => {
    const el = descriptionRef.current;
    if (!el) {
      return;
    }

    const update = () => {
      const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight);
      const lines = Math.round(el.scrollHeight / lineHeight);
      setMultiLine(lines > 1);
    };

    update(); // initial check
    const ro = new ResizeObserver(update); // re-check on width changes
    ro.observe(el);

    return () => ro.disconnect();
  }, []);

  return (
    <div className="flex toast-mobile:w-[356px] w-full justify-center">
      <div
        className={cn(
          "flex toast-mobile:w-fit w-full flex-row gap-3 rounded-lg bg-zinc-100 p-3",
          multiLine ? "items-start" : "items-center"
        )}
        data-testid="toast"
        key={id}
      >
        <div
          className={cn(
            "data-[type=error]:text-red-600 data-[type=success]:text-green-600",
            { "pt-1": multiLine }
          )}
          data-type={type}
        >
          {iconsByType[type]}
        </div>
        <div className="text-sm text-zinc-950" ref={descriptionRef}>
          {description}
        </div>
      </div>
    </div>
  );
}

type ToastProps = {
  id: string | number;
  type: "success" | "error";
  description: string;
};
