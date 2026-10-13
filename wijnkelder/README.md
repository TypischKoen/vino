# Wijnkelder

Een iPhone-app (webapp) die je wijnvoorraad bijhoudt, met een AI-sommelier (Gemini of Claude) die bij elk gerecht een fles uit **je eigen kelder** kiest.

## Wat kan hij

**Vandaag**
- Typ wat je eet, maak een foto van je bord of plak een recept-link. Claude kiest een fles uit je kelder, geeft een matchscore (1 tot 10), zegt hoe je hem serveert en hoeveel flessen je nodig hebt voor het aantal mensen.
- Wensen erbij: licht en fris, feestelijk, "op = op", verras me.
- Past er niks? Dan krijg je een koop-tip die je op je kooplijst zet.
- "Drink deze binnenkort": flessen waarvan het drinkvenster bijna dicht is.
- Je kelder in cijfers: flessen, waarde, oudste jaargang, verdeling per soort.
- Optioneel: weer-tip op basis van het weer bij jou.

**Toevoegen (rode +)**
- 📸 Foto van een etiket, of van je hele rek in één keer. Claude leest alle flessen.
- ▥ Streepjescode scannen met de camera (opzoeken via Open Food Facts, Claude vult aan).
- ✍️ Typ het gewoon: "6 flessen Cava en een Barolo 2018".
- 📝 Zelf invullen.
- Druif, regio, drinkvenster, smaak, prijsindicatie en "past bij" worden automatisch ingevuld. Jij checkt het even.

**Kelder**
- Zoeken, filteren op soort en drinkstatus (nog bewaren / op dronk / drink snel / over de top), sorteren.
- Per fles: foto, alle info, voorraad +/−, je eigen score, waar hij ligt, notities, wanneer je hem eerder opende.
- "Info opzoeken" zoekt online (Claude web search) naar smaak, drinkvenster en prijs.

**Sommelier**
- Chat die je hele kelder kent. Stuur gerust een foto mee van een wijnkaart of een fles in de winkel.
- Mag online zoeken voor prijzen, recensies en recepten (uit te zetten).

**Meer**
- Logboek van geopende flessen met score.
- Kooplijst.
- Backup (met foto's) naar iCloud Drive of waar je wilt, export naar Excel (CSV), backup terugzetten.

## Koppelingen

| Koppeling | Waarvoor | Sleutel nodig? |
|---|---|---|
| Perplexity (eerste keus als je tegoed hebt) | advies, etiketten, sommelier, zoekt zelf online | ja, API-sleutel met tegoed |
| Google Gemini | advies, etiketten lezen, sommelier, online zoeken | ja, **gratis** via aistudio.google.com |
| OpenRouter (reserve) | neemt automatisch over als Gemini het niet doet | ja, **gratis** via openrouter.ai |
| Claude API (optioneel) | hetzelfde, betaald per gebruik | ja, eigen API-sleutel met tegoed |
| Open Food Facts | streepjescode opzoeken | nee |
| Open-Meteo | weer-tip | nee |
| Safari camera + locatie | scannen, foto's, weer | toestemming |

## Op je iPhone zetten

1. Zet de app online (zie hieronder) en open de link in **Safari**.
2. Deel-knop → **Zet op beginscherm** → **Voeg toe**.
3. Open de app, ga naar **Meer → Instellingen** en vul een gratis sleutel in, liefst allebei:
   - **Gemini**: aistudio.google.com → Get API key → Create API key.
   - **OpenRouter** (reserve): openrouter.ai → Keys → Create Key, en zet bij Settings → Privacy de gratis modellen aan.
   De app kiest zelf een werkend model en schakelt vanzelf over als de ene dienst het niet doet. Gratis AI mag je vragen gebruiken om te trainen.

## Online zetten met GitHub Pages (gratis)

1. Merge deze branch naar `main`.
2. GitHub → repo → **Settings → Pages** → Source: *Deploy from a branch* → `main` en `/ (root)` → Save.
3. Na een minuut staat de app op `https://<gebruikersnaam>.github.io/<repo>/wijnkelder/`.

## Goed om te weten

- Alles (flessen, foto's, logboek) staat **alleen op je telefoon**. Maak af en toe een backup via Meer → Backup.
- De API-sleutel staat ook alleen op je telefoon en gaat direct naar Google of Anthropic. Iedereen die jouw telefoon gebruikt kan hem dus gebruiken.
- Na het toevoegen aan je beginscherm werkt de app ook offline. Alleen advies, scannen en de sommelier hebben internet nodig.

## Voor ontwikkelaars

De app is gewone HTML, CSS en JavaScript zonder build-stap. `vendor/` bevat de Anthropic SDK en een barcode-lezer, gebundeld door `tools/build-vendor.mjs`.

```bash
cd tools && npm install
npm run vendor   # libraries opnieuw bundelen
npm test         # unit tests van js/wine.js
```

Lokaal draaien: `python3 -m http.server` in deze map en open `http://localhost:8000`.
