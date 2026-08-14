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
  return (
    <section
      data-testid="page-placeholder"
      data-route={route}
      className="flex flex-col gap-density"
    >
      <h1 className="text-ink">{title}</h1>
      <p className="text-muted">
        This screen is scaffolded but not implemented yet.
        {phase ? ` Planned for ${phase}.` : ""}
      </p>
      <code className="text-sm text-muted">{route}</code>
    </section>
  );
}
