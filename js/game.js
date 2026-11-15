import {queryPoints} from './data.js';
import {map} from './map.js?v=7';
import {Marker, DivIcon, Polyline, CircleMarker, FeatureGroup} from 'leaflet';

// Use the database's spelling; music.js calls these co2 and no2.
const pollutants = ['c02', 'ch4', 'n02'];
const MAX_SLIDER_SCORE = 500;
const MAX_LOCATION_SCORE = 500;
const LOCATION_SCORE_SCALE_KM = 2000;
let currentGoals = null;
let selectedLocation = null;
let guessMarker = null;
let resultReveal = null;
let goalSound = null;
const SOUND_DURATION_MS = 3000;
const GOAL_COOLDOWN_MS = 10000;
let soundPlaying = false;
let goalAvailableAt = 0;
let cooldownTimer = null;
let playbackStartedAt = null;
let playbackTimer = null;
let playingGoal = false;

// Generate whole-number percentile targets between 0 and 100.
async function generateSliderGoal() {
    return Object.fromEntries(pollutants.map(id => [id, Math.floor(Math.random() * 101)]));
}

// The API filters pollutants independently. Pick a point shared by all three bands.
async function generateGameGoals() {
    for (let attempt = 0; attempt < 10; attempt++) {
        const goalSliders = await generateSliderGoal();
        const result = await queryPoints(pollutants.map(id => goalSliders[id]).join(','));
        
        if (!result.total) throw new Error('Import the pollutant data before playing.');
        
        const key = point => `${point.lat},${point.lon}`;
        const ch4Locations = new Set(result.layers.ch4.map(key));
        const n02Locations = new Set(result.layers.n02.map(key));
        
        const matches = result.layers.c02.filter(point =>
            ch4Locations.has(key(point)) && n02Locations.has(key(point)));
        if (matches.length) {
            const point = matches[Math.floor(Math.random() * matches.length)];
            return {goalSliders, goalLocation: {lat: point.lat, lon: point.lon}};
        }
    }
    throw new Error('No shared location found. Start a new round to try again.');
}

// Score the average absolute error: exact sliders earn 500, maximum error earns 0.
function scoreSliders(userSliders, goalSliders) {
    const errors = {};
    for (const id of pollutants) {
        const valid = value => Number.isFinite(value) && value >= 0 && value <= 100;
        if (!valid(userSliders?.[id]) || !valid(goalSliders?.[id])) {
            throw new Error('Each slider must be between 0 and 100.');
        }
        errors[id] = Math.abs(userSliders[id] - goalSliders[id]);
    }
    const averageError = pollutants.reduce((sum, id) => sum + errors[id], 0) / pollutants.length;
    return {score: Math.round(MAX_SLIDER_SCORE * (1 - averageError / 100)), errors};
}

// Great-circle distance works across the date line and near the poles.
function scoreLocation(userLocation, goalLocation) {
    const valid = point => point && Number.isFinite(point.lat) && Number.isFinite(point.lon) &&
        Math.abs(point.lat) <= 90 && Math.abs(point.lon) <= 180;
    if (!valid(userLocation) || !valid(goalLocation)) {
        throw new Error('Choose a valid location on the map.');
    }
    const radians = degrees => degrees * Math.PI / 180;
    const a = Math.sin(radians(goalLocation.lat - userLocation.lat) / 2) ** 2 +
        Math.cos(radians(userLocation.lat)) * Math.cos(radians(goalLocation.lat)) *
        Math.sin(radians(goalLocation.lon - userLocation.lon) / 2) ** 2;
    const distanceKm = 6371 * 2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, a))));
    // Smooth falloff: 500 at the target, about 184 at 2,000 km, then gradually less.
    const score = Math.round(MAX_LOCATION_SCORE * Math.exp(-distanceKm / LOCATION_SCORE_SCALE_KM));
    return {score, distanceKm};
}

// Generate the round on arrival or replay. Audio waits for a button click.
async function startGame() {
    currentGoals = null;
    selectedLocation = null;
    
    if (guessMarker) map.removeLayer(guessMarker);
    if (resultReveal) map.removeLayer(resultReveal);
    
    guessMarker = null;
    resultReveal = null;
    goalSound?.stop();
    goalSound = null;
    clearInterval(cooldownTimer);
    cooldownTimer = null;
    goalAvailableAt = 0;
    progress.value = 0;
    const results = document.getElementById('game-results');
    results.hidden = true;
    for (const value of results.querySelectorAll('[data-result-value]')) value.textContent = '';
    
    for (const id of pollutants) {
        const slider = document.getElementById(`${id}-threshold`);
        slider.value = 50;
        slider.dispatchEvent(new Event('input', {bubbles: true}));
    }
    
    const goals = await generateGameGoals();
    
    currentGoals = goals;
    return goals;
}

