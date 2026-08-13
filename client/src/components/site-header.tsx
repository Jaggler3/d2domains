import Link from "next/link";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { LogoutButton } from "@/components/logout-button";
import { getCurrentUser } from "@/lib/session";

export async function SiteHeader() {
  const user = await getCurrentUser();

  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Brand />
        <div className="flex items-center gap-2">
          {user ? (
            <>
              <Button
                render={<Link href="/account" />}
                variant="ghost"
                size="sm"
              >
                {user.email.split("@")[0]}
              </Button>
              <LogoutButton />
            </>
          ) : (
            <>
              <Button render={<Link href="/login" />} variant="ghost" size="sm">
                log in
              </Button>
              <Button render={<Link href="/register" />} size="sm">
                get started
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
