CREATE TABLE "opening_balance" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"year" integer NOT NULL,
	"bank_ore" integer DEFAULT 0 NOT NULL,
	"loan_ore" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "owner_opening_balance" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"year" integer NOT NULL,
	"owner_id" text NOT NULL,
	"balance_ore" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "owner" DROP CONSTRAINT "owner_public_id_unique";--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD COLUMN "receipt_not_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "matching_rule" ADD COLUMN "receipt_not_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "matching_rule" ADD COLUMN "user_description" text;--> statement-breakpoint
ALTER TABLE "owner" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "owner" o SET organization_id = (SELECT f.organization_id FROM flat_ownership fo JOIN flat f ON fo.flat_id = f.id WHERE fo.owner_id = o.id LIMIT 1) WHERE o.organization_id IS NULL;--> statement-breakpoint
ALTER TABLE "owner" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
UPDATE "ledger_account" SET type = 'LIABILITY' WHERE type = 'LOAN';--> statement-breakpoint
ALTER TABLE "opening_balance" ADD CONSTRAINT "opening_balance_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_opening_balance" ADD CONSTRAINT "owner_opening_balance_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_opening_balance" ADD CONSTRAINT "owner_opening_balance_owner_id_owner_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ob_org_year_idx" ON "opening_balance" USING btree ("organization_id","year");--> statement-breakpoint
CREATE UNIQUE INDEX "oob_org_year_owner_idx" ON "owner_opening_balance" USING btree ("organization_id","year","owner_id");--> statement-breakpoint
ALTER TABLE "owner" ADD CONSTRAINT "owner_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "owner_org_public_id_idx" ON "owner" USING btree ("organization_id","public_id");