// Default to this round's goals, but allow explicit goals for standalone checks.
async function submitGuess(userSliders, userLocation,
    goalSliders = currentGoals?.goalSliders, goalLocation = currentGoals?.goalLocation) {
    
    if (!goalSliders || !goalLocation) throw new Error('Start a game first.');
    
    if (!userLocation) throw new Error('Click the map to choose a location first.');
    
    const results = await showGameResults(userSliders, userLocation, goalSliders, goalLocation);
    revealAnswer(userLocation, goalSliders, goalLocation);
    goalSound?.stop();
    goalSound = null;
    currentGoals = null;
    clearInterval(cooldownTimer);
    cooldownTimer = null;
    updateSoundButtons();
    
    return results;
}

// Reveal only after scoring, so moving the sliders does not change the result.
function revealAnswer(userLocation, goalSliders, goalLocation) {
    const guess = guessMarker?.getLatLng() ?? {lat: userLocation.lat, lng: userLocation.lon};
    // Show the target in the nearest world copy, including across the date line.
    const target = [goalLocation.lat,
        goalLocation.lon + 360 * Math.round((guess.lng - goalLocation.lon) / 360)];
    const line = new Polyline([guess, target], {
        color: '#18351c', weight: 3, dashArray: '8 6', interactive: false,
        className: 'guess-result-line',
    });
    const targetMarker = new CircleMarker(target, {
        radius: 9, color: '#18351c', fillColor: '#ffcc33', fillOpacity: 1,
        interactive: false, className: 'goal-location-marker',
    }).bindTooltip('Target', {permanent: true, direction: 'top'});
    resultReveal = new FeatureGroup([line, targetMarker]).addTo(map);
    guessMarker?.dragging.disable();
    map.fitBounds(resultReveal.getBounds(), {padding: [40, 40], maxZoom: 5});

    for (const id of pollutants) {
        const slider = document.getElementById(`${id}-threshold`);
        slider.value = goalSliders[id];
        // Refresh the pollutant layers and readings using the revealed values.
        slider.dispatchEvent(new Event('input', {bubbles: true}));
    }
}

// Score the original guess before revealAnswer moves the sliders to their targets.
async function showGameResults(userSliders, userLocation, goalSliders, goalLocation) {
    const sliders = scoreSliders(userSliders, goalSliders);
    const location = scoreLocation(userLocation, goalLocation);
    const totalScore = sliders.score + location.score;
    // Each value has its own HTML element so the sidebar can style them independently.
    const values = {
        'result-total-score': totalScore.toLocaleString(),
        'result-total-max': (MAX_SLIDER_SCORE + MAX_LOCATION_SCORE).toLocaleString(),
        'result-slider-score': sliders.score,
        'result-slider-max': MAX_SLIDER_SCORE,
        'result-location-score': location.score,
        'result-location-max': MAX_LOCATION_SCORE,
        'result-distance': location.distanceKm.toLocaleString(undefined, {maximumFractionDigits: 1}),
        'result-latitude': goalLocation.lat.toFixed(2),
        'result-longitude': goalLocation.lon.toFixed(2),
    };
    for (const id of pollutants) {
        values[`result-${id}-guess`] = userSliders[id];
        values[`result-${id}-target`] = goalSliders[id];
        values[`result-${id}-error`] = sliders.errors[id];
    }
    for (const [id, value] of Object.entries(values)) {
        document.getElementById(id).textContent = value;
    }
    document.getElementById('game-results').hidden = false;

    return {totalScore, sliderScore: sliders.score, locationScore: location.score,
        sliderErrors: sliders.errors, distanceKm: location.distanceKm};
}

// Map clicks and pin drags both update the location used by Submit.
function selectLocation(latlng) {
    if (!currentGoals) return;
    // Normalize longitude when the map is panned into a repeated world copy.
    selectedLocation = {lat: latlng.lat, lon: ((latlng.lng + 180) % 360 + 360) % 360 - 180};
    if (guessMarker) guessMarker.setLatLng(latlng);
    else {
        guessMarker = new Marker(latlng, {
            draggable: true,
            autoPan: true,
            title: 'Drag to move your guess',
            alt: 'Your location guess',
            icon: new DivIcon({
                className: 'guess-pin',
                html: '<span class="guess-pin-head"></span>',
                iconSize: [30, 42],
                iconAnchor: [15, 42],
            }),
        }).addTo(map);
        guessMarker.on('dragend', () => selectLocation(guessMarker.getLatLng()));
    }
    document.getElementById('game-status').textContent =
        `Selected: ${selectedLocation.lat.toFixed(2)}, ${selectedLocation.lon.toFixed(2)}. Drag the pin to adjust, or submit your guess.`;
}

map.on('click', event => selectLocation(event.latlng));

