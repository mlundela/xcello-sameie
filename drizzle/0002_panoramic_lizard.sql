CREATE TABLE "bank_statement" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"file_name" text NOT NULL,
	"content" text NOT NULL,
	"imported_at" timestamp NOT NULL,
	"row_count" integer NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_transaction" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"bank_statement_id" text NOT NULL,
	"date" date NOT NULL,
	"description" text NOT NULL,
	"amount_ore" integer NOT NULL,
	"matched_owner_id" text,
	"ledger_account_id" text,
	"status" text DEFAULT 'UNMATCHED' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_account" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matching_rule" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"pattern" text NOT NULL,
	"owner_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bank_statement" ADD CONSTRAINT "bank_statement_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_bank_statement_id_bank_statement_id_fk" FOREIGN KEY ("bank_statement_id") REFERENCES "public"."bank_statement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_matched_owner_id_owner_id_fk" FOREIGN KEY ("matched_owner_id") REFERENCES "public"."owner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_ledger_account_id_ledger_account_id_fk" FOREIGN KEY ("ledger_account_id") REFERENCES "public"."ledger_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_account" ADD CONSTRAINT "ledger_account_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matching_rule" ADD CONSTRAINT "matching_rule_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matching_rule" ADD CONSTRAINT "matching_rule_owner_id_owner_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bs_org_idx" ON "bank_statement" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "bt_org_date_idx" ON "bank_transaction" USING btree ("organization_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "la_org_code_idx" ON "ledger_account" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "mr_org_idx" ON "matching_rule" USING btree ("organization_id");