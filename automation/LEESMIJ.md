# Signaal beheren

Signaal is de blog op flowstateconsultancy.nl/blog/. Elke drie dagen schrijft een geplande Claude-agent een nieuw artikel en zet het zonder tussenkomst online. Dit bestand is voor jou als eigenaar: wat er gebeurt, wat je eenmalig instelt, hoe je de routine stillegt en hoe je een artikel offline haalt.

## Wat er elke drie dagen gebeurt

1. De routine start en volgt `automation/ROUTINE.md`.
2. Eerst draait `node automation/preflight.mjs`. Die controleert of alles klaarstaat: de tools, de laatste deploy, of het nieuwste artikel echt online staat, en of er nog een blogbranch op je wacht. Klopt er iets niet, dan schrijft de routine niets en stopt.
3. De SEO-strateeg zoekt een actueel onderwerp met betrouwbare bronnen. De schrijver maakt het artikel, de strateeg leest het na.
4. `npm run build` en `npm run check` controleren het artikel: lengte, bronnen, links, trefwoorden, schrijfregels en de technische SEO.
5. De routine pusht naar `main`. Mag dat niet in haar omgeving, dan pusht ze een branch `claude/blog-<slug>`. De workflow "Publish blog branch" controleert die branch en zet hem op `main`.
6. De workflow "Deploy site" bouwt de site, zet hem op GitHub Pages en meldt de nieuwe pagina's bij IndexNow (Bing en andere zoekmachines). Google vindt ze via de sitemap.

Gaat er op GitHub iets mis, dan opent een workflow een issue in je repository. GitHub mailt je daarover.

## Eenmalig instellen

* GitHub, Settings > Pages: zet Source op "GitHub Actions" en vul je domein in bij Custom domain. Zet "Enforce HTTPS" aan zodra dat kan.
* GitHub, Settings > Rules (of Branches): bescherm `main` tegen force pushes en tegen verwijderen. Zet er geen regel op die een pull request verplicht maakt, want dan kunnen de routine en de workflow niet publiceren.
* GitHub, Settings > Actions > General: laat Actions toe voor deze repository. De workflows vragen zelf de rechten die ze nodig hebben.
* De routine in Claude Code: koppel deze repository en laat de routine elke drie dagen draaien met als opdracht `Volg automation/ROUTINE.md`. Geef de omgeving volledige netwerktoegang, of minstens toegang tot registry.npmjs.org, github.com, api.github.com, je eigen domein en het open web voor het bronnenonderzoek. Sta pushen naar `main` toe als die optie er is. Zonder die optie werkt het ook, via de blogbranch.

## De routine stilleggen

Er zijn twee manieren.

* Snel, ook vanaf je telefoon: maak op GitHub het bestand `automation/PAUZE` aan op `main` (Add file > Create new file). Zet er gerust een regel in waarom. De routine leest dat bij de start, stopt en verandert niets. Verwijder het bestand om weer te starten.
* Helemaal: zet de geplande routine uit of verwijder hem in Claude Code, bij je routines.

## Een artikel offline halen

Elk artikel staat in een eigen map: `content/blog/<slug>/` met `meta.json` en `post.md`.

1. Zoek eerst of andere artikelen ernaar linken: `grep -rl "/blog/<slug>.html" content/blog`. Haal die links weg, anders faalt de controle op een kapotte link.
2. Verwijder de map en de gebouwde pagina, bouw opnieuw en push:

   ```
   git rm -r content/blog/<slug> site/blog/<slug>.html
   npm run build
   npm run check
   git add -A site
   git commit -m "Blog: <slug> offline"
   git push origin main
   ```

3. Na de deploy geeft het adres een 404. Het artikel verdwijnt ook uit het overzicht, de RSS-feed, de sitemap en de homepage. Wil je dat Google het sneller vergeet, vraag het dan aan bij Google Search Console, onder Verwijderingen.

Een artikel aanpassen kan ook: wijzig `post.md` of `meta.json`, zet `updated` op de datum van vandaag en push. De routine raakt bestaande artikelen nooit aan.

## Als je een issue krijgt

* "Deploy mislukt: de website is niet bijgewerkt": open de link in het issue en kijk welke stap faalde. Los het op en push naar `main`. Het issue sluit vanzelf zodra een deploy weer lukt. Zolang de deploy faalt, publiceert de routine niets.
* "Blogartikel niet gepubliceerd: claude/blog-...": de routine pushte een branch die niet automatisch op `main` kon. De link in het issue zegt waarom. Is de branch in orde, voeg hem dan samen met `main`. Klopt er iets niet, verwijder de branch. Zolang hij bestaat, publiceert de routine niets.

Stopt de routine zonder issue, bijvoorbeeld door de pauzeknop of omdat het nieuwste artikel nog geen twee dagen oud is, dan staat de reden in de samenvatting van die run in Claude Code.

## Zelf controleren

Vanuit de hoofdmap van het project:

```
npm ci
npm test
npm run build
npm run check
npm run serve
```

`npm run serve` toont de site op http://localhost:4321/ zoals GitHub Pages hem serveert. Het logboek van de routine staat in `automation/log.md`, de briefings per artikel in `automation/briefs/`.
