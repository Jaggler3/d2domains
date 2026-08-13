import type { Metadata } from "next";
import { DnsManager } from "@/components/dns-manager";

export const metadata: Metadata = {
  title: "domain",
};

export default async function DomainDetailPage({
  params,
}: {
  params: Promise<{ domainName: string }>;
}) {
  const { domainName } = await params;
  return <DnsManager domainName={decodeURIComponent(domainName)} />;
}
