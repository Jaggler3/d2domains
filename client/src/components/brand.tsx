import Link from "next/link";
import { cn } from "@/lib/utils";

export function Brand({
  className,
  href = "/",
}: {
  className?: string;
  href?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "font-pixel text-lg lowercase text-foreground transition-opacity hover:opacity-80",
        className,
      )}
    >
      d<span className="text-primary">2</span>domains
    </Link>
  );
}
