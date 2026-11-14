# De website van Flow State Consultancy

De complete website staat in de map `site`. Het is een statische site: gewone HTML, CSS en JavaScript, zonder database en zonder bouwstap. Je kunt hem bij elke hostingpartij neerzetten.

## Wat er in zit

* `index.html`: homepage met het 3D-signaal dat van ruis naar een zuivere golf gaat terwijl je scrolt
* `diensten.html`: de vier diensten en de trainingsmodules, filterbaar per kanaal
* `over-ons.html`: het verhaal achter de naam, met het flowkanaal
* `contact.html`: contactformulier, veelgestelde vragen en bedrijfsgegevens
* `privacy.html`: privacyverklaring
* `404.html`: pagina voor links die niet bestaan
* `assets/`: stijlen, scripts, lettertypen en afbeeldingen

Alles staat op je eigen server: lettertypen, scripts en afbeeldingen. De site plaatst geen cookies en praat niet met Google of andere partijen. Daardoor heb je ook geen cookiebanner nodig.

## Nog invullen

Zoek en vervang deze teksten in alle `.html`-bestanden in de map `site`:

| Zoek | Vervang door |
|---|---|
| `[KVK-NUMMER]` | je KvK-nummer |
| `[BTW-ID]` | je btw-identificatienummer (NL...B01) |
| `[STRAAT HUISNUMMER]` | het vestigingsadres |
| `[POSTCODE PLAATS]` | postcode en plaats |
| `info@flowstateconsultancy.nl` | het e-mailadres dat je echt gebruikt |

Een Nederlandse bedrijfswebsite moet naam, adres, e-mailadres, KvK-nummer en btw-id tonen. Die staan in de footer van elke pagina en op de contactpagina.

## Bekijken op je eigen computer

Open een terminal in de map `site` en start een eenvoudige server:

```bash
python3 -m http.server 4321
```

Ga daarna naar http://localhost:4321. Dubbelklikken op `index.html` werkt niet goed, omdat browsers scripts dan blokkeren.

## Online zetten

De makkelijkste route is Netlify Drop: ga naar app.netlify.com/drop en sleep de map `site` erin. Je krijgt meteen een werkend adres en kunt daarna je eigen domein koppelen. Vercel, Cloudflare Pages of een gewone webhost met FTP werken ook: upload de inhoud van `site` naar de hoofdmap van je domein.

Zodra je domein bekend is, maak je de deelafbeelding absoluut. Vervang in elke pagina `content="assets/img/og-image.png"` door `content="https://jouwdomein.nl/assets/img/og-image.png"`. Dan verschijnt de afbeelding ook als je de link deelt op LinkedIn of WhatsApp.

## Het contactformulier

Het formulier verstuurt zelf niets. Na een klik op verzenden opent het mailprogramma van de bezoeker, met het bericht al ingevuld. Zo heb je geen server of formulierdienst nodig. Wil je later dat berichten direct binnenkomen, dan kun je het formulier koppelen aan een dienst als Formspree of Netlify Forms.

## Mappen buiten `site`

* `docs`: de briefing, alle teksten en de iconen. Handig als je later iets wilt aanpassen.
* `dev`: testscripts die tijdens het bouwen zijn gebruikt. Die hoeven niet online.
