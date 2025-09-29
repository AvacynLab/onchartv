"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

/**
 * ShareSidebar renders the sidebar displayed on shared chat pages. The layout
 * nudges visitors to authenticate so they can start their own conversations
 * instead of browsing the read-only preview.
 */
export function ShareSidebar() {
  const pathname = usePathname();
  const loginHref = pathname
    ? `/login?callbackUrl=${encodeURIComponent(pathname)}`
    : "/login";

  return (
    <Sidebar className="group-data-[side=left]:border-r">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <span className="font-semibold text-lg">Conversation partagée</span>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <p className="text-muted-foreground text-sm">
              Cet espace est accessible en lecture seule. Connectez-vous pour
              démarrer vos propres conversations et interagir en temps réel.
            </p>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <Button asChild className="w-full" variant="outline">
              <Link href={loginHref}>Se connecter</Link>
            </Button>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
