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