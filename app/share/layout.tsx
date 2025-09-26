import type { ReactNode } from "react";
import { DataStreamProvider } from "@/components/data-stream-provider";
import { ShareSidebar } from "@/components/share-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

export default function ShareLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <DataStreamProvider>
      <SidebarProvider defaultOpen={false}>
        <ShareSidebar />
        <SidebarInset>{children}</SidebarInset>
      </SidebarProvider>
    </DataStreamProvider>
  );
}
