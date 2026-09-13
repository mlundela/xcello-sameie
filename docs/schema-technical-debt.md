# Datamodell – kjente svakheter og fremtidige behov

Dette dokumentet beskriver arkitektoniske svakheter og mangler i nåværende datamodell som bevisst er utsatt. Punktene er identifisert av domeneekspertanalyse og bør adresseres før systemet skal skaleres til mange sameier eller underlegges revisjon.

---

## 1. ~~Manglende bilagsstruktur~~ — innført som skjult datalag

**Status:** Datamodellen er på plass (`voucher` + `voucher_line`-tabeller, auto-genererte bilag fra kategoriserings-handlinger). Rapporter (resultat, balanse) aggregerer fra `voucher_line`. UI er uendret — brukeren forholder seg fortsatt til bank-transaksjoner og velger én konto/eier.

**Dette gjenstår før full SAF-T-beredskap:**
- SAF-T XML-eksport (selve filgenereringen til Skatteetaten — se punkt 4)
- Splitt-bilag (én bank-transaksjon fordelt på flere kontoer)
- Manuelle bilag (årsavslutning, omposteringer uten bank-bevegelse)
- Periode-låsing (forhindre endringer i avsluttede regnskapsår)

**Implementert struktur:**

```
voucher
├── id, organizationId, voucherNumber (per fiscalYear), fiscalYear
├── date, description, source ('BANK_AUTO' | 'OPENING' | 'MANUAL')
└── voucher_line[]
    ├── ledgerAccountId
    ├── debitOre, creditOre  (ett av dem > 0 per linje)
    └── ownerId (valgfri, for innbetalings-/refusjonslinjer mot 3600)

bank_transaction
└── voucherId  (1:1-kobling til auto-generert bilag)
```

**Invariants** (håndheves i `src/lib/server/voucher.ts`):
- `SUM(debitOre) === SUM(creditOre)` per voucher (balanseligningen)
- BANK_AUTO-bilag har nøyaktig 2 linjer der én side er bankkonto (1920)
- `voucherNumber` er fortløpende per (organizationId, fiscalYear)

---

## 2. Lån som enkeltfelt

**Problem:** `opening_balance.loan_ore` er ett felt som representerer all langsiktig gjeld. Mange sameier har IN-lån (individuell nedbetaling av fellesgjeld) i tillegg til ordinær fellesgjeld. Noen har to separate lån.

**Konsekvens:** Kan ikke skille mellom ulike lån, vise lånets utvikling per periode, eller støtte sameier med IN-lån-ordning.

**Fremtidig løsning:** En separat `loan`-tabell:

```
loan
├── id, organizationId
├── name (e.g. "Fellesgjeld", "IN-lån")
├── lenderName
└── loan_balance (per year, via loan_balance-tabell)
```

---

## 3. Sameiebrøk-semantikk er udokumentert

**Problem:** Både `flat`-tabellen og `flat_ownership`-tabellen har `share_numerator`/`share_denominator`. Det er uklart hvilken semantikk de to brøkene representerer.

**Antatt semantikk:**
- `flat.shareNumerator/Denominator` = seksjonens andel av hele sameiet (sameiebrøk, fra tinglyst seksjoneringsbegjæring)
- `flat_ownership.shareNumerator/Denominator` = eierens andel av denne seksjonen (f.eks. 50/50 ved to sameiere)

**Risiko:** Hvis semantikken er feil eller blandes, vil fordeling av fellesutgifter og balanserapporter gi gale tall. Brøkene brukes ikke aktivt i nåværende rapporter (som bruker husleie per eier direkte), men vil bli kritiske ved andelsbasert kostnadsfordeling.

**Tiltak:** Dokumenter semantikken i koden (kommentar på schema-tabellene) og valider mot Matrikkel-data.

---

## 4. Fremtidige mangler (prioritert rekkefølge)

| Feature | Beskrivelse | Kritikalitet |
|---|---|---|
| SAF-T-eksport | XML-eksport for Skatteetaten (datamodellen er klar; gjenstår filgenerering) | Lovpålagt |
| Splitt-bilag | Fordel én bank-transaksjon på flere kontoer (eks. felles faktura) | Middels |
| Manuelle bilag | Posteringer uten bank-bevegelse (årsavslutning, omposteringer) | Middels |
| Periode-låsing | Lås bilag i avsluttede regnskapsår | Middels |
| Budsjett | Budsjettering per kontogruppe og år | Høy (kassererarbeidsflyt) |
| Faktura til eier | Formelt husleievarsel (EHF/PDF) | Høy |
| Ekstra lån | Se punkt 2 | Middels |
| Andelsbasert kostnadsfordeling | Fordel utgifter etter sameiebrøk, ikke fast husleie | Middels |
| Årsavslutningsveiviser | Guided workflow for lukking av regnskapsår | Middels |
