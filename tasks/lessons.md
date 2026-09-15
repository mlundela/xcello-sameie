# Lessons

## Migrasjons-scope: spør før du planlegger backfill

**Korreksjon (2026-05-03):** I planen for voucher-strukturen inkluderte jeg en backfill-migrasjon for eksisterende `bank_transaction`-rader. Bruker svarte: "Vi kan se bort fra migrasjon av eksisterende data. I denne fasen av utvikling har vi ingen data vi trenger å ta vare på."

**Regel:** Når dette prosjektet fortsatt er i utviklingsfase, default til å anta at det er trygt å droppe/reseede databasen. Ikke planlegg backfill-skript eller migrasjons-stier med mindre brukeren eksplisitt nevner produksjonsdata. Spør én gang i AskUserQuestion hvis det er uklart, men ikke skriv backfill-kode på spec.

**Hvorfor:** Backfill-kode er dødvekt som blir vedlikeholdsbyrde og forvirrer fremtidige endringer. I tidlig fase: dropp og kjør migrasjonen ren.

## Visuell konsekvens: sammenlign sidene mot hverandre, ikke bare klassene

**Korreksjon (2026-09-14):** Etter at jeg hadde innført en avstandsskala og verifisert med grep og skjermbilder, sa brukeren: "Spacingen på matchingsregler og kontoplan sidene er fortsatt ulikt resten". Klassene fulgte skalaen, men sidene så likevel annerledes ut: tabellrader med knapper (`btn-sm`) ble høyere enn tekstrader, skjemaene brukte plassholdere i stedet for synlige etiketter, og kontoplan hadde en løs knapperad under tittelen.

**Regel:** Når jeg verifiserer visuell konsekvens, legger jeg skjermbilder av sammenlignbare sider ved siden av hverandre og sjekker radhøyder, skjemamønster (etikett over felt) og hvor handlinger står. Grep etter tillatte klasser beviser bare at reglene er fulgt, ikke at resultatet ser likt ut.

**Hvorfor:** Komponenter som `btn-sm` og `select-sm` i tabellceller, eller et skjema uten etiketter, gir ulik rytme selv når hver enkelt klasse er "riktig".
