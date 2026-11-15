let synth;

const notes = {
    0: 'C4',
    10: 'D4',
    20: 'E4',
    30: 'F4',
    40: 'G4',
    50: 'A4',
    60: 'B4',
    70: 'C5',
    80: 'D5',
    90: 'E5',
    100: 'F5',
};

async function findNote(value) {
    switch (true) {
        case value > 90:
            return notes[10];
        case value > 80:
            return notes[20];
        case value > 70:
            return notes[30];
        case value > 60:
            return notes[40];
        case value > 50:
            return notes[50];
        case value > 40:
            return notes[60];
        case value > 30:
            return notes[70];
        case value > 20:
            return notes[80];
        case value > 10:
            return notes[90];
        default:
            return notes[100];
    }
}

async function playSound(note = 'C4', duration = '8n') {
    await Tone.start();
    synth ??= new Tone.Synth().toDestination();
    synth.triggerAttackRelease(note, duration);
}

async function playSlider(value) {
    var note = await findNote(value);
    console.log(`Playing note: ${note} for value: ${value}`);
    await playSound(note, '8n');
}

let activeAirSound;

function normalize(data) {
  return Object.fromEntries(
    Object.entries(data).map(([g, v]) => {
      // The map controls provide percentiles, not pollutant concentrations.
      return [g, Math.max(0, Math.min(1, v / 100))];
    })
  );
}

function readSliderData() {
    return {
        ch4: Number(document.getElementById('ch4-threshold').value),
        co2: Number(document.getElementById('c02-threshold').value),
        no2: Number(document.getElementById('n02-threshold').value),
    };
}

async function gatherDataAndPlaySound() {
    const button = document.getElementById('play_button');
    const status = document.getElementById('audio-status');
    if (button.disabled) return;

    button.disabled = true;
    status.hidden = true;
    try {
        if (activeAirSound) {
            activeAirSound.stop();
            activeAirSound = undefined;
        } else {
            activeAirSound = await playAirSound(readSliderData());
            activeAirSound.update(readSliderData());
        }
    } catch (error) {
        console.error('Unable to play air-quality sound:', error);
        status.textContent = 'Unable to start audio. Please try Play again.';
        status.hidden = false;
    } finally {
        button.textContent = activeAirSound ? 'Stop' : 'Play';
        button.disabled = false;
    }
}

for (const id of ['c02-threshold', 'ch4-threshold', 'n02-threshold']) {
    document.getElementById(id).addEventListener('input', () => {
        activeAirSound?.update(readSliderData());
    });
}

/**
 * Creates and starts an air-quality sound.
 * @param {object} data - { ch4, co2, no2 } percentiles from 0 to 100
 * @returns {{ stop: () => void, update: (newData) => void }}
 */
async function playAirSound(data) {
  await Tone.start();
  const norm = normalize(data);
  const BASE = 220;
  const FACTOR = 2;

  // --- Build graph ---
  const sineOsc  = new Tone.Oscillator(BASE, "sine");
  const doubleOsc = new Tone.Oscillator(BASE * FACTOR, "sawtooth");
  const doubleGain = new Tone.Gain(0);
  const sawOsc   = new Tone.Oscillator(BASE, "sawtooth");
  const crossfade = new Tone.CrossFade(0);
  
  //const wobbleOsc  = new Tone.Oscillator(BASE, "sine");
  //const wobbleGain = new Tone.Gain(0);

  const noise       = new Tone.Noise("white");
  const noiseFilter = new Tone.Filter(800, "lowpass");
  const noiseGain   = new Tone.Gain(0);
  
  const overall = (norm.ch4 + norm.co2 + norm.no2) / 3;
  const tremolo = new Tone.Tremolo({
      frequency: 1 + overall * 3,
      depth: 0.15 + overall * 0.2,
    });
    
    // Wire: oscillators → crossfade → tremolo → out; noise → filter → gain → out
    sineOsc.connect(crossfade.a);
    sawOsc.connect(crossfade.b);
    crossfade.connect(tremolo);
    doubleOsc.connect(doubleGain);
    doubleGain.toDestination();
    tremolo.toDestination();
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.toDestination();
    
  // Set initial values
  crossfade.fade.value = norm.ch4;
  doubleGain.gain.value = norm.co2 * 0.5;
  noiseFilter.frequency.value = 200 + norm.no2 * 4000;
  noiseGain.gain.value = norm.no2 * 0.3;

  // Start
  sineOsc.start();
  sawOsc.start();
  doubleOsc.start();
  noise.start();
  tremolo.start();

  // --- Return handle ---
  return {
    update(newData) {
      const n = normalize(newData);
      const o = (n.ch4 + n.co2 + n.no2) / 3;
      crossfade.fade.rampTo(n.ch4, 0.5);
      doubleGain.gain.rampTo(n.co2 * 0.5, 0.5);
      noiseFilter.frequency.rampTo(200 + n.no2 * 4000, 0.5);
      noiseGain.gain.rampTo(n.no2 * 0.3, 0.5);
      tremolo.frequency.rampTo(1 + o * 3, 0.5);
      tremolo.depth.rampTo(0.15 + o * 0.2, 0.5);
    },

    stop() {
      [sineOsc, sawOsc, doubleOsc, noise, tremolo].forEach(n => n.stop());
      [sineOsc, sawOsc, doubleOsc, noise, crossfade, doubleOsc,
       noiseFilter, noiseGain, tremolo].forEach(n => n.dispose());
    },
  };
}
