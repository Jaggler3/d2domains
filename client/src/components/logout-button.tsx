"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function LogoutButton({
  className,
  onDone,
}: {
  className?: string;
  onDone?: () => void;
}) {
  const router = useRouter();

  return (
    <Button
      className={className}
      variant="ghost"
      size="sm"
      onClick={async () => {
        await fetch("/api/v1/auth/logout", { method: "POST" });
        router.push("/");
        router.refresh();
        onDone?.();
      }}
    >
      log out
    </Button>
  );
}
