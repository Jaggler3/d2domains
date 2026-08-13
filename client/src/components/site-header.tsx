import Link from "next/link";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";

const navLinks = [
  { label: "domains", href: "/" },
  { label: "pricing", href: "/" },
  { label: "transfers", href: "/" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-8">
          <Brand />
          <nav className="hidden items-center gap-1 sm:flex">
            {navLinks.map((link) => (
              <Button
                key={link.label}
                render={<Link href={link.href} />}
                variant="ghost"
                size="sm"
              >
                {link.label}
              </Button>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <Button render={<Link href="/login" />} variant="ghost" size="sm">
            log in
          </Button>
          <Button render={<Link href="/register" />} size="sm">
            get started
          </Button>
        </div>
      </div>
    </header>
  );
}
