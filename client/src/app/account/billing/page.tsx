import type { Metadata } from "next";
import { BillingManager } from "@/components/billing-manager";
import { getMyOrders } from "@/lib/session";

export const metadata: Metadata = {
  title: "billing",
};

export default async function BillingPage() {
  const orders = await getMyOrders();
  return <BillingManager orders={orders} />;
}