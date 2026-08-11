import { redirect } from "next/navigation";

import { ConfirmProvider, ToastProvider } from "@galaxy-farm/ui";

import { AdminNav } from "@/app/(admin)/_components/admin-nav";
import { SyncProvider } from "@/app/_components/sync-provider";
import { currentActor } from "@/lib/auth";

/**
 * The admin surface. Theme is fixed per surface (spec §8): midnight-nebula.
 *
 * The session is checked here as well as in the middleware. Middleware is a
 * routing concern and can be bypassed by anything that reaches a server
 * component another way; this is the layer that actually has the actor.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await currentActor();
  if (actor === undefined) redirect("/login?next=/admin");

  // Farm name is a BrandingConfig value (§5.1). Until the settings store is
  // wired it falls back to the environment, so there is still one place to
  // change it and no string literal in a component.
  const farmName = process.env["NEXT_PUBLIC_FARM_NAME"] ?? "Galaxy Farm";

  return (
    <div data-surface="admin" data-theme="midnight-nebula">
      <SyncProvider>
        <ToastProvider>
          <ConfirmProvider>
            <div className="flex min-h-screen flex-col md:flex-row">
              <aside className="border-b border-edge md:w-64 md:shrink-0 md:border-b-0 md:border-r">
                <AdminNav farmName={farmName} />
              </aside>
              <main className="flex-1 p-density">{children}</main>
            </div>
          </ConfirmProvider>
        </ToastProvider>
      </SyncProvider>
    </div>
  );
}
