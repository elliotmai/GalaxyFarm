CREATE TABLE "kiosk_devices" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"pairing_code" text,
	"pairing_expires_at" timestamp with time zone,
	"paired_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"locked_to_board" text,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"password_hash" text NOT NULL,
	"access_from" timestamp with time zone,
	"access_to" timestamp with time zone,
	"contact_id" text,
	"last_signed_in_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE INDEX "kiosk_devices_property_idx" ON "kiosk_devices" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "kiosk_devices_sync_cursor_idx" ON "kiosk_devices" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "kiosk_devices_live_idx" ON "kiosk_devices" USING btree ("property_id") WHERE "kiosk_devices"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "users_property_idx" ON "users" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "users_sync_cursor_idx" ON "users" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "users_live_idx" ON "users" USING btree ("property_id") WHERE "users"."deleted_at" is null;