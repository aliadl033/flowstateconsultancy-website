# De website van Flow State Consultancy

De site staat live op https://flowstateconsultancy.nl. Het is een statische site: gewone HTML, CSS en JavaScript in de map `site`, zonder database. GitHub Pages host hem gratis vanuit de repository `aliadl033/flowstateconsultancy-website`.

## Wat er in zit

* `index.html`: homepage met het 3D-signaal dat van ruis naar een zuivere golf gaat terwijl je scrolt
* `diensten.html`: de vier diensten en de trainingsmodules, filterbaar per kanaal
* `over-ons.html`: het verhaal achter de naam, met het flowkanaal
* `contact.html`: contactformulier, veelgestelde vragen en bedrijfsgegevens
* `blog/`: Signaal, de blog met praktische artikelen over verkopen, coachen en telecom
* `privacy.html`: privacyverklaring
* `404.html`: pagina voor links die niet bestaan
* `assets/`: stijlen, scripts, lettertypen en afbeeldingen

Alles staat op je eigen domein: lettertypen, scripts en afbeeldingen. De site plaatst geen cookies en laadt niets van Google of andere partijen. Daardoor heb je ook geen cookiebanner nodig.

## Hoe publiceren werkt

Elke wijziging die op de branch `main` binnenkomt, gaat vanzelf online. Een GitHub Action bouwt de blog, controleert alle pagina's en zet de map `site` op GitHub Pages. Daarna meldt hij de gewijzigde pagina's bij IndexNow, zodat Bing en andere zoekmachines ze snel oppikken. Je ziet elke publicatie terug onder het tabblad Actions van de repository.

Het domein staat bij GoDaddy. Daar wijzen vier A-records naar GitHub Pages (185.199.108.153 tot en met 185.199.111.153) en een CNAME-record voor `www` naar `aliadl033.github.io`. Je e-mailrecords (MX, SPF en DKIM voor Google) zijn niet aangeraakt.

## De blog en de automatische schrijver

Elke drie dagen schrijft een geplande Claude-agent in de cloud een nieuw artikel. Hij werkt in twee rollen. De SEO-strateeg zoekt een actueel onderwerp met zoekvolume, en de schrijver maakt er een artikel van met bronnen. Daarna controleert de strateeg het stuk, draait de build met alle checks en publiceert het. Twijfelt hij over feiten, dan kiest hij een veiliger onderwerp of publiceert hij niets en schrijft hij in het logboek waarom.

* De instructies staan in `automation/ROUTINE.md`, de rollen in `.claude/agents/`.
* Elk artikel krijgt een regel in `automation/log.md`.
* Pauzeren kan snel door op GitHub een bestand `automation/PAUZE` aan te maken. Aanpassen of uitzetten doe je op https://claude.ai/code/routines.
* Alles over beheer, ook hoe je een artikel offline haalt, staat in `automation/LEESMIJ.md`.

Zelf een artikel schrijven kan ook. Maak een map `content/blog/<slug>/` met `meta.json` en `post.md` (zie `docs/BLOG-SPEC.md`), draai `npm run build` en `npm run check` en push naar `main`.

## Bedrijfsgegevens

De site toont Flowstate Consultancy B.V., KvK 98730185, Bredesteeg 6, 3811 WS Amersfoort en ali@flowstateconsultancy.nl. Het merk op de site is Flow State Consultancy.

Het btw-identificatienummer ontbreekt nog. Zodra je het hebt, zet je het met één script op elke pagina, in de bedrijfsgegevens op de contactpagina en in de gestructureerde gegevens voor Google:

```bash
node dev/set-btw.mjs NL123456789B01
node dev/seo-heads.mjs
npm run build
npm run check
```

Commit en push daarna naar `main`.

## Bekijken op je eigen computer

```bash
npm install
npm run build
python3 -m http.server 4321 --directory site
```

Ga daarna naar http://localhost:4321. Dubbelklikken op `index.html` werkt niet goed, omdat browsers scripts dan blokkeren.

## Het contactformulier

Het formulier verstuurt zelf niets. Na een klik op verzenden opent het mailprogramma van de bezoeker, met het bericht al ingevuld en gericht aan ali@flowstateconsultancy.nl. Zo heb je geen server of formulierdienst nodig.

## Mappen buiten `site`

* `content/blog`: de artikelen als tekst, waaruit de blogpagina's worden gebouwd
* `tools`: het bouwscript, de controles en de sjablonen van de blog
* `automation`: instructies en logboek van de blogagent
* `docs`: de briefing, alle teksten en de iconen
* `dev`: testscripts die tijdens het bouwen zijn gebruikt; die gaan niet online
