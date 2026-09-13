CREATE TABLE "opening_balance" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
	"year" integer NOT NULL,
	"bank_ore" integer NOT NULL DEFAULT 0,
	"loan_ore" integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX "ob_org_year_idx" ON "opening_balance" ("organization_id", "year");

CREATE TABLE "owner_opening_balance" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
	"year" integer NOT NULL,
	"owner_id" text NOT NULL REFERENCES "owner"("id") ON DELETE CASCADE,
	"balance_ore" integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX "oob_org_year_owner_idx" ON "owner_opening_balance" ("organization_id", "year", "owner_id");
