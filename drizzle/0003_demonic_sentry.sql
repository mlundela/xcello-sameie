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
ALTER TABLE "matching_rule" ALTER COLUMN "owner_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD COLUMN "user_description" text;--> statement-breakpoint
ALTER TABLE "flat_ownership" ADD COLUMN "is_payment_responsible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "matching_rule" ADD COLUMN "ledger_account_id" text;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_bank_transaction_id_bank_transaction_id_fk" FOREIGN KEY ("bank_transaction_id") REFERENCES "public"."bank_transaction"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "att_tx_idx" ON "attachment" USING btree ("bank_transaction_id");--> statement-breakpoint
ALTER TABLE "matching_rule" ADD CONSTRAINT "matching_rule_ledger_account_id_ledger_account_id_fk" FOREIGN KEY ("ledger_account_id") REFERENCES "public"."ledger_account"("id") ON DELETE cascade ON UPDATE no action;