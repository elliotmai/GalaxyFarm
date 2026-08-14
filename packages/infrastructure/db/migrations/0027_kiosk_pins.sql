-- The shared kiosk PIN (spec §4.3, §4.4, §4.5 tier "Elevated").
--
-- One row per property, holding a scrypt hash — the same treatment as a
-- person's password, because a PIN is chosen by a human and is exactly the
-- kind of low-entropy secret a memory-hard KDF is for. It never widens what a
-- `kiosk`-role session may do; it only gates the one thing a screen can do to
-- itself (unpairing) and any Elevated-tier action taken by a person using
-- `/kiosk` as themselves.
--
-- Deliberately not one of the tables `applyPush`/`pullSince` know how to
-- reach. `kioskDevices` two tables over is a §4.5 "system-owned row" for the
-- identical reason: this hash must never be a column a device could be sent,
-- so it stays out of `allTables`, out of `SYNCED_ENTITIES`, and out of the
-- repository/schema-conformance machinery entirely — `apps/web/lib/kiosk-pin-store.ts`
-- is its only reader and writer.
CREATE TABLE "kiosk_pins" (
	"property_id" text PRIMARY KEY NOT NULL,
	"pin_hash" text,
	"updated_at" timestamp with time zone NOT NULL
);
