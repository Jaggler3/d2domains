import {
  LayoutGrid,
  Globe,
  Network,
  ArrowLeftRight,
  CreditCard,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const navItems = [
  { label: "overview", icon: LayoutGrid, href: "/account", ready: true },
  { label: "domains", icon: Globe, href: "/account", ready: false },
  { label: "dns", icon: Network, href: "/account", ready: false },
  { label: "transfers", icon: ArrowLeftRight, href: "/account", ready: false },
  { label: "billing", icon: CreditCard, href: "/account", ready: false },
  { label: "settings", icon: Settings, href: "/account", ready: false },
];

export function AccountNav() {
  return (
    <nav className="flex gap-1 overflow-x-auto p-2 md:flex-col md:overflow-visible md:p-0">
      {navItems.map((item) => {
        const active = item.ready && item.label === "overview";
        return (
          <Button
            key={item.label}
            render={item.ready ? <a href={item.href} /> : <span />}
            variant={active ? "secondary" : "ghost"}
            className={cn(
              "justify-start whitespace-nowrap",
              !item.ready && "cursor-not-allowed opacity-60",
            )}
            size="sm"
          >
            <item.icon />
            {item.label}
            {!item.ready && (
              <Badge
                variant="outline"
                className="ml-auto hidden rounded-full text-[10px] md:inline-flex"
              >
                soon
              </Badge>
            )}
          </Button>
        );
      })}
    </nav>
  );
}
