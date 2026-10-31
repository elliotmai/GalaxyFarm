import { FALLBACK_FARM_NAME } from "@galaxy-farm/core";

import { SitePage } from "@/app/(public)/_components/public-shell";

import { PagePlaceholder } from "../../_components/page-placeholder";

export const metadata = { title: "Request Boarding" };

/**
 * The boarding enquiry (spec §7). Still a placeholder until Phase 5, but in
 * the landing's frame — it is where the landing's "Enquire" goes, and a page
 * that dropped the site's header would read as somewhere else entirely.
 */
export default function BookPage() {
  const farmName = process.env["NEXT_PUBLIC_FARM_NAME"] ?? FALLBACK_FARM_NAME;

  return (
    <SitePage farmName={farmName}>
      <PagePlaceholder title={"Request Boarding"} route={"/book"} phase={"Phase 5"} />
    </SitePage>
  );
}
