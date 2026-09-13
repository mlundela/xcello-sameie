# Lessons

## Migrasjons-scope: spør før du planlegger backfill

**Korreksjon (2026-05-03):** I planen for voucher-strukturen inkluderte jeg en backfill-migrasjon for eksisterende `bank_transaction`-rader. Bruker svarte: "Vi kan se bort fra migrasjon av eksisterende data. I denne fasen av utvikling har vi ingen data vi trenger å ta vare på."

**Regel:** Når dette prosjektet fortsatt er i utviklingsfase, default til å anta at det er trygt å droppe/reseede databasen. Ikke planlegg backfill-skript eller migrasjons-stier med mindre brukeren eksplisitt nevner produksjonsdata. Spør én gang i AskUserQuestion hvis det er uklart, men ikke skriv backfill-kode på spec.

**Hvorfor:** Backfill-kode er dødvekt som blir vedlikeholdsbyrde og forvirrer fremtidige endringer. I tidlig fase: dropp og kjør migrasjonen ren.
