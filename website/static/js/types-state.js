"use strict";
const globalMemory = [];
let globalMemoryIndex = -1;
const { Renderer, Stave, StaveNote, StaveTie, Dot, Voice: VFVoice, Accidental, Formatter, Tuplet } = Vex.Flow;
// Notes carry their own stave when drawn, so VexFlow decides collisions per staff (see customStaveNoteFormat)
const STAVENOTE_FORMAT_VEXFLOW = StaveNote.format;
const containers = {};
let renderers = {};
let contexts = {};
const staves = ["staff1", "staff2", "staff3", "staff4"];
const output = document.getElementById("output");
const template = document.getElementById("staffTemplate");
const createStaffContainers = (staffNames, activeStaff = "staff1") => {
    staffNames.forEach(name => {
        const clone = template.content.cloneNode(true);
        const settings = clone.querySelector(".staffSettings");
        const container = clone.querySelector(".staffContainer");
        settings.dataset.staff = name;
        container.dataset.name = name;
        container.id = `${name}Container`;
        output.appendChild(clone);
        containers[name] = container;
    });
};
const generatePhraseButton = document.querySelector('.generatePhraseButton');
const separateStaffButton = document.querySelector('.separateStaffButton');
const reverseButton = document.querySelector('.reverseButton');
const reflectButton = document.querySelector('.reflectButton');
const shiftButton = document.querySelector('.shiftButton');
const transposeButton = document.querySelector('.transposeButton');
const shuffleRhythmButton = document.querySelector('.shuffleRhythmButton');
const shuffleNotesButton = document.querySelector('.shuffleNotesButton');
const changeRhythmButton = document.querySelector('.changeRhythmButton');
const shufflePitchButton = document.querySelector('.shufflePitchButton');
const changePitchButton = document.querySelector('.changePitchButton');
const simplifyButton = document.querySelector('.simplifyButton');
const complicateButton = document.querySelector('.complicateButton');
const bpmSlider = document.getElementById("bpmSlider");
const bpmValueDisplay = document.getElementById("bpmValue");
const playButton = document.querySelector('.playButton');
let measureSigs = [{ num: 4, den: 4, groups: [1, 1, 1, 1] }];
let numMeasures = 1;
let currentLayer = 'main';
const VOICE_DEFS = [
    { id: 'up1', stems: 1, label: 'Up 1' },
    { id: 'down1', stems: -1, label: 'Down 1' },
    { id: 'up2', stems: 1, label: 'Up 2' },
    { id: 'down2', stems: -1, label: 'Down 2' },
];
class Voice {
    constructor(staffName, id) {
        this.unprocessedNotes = [];
        this.notes = [];
        this.ties = [];
        this.tuplets = [];
        this.toneNotes = [];
        this.name = staffName;
        this.id = id;
        this.stems = VOICE_DEFS.find(voiceDef => voiceDef.id === id).stems;
    }
}
// Every voice of a staff, Up 1 first
function staffVoices(staff) {
    return [staff, ...staff.extraVoices];
}
function getVoice(staff, id) {
    return id === 'up1' ? staff : (staff.extraVoices.find(voice => voice.id === id) ?? null);
}
function getOrCreateVoice(staff, id) {
    const have = getVoice(staff, id);
    if (have)
        return have;
    const voice = new Voice(staff.name, id);
    staff.extraVoices.push(voice);
    const order = (voice) => VOICE_DEFS.findIndex(voiceDef => voiceDef.id === voice.id);
    staff.extraVoices.sort((first, second) => order(first) - order(second));
    return voice;
}
function resetVoice(store) {
    store.unprocessedNotes = [];
    store.notes = [];
    store.ties = [];
    store.tuplets = [];
    store.toneNotes = [];
}
// A voice with no pitched notes disappears (Up 1 always stays)
function pruneEmptyVoices(staff) {
    staff.extraVoices = staff.extraVoices.filter(voice => voice.unprocessedNotes.some(note => !note.isRest));
}
// Up 1 is always drawn. Another voice is only drawn in the bars where it has a note (as in Dorico).
function voiceShownInBar(voice, measureIndex) {
    if (voice.id === 'up1')
        return true;
    return (voice.notes[measureIndex] || []).some((note) => !note.isRest());
}
class Staff {
    constructor(name, pitchRange = ["E3", "E6"], rhythmRange = [0.03125, 1], scale = ["C", "Chromatic"]) {
        this.id = 'up1'; // a staff is its own Up 1 voice
        this.stems = 1;
        this.extraVoices = []; // Down 1, Up 2, Down 2 (only the ones that have notes, in that order)
        this.name = name;
        this.pitchRange = pitchRange;
        this.rhythmRange = rhythmRange;
        this.scale = scale;
        this.harmonize = false;
        this.unprocessedNotes = [];
        this.notes = [];
        this.ties = [];
        this.tuplets = [];
        this.toneNotes = [];
        this.muted = false;
        this.duration = 0;
        this.requiredWidth = 0;
    }
}
const defaultPitchRanges = {
    staff1: ["C4", "C6"],
    staff2: ["A3", "F5"],
    staff3: ["E2", "C4"],
    staff4: ["D3", "B5"],
};
function resetStaffToDefaults(staff, rhythmRange) {
    staff.pitchRange = [...defaultPitchRanges[staff.name]];
    staff.rhythmRange = [...rhythmRange];
    staff.scale = ["C", "Chromatic"];
    staff.harmonize = false;
    staff.muted = false;
    staff.extraVoices = [];
    resetStaff(staff);
}
class UnprocessedNote {
    constructor(noteName, octave, duration, dotted = false, tiedToNext = false) {
        this.noteName = Array.isArray(noteName) ? noteName : [noteName];
        const fallback = Array.isArray(octave) ? (octave[0] ?? 4) : octave;
        this.octaves = this.noteName.map((ignoredName, index) => Array.isArray(octave) ? (octave[index] ?? fallback) : octave);
        this.duration = duration;
        this.dotted = dotted;
        this.isRest = this.noteName[0] === "Rest";
        this.tupletInfo = null;
        this.tiedToNext = tiedToNext;
    }
    get octave() { return this.octaves[0]; }
    toStaveNote() {
        return createNote(this.noteName, this.octaves, this.dotted ? this.duration + "d" : this.duration);
    }
    setTuplet(id, totalTupletDuration, ratio, count, index) {
        this.tupletInfo = { id, totalTupletDuration, ratio, count, index };
    }
}
const staff1 = new Staff("staff1", ["C4", "C6"]);
const staff2 = new Staff("staff2", ["A3", "F5"]);
const staff3 = new Staff("staff3", ["E2", "C4"]);
const staff4 = new Staff("staff4", ["D3", "B5"]);
const mainStaves = { staff1, staff2, staff3, staff4 };
const harmonyStaves = {
    staff1: new Staff("staff1", ["C4", "C6"], [0.25, 1]),
    staff2: new Staff("staff2", ["A3", "F5"], [0.25, 1]),
    staff3: new Staff("staff3", ["E2", "C4"], [0.25, 1]),
    staff4: new Staff("staff4", ["D3", "B5"], [0.25, 1]),
};
function getActiveStaves() {
    return currentLayer === 'main' ? mainStaves : harmonyStaves;
}
function getSelectedStaves() {
    const active = getActiveStaves();
    return staves
        .map(name => active[name])
        .filter(staff => getSelection(staff.name) !== null);
}
let clipboard = {};
let totalDuration = 0;
let sampler = null;
const pianoKeys = (() => {
    const noteNames = ["A", "Bb", "B", "C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab"];
    const keys = [];
    let octave = 0;
    for (let index = 0; index < 88; index++) {
        const note = noteNames[index % 12];
        if (note === "C" && index > 0)
            octave++;
        keys.push(note + octave);
    }
    return keys;
})();
const noteMapping = {
    "C": 0, "Db": 1, "D": 2, "Eb": 3, "E": 4,
    "F": 5, "Gb": 6, "G": 7, "Ab": 8, "A": 9,
    "Bb": 10, "B": 11, "Rest": 12,
};
const durationMapping = {
    "w": 1,
    "h": 0.5,
    "q": 0.25,
    "8": 0.125,
    "16": 0.0625,
    "32": 0.03125,
    "wd": 1 + 0.5,
    "hd": 0.5 + 0.25,
    "qd": 0.25 + 0.125,
    "8d": 0.125 + 0.0625,
    "16d": 0.0625 + 0.03125,
};
const durationsLargestFirst = Object.entries(durationMapping).sort((durA, durB) => durB[1] - durA[1]);
function getDurationKeyFromValue(value) {
    for (const [key, val] of Object.entries(durationMapping)) {
        if (Math.abs(val - value) < 1e-9)
            return key;
    }
    return null;
}
const scalesMapping = {
    'Chromatic': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    'Major': [0, 2, 4, 5, 7, 9, 11],
    'Minor': [0, 2, 3, 5, 7, 8, 10],
    'Pentatonic Major': [0, 2, 4, 7, 9],
    'Pentatonic Minor': [0, 3, 5, 7, 10],
    'MOLT 1': [0, 2, 4, 6, 8, 10],
    'MOLT 2': [0, 1, 3, 4, 6, 7, 9, 10],
    'MOLT 3': [0, 2, 3, 4, 6, 7, 8, 10, 11],
    'MOLT 4': [0, 1, 2, 5, 6, 7, 8, 11],
    'MOLT 5': [0, 1, 5, 6, 7, 11],
    'MOLT 6': [0, 2, 4, 5, 6, 8, 10, 11],
    'MOLT 7': [0, 1, 2, 3, 5, 6, 7, 8, 9, 11],
    'Overtone (Theoretical)': [0, 2, 4, 6, 7, 9, 10, 11],
    'Overtone (Audible)': [0, 2, 4, 7, 11],
};
// Filled by processNotes, keyed by the VexFlow StaveNote object.
const noteTiming = new WeakMap();
// Rebuilt on every drawAllVoices(); only the active layer is ever drawn.
const gridLayout = {};
let gridDivision = 1 / 16;
const GRID_DIVISIONS = [1 / 32, 1 / 16, 1 / 8, 1 / 4, 1 / 2, 1];
const GRID_LABELS = ['1/32', '1/16', '1/8', '1/4', '1/2', '1'];
const SVG_NS = 'http://www.w3.org/2000/svg';
