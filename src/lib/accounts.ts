/** Ledger accounts the accounting logic looks up by code (voucher.ts, balances.ts), so they can't be deleted. */
export const REQUIRED_ACCOUNT_CODES: readonly string[] = ['1500', '1920', '2050', '2400', '2770', '3600'];
