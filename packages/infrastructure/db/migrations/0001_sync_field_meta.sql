CREATE TABLE "sync_field_meta" (
	"entity" text NOT NULL,
	"record_id" text NOT NULL,
	"field" text NOT NULL,
	"property_id" text NOT NULL,
	"written_at" timestamp with time zone NOT NULL,
	"written_by" text NOT NULL,
	CONSTRAINT "sync_field_meta_entity_record_id_field_pk" PRIMARY KEY("entity","record_id","field")
);
--> statement-breakpoint
CREATE INDEX "sync_field_meta_record_idx" ON "sync_field_meta" USING btree ("entity","record_id");