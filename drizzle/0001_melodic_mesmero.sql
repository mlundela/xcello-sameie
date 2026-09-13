DROP TABLE IF EXISTS "flat_charge";
--> statement-breakpoint
CREATE TABLE "flat_rent" (
	"id" text PRIMARY KEY NOT NULL,
	"flat_id" text NOT NULL,
	"from_year" integer NOT NULL,
	"from_month" integer NOT NULL,
	"to_year" integer,
	"to_month" integer,
	"amount" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "flat_rent" ADD CONSTRAINT "flat_rent_flat_id_flat_id_fk" FOREIGN KEY ("flat_id") REFERENCES "public"."flat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fr_flat_idx" ON "flat_rent" USING btree ("flat_id");
