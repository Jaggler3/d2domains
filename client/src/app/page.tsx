import { SiteHeader } from "@/components/site-header";
import { RandomTagline } from "@/components/random-tagline";
import { DomainSearch } from "@/components/domain-search";

export default function LandingPage() {
  return (
    <>
      <SiteHeader />
      <main className="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-20">
        <RandomTagline />
        <DomainSearch />
      </main>
    </>
  );
}
