# Wildlife Eye

Your own god's-eye view: a 3D globe that is an encyclopedia of wildlife.

## Run

    ./start.sh          # serves on http://localhost:8642 and opens the browser

(Needs an internet connection for maps and live data; it is a plain static site, no build step.)

## Install as an app (PC and phone)

Wildlife Eye is an installable web app (PWA): one codebase for desktop and mobile.

- **PC (Chrome / Edge):** open it and click **⤓ Install app** in the top bar, or the
  install icon in the address bar. It then opens in its own window from the Start menu / app launcher.
- **Android (Chrome):** menu ⋮ → *Install app* / *Add to Home screen*.
- **iPhone / iPad (Safari):** Share → *Add to Home Screen*.

Phones only allow installing from an **https://** address, so to put it on a phone,
host the folder on any static host (GitHub Pages, Netlify, Cloudflare Pages).
`localhost` works for installing on this PC.

On phones the layout switches to bottom tabs (Globe · Species · Article) with the
map layers in a ☰ menu. `sw.js` caches the app and Cesium so it opens offline;
live data (pictures, sightings, cams, studies) still needs a connection. Bump
`VERSION` in `sw.js` if you ever want to force-clear old caches.

## What's in it

- **Encyclopedia** – 118 atlas entries (whales, birds, bees/wasps/hornets, wolves, bears)
  plus search across every animal on Earth (GBIF backbone).
- **Overview** – Wikipedia article, atlas field notes, facts, migration routes, range countries, records, lost populations.
- **Pictures** – Wikimedia Commons gallery + recent research-grade iNaturalist field photos.
- **Map** – range countries, migration routes, GBIF observation-density hexes, latest sightings on the globe.
- **Live video** – atlas live cams (in season / off season), embedded or in a new tab, plus a YouTube "live now" search.
- **Studies** – most-cited and newest papers (OpenAlex, falling back to Europe PMC), with abstracts.
- Top bar: real-time day/night, live worldwide sightings feed, satellite or dark basemap.

## Data

`data/wild.js` is generated from the five atlas pages in your home folder:

    node scripts/build-data.mjs

Re-run it after editing an atlas page. Camera map positions come from
`~/Downloads/gods-eye-view/src/data/local_data/wildlife/`.

Optional: put a free OpenAlex key in `config.js` so the Studies tab isn't affected
when OpenAlex pauses anonymous searches.
