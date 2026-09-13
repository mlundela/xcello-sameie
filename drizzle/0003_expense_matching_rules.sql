ALTER TABLE "matching_rule" ALTER COLUMN "owner_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "matching_rule" ADD COLUMN "ledger_account_id" text REFERENCES "public"."ledger_account"("id") ON DELETE cascade ON UPDATE no action;
