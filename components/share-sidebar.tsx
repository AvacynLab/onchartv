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
 * Build the destination for the "Se connecter" link.
 *
 * The component mirrors the previous behaviour: when a visitor is already on a
 * share page we preserve their current location via the callback URL so that a
 * successful sign-in returns them to the same conversation.
 */
export function buildLoginHref(pathname: string | null | undefined): string {
  if (!pathname) {
    return "/login";
  }

  return `/login?callbackUrl=${encodeURIComponent(pathname)}`;
}

/**
 * Sidebar displayed on the public share view.
 *
 * It guides anonymous visitors to authenticate before starting their own
 * conversations while keeping the shared thread readable.
 */
export function ShareSidebar() {
  const pathname = usePathname();
  const loginHref = buildLoginHref(pathname ?? undefined);

  return (
    <Sidebar className="group-data-[side=left]:border-r">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <span className="font-semibold text-lg">Conversation partage</span>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <p className="text-muted-foreground text-sm">
              Cet espace est accessible en lecture seule. Connectez-vous pour
              demarrer vos propres conversations et interagir en temps reel.
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
