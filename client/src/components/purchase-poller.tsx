"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

interface OrderStatus {
  status: string;
}

export function PurchasePoller({ hasPending }: { hasPending: boolean }) {
  const router = useRouter();
  const sawPending = useRef(false);

  useEffect(() => {
    if (!hasPending) return;
    sawPending.current = true;

    let cancelled = false;
    const id = setInterval(async () => {
      try {
        const res = await fetch("/api/v1/orders");
        const data = (await res.json().catch(() => null)) as {
          orders?: OrderStatus[];
        } | null;
        const pending =
          (data?.orders ?? []).filter((o) => o.status === "pending").length;
        if (pending === 0 && sawPending.current) {
          clearInterval(id);
          if (!cancelled) router.refresh();
        }
      } catch {}
    }, 2000);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [hasPending, router]);

  return null;
}
