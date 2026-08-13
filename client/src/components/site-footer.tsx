import Link from "next/link";
import { Brand } from "@/components/brand";

const footerCols = [
  {
    title: "products",
    links: [
      { label: "domain search", href: "/" },
      { label: "pricing", href: "/" },
      { label: "transfers", href: "/" },
    ],
  },
  {
    title: "account",
    links: [
      { label: "dashboard", href: "/account" },
      { label: "log in", href: "/login" },
      { label: "sign up", href: "/register" },
    ],
  },
  {
    title: "company",
    links: [
      { label: "about", href: "/" },
      { label: "contact", href: "/" },
      { label: "legal", href: "/" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-border/60 bg-background">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1fr_auto]">
        <div className="flex flex-col gap-3">
          <Brand />
          <p className="max-w-xs text-sm text-muted-foreground">
            register, renew, and manage your domains in one place.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
          {footerCols.map((col) => (
            <div key={col.title} className="flex flex-col gap-2">
              <span className="text-sm font-medium text-foreground">
                {col.title}
              </span>
              {col.links.map((link) => (
                <Link
                  key={link.label}
                  href={link.href}
                  className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-border/60 py-4">
        <p className="mx-auto max-w-6xl px-4 text-xs text-muted-foreground sm:px-6">
          © {new Date().getFullYear()} d2domains. all rights reserved.
        </p>
      </div>
    </footer>
  );
}
