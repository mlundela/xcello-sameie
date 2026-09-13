# Glossary

xcello is an accounting and property management system for Norwegian housing cooperatives (*sameier*). It provides double-entry bookkeeping compliant with Bokføringsloven, flat ownership tracking, à conto billing, supplier invoice management, and bank reconciliation.

---

## Norwegian ↔ English Reference

| Norwegian | English | Definition |
|---|---|---|
| Sameie | Housing cooperative | A jointly owned residential property |
| Sameier | Co-owners / residents | Members of a sameie |
| Sameiebrøk | Ownership fraction | Each flat's fractional share of total costs (e.g. 55/1000) |
| Bilag | Voucher | A formal accounting document required by Bokføringsloven §7 |
| Bilagslinje | Journal entry line | One debit or credit line within a bilag |
| Resultatregnskap | Income statement | Revenues vs. expenses for a period |
| Balanse | Balance sheet | Assets vs. liabilities/equity snapshot |
| À conto | Installment charge | Regular monthly charge to flat owners toward annual costs |
| Innbetaling | Payment received | Inbound payment from a flat owner |
| Utbetaling | Payment made | Outbound payment, e.g. to a supplier |
| Leverandør | Supplier | A vendor providing services to the sameie |
| Leverandørfaktura | Supplier invoice | An invoice received from a vendor |
| Kasserer | Treasurer | The user role typically managing accounts |
| Styremedlem | Board member | A member of the cooperative's governing board |
| Bokføringsloven | Norwegian Accounting Act | Law governing bookkeeping requirements (§7 requires numbered vouchers) |
| Organisasjonsnummer | Organisation number | 9-digit Norwegian business identifier |
| Personnummer | National ID number | 11-digit Norwegian personal identifier |

---

## Entity Reference

All entities live under `src/main/java/pl/piomin/services/entity/`.

### Account
Chart-of-accounts entry. Global (not per-organization).

| Field | Notes |
|---|---|
| accountNo | Unique (e.g. `"1920"`) |
| name | e.g. `"Bankinnskudd"` |
| type | `AccountType` enum |

---

### AccountingPeriod
A fiscal year for an Organization. One per (organization, year).

| Field | Notes |
|---|---|
| organization | → Organization |
| year | e.g. `2024` |
| status | `OPEN` or `CLOSED` |

---

### AccountType *(enum)*
`ASSET` · `LIABILITY` · `EQUITY` · `INCOME` · `EXPENSE`

---

### AccountingPeriodStatus *(enum)*
`OPEN` · `CLOSED`

---

### BankStatement
An imported bank statement file for an organization and period.

| Field | Notes |
|---|---|
| organization | → Organization |
| accountingPeriod | → AccountingPeriod |
| filename | Original file name |
| importedAt | Timestamp of import |

---

### BankTransaction
A single line from a `BankStatement`. Categorized and reconciled after import.

| Field | Notes |
|---|---|
| bankStatement | → BankStatement |
| transactionDate | |
| description | Raw text from bank |
| amount | Positive = inflow, negative = outflow |
| account | → Account (nullable; assigned after import) |
| reconciled | `true` once matched |
| voucher | → Voucher (nullable; set when journalised) |

---

### BudgetLine
One budgeted amount for an account within an accounting period.

| Field | Notes |
|---|---|
| accountingPeriod | → AccountingPeriod |
| account | → Account |
| budgetedAmount | |

---

### CategoryRule
Organization-specific rule to auto-categorize imported bank transactions.

| Field | Notes |
|---|---|
| organization | → Organization |
| descriptionPattern | Substring/regex matched against transaction description |
| account | → Account (assigned when rule matches) |
| priority | Lower value = higher priority |

---

### FlatCharge
A charge levied against a flat for a period. Either regular monthly à conto or an extraordinary one-off.

| Field | Notes |
|---|---|
| flat | → Flat |
| accountingPeriod | → AccountingPeriod |
| chargeType | `ACONTO` or `EXTRAORDINARY` |
| month | 1–12 for ACONTO; null for EXTRAORDINARY |
| amount | |
| description | Required for EXTRAORDINARY; optional for ACONTO |
| dueDate | Required for EXTRAORDINARY; null for ACONTO |

---

### FlatChargeType *(enum)*
`ACONTO` · `EXTRAORDINARY`

---

### FlatOwnership
Event-log record of who owns a flat over time. Non-overlapping date ranges per flat.

| Field | Notes |
|---|---|
| flat | → Flat |
| owner | → Owner |
| fromDate | Start of ownership |
| toDate | End of ownership; `null` = current owner |

---

### FlatPayment
A payment received from an owner for a period, linked to a specific bank transaction.

| Field | Notes |
|---|---|
| owner | → Owner |
| accountingPeriod | → AccountingPeriod |
| bankTransaction | → BankTransaction |
| amount | |

