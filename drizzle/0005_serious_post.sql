CREATE TABLE "voucher" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"voucher_number" integer NOT NULL,
	"fiscal_year" integer NOT NULL,
	"date" date NOT NULL,
	"description" text NOT NULL,
	"source" text DEFAULT 'BANK_AUTO' NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voucher_line" (
	"id" text PRIMARY KEY NOT NULL,
	"voucher_id" text NOT NULL,
	"line_number" integer NOT NULL,
	"ledger_account_id" text NOT NULL,
	"debit_ore" integer DEFAULT 0 NOT NULL,
	"credit_ore" integer DEFAULT 0 NOT NULL,
	"owner_id" text
);
--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD COLUMN "voucher_id" text;--> statement-breakpoint
ALTER TABLE "voucher" ADD CONSTRAINT "voucher_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_line" ADD CONSTRAINT "voucher_line_voucher_id_voucher_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."voucher"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_line" ADD CONSTRAINT "voucher_line_ledger_account_id_ledger_account_id_fk" FOREIGN KEY ("ledger_account_id") REFERENCES "public"."ledger_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_line" ADD CONSTRAINT "voucher_line_owner_id_owner_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "voucher_org_year_number_idx" ON "voucher" USING btree ("organization_id","fiscal_year","voucher_number");--> statement-breakpoint
CREATE INDEX "voucher_org_year_idx" ON "voucher" USING btree ("organization_id","fiscal_year");--> statement-breakpoint
CREATE INDEX "vl_voucher_idx" ON "voucher_line" USING btree ("voucher_id");--> statement-breakpoint
CREATE INDEX "vl_ledger_idx" ON "voucher_line" USING btree ("ledger_account_id");--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_voucher_id_voucher_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."voucher"("id") ON DELETE set null ON UPDATE no action;