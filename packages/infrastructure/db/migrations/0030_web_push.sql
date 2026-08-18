-- Web push, behind the `Notifier` port (spec §6, issue #41).
--
-- Two tables, and neither is an entity. Both stay out of `allTables` for the
-- reason `kiosk_pins` gives three migrations back: sync copies rows to every
-- device on the property, and neither of these is a row a device should ever
-- receive.
--
-- `push_subscriptions` is the obvious one. A subscription is a capability URL
-- plus the two keys that decrypt anything sent to it, so replicating one to
-- the barn kiosk would hand every screen the ability to read the owner's
-- notifications. It is a §4.5 "system-owned row" in the same sense a device
-- token is: minted by a browser, revoked by a person, never edited.
--
-- One row per *browser*, not per person — `endpoint` is unique because the
-- push service already guarantees it is. A phone and a laptop are two rows,
-- and unsubscribing one leaves the other alone, which is the whole of "per
-- user and per device". `device_label` is a human's word for which is which,
-- because an endpoint is 200 characters of opaque URL and a person deciding
-- what to revoke needs to recognise the thing they are revoking.
--
-- `notification_settings` is the §6 preference model — per-trigger opt-out,
-- channel choice, and lead time. It is not secret, but it is not a device's
-- business either: it is read on the server when something is about to be
-- sent, and a kiosk that never sends anything has no use for a copy. Keeping
-- it here rather than in the sync machinery also keeps a person's own
-- preferences off every other screen in the household.
--
-- `user_id` is nullable on the settings, and that carries meaning: a row with
-- one is that person's own choice, and a row without is the property-wide
-- default that applies until they make one (`settingFor` in core resolves the
-- two in that order). `NULLS NOT DISTINCT` is what makes one default per
-- trigger per property enforceable: without it Postgres counts every NULL as
-- its own value and the uniqueness would apply to everybody except the
-- property-wide row it exists to protect.
CREATE TABLE "push_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth_secret" text NOT NULL,
	"device_label" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"last_sent_at" timestamp with time zone,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" ("user_id");
--> statement-breakpoint
CREATE TABLE "notification_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"user_id" text,
	"trigger" text NOT NULL,
	"channel" text NOT NULL,
	"lead_days" integer NOT NULL,
	"enabled" boolean NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "notification_settings_scope_unique" UNIQUE NULLS NOT DISTINCT ("property_id","user_id","trigger")
);
