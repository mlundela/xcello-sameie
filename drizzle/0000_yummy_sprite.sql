CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"id_token" text,
	"password" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounting_period" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"year" integer NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachment" (
	"id" text PRIMARY KEY NOT NULL,
	"bank_transaction_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"content" text NOT NULL,
	"uploaded_at" timestamp NOT NULL
);
--> statement-breakpoint
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
	"user_description" text,
	"amount_ore" integer NOT NULL,
	"matched_owner_id" text,
	"ledger_account_id" text,
	"status" text DEFAULT 'UNMATCHED' NOT NULL,
	"receipt_not_required" boolean DEFAULT false NOT NULL,
	"voucher_id" text
);
--> statement-breakpoint
CREATE TABLE "flat" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"nummer" integer NOT NULL,
	"flat_no" text NOT NULL,
	"share_numerator" integer NOT NULL,
	"share_denominator" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flat_ownership" (
	"id" text PRIMARY KEY NOT NULL,
	"flat_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date,
	"share_numerator" integer NOT NULL,
	"share_denominator" integer NOT NULL,
	"is_payment_responsible" boolean DEFAULT false NOT NULL
);
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
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"inviter_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"role" text,
	"status" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL
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
	"owner_id" text,
	"ledger_account_id" text,
	"receipt_not_required" boolean DEFAULT false NOT NULL,
	"user_description" text
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text,
	"logo" text,
	"metadata" text,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "owner" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"owner_type" text DEFAULT 'PERSON' NOT NULL,
	"public_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"active_organization_id" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean NOT NULL,
	"image" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp
);
--> statement-breakpoint
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
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounting_period" ADD CONSTRAINT "accounting_period_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_bank_transaction_id_bank_transaction_id_fk" FOREIGN KEY ("bank_transaction_id") REFERENCES "public"."bank_transaction"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_statement" ADD CONSTRAINT "bank_statement_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_bank_statement_id_bank_statement_id_fk" FOREIGN KEY ("bank_statement_id") REFERENCES "public"."bank_statement"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_matched_owner_id_owner_id_fk" FOREIGN KEY ("matched_owner_id") REFERENCES "public"."owner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_ledger_account_id_ledger_account_id_fk" FOREIGN KEY ("ledger_account_id") REFERENCES "public"."ledger_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_voucher_id_voucher_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."voucher"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flat" ADD CONSTRAINT "flat_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flat_ownership" ADD CONSTRAINT "flat_ownership_flat_id_flat_id_fk" FOREIGN KEY ("flat_id") REFERENCES "public"."flat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flat_ownership" ADD CONSTRAINT "flat_ownership_owner_id_owner_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flat_rent" ADD CONSTRAINT "flat_rent_flat_id_flat_id_fk" FOREIGN KEY ("flat_id") REFERENCES "public"."flat"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_account" ADD CONSTRAINT "ledger_account_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matching_rule" ADD CONSTRAINT "matching_rule_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matching_rule" ADD CONSTRAINT "matching_rule_owner_id_owner_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matching_rule" ADD CONSTRAINT "matching_rule_ledger_account_id_ledger_account_id_fk" FOREIGN KEY ("ledger_account_id") REFERENCES "public"."ledger_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner" ADD CONSTRAINT "owner_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher" ADD CONSTRAINT "voucher_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_line" ADD CONSTRAINT "voucher_line_voucher_id_voucher_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."voucher"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_line" ADD CONSTRAINT "voucher_line_ledger_account_id_ledger_account_id_fk" FOREIGN KEY ("ledger_account_id") REFERENCES "public"."ledger_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_line" ADD CONSTRAINT "voucher_line_owner_id_owner_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owner"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ap_org_year_idx" ON "accounting_period" USING btree ("organization_id","year");--> statement-breakpoint
CREATE INDEX "att_tx_idx" ON "attachment" USING btree ("bank_transaction_id");--> statement-breakpoint
CREATE INDEX "bs_org_idx" ON "bank_statement" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "bt_org_date_idx" ON "bank_transaction" USING btree ("organization_id","date");--> statement-breakpoint
CREATE INDEX "fr_flat_idx" ON "flat_rent" USING btree ("flat_id");--> statement-breakpoint
CREATE UNIQUE INDEX "la_org_code_idx" ON "ledger_account" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "mr_org_idx" ON "matching_rule" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "owner_org_public_id_idx" ON "owner" USING btree ("organization_id","public_id");--> statement-breakpoint
CREATE UNIQUE INDEX "voucher_org_year_number_idx" ON "voucher" USING btree ("organization_id","fiscal_year","voucher_number");--> statement-breakpoint
CREATE INDEX "voucher_org_year_idx" ON "voucher" USING btree ("organization_id","fiscal_year");--> statement-breakpoint
CREATE INDEX "vl_voucher_idx" ON "voucher_line" USING btree ("voucher_id");--> statement-breakpoint
CREATE INDEX "vl_ledger_idx" ON "voucher_line" USING btree ("ledger_account_id");