-- The care guide (spec §5.10).
--
-- Only the half somebody writes is stored. The pens with their effective
-- safety levels, the merged care instructions, today's chores, the emergency
-- numbers and the vet are composed from live records every time the guide is
-- opened — a guide generated once and saved would be wrong the first time an
-- animal moved pens, which is the week it is most likely to be read.
--
-- So `includes` is a list of which auto-sections to compose, not their
-- contents, and `guide_sections` holds the hand-written ones.
CREATE TABLE "care_guides" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"title" text NOT NULL,
	"intro" text,
	-- text[] rather than a join table: the sync engine patches *fields*
	-- (§4.2), and a join table has no representation in a field-level patch.
	"includes" text[] DEFAULT '{}' NOT NULL,
	"active" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guide_sections" (
	"id" text PRIMARY KEY NOT NULL,
	"property_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" text,
	"deleted_reason" text,
	"care_guide_id" text NOT NULL,
	"title" text NOT NULL,
	"body_markdown" text NOT NULL,
	-- Quoted, because `order` is a reserved word. The column key has to match
	-- the entity's field name exactly — the repository maps the two by
	-- identity — so renaming it to `sort_order` would silently drop the value.
	"order" integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX "care_guides_property_idx" ON "care_guides" ("property_id");--> statement-breakpoint
CREATE INDEX "care_guides_sync_cursor_idx" ON "care_guides" ("updated_at");--> statement-breakpoint
CREATE INDEX "care_guides_live_idx" ON "care_guides" ("property_id") WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "guide_sections_property_idx" ON "guide_sections" ("property_id");--> statement-breakpoint
CREATE INDEX "guide_sections_sync_cursor_idx" ON "guide_sections" ("updated_at");--> statement-breakpoint
CREATE INDEX "guide_sections_live_idx" ON "guide_sections" ("property_id") WHERE "deleted_at" is null;--> statement-breakpoint
-- The read this table exists for: every section of one guide, in order.
CREATE INDEX "guide_sections_guide_idx" ON "guide_sections" ("care_guide_id", "order");
