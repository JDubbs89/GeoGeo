# Welcome to GeoGeoGeo!

GeoGeoGeo is a small web game developed using NASA's global emissions data for the NASA Space Apps Hackathon 2026. It combines sound with geographical visualizations in a GeoGuessr-inspired experience: listen to a programmatically generated tone, explore the pollutant data, and guess the hidden target location on the map.

**[Play GeoGeoGeo](https://jdubbs89.github.io/GeoGeo/)** · **[Explore the data](https://jdubbs89.github.io/GeoGeo/explore.html)**

## How to play

1. Select **Play** from the main menu.
2. Press **▶** on the map to hear the goal sound.
3. Adjust the CO₂, CH₄, and NO₂ sliders, then use the sidebar's **▶** button to compare your sound with the goal. The map layers update as you adjust the sliders.
4. Click the map to place your guess. Drag the pin to refine its location.
5. Select **GeoGeoGeo!** to submit your guess and reveal the target.
6. Select **Play Again** for another round.

Each round awards up to **1,000 points**: 500 for matching the target sliders and 500 for guessing the location. Sounds play for three seconds; the goal sound has a ten-second cooldown measured from the start of playback.

## Run locally

You need Git, Python 3 (the deployment workflow uses Python 3.12), a browser with JavaScript and audio enabled, and an internet connection for map tiles and browser libraries.

```sh
git clone https://github.com/JDubbs89/GeoGeo.git
cd GeoGeo
python3 scripts/build_pages.py
python3 -m http.server 8000 --directory _site
```

Open [localhost:8000](http://localhost:8000) to play, or [localhost:8000/explore.html](http://localhost:8000/explore.html) to explore the data. Stop the server with `Ctrl+C`.

On systems where Python is named `python`, use that command instead of `python3`.

The build uses the included `data/points.json` snapshot. You do not need to install Python packages, run `npm install`, configure NASA credentials, or start the API server for this preview. Rebuild after changing source files to update `_site/`.

## Explore the data and sound

The included measurements cover three pollutants, labeled as 2016 data in the explorer:

| Pollutant | Measurement | Units | Map color |
| --- | --- | --- | --- |
| Carbon dioxide (CO₂) | Concentration | ppm | Green |
| Methane (CH₄) | Emissions | Mg yr⁻¹ km⁻² | Orange |
| Nitrogen dioxide (NO₂) | Concentration | ppbv | Purple |

Each slider selects a band within ±20 percentile points of its value for that pollutant. Methane percentiles rank positive emissions separately; zero-emission locations appear when the selected band includes zero. Darker map shades indicate higher readings.

The sound translates pollutant percentiles into changes in timbre, harmonics, noise, and tremolo. Each round chooses random target slider values and a random location shared by the three matching pollutant bands. Your task is to match the sound and identify a plausible location from the geographical clues.

## Acknowledgments

Built for the NASA Space Apps Hackathon 2026 using NASA global emissions and atmospheric measurements, with maps from OpenStreetMap and sound generated through Tone.js.
