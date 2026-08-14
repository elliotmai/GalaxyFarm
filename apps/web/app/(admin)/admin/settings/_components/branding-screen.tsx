"use client";

import { useState } from "react";

import { Button, Callout, Card, Section, TextInput, useToast } from "@galaxy-farm/ui";
import {
  brandingConfigSchema,
  FALLBACK_FARM_NAME,
  resolveBranding,
  resolveFarmName,
  type BrandingConfig,
  type Ulid,
} from "@galaxy-farm/core";

import { useMutations } from "@/lib/local/mutations";
import { useRecords } from "@/lib/local/use-records";

/**
 * What the farm is called (spec §5.1, §7 `/admin/settings`).
 *
 * §5.1 makes the farm name a stored value rather than a string in code, for
 * the reason this screen exists: it is injected into every page title,
 * navigation header, email template, PDF, kiosk board and the customer portal,
 * so landing on a name is one edit here rather than a search-and-replace.
 *
 * Owner-only, and the gate that matters is not this component. The tab is
 * absent without `branding.manage`, but that is presentation — §4.3 puts the
 * real check in the application layer, and here that is the sync push handler,
 * which refuses a `brandingConfigs` patch from anybody without the capability
 * whether or not a screen was involved in producing it.
 *
 * Written through the local store like everything else, so renaming the farm
 * from a phone in the barn works at zero bars and reaches the kiosk on the
 * next pull.
 */

export function BrandingScreen({
  propertyId,
  actorId,
}: {
  readonly propertyId: Ulid;
  readonly actorId: Ulid;
}) {
  const { records: configs, loading } = useRecords<BrandingConfig>("brandingConfigs", {
    propertyId,
  });
  const api = useMutations<BrandingConfig>(
    "brandingConfigs",
    "brandingConfigs",
    brandingConfigSchema,
    propertyId,
    actorId,
  );
  const { show } = useToast();

  const config = resolveBranding(configs);
  // The environment is the fallback until somebody sets a name, and it is what
  // the server-rendered pages are still reading — so it is what the field
  // starts from rather than an empty box.
  const stored = resolveFarmName(config, {
    NEXT_PUBLIC_FARM_NAME: process.env["NEXT_PUBLIC_FARM_NAME"],
  });

  const [draft, setDraft] = useState(stored);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  // The stored value wins until somebody types, so a name synced from another
  // device is not overwritten by a stale form nobody touched.
  const value = dirty ? draft : stored;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);

    const farmName = value.trim();
    if (farmName === "") {
      setError("The farm needs a name.");
      return;
    }
    if (farmName === stored) {
      setDirty(false);
      return;
    }

    setBusy(true);
    try {
      const result =
        config === undefined
          ? await api.create({ farmName } as never)
          : await api.update(config.id, { farmName } as Partial<BrandingConfig>);

      if (!result.ok) {
        setError(
          result.error.kind === "validation"
            ? (result.error.issues[0]?.message ?? "That is not a usable name.")
            : "Could not save that.",
        );
        return;
      }

      setDirty(false);
      show({ message: `The farm is now ${farmName}`, tone: "success" });
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-muted">Loading…</p>;

  return (
    <Section
      title="Farm name"
      description="Used in the page title, the navigation, emails, PDFs, the kiosk boards and the customer portal. Changing it here changes it everywhere."
    >
      <Card>
        <form onSubmit={(event) => void save(event)} className="flex flex-col gap-density">
          <TextInput
            label="Farm name"
            hint={
              config === undefined
                ? `Not set yet, so the app is using ${stored}.`
                : "What this place is called."
            }
            value={value}
            maxLength={80}
            onChange={(event) => {
              setDraft(event.target.value);
              setDirty(true);
            }}
            {...(error === undefined ? {} : { error })}
            required
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" busy={busy} disabled={!dirty}>
              Save
            </Button>
            {!dirty ? null : (
              <Button
                variant="ghost"
                onClick={() => {
                  // crud-guard: allow-unconfirmed — drops an unsaved edit in a
                  // form, nothing persisted
                  setDirty(false);
                  setError(undefined);
                }}
              >
                Cancel
              </Button>
            )}
          </div>

          {/*
            Said out loud because it is genuinely surprising: the working
            surfaces read the name from this device and update the moment it
            is saved, but the page title and the pages somebody sees before
            signing in are rendered on the server, which has no device to read
            from. They follow on the next deploy that sets the variable.
          */}
          <Callout tone="action" title="Where this reaches, and where it does not yet">
            Inside the app it takes effect straight away — here, and on the kiosk and the phones as
            they sync. What it does not yet change is anything drawn before you sign in: the browser
            tab title, the front door, the login screen, an invitation. Those are built on the
            server, which has no device to read from, and still say{" "}
            <strong>{process.env["NEXT_PUBLIC_FARM_NAME"] ?? FALLBACK_FARM_NAME}</strong>.
          </Callout>
        </form>
      </Card>
    </Section>
  );
}
