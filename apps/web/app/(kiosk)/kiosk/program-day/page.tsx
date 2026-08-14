import { PagePlaceholder } from "../../../_components/page-placeholder";

export const metadata = { title: "Program Day Sheet" };

/**
 * The show program's daily routine as a calf × activity grid (spec §4.4,
 * §5.7 "ProgramSchedule"). Genuinely not built anywhere yet — `ProgramSchedule`
 * itself is business-module scope the roadmap places in Phase 5, and that
 * module's application layer is still an empty scaffold. The other five
 * boards are real because their domain layers already exist; this one stays
 * an honest placeholder rather than inventing a schedule model ahead of the
 * business module that is supposed to define it.
 */
export default function KioskProgramDayPage() {
  return (
    <PagePlaceholder title={"Program Day Sheet"} route={"/kiosk/program-day"} phase={"Phase 5"} />
  );
}
