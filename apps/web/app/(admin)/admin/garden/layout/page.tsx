import { PagePlaceholder } from "../../../../_components/page-placeholder";

export const metadata = { title: "Garden Layout" };

/**
 * The layout designer (§5.5, §8, issue #33).
 *
 * Still a placeholder, and deliberately so: §2 says the property map and the
 * garden designer are one component with two skins, and that component — the
 * shared `SpatialEditor` — is being built under #8. A second SVG editor drawn
 * here to fill the page would be the exact duplication the principle exists to
 * prevent.
 *
 * The beds themselves are real and are managed under **Plantings → Beds**,
 * geometry columns and all. This page is the drawing of them, not the record
 * of them.
 */
export default function AdminGardenLayoutPage() {
  return (
    <PagePlaceholder title={"Garden Layout"} route={"/admin/garden/layout"} phase={"Phase 3"} />
  );
}
