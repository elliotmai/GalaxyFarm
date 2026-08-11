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
  return (
    <main data-testid="page-placeholder" data-route={route}>
      <h1>{title}</h1>
      <p>
        This screen is scaffolded but not implemented yet.
        {phase ? ` Planned for ${phase}.` : ""}
      </p>
      <code>{route}</code>
    </main>
  );
}
