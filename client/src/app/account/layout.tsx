import { AccountNav } from "@/components/account-nav";
import { Brand } from "@/components/brand";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import Link from "next/link";

export default function AccountLayout({ children }: LayoutProps<"/account">) {
  return (
    <div className="flex min-h-svh flex-1">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-border/60 bg-sidebar md:flex">
        <div className="flex h-14 items-center px-4">
          <Brand href="/account" />
        </div>
        <div className="flex flex-1 flex-col gap-1 px-2">
          <AccountNav />
        </div>
        <div className="border-t border-border/60 p-3">
          <div className="flex items-center gap-3 rounded-lg px-2 py-1.5">
            <Avatar className="size-7">
              <AvatarFallback className="bg-primary/15 text-xs text-primary">
                d2
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium lowercase">
                d2domains user
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                you@example.com
              </p>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-4 border-b border-border/60 px-4 sm:px-6">
          <Brand className="md:hidden" href="/account" />
          <div className="hidden text-sm font-medium lowercase text-muted-foreground md:block">
            your dashboard
          </div>
          <div className="flex items-center gap-2">
            <div className="md:hidden">
              <Avatar className="size-7">
                <AvatarFallback className="bg-primary/15 text-xs text-primary">
                  d2
                </AvatarFallback>
              </Avatar>
            </div>
            <Button
              render={<Link href="/" />}
              variant="ghost"
              size="sm"
              className="hidden sm:inline-flex"
            >
              back to site
            </Button>
          </div>
        </header>
        <div className="md:hidden">
          <Separator />
          <AccountNav />
        </div>
        <main className="flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