---

### FlatReconciliation
Year-end settlement snapshot per owner and period. Created when a period is closed. One per (owner, period); covers all flats the owner holds.

| Field | Notes |
|---|---|
| owner | → Owner |
| accountingPeriod | → AccountingPeriod |
| totalBilled | Sum of all FlatCharges for owner's flats |
| totalPaid | Sum of all FlatPayments for owner |
| balance | `totalPaid - totalBilled` |
| status | `FlatReconciliationStatus` enum |
| reconciledAt | |
| notes | Optional free text |

---

### FlatReconciliationStatus *(enum)*
`OPEN` · `SURPLUS` · `DEFICIT` · `DISPUTED`

---

### Flat
A unit within an Organization. Its sameiebrøk determines its share of à conto costs.

| Field | Notes |
|---|---|
| organization | → Organization |
| flatNo | Unit identifier (e.g. `"H0101"`) |
| shareNumerator | Numerator of ownership fraction |
| shareDenominator | Denominator of ownership fraction |

---

### Invite
A one-time email invitation to join an organization.

| Field | Notes |
|---|---|
| token | Unique UUID |
| invitedEmail | |
| organization | → Organization |
| createdAt / expiresAt | |
| used | `true` once accepted |

---

### JournalEntryLine *(Bilagslinje)*
One debit or credit line within a `Voucher`. Exactly one of debit/credit must be set per line.

| Field | Notes |
|---|---|
| voucher | → Voucher |
| account | → Account |
| debit | Nullable |
| credit | Nullable |
| description | Optional line note |

---

### Organization
Top-level tenant. Represents a sameie.

---

### Owner
A person or company that owns one or more flats and is responsible for payments.

| Field | Notes |
|---|---|
| name | |
| ownerType | `PERSON` or `COMPANY` |
| publicId | Personnummer (11 digits) or organisasjonsnummer (9 digits) |
| email / phone | Optional |
| user | → User (optional; owner may also be a system user) |

---

### OwnerType *(enum)*
`PERSON` · `COMPANY`

---

### Supplier *(Leverandør)*
A vendor scoped to an Organization (e.g. vaktmester, forsikring, strøm).

| Field | Notes |
|---|---|
| organization | → Organization |
| name | Unique per organization |
| orgNo | Norwegian organisasjonsnummer (optional) |
| email / phone / address | Optional |

---

### SupplierInvoice *(Leverandørfaktura)*
An invoice received from a Supplier. Unique per (organization, supplier, invoiceNo).

Lifecycle: `RECEIVED → APPROVED → POSTED → PAID`

| Field | Notes |
|---|---|
| organization | → Organization |
| accountingPeriod | → AccountingPeriod |
| supplier | → Supplier |
| invoiceNo | |
| invoiceDate / dueDate | |
| amount | |
| account | → Account (expense account, e.g. `6500 Vedlikehold`) |
| status | `SupplierInvoiceStatus` enum |
| voucher | → Voucher (set when POSTED) |
| bankTransaction | → BankTransaction (set when PAID) |
| description | Optional |

---

### SupplierInvoiceStatus *(enum)*
`RECEIVED` · `APPROVED` · `POSTED` · `PAID`

---

### User
An authenticated system user (kasserer, styremedlem, etc.).

---

### Voucher *(Bilag)*
A numbered accounting voucher as required by Bokføringsloven §7. Groups two or more `JournalEntryLine`s that must balance (debits = credits). Unique per (organization, period, voucherNo).

| Field | Notes |
|---|---|
| organization | → Organization |
| accountingPeriod | → AccountingPeriod |
| voucherDate | |
| voucherNo | Sequential per period |
| description | |
| createdAt | |

---

## Key Process Flows

### Billing Cycle
1. `FlatCharge` records are created per flat per month (ACONTO) or as one-offs (EXTRAORDINARY).
2. Owner pays → bank imports `BankTransaction` → matched as `FlatPayment`.
3. At period close → `FlatReconciliation` is created per owner summarising `totalBilled` vs `totalPaid`.

### Supplier Invoice Lifecycle
`RECEIVED` → `APPROVED` → `POSTED` (creates a `Voucher` with balanced `JournalEntryLine`s) → `PAID` (links to `BankTransaction`).

### Bank Reconciliation
1. Import bank file → `BankStatement` + `BankTransaction` rows created.
2. `CategoryRule`s auto-assign an `Account` to matching transactions.
3. Transactions are manually or automatically matched to `FlatPayment`s or `SupplierInvoice` outflows.
4. Reconciled transactions are journalised → `Voucher` linked.

### Period Closing
1. Verify all vouchers are balanced.
2. Generate `FlatReconciliation` for each owner.
3. Set `AccountingPeriod.status = CLOSED`.
4. Produce `Resultatregnskap` (income statement) and `Balanse` (balance sheet) reports.
