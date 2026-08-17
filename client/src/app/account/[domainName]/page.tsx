import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DomainSettings } from "@/components/domain-settings";
import { DnsManager } from "@/components/dns-manager";
import { EmailStarterCard } from "@/components/account/email-starter-card";

export const metadata: Metadata = {
  title: "domain",
};

export default async function DomainDetailPage({
  params,
}: {
  params: Promise<{ domainName: string }>;
}) {
  const { domainName } = await params;
  const name = decodeURIComponent(domainName);

  const emailRes = await fetch(`${process.env.HOG_URL}/api/v1/domains/${encodeURIComponent(name)}/email`, {
    next: { revalidate: 0 },
  }).catch(() => null);
  
  const emailData = emailRes?.ok 
    ? await emailRes.json() 
    : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Button render={<Link href="/account" />} variant="ghost" size="sm">
          <ArrowLeft />
        </Button>
        <div>
          <h1 className="font-mono text-2xl font-semibold tracking-tight">
            {name}
          </h1>
          <p className="text-sm text-muted-foreground">
            registrar settings and dns records.
          </p>
        </div>
      </div>

      <EmailStarterCard domainName={name} emailData={emailData} />
      <DomainSettings domainName={name} />
      <DnsManager domainName={name} />
    </div>
  );
}
