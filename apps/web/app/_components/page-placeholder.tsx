/**
 * Scaffolding component.
 *
 * Every route in the spec's route map (§7) exists so that navigation,
 * permissions, and the route-map conformance test are real from day one. Each
 * one renders this placeholder until its feature phase lands (§11).
 *
 * Delete this component once the last route has a real implementation; the
 * route-map test will keep the routes themselves honest in the meantime.
 */
export function PagePlaceholder({
  title,
  route,
  phase,
}: {
  title: string;
  route: string;
  phase?: string;
}) {
  // A `section`, not a `main`. Every route group's layout already provides the
  // page's single `main` landmark, and a second one nested inside it is invalid
  // HTML — a screen reader offers two "main" landmarks and neither is the page.
  // It also broke the e2e suite's `main` locator, which is how it was found.
  // Said as a plan rather than as a gap: "coming later" with when, not a
  // developer's note and a raw route, which read as a broken page to the
  // people the app is for. The route stays on the element for the tests.
  return (
    <section
      data-testid="page-placeholder"
      data-route={route}
      className="flex flex-col gap-density"
    >
      <h1 className="text-ink">{title}</h1>
      <div className="flex flex-col items-center gap-2 rounded-density border border-dashed border-rule p-8 text-center">
        <p className="text-density font-semibold text-ink">Not built yet</p>
        <p className="max-w-prose text-sm text-muted">
          {phase ? `Planned for ${phase}.` : "Planned for a later phase."}
        </p>
      </div>
    </section>
  );
}
