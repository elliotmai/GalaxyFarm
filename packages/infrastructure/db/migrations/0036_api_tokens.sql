-- Connected-app API tokens (spec §4.3 "Connected apps").
--
-- Another of the household's apps — the kitchen's Fridge Board first — reads
-- this farm's location, today's chores and the housesitter guide, and ticks
-- chores, server-to-server, with `Authorization: Bearer <token>`.
--
-- **Deliberately outside `allTables`**, the same exception `kiosk_pins` and
-- `wander_connections` document: the row carries a credential's hash, and
-- sync copies rows to every device on the property. Only the SHA-256 of the
-- token is kept — the token is shown to the owner once, when minted.
--
-- One token, one property: the API takes the property from this row and never
-- from the request. A §4.5 system-owned row — minted and revoked by the owner,
-- never edited, never deleted, so a revoked row stays as the record of what
-- wrote under its id in the sync audit.
CREATE TABLE "api_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"label" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE INDEX "api_tokens_property_idx" ON "api_tokens" ("property_id");
