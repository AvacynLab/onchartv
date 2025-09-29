import { cookies } from "next/headers";
import Script from "next/script";
import { AppSidebar } from "@/components/app-sidebar";
import { DataStreamProvider } from "@/components/data-stream-provider";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { auth } from "../(auth)/auth";
import { getChatsByUserId } from "@/lib/db/queries";
import { HISTORY_PAGE_SIZE } from "@/lib/history/config";
import { getPyodideScriptSrc } from "@/lib/pyodide";

export const experimental_ppr = true;

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [session, cookieStore] = await Promise.all([auth(), cookies()]);
  const initialHistory =
    session?.user?.type === "regular"
      ? await getChatsByUserId({
          endingBefore: null,
          id: session.user.id,
          limit: HISTORY_PAGE_SIZE,
          startingAfter: null,
        })
      : null;
  const isCollapsed = cookieStore.get("sidebar_state")?.value !== "true";
  const pyodideScriptSrc = getPyodideScriptSrc();

  return (
    <>
      {/**
       * Loading the upstream Pyodide bundle during Playwright runs triggers
       * unavoidable network calls. Swap in a lightweight local stub instead so
       * the hermetic e2e suite remains fully offline while development and
       * production continue to leverage the official CDN build.
       */}
      <Script src={pyodideScriptSrc} strategy="beforeInteractive" />
      <DataStreamProvider>
        <SidebarProvider defaultOpen={!isCollapsed}>
          <AppSidebar initialHistory={initialHistory} user={session?.user} />
          <SidebarInset>{children}</SidebarInset>
        </SidebarProvider>
      </DataStreamProvider>
    </>
  );
}
