# Wijnkelder

Houdt je wijnvoorraad bij en kiest met AI een fles **uit je eigen kelder** bij wat je eet.

## Wat zit erin

- **Voorraad**: flessen toevoegen, +/- per fles, zoeken, verwijderen. Opslag in `data/wines.json`.
- **Vivino import**: Vivino heeft geen openbare API. Vraag je data op via vivino.com > Settings > Privacy > download je data en upload de CSV. Kolomnamen worden automatisch herkend (ook Nederlandse varianten). Zelfde producent + naam + jaar wordt samengevoegd.
- **Google lookup**: zoek een wijn op via de Google Custom Search JSON API, of klik 🔎 bij een fles om beschrijving, link en etiketfoto aan te vullen.
- **AI wijnadvies**: typ je gerecht, Claude kiest 1 fles + 2 alternatieven uit wat je op voorraad hebt, met uitleg. Met "Deze trek ik open" gaat er direct een fles van de voorraad af. De server checkt dat de gekozen wijn echt in je kelder staat.

## Starten

Node 22 of nieuwer.

```bash
cd wijnkelder
npm install
cp .env.example .env   # vul je sleutels in
npm start              # http://localhost:3000
```

### Sleutels

| Variabele | Waarvoor | Waar te halen |
|---|---|---|
| `ANTHROPIC_API_KEY` | wijnadvies | console.anthropic.com |
| `GOOGLE_API_KEY` | wijn opzoeken | Google Cloud console, zet "Custom Search API" aan |
| `GOOGLE_CSE_ID` | wijn opzoeken | programmablesearchengine.google.com, maak een zoekmachine aan |

Zonder sleutels werkt de voorraad gewoon, alleen advies en opzoeken staan dan uit.

## Testen

```bash
npm test
```

## Beperkingen

- Draait lokaal zonder login. Zet je het online, bouw dan eerst authenticatie in, anders kan iedereen je kelder aanpassen en je API-tegoed opmaken.
- Vivino sync is eenmalig per import, niet live. Drink je een fles, tik dan op − of gebruik de knop bij het advies.
- Google Custom Search is gratis tot 100 zoekopdrachten per dag.
