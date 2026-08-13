import { Landing } from "@/app/(public)/_components/landing";
import { FALLBACK_FARM_NAME } from "@galaxy-farm/core";

export const metadata = {
  title: "Show calf boarding in Wise County, Texas",
  description:
    "A family cattle operation north of Fort Worth, raising registered Maine-Anjou, Chianina and Shorthorn — and boarding show calves.",
};

/**
 * The landing page (spec §7).
 *
 * Names come from the environment with a neutral fallback, the same as every
 * other surface: they are BrandingConfig values (§5.1) and never string
 * literals in a component, so there stays exactly one place to change them
 * when the business is named.
 */
export default function LandingPage() {
  const farmName = process.env["NEXT_PUBLIC_FARM_NAME"] ?? FALLBACK_FARM_NAME;
  const businessName = process.env["NEXT_PUBLIC_BUSINESS_NAME"];

  return <Landing farmName={farmName} {...(businessName === undefined ? {} : { businessName })} />;
}
