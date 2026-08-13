import type { Metadata } from "next";
import Link from "next/link";
import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "overview",
};

export default function AccountPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight lowercase">
          overview
        </h1>
        <p className="text-sm text-muted-foreground">
          manage all of your domains from one place.
        </p>
      </div>

      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
          <div className="inline-flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Globe className="size-6" />
          </div>
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-medium lowercase">
              no domains yet
            </h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              search for your next domain and claim it before someone else
              does.
            </p>
          </div>
          <Button render={<Link href="/">search for a domain</Link>} />
        </CardContent>
      </Card>
    </div>
  );
}