const startButton = document.getElementById('start-game');
const submitButton = document.getElementById('submit-guess');
const status = document.getElementById('game-status');
const goalButton = document.getElementById('playGoalButton');
const sliderButton = document.getElementById('play_button');
const progress = document.getElementById('playProgress');
const audioStatus = document.getElementById('audio-status');

// Show the cooldown, and prevent overlapping goal and slider sounds.
function updateSoundButtons() {
    const remaining = Math.max(0, goalAvailableAt - Date.now());
    goalButton.disabled = !currentGoals || soundPlaying || remaining > 0;
    sliderButton.disabled = !currentGoals || soundPlaying;
    goalButton.textContent = remaining > 0 ? `${Math.ceil(remaining / 1000)}s` : '▶';
    const goalLabel = remaining > 0 ? `Goal sound available in ${Math.ceil(remaining / 1000)} seconds` : 'Play goal sound';
    goalButton.setAttribute('aria-label', goalLabel);
    goalButton.title = goalLabel;
    const audioRemaining = playbackStartedAt === null ? 0 :
        Math.max(0, SOUND_DURATION_MS - (Date.now() - playbackStartedAt));
    sliderButton.textContent = soundPlaying && !playingGoal && audioRemaining > 0 ?
        `${Math.ceil(audioRemaining / 1000)}s` : '▶';
    if (remaining === 0) {
        clearInterval(cooldownTimer);
        cooldownTimer = null;
    }
}

// The bar measures audio playback, independently of the goal cooldown.
function updateAudioProgress() {
    progress.value = Math.min(SOUND_DURATION_MS, Date.now() - playbackStartedAt);
    updateSoundButtons();
}

// Both buttons play a three-second sample. Only the goal has a cooldown,
// measured from when its audio starts (so playback counts toward the 10 seconds).
async function playRoundSound(isGoal) {
    if (!currentGoals || soundPlaying || (isGoal && Date.now() < goalAvailableAt)) return;
    soundPlaying = true;
    playingGoal = isGoal;
    progress.value = 0;
    startButton.disabled = true;
    submitButton.disabled = true;
    audioStatus.hidden = true;
    updateSoundButtons();
    try {
        const data = isGoal ? {
            co2: currentGoals.goalSliders.c02,
            ch4: currentGoals.goalSliders.ch4,
            no2: currentGoals.goalSliders.n02,
        } : window.readSliderData();
        // playAirSound unlocks browser audio here, in response to this click.
        goalSound = await window.playAirSound(data);
        playbackStartedAt = Date.now();
        playbackTimer = setInterval(updateAudioProgress, 50);
        if (isGoal) {
            goalAvailableAt = Date.now() + GOAL_COOLDOWN_MS;
            cooldownTimer = setInterval(updateSoundButtons, 250);
            updateSoundButtons();
        }
        await new Promise(resolve => setTimeout(resolve, SOUND_DURATION_MS));
        progress.value = SOUND_DURATION_MS;
    } catch (error) {
        audioStatus.textContent = `Unable to play sound: ${error.message}. Please try again.`;
        audioStatus.hidden = false;
    } finally {
        goalSound?.stop();
        goalSound = null;
        clearInterval(playbackTimer);
        playbackTimer = null;
        playbackStartedAt = null;
        soundPlaying = false;
        startButton.disabled = false;
        submitButton.disabled = !currentGoals;
        updateSoundButtons();
    }
}

async function beginRound() {
    startButton.disabled = true;
    submitButton.disabled = true;
    goalButton.disabled = true;
    sliderButton.disabled = true;
    audioStatus.hidden = true;
    status.textContent = 'Loading a new round…';
    try {
        await startGame();
        startButton.textContent = 'Replay';
        submitButton.disabled = false;
        status.textContent = 'Press ▶ above the map to hear the goal. Adjust the sliders and place your pin.';
    } catch (error) {
        status.textContent = error.message;
    } finally {
        startButton.disabled = false;
        updateSoundButtons();
    }
}

startButton.addEventListener('click', beginRound);
goalButton.addEventListener('click', () => playRoundSound(true));
sliderButton.addEventListener('click', () => playRoundSound(false));

submitButton.addEventListener('click', async () => {
    submitButton.disabled = true;
    try {
        const userSliders = Object.fromEntries(pollutants.map(id =>
            [id, Number(document.getElementById(`${id}-threshold`).value)]));
        await submitGuess(userSliders, selectedLocation);
        status.textContent = 'Round finished.';
    } catch (error) {
        status.textContent = error.message;
        submitButton.disabled = !currentGoals;
    }
});

// Stop audio if the player leaves the game, including when entering the back cache.
window.addEventListener('pagehide', () => {
    goalSound?.stop();
    goalSound = null;
});

beginRound();
