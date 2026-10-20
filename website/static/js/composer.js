"use strict";
/// <reference path="declarations.d.ts" />
const globalMemory = [];
let globalMemoryIndex = -1;
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Voice Container Setup
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
const { Renderer, Stave, StaveNote, StaveTie, Dot, Voice: VFVoice, Accidental, Formatter, Tuplet } = Vex.Flow;
// Notes carry their own stave when drawn, so VexFlow decides collisions per staff (see customStaveNoteFormat)
const STAVENOTE_FORMAT_VEXFLOW = StaveNote.format;
StaveNote.format = customStaveNoteFormat;
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
createStaffContainers(["staff1", "staff2", "staff3", "staff4"]);
Object.entries(containers).forEach(([name, container]) => {
    renderers[name] = new Renderer(container, Renderer.Backends.SVG);
    contexts[name] = renderers[name].getContext();
});
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Variable definitions
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
const staffContainers = document.querySelectorAll('.staffContainer');
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
document.getElementById('layerToggle')?.addEventListener('click', () => {
    currentLayer = currentLayer === 'main' ? 'harmony' : 'main';
    const btn = document.getElementById('layerToggle');
    btn.textContent = currentLayer === 'main' ? 'Main' : 'Harmony';
    document.querySelectorAll('.harmonizeButton').forEach(btn => {
        btn.style.display = currentLayer === 'main' ? '' : 'none';
    });
    document.querySelectorAll(".staffSettings").forEach(settings => {
        const staffName = settings.dataset.staff;
        populateStaffSettings(settings, staffName);
    });
    renderGridOverlays(Object.values(getActiveStaves()));
    drawAllStaves();
});
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
        this.stems = VOICE_DEFS.find(d => d.id === id).stems;
    }
}
// Every voice of a staff, Up 1 first
function staffVoices(staff) {
    return [staff, ...staff.extraVoices];
}
function getVoice(staff, id) {
    return id === 'up1' ? staff : (staff.extraVoices.find(v => v.id === id) ?? null);
}
function getOrCreateVoice(staff, id) {
    const have = getVoice(staff, id);
    if (have)
        return have;
    const voice = new Voice(staff.name, id);
    staff.extraVoices.push(voice);
    const order = (v) => VOICE_DEFS.findIndex(d => d.id === v.id);
    staff.extraVoices.sort((a, b) => order(a) - order(b));
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
    staff.extraVoices = staff.extraVoices.filter(v => v.unprocessedNotes.some(n => !n.isRest));
}
// Up 1 is always drawn. Another voice is only drawn in the bars where it has a note (as in Dorico).
function voiceShownInBar(v, measureIndex) {
    if (v.id === 'up1')
        return true;
    return (v.notes[measureIndex] || []).some((n) => !n.isRest());
}
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Sideways spacing of notes that start together (several voices on one staff)
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// VexFlow decides sideways shifts from stem collisions, so notes more than a second apart can still move.
// We keep its handling of rests (moving them up/down, hiding identical rests in two voices) but replace the
// shifting of notes: a note moves aside ONLY if another note starting at the same moment is a second or less away.
function headKind(note) {
    const d = note.getDuration();
    return d === 'w' ? 'w' : d === 'h' ? 'h' : 'q';
}
function customStaveNoteFormat(notes, state) {
    const before = state.right_shift;
    const result = STAVENOTE_FORMAT_VEXFLOW(notes, state); // rests: vertical moves, hiding identical rests
    state.right_shift = before; // we decide the extra width ourselves
    const pitched = notes.filter((x) => !x.isRest());
    pitched.forEach((x) => {
        x.setXShift(0); // undo VexFlow's note shifts
        if (x._stems && x.getStemDirection() !== x._stems)
            x.setStemDirection(x._stems); // and its stem flips
    });
    // Three or more voices at one moment: VexFlow assumes the voices are listed top to bottom, which ours are not,
    // so its rest placement can land on the note heads. Put each rest on its own voice's side of the staff instead,
    // moving it away from any head it would touch.
    if (notes.length >= 3) {
        const obstacles = pitched.flatMap((x) => x.getKeyProps().map((k) => k.line));
        notes.filter((x) => x.isRest() && x._stems && x.render_options.draw !== false).forEach((r) => {
            const up = r._stems === 1;
            const above = r.glyph && r.glyph.line_above != null ? r.glyph.line_above : 1.5;
            const below = r.glyph && r.glyph.line_below != null ? r.glyph.line_below : 1.5;
            let line = up ? 4 : 2;
            for (let i = 0; i < 8; i++) {
                if (!obstacles.some(h => h > line - below - 0.5 && h < line + above + 0.5))
                    break;
                line += up ? 1 : -1;
            }
            r.setKeyLine(0, line);
            obstacles.push(line);
        });
    }
    if (pitched.length < 2)
        return result;
    const lines = (x) => x.getKeyProps().map((k) => k.line);
    const conflict = (a, b) => {
        let min = Infinity;
        for (const la of lines(a))
            for (const lb of lines(b))
                min = Math.min(min, Math.abs(la - lb));
        return min < 1; // a second apart or closer, unisons included: side by side
    };
    // columns: the first voice stays put; a later voice moves right until it clears every note it conflicts with
    const col = new Map();
    const width = Math.max(...pitched.map((x) => x.getVoiceShiftWidth())) + 2;
    let maxCol = 0;
    pitched.forEach((note) => {
        let c = 0;
        while (pitched.some((o) => o !== note && col.get(o) === c && conflict(note, o)))
            c++;
        col.set(note, c);
        maxCol = Math.max(maxCol, c);
        note.setXShift(c * width);
    });
    state.right_shift = before + maxCol * width;
    return result;
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
        this.octaves = this.noteName.map((_, i) => Array.isArray(octave) ? (octave[i] ?? fallback) : octave);
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
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Mapping
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
bpmSlider.addEventListener("input", () => {
    bpmValueDisplay.textContent = bpmSlider.value;
});
const pianoKeys = (() => {
    const noteNames = ["A", "Bb", "B", "C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab"];
    const keys = [];
    let octave = 0;
    for (let i = 0; i < 88; i++) {
        const note = noteNames[i % 12];
        if (note === "C" && i > 0)
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
const typeMapping = {
    1: "whole", 0.5: "half", 0.25: "quarter",
    0.125: "8th", 0.0625: "16th", 0.03125: "32nd",
};
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
const chordMapping = {
    'Major Triad': [0, 4, 7],
    'Minor Triad': [0, 3, 7],
    'Augmented Triad': [0, 4, 8],
    'Diminished Triad': [0, 3, 6],
    'Major 7': [0, 4, 7, 11],
    'Minor 7': [0, 3, 7, 10],
    'Dominant 7': [0, 4, 7, 10],
    'Diminished 7': [0, 3, 6, 9],
    'Half Diminished 7': [0, 3, 6, 10],
};
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Dropdowns
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('projectTitleBtn')?.classList.remove('active');
        btn.classList.add('active');
        document.querySelectorAll('.tab-content').forEach(content => content.classList.add('hidden'));
        const target = document.getElementById(btn.dataset.target);
        target?.classList.remove('hidden');
        const dest = btn.dataset.target;
        if (dest === 'input-menu')
            setCurrentTab('create');
        else if (dest === 'edit-menu')
            setCurrentTab('edit');
        else
            renderGridOverlays(Object.values(getActiveStaves()));
    });
});
// Voice Settings //////////////////////////////////////////////////////////////////////
const allPitches = (() => {
    const list = [];
    ["A", "Bb", "B"].forEach(n => list.push(n + "0"));
    for (let oct = 1; oct <= 7; oct++) {
        ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"].forEach(n => list.push(n + oct));
    }
    list.push("C8");
    return list;
})();
const pitchIndex = (p) => allPitches.indexOf(p);
const toPitchStr = (v) => Array.isArray(v) ? `${v[0]}${v[1]}` : v;
function populateScaleSelect(select) {
    select.innerHTML = "";
    Object.keys(scalesMapping).forEach(name => {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        select.appendChild(opt);
    });
}
function populateMinFor(maxPitch, minSelect, selectedMin) {
    minSelect.innerHTML = "";
    const maxIdx = pitchIndex(maxPitch);
    allPitches.forEach((p, i) => {
        if (i <= maxIdx) {
            const opt = document.createElement("option");
            opt.value = p;
            opt.textContent = p;
            minSelect.appendChild(opt);
        }
    });
    if (selectedMin && pitchIndex(selectedMin) <= maxIdx)
        minSelect.value = selectedMin;
}
function populateMaxFor(minPitch, maxSelect, selectedMax) {
    maxSelect.innerHTML = "";
    const minIdx = pitchIndex(minPitch);
    allPitches.forEach((p, i) => {
        if (i >= minIdx) {
            const opt = document.createElement("option");
            opt.value = p;
            opt.textContent = p;
            maxSelect.appendChild(opt);
        }
    });
    if (selectedMax && pitchIndex(selectedMax) >= minIdx)
        maxSelect.value = selectedMax;
}
const rhythmOptions = [
    { id: 1, symbol: "𝅝" },
    { id: 0.5, symbol: "𝅗𝅥" },
    { id: 0.25, symbol: "𝅘𝅥" },
    { id: 0.125, symbol: "𝅘𝅥𝅮" },
    { id: 0.0625, symbol: "𝅘𝅥𝅯" },
    { id: 0.03125, symbol: "𝅘𝅥𝅰" },
];
function populateMinRhythm(maxId, selectEl, selectedId) {
    const maxIndex = rhythmOptions.findIndex(r => r.id === maxId);
    selectEl.innerHTML = "";
    rhythmOptions.forEach((opt, i) => {
        if (i >= maxIndex) {
            const o = document.createElement("option");
            o.value = String(opt.id);
            o.textContent = opt.symbol;
            if (opt.id === selectedId)
                o.selected = true;
            selectEl.appendChild(o);
        }
    });
}
function populateMaxRhythm(minId, selectEl, selectedId) {
    const minIndex = rhythmOptions.findIndex(r => r.id === minId);
    selectEl.innerHTML = "";
    rhythmOptions.forEach((opt, i) => {
        if (i <= minIndex) {
            const o = document.createElement("option");
            o.value = String(opt.id);
            o.textContent = opt.symbol;
            if (opt.id === selectedId)
                o.selected = true;
            selectEl.appendChild(o);
        }
    });
}
function populateStaffSettings(settings, staffName) {
    const staff = getActiveStaves()[staffName];
    const rootSelect = settings.querySelectorAll('.rootSelect')[0];
    const scaleSelect = settings.querySelector('.scaleSelect');
    const minSelect = settings.querySelector('.minPitch');
    const maxSelect = settings.querySelector('.maxPitch');
    const minRhythm = settings.querySelector('.minRhythm');
    const maxRhythm = settings.querySelector('.maxRhythm');
    const harmonizeButton = settings.querySelector('.harmonizeButton');
    const muteButton = settings.querySelector('.muteButton');
    populateScaleSelect(scaleSelect);
    if (staff.scale && staff.scale[1]) {
        scaleSelect.value = staff.scale[1];
    }
    else {
        scaleSelect.value = "Chromatic";
        staff.scale = [(staff.scale && staff.scale[0]) || "C", "Chromatic"];
    }
    rootSelect.value = staff.scale[0];
    const initialMin = toPitchStr(staff.pitchRange?.[0] || "E3");
    const initialMax = toPitchStr(staff.pitchRange?.[1] || "E6");
    populateMaxFor(initialMin, maxSelect, initialMax);
    populateMinFor(initialMax, minSelect, initialMin);
    minSelect.value = initialMin;
    maxSelect.value = initialMax;
    const initialMinRhythm = staff.rhythmRange?.[0] ?? 0.03125;
    const initialMaxRhythm = staff.rhythmRange?.[1] ?? 1;
    populateMaxRhythm(initialMinRhythm, maxRhythm, initialMaxRhythm);
    populateMinRhythm(initialMaxRhythm, minRhythm, initialMinRhythm);
    minRhythm.value = String(initialMinRhythm);
    maxRhythm.value = String(initialMaxRhythm);
    if (harmonizeButton)
        harmonizeButton.classList.toggle('active', staff.harmonize);
    if (muteButton)
        muteButton.classList.toggle('active', staff.muted);
}
document.querySelectorAll(".staffSettings").forEach(settings => {
    const staffName = settings.dataset.staff;
    const muteButton = settings.querySelector('.muteButton');
    const midiButton = settings.querySelector('.midiButton');
    const musicXMLButton = settings.querySelector('.musicXMLButton');
    const rootSelect = settings.querySelectorAll('.rootSelect')[0];
    const scaleSelect = settings.querySelector('.scaleSelect');
    const minSelect = settings.querySelector('.minPitch');
    const maxSelect = settings.querySelector('.maxPitch');
    const minRhythm = settings.querySelector('.minRhythm');
    const maxRhythm = settings.querySelector('.maxRhythm');
    const harmonizeButton = settings.querySelector('.harmonizeButton');
    // Initialize with main layer values
    populateStaffSettings(settings, staffName);
    // Event listeners read active layer's voice at fire time
    rootSelect?.addEventListener('change', () => {
        getActiveStaves()[staffName].scale[0] = rootSelect.value;
        saveToLocalStorage();
    });
    scaleSelect.addEventListener('change', () => {
        getActiveStaves()[staffName].scale[1] = scaleSelect.value;
        saveToLocalStorage();
    });
    minSelect.addEventListener("change", () => {
        const staff = getActiveStaves()[staffName];
        populateMaxFor(minSelect.value, maxSelect, maxSelect.value);
        staff.pitchRange[0] = minSelect.value;
        saveToLocalStorage();
    });
    maxSelect.addEventListener("change", () => {
        const staff = getActiveStaves()[staffName];
        populateMinFor(maxSelect.value, minSelect, minSelect.value);
        staff.pitchRange[1] = maxSelect.value;
        saveToLocalStorage();
    });
    minRhythm.addEventListener("change", () => {
        const staff = getActiveStaves()[staffName];
        staff.rhythmRange[0] = parseFloat(minRhythm.value);
        populateMaxRhythm(staff.rhythmRange[0], maxRhythm, staff.rhythmRange[1]);
        saveToLocalStorage();
    });
    maxRhythm.addEventListener("change", () => {
        const staff = getActiveStaves()[staffName];
        staff.rhythmRange[1] = parseFloat(maxRhythm.value);
        populateMinRhythm(staff.rhythmRange[1], minRhythm, staff.rhythmRange[0]);
        saveToLocalStorage();
    });
    muteButton.addEventListener("click", () => {
        muteButton.classList.toggle("active");
        getActiveStaves()[staffName].muted = muteButton.classList.contains("active");
        saveToLocalStorage();
    });
    harmonizeButton.addEventListener('click', () => {
        harmonizeButton.classList.toggle('active');
        mainStaves[staffName].harmonize = harmonizeButton.classList.contains('active');
        saveToLocalStorage();
    });
});
document.querySelectorAll('.staffSettingsBlank').forEach(blank => {
    blank.addEventListener('click', () => {
        const settings = blank.closest('.staffSettings');
        const staffName = settings.dataset.staff;
        const existing = getSelection(staffName);
        if (existing) {
            clearSelection(staffName);
        }
        else {
            const totalDur = totalLength();
            setSelection(staffName, { start: 0, end: totalDur });
        }
    });
});
document.addEventListener('click', (e) => {
    const bar = document.getElementById('measureBar');
    if (bar && !bar.contains(e.target)) {
        selectedMeasureIndex = null;
        drawMeasureBar(getGlobalMeasureWidths(Object.values(getActiveStaves())));
    }
});
////////////////////////////////////////////////////////////////////////////////////
const transposeDropdown = document.getElementById("transposeDropdown");
transposeButton.addEventListener("click", () => {
    const MAX_INTERVAL = 12;
    transposeDropdown.innerHTML = "";
    const blankOption = document.createElement("option");
    blankOption.value = "";
    blankOption.textContent = "";
    transposeDropdown.appendChild(blankOption);
    for (let i = MAX_INTERVAL; i >= 1; i--) {
        const opt = document.createElement("option");
        opt.value = String(i);
        opt.textContent = `+${i}`;
        transposeDropdown.appendChild(opt);
    }
    for (let i = 1; i <= MAX_INTERVAL; i++) {
        const opt = document.createElement("option");
        opt.value = String(-i);
        opt.textContent = `-${i}`;
        transposeDropdown.appendChild(opt);
    }
    transposeDropdown.style.display = "block";
    transposeDropdown.selectedIndex = 0;
    transposeDropdown.focus();
});
transposeDropdown.addEventListener("click", () => {
    if (transposeDropdown.value === "")
        return;
    const interval = parseInt(transposeDropdown.value, 10);
    const active = getActiveStaves();
    let anyApplied = false;
    for (const name of staves) {
        if (applyToRange(active[name], (notes) => transposeNotes(notes, active[name], interval)))
            anyApplied = true;
    }
    if (anyApplied) {
        drawAllStaves();
        updateMemory();
    }
    transposeDropdown.style.display = "none";
});
transposeDropdown.addEventListener("blur", () => {
    transposeDropdown.style.display = "none";
});
const shiftSelect = document.querySelector("#shiftSelect");
shiftButton.addEventListener("click", (e) => {
    e.stopPropagation();
    shiftSelect.style.display = shiftSelect.style.display === "block" ? "none" : "block";
});
shiftSelect.addEventListener("click", () => {
    const selectedValue = shiftSelect.value;
    for (const staff of getSelectedStaves()) {
        shiftStaff(staff, selectedValue);
    }
    updateMemory();
    shiftSelect.style.display = "none";
});
document.addEventListener("click", (event) => {
    if (!shiftSelect.contains(event.target) && !shiftButton.contains(event.target)) {
        shiftSelect.style.display = "none";
    }
});
const reflectSelect = document.querySelector("#reflectSelect");
reflectButton.addEventListener("click", (e) => {
    e.stopPropagation();
    reflectSelect.style.display = reflectSelect.style.display === "block" ? "none" : "block";
});
reflectSelect.addEventListener("click", () => {
    const axisPitch = reflectSelect.value;
    const active = getActiveStaves();
    let anyApplied = false;
    for (const name of staves) {
        if (applyToRange(active[name], (notes) => reflectNotes(notes, active[name], axisPitch)))
            anyApplied = true;
    }
    if (anyApplied) {
        drawAllStaves();
        updateMemory();
    }
    reflectSelect.style.display = "none";
});
document.addEventListener("click", (event) => {
    if (!reflectButton.contains(event.target) && !reflectSelect.contains(event.target)) {
        reflectSelect.style.display = "none";
    }
});
function bindStaffAction(button, transform) {
    if (!button)
        return;
    button.addEventListener("click", () => {
        const active = getActiveStaves();
        let anyApplied = false;
        for (const name of staves) {
            if (applyToRange(active[name], transform))
                anyApplied = true;
        }
        if (anyApplied) {
            drawAllStaves();
            updateMemory();
        }
    });
}
bpmSlider.addEventListener("input", () => {
    bpmValueDisplay.textContent = bpmSlider.value;
});
function setupPlayButton(button, getParts) {
    if (!button)
        return;
    button.addEventListener("click", () => {
        if (isPlaying) {
            stopPlayback(button);
            return;
        }
        setupSampler().then(() => playAllStaves(getParts(), button));
    });
}
setupPlayButton(playButton, () => Object.values(getActiveStaves()));
generatePhraseButton?.addEventListener("click", () => {
    const active = getActiveStaves();
    let anyApplied = false;
    for (const name of staves) {
        if (generateIntoSelection(active[name]))
            anyApplied = true;
    }
    if (anyApplied) {
        drawAllStaves();
        updateMemory();
    }
});
function sumUnprocessedDuration(notes) {
    let total = 0;
    for (const note of notes) {
        total += note.tupletInfo
            ? (note.tupletInfo.index === note.tupletInfo.count ? note.tupletInfo.totalTupletDuration : 0)
            : getNoteDuration(note);
    }
    return total;
}
function applyPerStaffTransform(transform) {
    const active = getActiveStaves();
    let anyApplied = false;
    for (const name of staves) {
        const staff = active[name];
        if (applyToRange(staff, (notes, startOffset) => transform(staff, notes, startOffset)))
            anyApplied = true;
    }
    if (anyApplied) {
        drawAllStaves();
        updateMemory();
    }
}
separateStaffButton?.addEventListener("click", () => {
    if (!gridViewOn)
        return;
    if (separateStaff()) {
        drawAllStaves();
        updateMemory();
    }
});
bindStaffAction(reverseButton, reverseNotes);
changeRhythmButton?.addEventListener("click", () => {
    applyPerStaffTransform((staff, notes, startOffset) => changeRhythmNotes(notes, staff, startOffset));
});
bindStaffAction(shuffleRhythmButton, shuffleRhythmNotes);
bindStaffAction(shuffleNotesButton, shuffleNotesNotes);
bindStaffAction(shufflePitchButton, shufflePitchNotes);
changePitchButton?.addEventListener("click", () => {
    applyPerStaffTransform((staff, notes, startOffset) => changePitchNotes(notes, staff, startOffset));
});
complicateButton?.addEventListener("click", () => {
    applyPerStaffTransform((staff, notes, startOffset) => complicateNotes(notes, staff, startOffset));
});
bindStaffAction(simplifyButton, simplifyNotes);
// Select buttons now appear in both the Create and Edit tabs — bind every instance found,
// not just the first (a plain querySelector would silently miss the second one).
document.querySelectorAll('.previousButton').forEach(btn => {
    btn.addEventListener('click', () => accessMemory(-1));
});
document.querySelectorAll('.nextButton').forEach(btn => {
    btn.addEventListener('click', () => accessMemory(1));
});
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Keyboard shortcuts: Space = Play, Ctrl+C / Ctrl+V = Copy/Paste
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
document.addEventListener('keydown', (e) => {
    const target = e.target;
    const isTextEntry = (target.tagName === 'INPUT' && target.type !== 'range') ||
        target.tagName === 'SELECT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;
    if (isTextEntry)
        return;
    if (e.code === 'Space') {
        e.preventDefault();
        playButton?.click();
        return;
    }
    if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z' || e.key === 'Z') {
            e.preventDefault();
            accessMemory(-1);
            return;
        }
        if (e.key === 'y' || e.key === 'Y') {
            e.preventDefault();
            accessMemory(1);
            return;
        }
        if (e.key === 'c' || e.key === 'C') {
            e.preventDefault();
            copySelection();
            return;
        }
        if (e.key === 'v' || e.key === 'V') {
            e.preventDefault();
            pasteSelection();
            updateMemory();
            return;
        }
    }
});
/////////////////////////////////////////////////////////////////////////////////////
// Main Functions
/////////////////////////////////////////////////////////////////////////////////////
function getNoteDuration(note) {
    const dur = note.dotted ? note.duration + "d" : note.duration;
    return durationMapping[dur];
}
function getDurationString(note) {
    const frac = getNoteDuration(note);
    for (const [durStr, value] of Object.entries(durationMapping)) {
        if (Math.abs(value - frac) < 1e-6)
            return durStr;
    }
    return null;
}
function getAllowedPitches(staff, noteDuration) {
    const minIdx = pitchIndex(staff.pitchRange[0]);
    const maxIdx = pitchIndex(staff.pitchRange[1]);
    const allowedPitches = allPitches.slice(minIdx, maxIdx + 1);
    const rootIndex = noteMapping[staff.scale[0]];
    const scale = scalesMapping[staff.scale[1]];
    const scalePitches = allowedPitches.filter(pitch => {
        const noteName = pitch.slice(0, -1);
        const pitchClass = noteMapping[noteName];
        return pitchClass !== undefined && scale.includes((pitchClass - rootIndex + 12) % 12);
    });
    if (staff.harmonize) {
        const staffHarmony = harmonyStaves[staff.name];
        if (!staffHarmony || !staffHarmony.unprocessedNotes.length)
            return scalePitches;
        let durationSearched = 0;
        let currentChord = null;
        for (let i = 0; i < staffHarmony.unprocessedNotes.length; ++i) {
            currentChord = staffHarmony.unprocessedNotes[i];
            durationSearched += durationMapping[currentChord.duration];
            if (durationSearched <= totalDuration && i + 1 < staffHarmony.unprocessedNotes.length)
                continue;
            const currentOverlap = durationSearched - totalDuration;
            const nextOverlap = noteDuration - currentOverlap;
            if (nextOverlap > currentOverlap && i + 1 < staffHarmony.unprocessedNotes.length) {
                currentChord = staffHarmony.unprocessedNotes[i + 1];
            }
            if (currentChord.isRest)
                return [];
            const chordClasses = new Set(currentChord.noteName.map(pitchClassOf));
            return scalePitches.filter(pitch => chordClasses.has(pitchClassOf(pitch.slice(0, -1))));
        }
    }
    return scalePitches;
}
function getNoteDurationInSeconds(staff, note) {
    const bpm = parseFloat(bpmSlider.value) || 120;
    const quarterNoteSeconds = 60 / bpm;
    let durationInWholeNotes = getNoteDuration(note);
    if (note.tupletInfo) {
        const { ratio } = note.tupletInfo;
        durationInWholeNotes = durationInWholeNotes * ratio[1] / ratio[0];
    }
    return durationInWholeNotes * 4 * quarterNoteSeconds;
}
function checkNoteInScale(note, staff) {
    if (note.isRest)
        return true;
    const canon = canonicalPitch(note.noteName[0], note.octaves[0]);
    const interval = (noteMapping[canon.name] - noteMapping[staff.scale[0]] + 12) % 12;
    return scalesMapping[staff.scale[1]].includes(interval);
}
function randomPitchFromScale(staff, noteDuration, allowRest = true) {
    const scalePitches = getAllowedPitches(staff, noteDuration);
    if (allowRest && (!scalePitches.length || Math.random() < 0.2))
        return ["Rest", 4];
    const pick = scalePitches[Math.floor(Math.random() * scalePitches.length)];
    return [pick.slice(0, -1), parseInt(pick.slice(-1), 10)];
}
function findTuplet(note, staff) {
    for (const tupletObj of staff.tuplets) {
        if (tupletObj.tupletNotes.includes(note))
            return tupletObj;
    }
    return null;
}
function createNote(noteNames, noteOctaves, noteDuration) {
    let keys = [];
    let accidentals = [];
    let durationInfo = noteDuration;
    if (noteNames[0] === "Rest") {
        keys = ["B/4"];
        durationInfo = noteDuration + "r";
    }
    else {
        const entries = noteNames.map((n, i) => {
            const { letter, acc } = parsePitchName(n);
            const octave = Array.isArray(noteOctaves) ? (noteOctaves[i] ?? noteOctaves[0]) : noteOctaves;
            return { letter, acc, octave };
        });
        entries.sort((a, b) => staffPosition(a.letter, a.octave) - staffPosition(b.letter, b.octave));
        keys = entries.map(e => `${e.letter}/${e.octave}`);
        accidentals = entries.map(e => e.acc);
    }
    const note = new StaveNote({ keys, duration: durationInfo });
    accidentals.forEach((acc, i) => { if (acc !== '')
        note.addModifier(new Accidental(acc), i); });
    if (noteDuration.includes("d")) {
        note.dotted = true;
        Dot.buildAndAttach([note], { all: true });
    }
    return note;
}
function fillDuration(fillNoteDuration, source) {
    const fillNotes = [];
    let remaining = fillNoteDuration;
    while (remaining > 1e-9) {
        let placed = false;
        for (const [durStr, durValue] of durationsLargestFirst) {
            if (durValue <= remaining + 1e-9) {
                const piece = createNote(source.noteName, source.octaves, durStr);
                piece._dur = durValue;
                fillNotes.push(piece);
                remaining = round(remaining - durValue);
                placed = true;
                break;
            }
        }
        if (!placed)
            break;
    }
    return fillNotes;
}
function toneNamesFor(n) {
    if (n.isRest)
        return null;
    return n.noteName.map((nm, i) => toToneName(nm, n.octaves[i]));
}
function round(val) {
    return Math.round(val * 1e9) / 1e9;
}
// A tie is only valid between two pitched, non-tuplet notes with identical pitch.
function sanitizeTies(notes) {
    for (let i = 0; i < notes.length; i++) {
        const n = notes[i];
        if (!n.tiedToNext)
            continue;
        const next = notes[i + 1];
        const valid = !!next && !n.isRest && !next.isRest && !n.tupletInfo && !next.tupletInfo &&
            samePitches(n, next);
        if (!valid)
            n.tiedToNext = false;
    }
}
// The usual grouping of a time signature: a group per beat in simple time, threes in compound time (6/8 = 3+3),
// and twos and a three in odd meters (5/8 = 2+3, 7/8 = 2+2+3)
function defaultGroups(num, den) {
    if (den <= 4)
        return Array(num).fill(1);
    if (num <= 3)
        return [num];
    if (num % 3 === 0)
        return Array(num / 3).fill(3);
    if (num % 2 === 0)
        return Array(num / 2).fill(2);
    return [...Array((num - 3) / 2).fill(2), 3];
}
function makeSig(num, den, groups) {
    const ok = !!groups && groups.length > 0 && groups.every(g => Number.isInteger(g) && g > 0) && groups.reduce((a, b) => a + b, 0) === num;
    return { num, den, groups: ok ? [...groups] : defaultGroups(num, den) };
}
// The measure signatures of a saved composition (older saves have one signature for the whole piece)
function sigsFromData(data) {
    const valid = (s) => !!s && Number.isInteger(s.num) && s.num >= 1 && s.num <= 32 && [2, 4, 8, 16].includes(s.den);
    if (Array.isArray(data.measureSigs) && data.measureSigs.length > 0 && data.measureSigs.every(valid)) {
        return data.measureSigs.map((s) => makeSig(s.num, s.den, s.groups));
    }
    const ts = Array.isArray(data.timeSignature) ? data.timeSignature : [4, 4];
    return [makeSig(ts[0], ts[1])];
}
// The signature of measure i (measures past the end of the list keep the last signature)
function sigOf(i) {
    return measureSigs[Math.min(Math.max(i, 0), measureSigs.length - 1)];
}
function measureLenOf(i) {
    const s = sigOf(i);
    return s.num / s.den;
}
// Where measure i begins, in whole notes
function measureStartOf(i) {
    let t = 0;
    for (let k = 0; k < i; k++)
        t += measureLenOf(k);
    return round(t);
}
// The measure that contains time t (a barline belongs to the measure that starts there)
function measureIndexAt(t) {
    let i = 0;
    let start = 0;
    for (;;) {
        const end = round(start + measureLenOf(i));
        if (t < end - 1e-9 || i > 100000)
            return i;
        start = end;
        i++;
    }
}
// The first barline after time t
function barlineAfter(t) {
    return measureStartOf(measureIndexAt(t) + 1);
}
function posInMeasureAt(t) {
    return round(t - measureStartOf(measureIndexAt(t)));
}
// How much room is left in the measure at time t (a whole measure if t is on a barline)
function spaceToBarline(t) {
    return round(barlineAfter(t) - t);
}
// The length of the whole piece, in whole notes
function totalLength() {
    return measureStartOf(numMeasures);
}
// How many measures it takes to hold `total` whole notes
function measuresCovering(total) {
    let i = 0;
    let t = 0;
    while (t < total - 1e-9 && i < 100000) {
        t = round(t + measureLenOf(i));
        i++;
    }
    return i;
}
// One signature per measure: extra entries go, missing ones repeat the last signature
function normalizeSigs() {
    const n = Math.max(1, numMeasures);
    const last = measureSigs[measureSigs.length - 1];
    const next = measureSigs.slice(0, n);
    while (next.length < n)
        next.push({ ...last, groups: [...last.groups] });
    measureSigs = next;
}
function sigsForSave() {
    normalizeSigs();
    return measureSigs.map(s => ({ num: s.num, den: s.den, groups: [...s.groups] }));
}
// A signature is written at the start of the piece and wherever it changes
function sigShownAt(i) {
    if (i <= 0)
        return true;
    const a = sigOf(i - 1);
    const b = sigOf(i);
    return a.num !== b.num || a.den !== b.den;
}
// Where the beat groups of a measure begin, in whole notes from its barline, ending with the measure's length
function groupCuts(i) {
    const s = sigOf(i);
    const cuts = [0];
    let acc = 0;
    for (const g of s.groups) {
        acc += g;
        cuts.push(round(acc / s.den));
    }
    if (acc !== s.num)
        return [0, round(s.num / s.den)];
    return cuts;
}
// The groups in the form VexFlow's beaming wants
function beamGroups(i) {
    const s = sigOf(i);
    return s.groups.map(g => new Vex.Flow.Fraction(g, s.den));
}
// Rests for a span, the largest first, never across a barline (the plain way: used when nothing tidier fits)
function greedyRests(duration, startPos) {
    const rests = [];
    let remaining = duration;
    let pos = startPos;
    while (remaining > 1e-9) {
        const limit = Math.min(remaining, spaceToBarline(pos));
        let placed = false;
        for (const [durStr, durVal] of durationsLargestFirst) {
            if (durVal <= limit + 1e-9) {
                rests.push(new UnprocessedNote(['Rest'], 4, durStr, false));
                remaining = round(remaining - durVal);
                pos = round(pos + durVal);
                placed = true;
                break;
            }
        }
        if (!placed)
            break;
    }
    return rests;
}
function processNotes(staff, unprocessedNotes) {
    sanitizeTies(unprocessedNotes);
    let tupletNotes = [];
    let measureNotes = [];
    let posInMeasure = 0;
    let currentTieGroup = [];
    let tupletStartAbs = 0;
    const curLen = () => measureLenOf(staff.notes.length); // the measure being filled
    let tieHead = -1; // index in toneNotes of the note a tie is continuing, so tied notes sound once
    const pushMeasure = (m, why) => {
        if (m.length > 0) {
            staff.notes.push([...m]);
            return;
        }
        console.warn('skipped empty measure push:', staff.name, why, 'pos', posInMeasure);
    };
    for (const unprocessedNote of unprocessedNotes) {
        while (posInMeasure >= curLen() - 1e-9) {
            const len = curLen();
            if (measureNotes.length > 0)
                staff.notes.push([...measureNotes]);
            measureNotes = [];
            posInMeasure = round(Math.max(0, posInMeasure - len));
        }
        staff.unprocessedNotes.push(unprocessedNote);
        const note = unprocessedNote.toStaveNote();
        if (unprocessedNote.tupletInfo) {
            const { id, totalTupletDuration, ratio, count, index } = unprocessedNote.tupletInfo;
            if (index === 1)
                tupletStartAbs = round(measureStartOf(staff.notes.length) + posInMeasure);
            const perNote = totalTupletDuration / count;
            noteTiming.set(note, { start: round(tupletStartAbs + (index - 1) * perNote), dur: perNote, tupletId: id });
            tupletNotes.push(note);
            measureNotes.push(note);
            staff.toneNotes.push([toneNamesFor(unprocessedNote), getNoteDuration(unprocessedNote) * ratio[1] / ratio[0]]);
            tieHead = -1;
            if (index === count) {
                const vfTuplet = new Tuplet(tupletNotes, {
                    num_notes: ratio[0],
                    notes_occupied: ratio[1],
                    ratioed: true,
                });
                staff.tuplets.push({ tupletNotes: [...tupletNotes], vfTuplet, realDuration: totalTupletDuration });
                posInMeasure = round(posInMeasure + totalTupletDuration);
                tupletNotes = [];
                if (posInMeasure >= curLen() - 1e-9) {
                    const len = curLen();
                    pushMeasure(measureNotes, 'tuplet end');
                    measureNotes = [];
                    posInMeasure = round(Math.max(0, posInMeasure - len));
                }
            }
        }
        else {
            const noteDur = getNoteDuration(unprocessedNote);
            if (round(posInMeasure + noteDur) > curLen()) {
                const fillDur = round(curLen() - posInMeasure);
                let overflowDur = round(noteDur - fillDur);
                const notesToTie = [];
                if (currentTieGroup.length > 0) {
                    notesToTie.push(...currentTieGroup);
                    currentTieGroup = [];
                }
                const fillNotes = fillDuration(fillDur, unprocessedNote);
                stampSequence(fillNotes, round(measureStartOf(staff.notes.length) + posInMeasure));
                measureNotes.push(...fillNotes);
                notesToTie.push(...fillNotes);
                pushMeasure(measureNotes, 'overflow fill');
                measureNotes = [];
                posInMeasure = 0;
                while (overflowDur >= curLen() - 1e-9) {
                    const len = curLen();
                    const chunk = fillDuration(len, unprocessedNote);
                    stampSequence(chunk, measureStartOf(staff.notes.length));
                    notesToTie.push(...chunk);
                    pushMeasure(chunk, 'overflow chunk');
                    overflowDur = round(overflowDur - len);
                }
                if (overflowDur > 1e-9) {
                    const tail = fillDuration(overflowDur, unprocessedNote);
                    stampSequence(tail, measureStartOf(staff.notes.length));
                    measureNotes.push(...tail);
                    notesToTie.push(...tail);
                    posInMeasure = overflowDur;
                }
                if (!note.isRest()) {
                    if (unprocessedNote.tiedToNext)
                        currentTieGroup = notesToTie; // tie continues into the next piece
                    else
                        staff.ties.push(notesToTie);
                }
            }
            else {
                if (unprocessedNote.tiedToNext && !unprocessedNote.isRest) {
                    currentTieGroup.push(note);
                }
                else if (currentTieGroup.length > 0 && !unprocessedNote.isRest) {
                    currentTieGroup.push(note);
                    staff.ties.push([...currentTieGroup]);
                    currentTieGroup = [];
                }
                else {
                    currentTieGroup = [];
                }
                noteTiming.set(note, { start: round(measureStartOf(staff.notes.length) + posInMeasure), dur: noteDur, tupletId: null });
                measureNotes.push(note);
                posInMeasure = round(posInMeasure + noteDur);
                if (posInMeasure >= curLen() - 1e-9) {
                    pushMeasure(measureNotes, 'note end');
                    measureNotes = [];
                    posInMeasure = 0;
                }
            }
            // A note tied from the one before only lengthens it; it is not played again
            if (tieHead >= 0) {
                staff.toneNotes[tieHead][1] = round(staff.toneNotes[tieHead][1] + noteDur);
            }
            else {
                staff.toneNotes.push([toneNamesFor(unprocessedNote), noteDur]);
            }
            if (unprocessedNote.tiedToNext && !unprocessedNote.isRest) {
                if (tieHead < 0)
                    tieHead = staff.toneNotes.length - 1;
            }
            else {
                tieHead = -1;
            }
        }
    }
    if (currentTieGroup.length > 1)
        staff.ties.push([...currentTieGroup]);
    if (measureNotes.length > 0)
        staff.notes.push([...measureNotes]);
}
function resetStaff(staff) {
    staff.unprocessedNotes = [];
    staff.notes = [];
    staff.ties = [];
    staff.tuplets = [];
    staff.toneNotes = [];
    staff.duration = 0;
}
/////////////////////////////////////////////////////////////////////////////////////
// Memory
/////////////////////////////////////////////////////////////////////////////////////
function snapshotNotes(notes) {
    return notes.map(note => ({
        noteName: [...note.noteName],
        octave: note.octave,
        octaves: [...note.octaves],
        duration: note.duration,
        dotted: note.dotted,
        tupletInfo: note.tupletInfo ? { ...note.tupletInfo } : null,
        tiedToNext: note.tiedToNext,
    }));
}
function notesFromSnapshot(snapshot) {
    return snapshot.map(s => {
        const note = new UnprocessedNote([...s.noteName], s.octaves, s.duration, s.dotted, s.tiedToNext);
        if (s.tupletInfo)
            note.tupletInfo = { ...s.tupletInfo };
        return note;
    });
}
function snapshotStaffNotes(staff) {
    const snap = {};
    for (const voice of staffVoices(staff)) {
        if (voice.id === 'up1' || voice.unprocessedNotes.length > 0)
            snap[voice.id] = snapshotNotes(voice.unprocessedNotes);
    }
    return snap;
}
function updateMemory() {
    globalMemory.splice(globalMemoryIndex + 1);
    const snapshot = {
        numMeasures,
        timeSignature: [measureSigs[0].num, measureSigs[0].den],
        measureSigs: sigsForSave(),
        main: {},
        harmony: {},
    };
    for (const staffName of staves) {
        snapshot.main[staffName] = snapshotStaffNotes(mainStaves[staffName]);
        snapshot.harmony[staffName] = snapshotStaffNotes(harmonyStaves[staffName]);
    }
    globalMemory.push(snapshot);
    globalMemoryIndex = globalMemory.length - 1;
    if (typeof saveToLocalStorage === 'function')
        saveToLocalStorage();
}
function restoreStaffFromSnapshot(staff, snapshot) {
    staff.extraVoices = [];
    resetStaff(staff);
    processNotes(staff, notesFromSnapshot(snapshot['up1'] ?? []));
    for (const def of VOICE_DEFS) {
        if (def.id === 'up1' || !snapshot[def.id])
            continue;
        const voice = getOrCreateVoice(staff, def.id);
        resetVoice(voice);
        processNotes(voice, notesFromSnapshot(snapshot[def.id]));
    }
}
function accessMemory(indexDifference) {
    const newIdx = globalMemoryIndex + indexDifference;
    if (newIdx < 0 || newIdx >= globalMemory.length)
        return;
    globalMemoryIndex = newIdx;
    const snapshot = globalMemory[newIdx];
    numMeasures = snapshot.numMeasures;
    measureSigs = sigsFromData(snapshot);
    for (const staffName of staves) {
        restoreStaffFromSnapshot(mainStaves[staffName], snapshot.main[staffName]);
        restoreStaffFromSnapshot(harmonyStaves[staffName], snapshot.harmony[staffName]);
    }
    drawAllStaves();
}
// Insert-mode paste, in one voice: the copied notes go in at time t. A note that spans t is divided there
// (two separate notes, not tied) and its second half moves later; at a boundary the notes just go in.
function insertCellsAt(cells, t, notes, len) {
    const fresh = { start: t, end: round(t + len), notes, isTuplet: false, isRest: notes.every(n => n.isRest) };
    const out = [];
    let done = false;
    for (const c of cells) {
        if (done || c.end <= t + 1e-9) {
            out.push(c);
            continue;
        }
        if (c.start >= t - 1e-9) {
            out.push(fresh, c);
            done = true;
            continue;
        }
        if (c.isTuplet)
            return null; // a tuplet can't be divided
        out.push({ ...c, end: t, notes: piecesFor(c, c.start, t) }, fresh, { ...c, start: t, notes: piecesFor(c, t, c.end) });
        done = true;
    }
    if (!done)
        out.push(fresh);
    return out;
}
// Pastes at the start of the selection, for the whole length of what was copied:
//  Overwrite  replaces that range in the voices pasted into; other voices are left alone
//  Insert     pushes everything after it later in every voice (a held note gets longer)
//  Polyphony  like Overwrite, and every copied voice goes to the same voice it came from
// A single copied voice goes into the selected voice, unless Polyphony is on.
function planPaste(staff, clip, sel) {
    const total = getTotalDuration(staff);
    const t = sel.start;
    const len = clip.length;
    const e = round(t + len);
    const ids = Object.keys(clip.voices);
    if (!ids.length || len < 1e-9)
        return null;
    const chosen = sel.voice && sel.voice !== 'all' ? sel.voice : null;
    const remap = !!chosen && ids.length === 1 && !polyphonyMode;
    const destOf = (id) => (remap ? chosen : id);
    const cellsOf = (id) => {
        const v = getVoice(staff, id);
        return v ? buildCells(v.unprocessedNotes) : emptyVoiceCells(total);
    };
    const notesOf = (id) => {
        const notes = notesFromSnapshot(clip.voices[id]);
        if (notes.length)
            notes[notes.length - 1].tiedToNext = false; // never tied on into what follows
        return notes;
    };
    const changes = {};
    let newTotal;
    if (insertMode) {
        const pasted = new Set(ids.map(destOf));
        for (const voice of staffVoices(staff)) {
            if (pasted.has(voice.id))
                continue;
            const shifted = shiftCellsAt(buildCells(voice.unprocessedNotes), t, len);
            if (!shifted)
                return null; // a tuplet would have to stretch
            changes[voice.id] = shifted.flatMap(c => c.notes);
        }
        for (const id of ids) {
            const inserted = insertCellsAt(cellsOf(destOf(id)), t, notesOf(id), len);
            if (!inserted)
                return null;
            changes[destOf(id)] = inserted.flatMap(c => c.notes);
        }
        newTotal = round(total + len);
    }
    else {
        for (const id of ids) {
            const painted = paint(cellsOf(destOf(id)), t, e, notesOf(id));
            if (!painted)
                return null; // it would cut through a tuplet
            changes[destOf(id)] = painted.flatMap(c => c.notes);
        }
        newTotal = Math.max(total, e);
    }
    for (const id of Object.keys(changes)) {
        if (tupletCrossesBarline(changes[id], 0, Infinity))
            return null; // a tuplet would end up across a barline
    }
    return { staff, changes, newTotal, start: t, end: e, state: remap ? chosen : 'all' };
}
// Copy, then turn the copied range into rests. Returns false if nothing was cut.
function cutSelection() {
    if (!copySelection())
        return false;
    const clear = clearedToRests;
    for (const staff of getSelectedStaves())
        applyToRange(staff, clear);
    drawAllStaves();
    return true;
}
// Ctrl+X (Cmd+X) cuts. Copy and paste keep whatever shortcuts and buttons you already have.
// While writing, a click on the blank part of a track's settings does nothing (it would select the whole track)
function ignoreBlankClicksWhileWriting() {
    document.addEventListener('click', e => {
        if (entryState.entry && e.target?.closest?.('.staffSettingsBlank'))
            e.stopPropagation();
    }, true);
}
function setupClipboardKeys() {
    document.addEventListener('keydown', (e) => {
        if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== 'x')
            return;
        const target = e.target;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA' || target.isContentEditable))
            return;
        if (!gridViewOn)
            return;
        e.preventDefault();
        if (cutSelection())
            updateMemory();
    });
}
// Copies the selected range of every selected track: the selected voice, or every voice drawn there when all
// are selected. Copies nothing (and says why) if a selection cuts through a tuplet.
function copySelection() {
    const next = {};
    for (const staff of getSelectedStaves()) {
        const sel = getSelection(staff.name);
        if (!sel)
            continue;
        const clip = { length: round(sel.end - sel.start), voices: {} };
        for (const voice of selectionTargets(staff, sel)) {
            const { selected, ok } = sliceRange(voice, sel.start, sel.end);
            if (!ok) {
                alert(`Selection in ${staff.name} cuts through a tuplet — adjust it to cover the whole tuplet.`);
                return false;
            }
            clip.voices[voice.id] = snapshotNotes(selected);
        }
        next[staff.name] = clip;
    }
    if (!Object.keys(next).length)
        return false;
    clipboard = next;
    return true;
}
// Pastes what was copied at the start of the selection of each selected track (in order, as before).
// It does not save an undo step itself: the paste button calls updateMemory() afterwards.
function pasteSelection() {
    const names = Object.keys(clipboard);
    const targets = getSelectedStaves();
    if (!names.length || !targets.length)
        return;
    // work out every track first; nothing changes unless all of them can be pasted
    const plans = [];
    for (let i = 0; i < targets.length; i++) {
        const sel = getSelection(targets[i].name);
        const plan = sel ? planPaste(targets[i], clipboard[names[i % names.length]], sel) : null;
        if (!plan) {
            alert(`Can't paste into ${targets[i].name} here: it would cut through a tuplet, or put a tuplet across a barline.`);
            return;
        }
        plans.push(plan);
    }
    for (const plan of plans) {
        for (const id of Object.keys(plan.changes)) {
            const notes = plan.changes[id];
            renumberTuplets(notes);
            const voice = getOrCreateVoice(plan.staff, id);
            resetVoice(voice);
            processNotes(voice, notes);
        }
        const measures = measuresCovering(plan.newTotal);
        if (measures > numMeasures)
            numMeasures = measures;
    }
    drawAllStaves();
    // the pasted range ends up selected (after the drawing, so the Edit tab can snap it to whole notes)
    for (const plan of plans) {
        selections[currentLayer][plan.staff.name] = makeSelection(plan.staff, { start: plan.start, end: plan.end }, plan.state);
        lastSelectedStaff[currentLayer] = plan.staff.name;
    }
    renderGridOverlays(Object.values(getActiveStaves()));
}
/////////////////////////////////////////////////////////////////////////////////////
// Draw
/////////////////////////////////////////////////////////////////////////////////////
function ensureSvgSize(partName, requiredWidth) {
    const container = containers[partName];
    const height = container.clientHeight || 300;
    renderers[partName].resize(requiredWidth, height);
    const svg = container.querySelector('svg');
    if (svg) {
        svg.setAttribute('width', String(requiredWidth));
        svg.setAttribute('height', String(height));
        svg.setAttribute('viewBox', `0 0 ${requiredWidth} ${height}`);
        svg.style.width = `${requiredWidth}px`;
        svg.style.height = `${height}px`;
        svg.style.overflow = 'visible';
    }
    const outputDiv = document.getElementById('output');
    if (outputDiv)
        outputDiv.style.width = `${requiredWidth + 200}px`;
    contexts[partName] = renderers[partName].getContext();
}
function getGlobalMeasureWidths(staffList) {
    const globalWidths = [];
    staffList.forEach(staff => {
        staffVoices(staff).forEach(voice => {
            voice.notes.forEach((measureNotes, i) => {
                if (!voiceShownInBar(voice, i))
                    return;
                const width = 200 + measureNotes.length * 40 + (sigShownAt(i) && i > 0 ? 25 : 0);
                globalWidths[i] = Math.max(globalWidths[i] || 0, width);
            });
        });
    });
    for (let i = globalWidths.length; i < numMeasures; i++) {
        globalWidths[i] = 400 + (sigShownAt(i) && i > 0 ? 25 : 0);
    }
    return globalWidths;
}
function getTupletsForMeasure(staff, measureIndex) {
    const measureNoteSet = new Set(staff.notes[measureIndex]);
    return staff.tuplets
        .filter(tuplet => tuplet.tupletNotes.some(note => measureNoteSet.has(note)))
        .map(tuplet => tuplet.vfTuplet);
}
function padStavesToLength() {
    const allStaves = [...staves.map(n => mainStaves[n]), ...staves.map(n => harmonyStaves[n])];
    allStaves.forEach(pruneEmptyVoices);
    const stores = allStaves.flatMap(staff => staffVoices(staff));
    const target = round(Math.max(totalLength(), ...stores.map(s => getTotalDuration(s))));
    const targetMeasures = measuresCovering(target);
    for (const store of stores) {
        const have = getTotalDuration(store);
        const short = have < target - 1e-9;
        const stale = store.notes.length !== targetMeasures;
        if (!short && !stale)
            continue;
        let notes = [...store.unprocessedNotes];
        if (short)
            notes = [...notes, ...fillDurationWithRests(round(target - have), have)];
        resetVoice(store);
        processNotes(store, notes);
    }
}
function clampSelections() {
    const total = totalLength();
    for (const layer of ['main', 'harmony']) {
        const store = selections[layer];
        for (const name of Object.keys(store)) {
            const s = store[name];
            if (!s)
                continue;
            if (s.start >= total - 1e-9)
                store[name] = null;
            else if (s.end > total)
                store[name] = { ...s, end: total, base: s.base && s.base.end > total ? { ...s.base, end: total } : s.base };
        }
    }
}
function drawAllStaves(includeHarmony = false) {
    if (playStartMeasure >= numMeasures)
        playStartMeasure = Math.max(0, numMeasures - 1);
    clampSelections();
    padStavesToLength();
    const staffList = Object.values(getActiveStaves());
    const globalMeasureWidths = getGlobalMeasureWidths(staffList);
    const requiredWidth = globalMeasureWidths.reduce((a, b) => a + b, 0) + 100;
    staffList.forEach(staff => {
        eraseDrawing(staff);
        ensureSvgSize(staff.name, requiredWidth);
        gridLayout[staff.name] = { measures: [] };
    });
    const measureCount = Math.max(...staffList.map(staff => staff.notes.length), numMeasures);
    let staffLength = 0;
    for (let measureIndex = 0; measureIndex < measureCount; measureIndex++) {
        const staveWidth = globalMeasureWidths[measureIndex] || 400;
        const vfStaves = {};
        const items = [];
        const drawnNotes = {}; // every note drawn on a staff in this bar (all its voices)
        staffList.forEach(staff => {
            const stave = new Stave(staffLength, 60, staveWidth);
            if (measureIndex === 0)
                stave.addClef("treble");
            if (sigShownAt(measureIndex))
                stave.addTimeSignature(`${sigOf(measureIndex).num}/${sigOf(measureIndex).den}`);
            stave.setContext(contexts[staff.name]).draw();
            vfStaves[staff.name] = stave;
            const shown = staffVoices(staff).filter(v => voiceShownInBar(v, measureIndex));
            const several = shown.length > 1; // one voice: stems stay as they are. Several: each voice's stems are fixed
            drawnNotes[staff.name] = [];
            shown.forEach(voice => {
                const notes = voice.notes[measureIndex] || [];
                notes.forEach((n) => {
                    n.setStave(stave); // attach every note to its own staff: collisions are then decided per staff
                    n._stems = several ? voice.stems : undefined;
                    if (several && !n.isRest() && n.getStemDirection() !== voice.stems)
                        n.setStemDirection(voice.stems);
                    if (n.render_options)
                        n.render_options.draw = true; // start from "visible"; formatting may hide a duplicate rest
                });
                const vf = new VFVoice({ num_beats: sigOf(measureIndex).num, beat_value: sigOf(measureIndex).den }).setStrict(false);
                vf.addTickables(notes);
                items.push({
                    vf,
                    staff,
                    notes,
                    beams: Vex.Flow.Beam.generateBeams(notes, { maintain_stem_directions: several, groups: beamGroups(measureIndex) }), // before drawing, so beamed notes get no tails
                    tuplets: getTupletsForMeasure(voice, measureIndex),
                });
                drawnNotes[staff.name].push(...notes);
            });
        });
        const nonEmptyItems = items.filter(it => it.vf.getTickables().length > 0);
        if (nonEmptyItems.length > 0) {
            try {
                const formatter = new Formatter();
                formatter.joinVoices(nonEmptyItems.map(it => it.vf));
                formatter.formatToStave(nonEmptyItems.map(it => it.vf), Object.values(vfStaves)[0]);
            }
            catch (err) {
                console.error('format failed', 'm' + (measureIndex + 1), err);
            }
        }
        items.forEach(({ vf, staff, beams, tuplets }) => {
            try {
                if (vf.getTickables().length > 0) {
                    vf.draw(contexts[staff.name], vfStaves[staff.name]);
                }
                beams.forEach(beam => beam.setContext(contexts[staff.name]).draw());
                tuplets.forEach(tuplet => tuplet.setContext(contexts[staff.name]).draw());
            }
            catch (err) {
                console.error('draw failed', staff.name, 'm' + (measureIndex + 1), err);
            }
        });
        staffList.forEach(staff => {
            try {
                captureMeasureLayout(staff, measureIndex, vfStaves[staff.name], drawnNotes[staff.name]);
            }
            catch (err) {
                console.error('layout failed', staff.name, 'm' + (measureIndex + 1), err);
            }
        });
        staffLength += staveWidth;
    }
    staffList.forEach(staff => {
        staffVoices(staff).forEach(voice => drawTies(voice.ties, contexts[staff.name]));
    });
    renderGridOverlays(staffList);
    // Set staffWrapper width to match notation width so sticky works
    document.querySelectorAll('.staffWrapper').forEach(wrapper => {
        wrapper.style.minWidth = `${requiredWidth + 200}px`;
    });
    // Set measureBarWrapper width to match notation so sticky works
    const measureBarWrapper = document.getElementById('measureBarWrapper');
    if (measureBarWrapper)
        measureBarWrapper.style.minWidth = `${requiredWidth + 200}px`;
    // Draw measure bar
    const barWidths = globalMeasureWidths.length > 0
        ? globalMeasureWidths
        : Array(numMeasures).fill(400);
    drawMeasureBar(barWidths);
}
function drawTies(tieGroups, context) {
    for (const notesToTie of tieGroups) {
        for (let i = 0; i < notesToTie.length - 1; ++i) {
            new StaveTie({
                first_note: notesToTie[i],
                last_note: notesToTie[i + 1],
                first_indices: [0],
                last_indices: [0],
            }).setContext(context).draw();
        }
    }
}
function eraseDrawing(staff) {
    const partName = staff.name;
    if (!partName || !containers[partName]) {
        console.warn("No container found for part:", partName);
        return;
    }
    containers[partName].innerHTML = "";
    renderers[partName] = new Renderer(containers[partName], Renderer.Backends.SVG);
    contexts[partName] = renderers[partName].getContext();
}
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Measure Bar
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
let selectedMeasureIndex = null;
// Rewrites the rests of every voice in [from, to) so they follow the measures' signatures and groupings
// Gives measure `index` a new time signature. The measures after it that had the same signature follow it. Notes
// keep their place in time and are re-barred; rests are rewritten to fit the new bars.
function changeMeasureSig(index, num, den) {
    padStavesToLength();
    normalizeSigs();
    const old = sigOf(index);
    if (old.num === num && old.den === den)
        return true;
    let end = index + 1;
    while (end < numMeasures && sigOf(end).num === old.num && sigOf(end).den === old.den)
        end++;
    const saved = measureSigs;
    measureSigs = measureSigs.map(s => ({ ...s, groups: [...s.groups] }));
    for (let k = index; k < end; k++)
        measureSigs[k] = makeSig(num, den);
    // a tuplet may not end up across a barline
    for (const layer of [mainStaves, harmonyStaves]) {
        for (const staffName of staves) {
            for (const voice of staffVoices(layer[staffName])) {
                if (tupletCrossesBarline(voice.unprocessedNotes, 0, 1e9)) {
                    measureSigs = saved;
                    alert(`Cannot change the time signature — a tuplet in ${staffName} would cross a barline.`);
                    return false;
                }
            }
        }
    }
    const from = measureStartOf(index);
    let contentEnd = 0;
    for (const layer of [mainStaves, harmonyStaves]) {
        for (const staffName of staves) {
            for (const voice of staffVoices(layer[staffName])) {
                const notes = [...voice.unprocessedNotes];
                while (notes.length && notes[notes.length - 1].isRest && !notes[notes.length - 1].tupletInfo)
                    notes.pop(); // padding is added again below
                resetVoice(voice);
                processNotes(voice, coalesceRests(notes, (_k, _s, e) => e > from + 1e-9));
                contentEnd = Math.max(contentEnd, getTotalDuration(voice));
            }
        }
    }
    numMeasures = Math.max(numMeasures, measuresCovering(contentEnd));
    normalizeSigs();
    for (const layer of [mainStaves, harmonyStaves]) {
        for (const staffName of staves) {
            for (const voice of staffVoices(layer[staffName])) {
                const have = getTotalDuration(voice);
                const need = round(totalLength() - have);
                if (need > 1e-9) {
                    const notes = [...voice.unprocessedNotes, ...fillDurationWithRests(need, have)];
                    resetVoice(voice);
                    processNotes(voice, notes);
                }
            }
        }
    }
    remapAllSelections(() => null);
    drawAllStaves();
    updateMemory();
    return true;
}
// Sets how the beats of one measure are grouped (e.g. 2+2+3). Beams and rests follow it.
function drawMeasureBar(measureWidths) {
    const bar = document.getElementById('measureBar');
    if (!bar)
        return;
    bar.innerHTML = '';
    const spacer = document.createElement('div');
    spacer.className = 'measure-bar-spacer';
    bar.appendChild(spacer);
    measureWidths.forEach((width, i) => {
        const cell = document.createElement('div');
        cell.className = 'measure-bar-cell';
        const extraWidth = i === 0 ? 30.5 : 0;
        cell.style.width = `${width + extraWidth}px`;
        cell.style.minWidth = `${width + extraWidth}px`;
        cell.style.flexShrink = '0';
        if (i === selectedMeasureIndex)
            cell.classList.add('selected');
        if (i === playStartMeasure)
            cell.classList.add('play-start');
        // Delete button (hidden until selected)
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'measure-action-btn measure-delete-btn';
        deleteBtn.textContent = '×';
        deleteBtn.title = 'Delete measure';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteMeasure(i);
        });
        // Measure number (always visible)
        const label = document.createElement('span');
        label.className = 'measure-number';
        label.textContent = String(i + 1);
        // Time signature display (hidden until selected)
        const timeSigDisplay = document.createElement('span');
        timeSigDisplay.className = 'measure-timesig';
        timeSigDisplay.textContent = `${sigOf(i).num}/${sigOf(i).den}`;
        timeSigDisplay.title = `Beats grouped ${sigOf(i).groups.join('+')}`;
        timeSigDisplay.addEventListener('click', (e) => {
            e.stopPropagation();
            timeSigDisplay.style.display = 'none';
            timeSigEditor.style.display = 'flex';
        });
        // Time signature editor (hidden until timeSigDisplay clicked)
        const timeSigEditor = document.createElement('div');
        timeSigEditor.className = 'measure-timesig-editor';
        timeSigEditor.style.display = 'none';
        const topSel = document.createElement('select');
        for (let num = 1; num <= 16; num++) {
            const opt = document.createElement('option');
            opt.value = String(num);
            opt.textContent = String(num);
            if (num === sigOf(i).num)
                opt.selected = true;
            topSel.appendChild(opt);
        }
        const slash = document.createElement('span');
        slash.textContent = '/';
        slash.style.margin = '0 1px';
        const bottomSel = document.createElement('select');
        for (const val of ['2', '4', '8', '16']) {
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = val;
            if (parseInt(val) === sigOf(i).den)
                opt.selected = true;
            bottomSel.appendChild(opt);
        }
        function applyTimeSignatureChange() {
            const ok = changeMeasureSig(i, parseInt(topSel.value), parseInt(bottomSel.value));
            if (!ok) {
                topSel.value = String(sigOf(i).num);
                bottomSel.value = String(sigOf(i).den);
            }
        }
        topSel.addEventListener('change', (e) => { e.stopPropagation(); applyTimeSignatureChange(); });
        bottomSel.addEventListener('change', (e) => { e.stopPropagation(); applyTimeSignatureChange(); });
        timeSigEditor.appendChild(topSel);
        timeSigEditor.appendChild(slash);
        timeSigEditor.appendChild(bottomSel);
        // Add button (hidden until selected)
        const addBtn = document.createElement('button');
        addBtn.className = 'measure-action-btn measure-add-btn';
        addBtn.textContent = '+';
        addBtn.title = 'Insert measure after';
        addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            insertMeasureAfter(i);
        });
        cell.appendChild(deleteBtn);
        cell.appendChild(label);
        cell.appendChild(timeSigDisplay);
        cell.appendChild(timeSigEditor);
        cell.appendChild(addBtn);
        cell.addEventListener('click', () => {
            bar.querySelectorAll('.measure-bar-cell').forEach(c => c.classList.remove('selected', 'play-start'));
            cell.classList.add('selected', 'play-start');
            selectedMeasureIndex = i;
            playStartMeasure = i;
        });
        bar.appendChild(cell);
    });
}
function fillDurationAsUnprocessed(duration, sourceNote) {
    const result = [];
    let remaining = duration;
    while (remaining > 1e-9) {
        for (const [durStr, durVal] of durationsLargestFirst) {
            if (durVal <= remaining + 1e-9) {
                result.push(new UnprocessedNote(sourceNote.isRest ? ["Rest"] : [...sourceNote.noteName], sourceNote.isRest ? 4 : [...sourceNote.octaves], durStr, false, true // tiedToNext = true, will be corrected for last note below
                ));
                remaining = round(remaining - durVal);
                break;
            }
        }
    }
    // Last note is not tied to next
    if (result.length > 0)
        result[result.length - 1].tiedToNext = false;
    return result;
}
function fillDurationWithRests(duration, startPos = 0) {
    return naturalRests(duration, startPos);
}
function getTotalDuration(staff) {
    let total = 0;
    for (const note of staff.unprocessedNotes) {
        if (note.tupletInfo) {
            if (note.tupletInfo.index === note.tupletInfo.count) {
                total += note.tupletInfo.totalTupletDuration;
            }
        }
        else {
            total += getNoteDuration(note);
        }
    }
    return round(total);
}
function getMeasureStartDur(measureIndex) {
    return measureStartOf(measureIndex);
}
function remapAllSelections(map) {
    for (const layer of ['main', 'harmony']) {
        const store = selections[layer];
        for (const name of Object.keys(store)) {
            const s = store[name];
            if (!s)
                continue;
            const mapped = map(s);
            const mappedBase = s.base ? map({ start: s.base.start, end: s.base.end }) : null;
            store[name] = mapped ? { ...mapped, voice: s.voice, base: mappedBase ? { start: mappedBase.start, end: mappedBase.end } : undefined } : null;
        }
    }
}
// Adds an empty measure after insertAtDur in one voice's notes
function insertMeasureInNotes(notes, insertAtDur) {
    const newNotes = [];
    const len = measureLenOf(measureIndexAt(insertAtDur)); // the new measure's length
    let pos = 0;
    let inserted = false;
    for (let i = 0; i < notes.length; i++) {
        const note = notes[i];
        const noteDur = note.tupletInfo
            ? (note.tupletInfo.index === note.tupletInfo.count ? note.tupletInfo.totalTupletDuration : 0)
            : getNoteDuration(note);
        const noteStart = pos;
        const noteEnd = round(pos + noteDur);
        if (noteDur > 0)
            pos = noteEnd;
        if (note.tupletInfo && note.tupletInfo.index !== note.tupletInfo.count) {
            newNotes.push(note);
            continue;
        }
        if (!inserted) {
            if (noteEnd <= insertAtDur) {
                newNotes.push(note);
                if (round(noteEnd) === round(insertAtDur)) {
                    newNotes.push(...fillDurationWithRests(len, insertAtDur));
                    inserted = true;
                }
            }
            else if (noteStart < insertAtDur && noteEnd > insertAtDur) {
                const beforeDur = round(insertAtDur - noteStart);
                const afterDur = round(noteEnd - insertAtDur);
                newNotes.push(...fillDurationAsUnprocessed(beforeDur, note));
                newNotes.push(...fillDurationWithRests(len, insertAtDur));
                newNotes.push(...fillDurationAsUnprocessed(afterDur, note));
                inserted = true;
            }
            else {
                newNotes.push(note);
            }
        }
        else {
            newNotes.push(note);
        }
    }
    if (!inserted) {
        newNotes.push(...fillDurationWithRests(len, pos));
    }
    return newNotes;
}
function insertMeasureAfter(measureIndex) {
    padStavesToLength();
    normalizeSigs();
    const insertAtDur = measureStartOf(measureIndex + 1);
    const copy = sigOf(measureIndex);
    measureSigs.splice(measureIndex + 1, 0, { num: copy.num, den: copy.den, groups: [...copy.groups] }); // the new measure has its neighbour's signature
    const len = measureLenOf(measureIndex + 1);
    for (const layer of [mainStaves, harmonyStaves]) {
        for (const staffName of staves) {
            for (const voice of staffVoices(layer[staffName])) {
                const newNotes = insertMeasureInNotes(voice.unprocessedNotes, insertAtDur);
                resetVoice(voice);
                processNotes(voice, newNotes);
            }
        }
    }
    remapAllSelections(s => {
        if (s.start >= insertAtDur - 1e-9) {
            return { start: round(s.start + len), end: round(s.end + len) };
        }
        if (s.end > insertAtDur + 1e-9) {
            return { start: s.start, end: round(s.end + len) };
        }
        return s;
    });
    numMeasures++;
    selectedMeasureIndex = measureIndex + 1;
    drawAllStaves();
    updateMemory();
}
// Removes the bar [startDur, endDur) from one voice's notes
function deleteMeasureFromNotes(notes, startDur, endDur) {
    // Pass 1: split any note that crosses a barline into tied pieces
    const split = [];
    let pos = 0;
    for (const note of notes) {
        if (note.tupletInfo) {
            if (note.tupletInfo.index === note.tupletInfo.count) {
                pos = round(pos + note.tupletInfo.totalTupletDuration);
            }
            split.push(note);
            continue;
        }
        const noteDur = getNoteDuration(note);
        const noteStart = pos;
        pos = round(pos + noteDur);
        const firstBoundary = barlineAfter(noteStart);
        if (pos <= firstBoundary + 1e-9) {
            split.push(note);
        }
        else {
            let remaining = noteDur;
            let currentPos = noteStart;
            while (remaining > 1e-9) {
                const boundary = barlineAfter(currentPos);
                const spaceInMeasure = round(Math.min(boundary - currentPos, remaining));
                const pieces = fillDurationAsUnprocessed(spaceInMeasure, note);
                const hasMore = remaining - spaceInMeasure > 1e-9;
                pieces.forEach((p, i) => {
                    p.tiedToNext = (i < pieces.length - 1) || hasMore;
                });
                split.push(...pieces);
                remaining = round(remaining - spaceInMeasure);
                currentPos = round(currentPos + spaceInMeasure);
            }
        }
    }
    // Pass 2: drop everything inside [startDur, endDur)
    const newNotes = [];
    let p = 0;
    for (const note of split) {
        const noteDur = note.tupletInfo
            ? (note.tupletInfo.index === note.tupletInfo.count ? note.tupletInfo.totalTupletDuration : 0)
            : getNoteDuration(note);
        const noteStart = p;
        const noteEnd = round(p + noteDur);
        if (noteDur > 0)
            p = noteEnd;
        if (note.tupletInfo && note.tupletInfo.index !== note.tupletInfo.count) {
            if (noteStart < startDur - 1e-9 || noteStart >= endDur - 1e-9)
                newNotes.push(note);
            continue;
        }
        if (noteEnd <= startDur + 1e-9) {
            if (round(noteEnd) === round(startDur) && note.tiedToNext) {
                const cleared = new UnprocessedNote([...note.noteName], note.octaves, note.duration, note.dotted, false);
                if (note.tupletInfo)
                    cleared.tupletInfo = { ...note.tupletInfo };
                newNotes.push(cleared);
            }
            else {
                newNotes.push(note);
            }
        }
        else if (noteStart >= endDur - 1e-9) {
            newNotes.push(note);
        }
    }
    // Clear a dangling tie at the very end
    for (let i = newNotes.length - 1; i >= 0; i--) {
        if (!newNotes[i].tiedToNext)
            break;
        const nextNote = newNotes[i + 1];
        if (!nextNote || !samePitches(nextNote, newNotes[i])) {
            newNotes[i].tiedToNext = false;
        }
    }
    return newNotes;
}
// Is this measure only rests, in every voice of every track, on both layers?
function measureIsBlank(measureIndex) {
    const s = measureStartOf(measureIndex);
    const e = measureStartOf(measureIndex + 1);
    for (const layer of [mainStaves, harmonyStaves]) {
        for (const name of staves) {
            for (const voice of staffVoices(layer[name])) {
                let pos = 0;
                for (const n of voice.unprocessedNotes) {
                    const d = n.tupletInfo ? n.tupletInfo.totalTupletDuration / n.tupletInfo.count : getNoteDuration(n);
                    if (!n.isRest && pos < e - 1e-9 && pos + d > s + 1e-9)
                        return false;
                    pos = round(pos + d);
                }
            }
        }
    }
    return true;
}
// Removes one measure from every voice, optionally leaving the redraw to the caller
function deleteMeasureStep(measureIndex, redraw) {
    padStavesToLength();
    normalizeSigs();
    const allStaves = [...staves.map(n => mainStaves[n]), ...staves.map(n => harmonyStaves[n])];
    const totalMeasures = Math.max(numMeasures, ...allStaves.map(p => p.notes.length));
    if (totalMeasures <= 1) {
        for (const layer of [mainStaves, harmonyStaves]) {
            for (const staffName of staves) {
                const staff = layer[staffName];
                staff.extraVoices = [];
                resetStaff(staff);
                processNotes(staff, fillDurationWithRests(measureLenOf(0), 0));
            }
        }
        numMeasures = 1;
        selectedMeasureIndex = null;
        remapAllSelections(() => null);
        if (redraw) {
            drawAllStaves();
            updateMemory();
        }
        return;
    }
    const startDur = measureStartOf(measureIndex);
    const endDur = measureStartOf(measureIndex + 1);
    const len = round(endDur - startDur);
    // worked out with the measures as they are, then the measure (and its signature) goes
    const jobs = [];
    for (const layer of [mainStaves, harmonyStaves]) {
        for (const staffName of staves) {
            for (const voice of staffVoices(layer[staffName])) {
                jobs.push({ voice, notes: deleteMeasureFromNotes(voice.unprocessedNotes, startDur, endDur) });
            }
        }
    }
    measureSigs.splice(measureIndex, 1);
    if (measureSigs.length === 0)
        measureSigs = [makeSig(4, 4)];
    for (const job of jobs) {
        resetVoice(job.voice);
        processNotes(job.voice, job.notes);
    }
    remapAllSelections(s => {
        const shift = (t) => t >= endDur - 1e-9 ? round(t - len) : (t > startDur ? startDur : t);
        const ns = shift(s.start);
        const ne = shift(s.end);
        return ne - ns < 1e-9 ? null : { start: ns, end: ne };
    });
    numMeasures = Math.max(1, numMeasures - 1);
    selectedMeasureIndex = null;
    if (redraw) {
        drawAllStaves();
        updateMemory();
    }
}
// Deletes a measure. If it is blank in every track, the blank measures right after it go too.
function deleteMeasure(measureIndex) {
    padStavesToLength();
    const allStaves = [...staves.map(n => mainStaves[n]), ...staves.map(n => harmonyStaves[n])];
    const total = Math.max(numMeasures, ...allStaves.map(p => p.notes.length));
    let count = 1;
    if (measureIsBlank(measureIndex)) {
        while (measureIndex + count < total && measureIsBlank(measureIndex + count))
            count++;
    }
    for (let k = 0; k < count; k++)
        deleteMeasureStep(measureIndex, false);
    drawAllStaves();
    updateMemory();
}
// Filled by processNotes, keyed by the VexFlow StaveNote object.
const noteTiming = new WeakMap();
// Rebuilt on every drawAllVoices(); only the active layer is ever drawn.
const gridLayout = {};
let gridDivision = 1 / 16;
const GRID_DIVISIONS = [1 / 32, 1 / 16, 1 / 8, 1 / 4, 1 / 2, 1];
const GRID_LABELS = ['1/32', '1/16', '1/8', '1/4', '1/2', '1'];
const SVG_NS = 'http://www.w3.org/2000/svg';
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Selection state
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
let currentTab = 'create';
let suppressContainerClick = false;
let gridViewOn = true;
const selections = {
    main: {},
    harmony: {},
};
// Most recently selected track per layer (decides which track survives entering Edit)
const lastSelectedStaff = { main: null, harmony: null };
function getSelection(staffName) {
    if (!gridViewOn)
        return null;
    return selections[currentLayer][staffName] ?? null;
}
function setSelection(staffName, range) {
    if (!gridViewOn)
        return;
    if (currentTab === 'edit' && range) {
        for (const name of staves) {
            if (name !== staffName)
                selections[currentLayer][name] = null;
        }
    }
    selections[currentLayer][staffName] = range;
    if (range)
        lastSelectedStaff[currentLayer] = staffName;
    renderGridOverlays(Object.values(getActiveStaves()));
}
function clearSelection(staffName) {
    setSelection(staffName, null);
}
// The voice a selection is in (Up 1 when it doesn't name one, or when that voice no longer exists)
// The first voice a selection acts on (the only one, unless several are selected)
function selectionStore(staff, sel) {
    return selectionTargets(staff, sel)[0];
}
// The voices of a staff that are drawn somewhere in [s, e). Up 1 always counts.
function drawnVoicesIn(staff, s, e) {
    return staffVoices(staff).filter(v => v.id === 'up1' || voiceActiveIn(v, s, e));
}
// The voices a selection acts on: the chosen voice, or every voice drawn in its range
function selectionTargets(staff, sel) {
    if (!sel)
        return [staff];
    if (sel.voice && sel.voice !== 'all')
        return [getVoice(staff, sel.voice) ?? staff];
    return drawnVoicesIn(staff, sel.start, sel.end);
}
// What a click inside a selection steps through: all voices, then each voice drawn in the range
function selectionCycle(staff, sel) {
    const base = sel.base ?? sel;
    const drawn = drawnVoicesIn(staff, base.start, base.end);
    return drawn.length >= 2 ? ['all', ...drawn.map(v => v.id)] : [];
}
// A selection of a range for a voice state. In the Edit tab it grows to whole notes of the voice(s) it covers.
function makeSelection(staff, base, state) {
    let start = base.start;
    let end = base.end;
    if (currentTab === 'edit') {
        const voices = state === 'all' ? drawnVoicesIn(staff, base.start, base.end) : [getVoice(staff, state) ?? staff];
        for (const v of voices) {
            const first = noteSpanAt(v, base.start + 1e-6);
            const last = noteSpanAt(v, base.end - 1e-6);
            if (first)
                start = Math.min(start, first.start);
            if (last)
                end = Math.max(end, last.end);
        }
    }
    return { start, end, voice: state, base: { start: base.start, end: base.end } };
}
// A click inside a selection: the same range, in the next voice (all, then each voice drawn there)
function cycleSelection(staffName) {
    const staff = getActiveStaves()[staffName];
    const sel = selections[currentLayer][staffName];
    if (!staff || !sel)
        return;
    const cycle = selectionCycle(staff, sel);
    if (!cycle.length)
        return;
    const at = cycle.indexOf(sel.voice ?? 'all');
    const next = cycle[(at + 1) % cycle.length];
    setSelection(staffName, makeSelection(staff, sel.base ?? sel, next));
}
// Per layer and staff: the selection a blank click last cleared
const clearedSelections = {};
// A click on the notation outside the selection's vertical range clears that track's selection;
// clicking there again brings back the one that was cleared
function blankClick(staffName) {
    const key = `${currentLayer}:${staffName}`;
    const now = selections[currentLayer][staffName];
    if (now) {
        clearedSelections[key] = now;
        setSelection(staffName, null);
        return;
    }
    const back = clearedSelections[key];
    clearedSelections[key] = null;
    if (back && back.start < totalLength() - 1e-9)
        setSelection(staffName, back);
}
function noteSpanAt(staff, t) {
    const hit = findNoteAtTime(staff, t);
    if (!hit)
        return null;
    return expandToTieGroup(staff, hit.note, hit.start, hit.start + hit.dur);
}
// Create -> Edit: grow every selection to whole notes, and keep a single track
// Create -> Edit: every selection grows to whole notes, and one track is kept
function collapseSelectionsForEdit() {
    for (const layer of ['main', 'harmony']) {
        const parts = layer === 'main' ? mainStaves : harmonyStaves;
        const store = selections[layer];
        for (const name of staves) {
            const s = store[name];
            if (!s)
                continue;
            store[name] = makeSelection(parts[name], s.base ?? s, s.voice ?? 'all');
        }
        const preferred = lastSelectedStaff[layer];
        const keep = preferred && store[preferred] ? preferred : staves.find(n => store[n]);
        for (const name of staves)
            if (name !== keep)
                store[name] = null;
    }
}
function setCurrentTab(tab) {
    const previous = currentTab;
    currentTab = tab;
    if (tab === 'edit' && previous !== 'edit')
        collapseSelectionsForEdit();
    renderGridOverlays(Object.values(getActiveStaves()));
}
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Layout capture (called from composer.ts's processNotes / drawAllVoices)
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Stamps a run of notes made by fillDuration() (each carries its own _dur).
function stampSequence(notes, start) {
    let t = start;
    for (const n of notes) {
        noteTiming.set(n, { start: t, dur: n._dur, tupletId: null });
        t = round(t + n._dur);
    }
}
// Called from drawAllVoices() after a measure's voices are formatted and drawn.
function captureMeasureLayout(staff, measureIndex, stave, notes) {
    const layout = gridLayout[staff.name];
    if (!layout)
        return;
    const startTime = measureStartOf(measureIndex);
    const endTime = measureStartOf(measureIndex + 1);
    const xStart = stave.getX();
    const xEnd = stave.getX() + stave.getWidth();
    let yTop = stave.getYForLine(0) - 45;
    let yBottom = stave.getYForLine(4) + 45;
    const baseTop = yTop; // the stave's own band: selections use this, whatever the notes do
    const baseBottom = yBottom;
    // notes with many ledger lines reach beyond the stave: the band (and the grid) grows to include them
    for (const n of notes) {
        try {
            for (const y of n.getYs()) {
                yTop = Math.min(yTop, y - 20);
                yBottom = Math.max(yBottom, y + 20);
            }
        }
        catch (e) {
            // not formatted
        }
    }
    const lines = [
        { t: startTime, x: xStart, kind: 'bar' },
        { t: endTime, x: xEnd, kind: 'bar' },
    ];
    // One onset per start time, even when several voices start together: the leftmost note head sets the x
    const byTime = new Map();
    for (const n of notes) {
        const info = noteTiming.get(n);
        if (!info)
            continue;
        let x;
        try {
            x = typeof n.getNoteHeadBeginX === 'function' ? n.getNoteHeadBeginX() : n.getAbsoluteX();
        }
        catch (e) {
            continue; // note wasn't formatted (shouldn't happen after draw)
        }
        const key = Math.round(info.start * 1e6);
        const isTuplet = info.tupletId !== null;
        const cur = byTime.get(key);
        if (!cur)
            byTime.set(key, { t: info.start, x, tuplet: isTuplet });
        else {
            cur.x = Math.min(cur.x, x);
            cur.tuplet = cur.tuplet && isTuplet;
        }
    }
    const onsets = [...byTime.values()].sort((a, b) => a.t - b.t);
    if (onsets.length === 0) {
        const x0 = stave.getNoteStartX();
        for (let k = Math.floor(startTime / gridDivision + 1e-9) + 1;; k++) {
            const t = round(k * gridDivision);
            if (t >= endTime - 1e-9)
                break;
            lines.push({ t, x: x0 + ((t - startTime) / (endTime - startTime)) * (xEnd - x0), kind: 'sub' });
        }
    }
    else {
        onsets.forEach((o, i) => {
            if (o.tuplet) {
                lines.push({ t: o.t, x: o.x, kind: 'tuplet' });
                return;
            }
            lines.push({ t: o.t, x: o.x, kind: 'onset' });
            const next = onsets[i + 1] ?? { t: endTime, x: xEnd };
            if (next.t - o.t < 1e-9)
                return;
            for (let k = Math.floor(o.t / gridDivision + 1e-9) + 1;; k++) {
                const t = round(k * gridDivision);
                if (t >= next.t - 1e-9)
                    break;
                lines.push({ t, x: o.x + ((t - o.t) / (next.t - o.t)) * (next.x - o.x), kind: 'sub' });
            }
        });
    }
    layout.measures.push({ index: measureIndex, startTime, endTime, xStart, xEnd, yTop, yBottom, baseTop, baseBottom, lines });
}
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Time / note lookup helpers
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
function findMeasureAtX(partName, x) {
    const layout = gridLayout[partName];
    if (!layout || !layout.measures.length)
        return null;
    for (const m of layout.measures) {
        if (x >= m.xStart && x <= m.xEnd)
            return m;
    }
    return x < layout.measures[0].xStart ? layout.measures[0] : layout.measures[layout.measures.length - 1];
}
// Continuous (unsnapped) time estimate under a given x, for picking a raw anchor point.
function rawTimeFromX(partName, x) {
    const m = findMeasureAtX(partName, x);
    if (!m)
        return 0;
    const sorted = [...m.lines].sort((a, b) => a.x - b.x);
    if (x <= sorted[0].x)
        return sorted[0].t;
    if (x >= sorted[sorted.length - 1].x)
        return sorted[sorted.length - 1].t;
    for (let i = 0; i < sorted.length - 1; i++) {
        if (x >= sorted[i].x && x <= sorted[i + 1].x) {
            const span = sorted[i + 1].x - sorted[i].x;
            const frac = span > 1e-9 ? (x - sorted[i].x) / span : 0;
            return sorted[i].t + frac * (sorted[i + 1].t - sorted[i].t);
        }
    }
    return sorted[sorted.length - 1].t;
}
// Nearest grid line of any kind (used for exact-mode snapping).
function nearestLine(partName, x) {
    const m = findMeasureAtX(partName, x);
    if (!m || !m.lines.length)
        return null;
    let best = m.lines[0];
    let bestDist = Math.abs(best.x - x);
    for (const line of m.lines) {
        const d = Math.abs(line.x - x);
        if (d < bestDist) {
            best = line;
            bestDist = d;
        }
    }
    return best;
}
// Finds the note (or rest) whose [start, start+dur) covers time t.
function findNoteAtTime(staff, t) {
    for (const measureNotes of staff.notes) {
        for (const n of measureNotes) {
            const info = noteTiming.get(n);
            if (!info)
                continue;
            if (t >= info.start - 1e-9 && t < info.start + info.dur - 1e-9) {
                return { ...info, note: n };
            }
        }
    }
    return null;
}
// Expands a single note's range to cover its whole tie group, if it has one.
function expandToTieGroup(staff, note, start, end) {
    for (const group of staff.ties) {
        if (group.includes(note)) {
            let gStart = start, gEnd = end;
            for (const n of group) {
                const info = noteTiming.get(n);
                if (!info)
                    continue;
                gStart = Math.min(gStart, info.start);
                gEnd = Math.max(gEnd, info.start + info.dur);
            }
            return { start: gStart, end: gEnd };
        }
    }
    return { start, end };
}
function pickEdge(partName, x) {
    const line = nearestLine(partName, x);
    return line ? line.t : rawTimeFromX(partName, x);
}
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Rendering: grid lines + selection highlight
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
function gridPosition(t, measureStart) {
    const v = (t - measureStart) / gridDivision + 1;
    const truncated = Math.floor(v * 10 + 1e-6) / 10;
    return String(truncated);
}
function timeToX(partName, t) {
    const layout = gridLayout[partName];
    if (!layout)
        return 0;
    for (const m of layout.measures) {
        if (t >= m.startTime - 1e-9 && t <= m.endTime + 1e-9) {
            const sorted = [...m.lines].sort((a, b) => a.t - b.t);
            if (t <= sorted[0].t)
                return sorted[0].x;
            if (t >= sorted[sorted.length - 1].t)
                return sorted[sorted.length - 1].x;
            for (let i = 0; i < sorted.length - 1; i++) {
                if (t >= sorted[i].t && t <= sorted[i + 1].t) {
                    const span = sorted[i + 1].t - sorted[i].t;
                    const frac = span > 1e-9 ? (t - sorted[i].t) / span : 0;
                    return sorted[i].x + frac * (sorted[i + 1].x - sorted[i].x);
                }
            }
        }
    }
    return 0;
}
// Called from drawAllVoices() after everything is drawn. Also re-renders on its own
// whenever selection state changes (setSelection), without touching the notation.
// Is this voice drawn anywhere in [s, e)? A note counts, and so does a rest that is actually shown.
function voiceActiveIn(v, s, e) {
    const first = measureIndexAt(s);
    const last = measureIndexAt(round(e - 1e-6));
    for (let bar = first; bar <= last; bar++) {
        if (!voiceShownInBar(v, bar))
            continue;
        for (const n of v.notes[bar] || []) {
            const info = noteTiming.get(n);
            if (!info || info.start >= e - 1e-9 || info.start + info.dur <= s + 1e-9)
                continue;
            if (n.render_options && n.render_options.draw === false)
                continue; // a hidden duplicate rest
            return true;
        }
    }
    return false;
}
function renderGridOverlays(staffList) {
    for (const staff of staffList) {
        const layout = gridLayout[staff.name];
        const svg = containers[staff.name]?.querySelector('svg');
        if (!layout || !svg)
            continue;
        svg.querySelector('.gridOverlay')?.remove();
        const g = document.createElementNS(SVG_NS, 'g');
        g.setAttribute('class', 'gridOverlay');
        g.setAttribute('pointer-events', 'none');
        const seen = new Set();
        for (const m of layout.measures) {
            for (const line of m.lines) {
                const key = `${line.kind}:${Math.round(line.x)}`;
                if (seen.has(key))
                    continue;
                seen.add(key);
                const el = document.createElementNS(SVG_NS, 'line');
                el.setAttribute('class', `gridLine gridLine-${line.kind}`);
                el.setAttribute('x1', String(line.x));
                el.setAttribute('x2', String(line.x));
                el.setAttribute('y1', String(m.baseTop));
                el.setAttribute('y2', String(m.baseBottom));
                g.appendChild(el);
                if (line.kind === 'onset' || line.kind === 'tuplet') {
                    const label = document.createElementNS(SVG_NS, 'text');
                    label.setAttribute('class', 'gridLabel');
                    label.setAttribute('x', String(line.x + 2));
                    label.setAttribute('y', String(m.baseTop - 3));
                    label.textContent = gridPosition(line.t, m.startTime);
                    g.appendChild(label);
                }
            }
        }
        if (typeof scheduleEditRefresh === 'function')
            scheduleEditRefresh();
        // Selection highlight (or the live preview while a handle is being dragged)
        const preview = handlePreview && handlePreview.partName === staff.name ? handlePreview : null;
        const realSel = selections[currentLayer][staff.name];
        const sel = preview ?? realSel;
        const band = selectionBand(staff.name);
        if (sel && band) {
            const yTop = band.yTop;
            const yBottom = band.yBottom;
            const x1 = timeToX(staff.name, sel.start);
            const x2 = timeToX(staff.name, sel.end);
            const rect = document.createElementNS(SVG_NS, 'rect');
            rect.setAttribute('class', 'selectionHighlight');
            rect.setAttribute('x', String(Math.min(x1, x2)));
            rect.setAttribute('y', String(yTop));
            rect.setAttribute('width', String(Math.max(1, Math.abs(x2 - x1))));
            rect.setAttribute('height', String(yBottom - yTop));
            g.appendChild(rect);
            // Outline every selected note of the selected voice (nothing is outlined while all voices are selected)
            if (!preview && realSel && realSel.voice && realSel.voice !== 'all') {
                for (const voice of selectionTargets(staff, realSel)) {
                    for (const bar of voice.notes) {
                        for (const n of bar) {
                            const info = noteTiming.get(n);
                            if (!info || info.start < sel.start - 1e-6 || info.start + info.dur > sel.end + 1e-6)
                                continue;
                            if (n.render_options && n.render_options.draw === false)
                                continue;
                            try {
                                const ys = n.getYs();
                                const left = n.getNoteHeadBeginX();
                                const right = typeof n.getNoteHeadEndX === 'function' ? n.getNoteHeadEndX() : left + 14;
                                const box = document.createElementNS(SVG_NS, 'rect');
                                box.setAttribute('class', 'noteOutline');
                                box.setAttribute('x', String(left - 3));
                                box.setAttribute('y', String(Math.min(...ys) - 8));
                                box.setAttribute('width', String(Math.max(10, right - left) + 6));
                                box.setAttribute('height', String(Math.max(...ys) - Math.min(...ys) + 16));
                                box.setAttribute('rx', '4');
                                g.appendChild(box);
                            }
                            catch (e) {
                                // not drawn yet
                            }
                        }
                    }
                }
            }
            // Resize handles: only when exactly one (non-tuplet) note is selected
            const selectDragging = !!drag && drag.kind === 'select' && drag.moved;
            if (!selectDragging && (preview || getSingleNoteSelection(staff))) {
                for (const hx of [x1, x2]) {
                    const h = document.createElementNS(SVG_NS, 'rect');
                    h.setAttribute('class', 'selectionHandle');
                    h.setAttribute('x', String(hx - HANDLE_W / 2));
                    h.setAttribute('y', String(yTop));
                    h.setAttribute('width', String(HANDLE_W));
                    h.setAttribute('height', String(yBottom - yTop));
                    g.appendChild(h);
                }
            }
        }
        svg.appendChild(g);
    }
}
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Mouse interaction
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
const HANDLE_W = 3;
const HANDLE_HIT = 8;
const DRAG_THRESHOLD = 4;
let drag = null;
let handlePreview = null;
function localPoint(partName, e) {
    const svg = containers[partName]?.querySelector('svg');
    if (!svg)
        return null;
    const r = svg.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
}
// The vertical extent of a selection's highlight: always the stave's own band, however high or low the notes reach
function selectionBand(partName) {
    const layout = gridLayout[partName];
    if (!layout || !layout.measures.length)
        return null;
    return { yTop: layout.measures[0].baseTop, yBottom: layout.measures[0].baseBottom };
}
// The vertical extent of a staff's drawing: the stave, plus any notes that reach beyond it
function staffBand(partName) {
    const layout = gridLayout[partName];
    if (!layout || !layout.measures.length)
        return null;
    return {
        yTop: Math.min(...layout.measures.map(m => m.yTop)),
        yBottom: Math.max(...layout.measures.map(m => m.yBottom)),
    };
}
function inStaffBand(partName, y) {
    const band = selectionBand(partName);
    return !!band && y >= band.yTop && y <= band.yBottom;
}
// Range of the selection if it is exactly one non-tuplet note (tie groups count as one note)
// Range of the selection if it is exactly one non-tuplet note of the selected voice (tie groups count as one note)
// Range of the selection if it is exactly one non-tuplet note of one voice (tie groups count as one note)
function getSingleNoteSelection(staff) {
    const sel = getSelection(staff.name);
    if (!sel)
        return null;
    const targets = selectionTargets(staff, sel);
    if (targets.length !== 1)
        return null;
    const store = targets[0];
    const hit = findNoteAtTime(store, sel.start + 1e-6);
    if (!hit || hit.tupletId !== null)
        return null;
    const span = expandToTieGroup(store, hit.note, hit.start, hit.start + hit.dur);
    const same = Math.abs(span.start - sel.start) < 1e-6 && Math.abs(span.end - sel.end) < 1e-6;
    return same ? { ...span, voice: sel.voice, base: sel.base } : null;
}
function handleHit(partName, x) {
    const staff = getActiveStaves()[partName];
    const range = staff ? getSingleNoteSelection(staff) : null;
    if (!range)
        return null;
    const dl = Math.abs(x - timeToX(partName, range.start));
    const dr = Math.abs(x - timeToX(partName, range.end));
    if (Math.min(dl, dr) > HANDLE_HIT)
        return null;
    return { side: dl <= dr ? 'left' : 'right', range };
}
function tupletSpans(staff) {
    return getAtoms(staff).filter(a => a.isTuplet).map(a => ({ start: a.start, end: a.end }));
}
function insideTuplet(spans, t) {
    return spans.some(s => t > s.start + 1e-9 && t < s.end - 1e-9);
}
// Nearest grid line to x that is a legal edge for this handle
function pickHandleTime(partName, x, d) {
    const fallback = d.side === 'left' ? d.origStart : d.origEnd;
    const m = findMeasureAtX(partName, x);
    if (!m)
        return fallback;
    let best = null;
    let bestDist = Infinity;
    for (const line of m.lines) {
        if (insideTuplet(d.invalid, line.t))
            continue;
        if (d.side === 'left' && line.t >= d.origEnd - 1e-9)
            continue;
        if (d.side === 'right' && line.t <= d.origStart + 1e-9)
            continue;
        const dist = Math.abs(line.x - x);
        if (dist < bestDist) {
            best = line;
            bestDist = dist;
        }
    }
    return best ? best.t : fallback;
}
// Overwrite-style resize: whatever the new span covers is replaced; time the note gives up becomes a rest.
// Overwrite-style resize of a note in one voice: whatever the new span covers is replaced; time the note gives up becomes a rest.
function resizeNote(store, oldStart, oldEnd, newStart, newEnd) {
    const total = totalLength();
    newStart = Math.max(0, newStart);
    newEnd = Math.min(total, newEnd);
    if (newEnd - newStart < 1e-9)
        return false;
    const orig = sliceRange(store, oldStart, oldEnd);
    if (!orig.ok || orig.selected.length === 0 || orig.selected[0].tupletInfo)
        return false;
    const source = orig.selected[0];
    const rStart = Math.min(oldStart, newStart);
    const rEnd = Math.max(oldEnd, newEnd);
    const { before, after, ok } = sliceRange(store, rStart, rEnd);
    if (!ok) {
        alert('That change would cut through a tuplet.');
        return false;
    }
    const lead = newStart - rStart > 1e-9 ? fillDurationWithRests(round(newStart - rStart), rStart) : [];
    const note = fillDurationAsUnprocessed(round(newEnd - newStart), source);
    const trail = rEnd - newEnd > 1e-9 ? fillDurationWithRests(round(rEnd - newEnd), newEnd) : [];
    if (before.length)
        before[before.length - 1].tiedToNext = false;
    const newNotes = [...before, ...lead, ...note, ...trail, ...after];
    renumberTuplets(newNotes);
    resetVoice(store);
    processNotes(store, newNotes);
    return true;
}
// Tracks from the one the drag started on to the one under the cursor (inclusive)
function tracksSpanned(anchorName, clientY) {
    const anchorIdx = staves.indexOf(anchorName);
    let curIdx = anchorIdx;
    let best = Infinity;
    staves.forEach((name, i) => {
        const r = containers[name].getBoundingClientRect();
        const dist = clientY < r.top ? r.top - clientY : clientY > r.bottom ? clientY - r.bottom : 0;
        if (dist < best) {
            best = dist;
            curIdx = i;
        }
    });
    return staves.slice(Math.min(anchorIdx, curIdx), Math.max(anchorIdx, curIdx) + 1);
}
function setSelectionsBulk(next, lastName) {
    if (!gridViewOn)
        return;
    for (const name of staves)
        selections[currentLayer][name] = next[name] ?? null;
    if (next[lastName])
        lastSelectedStaff[currentLayer] = lastName;
    renderGridOverlays(Object.values(getActiveStaves()));
}
function updateSelectDrag(d, e) {
    const staff = getActiveStaves()[d.partName];
    const pt = localPoint(d.partName, e);
    if (!staff || !pt)
        return;
    if (!d.moved) {
        if (Math.hypot(e.clientX - d.startClientX, e.clientY - d.startClientY) < DRAG_THRESHOLD)
            return;
        d.moved = true;
    }
    if (currentTab === 'create') {
        const a = pickEdge(d.partName, timeToX(d.partName, d.anchorT));
        const b = pickEdge(d.partName, pt.x);
        const start = Math.min(a, b);
        const end = Math.max(a, b);
        const empty = end - start < 1e-9;
        const span = tracksSpanned(d.partName, e.clientY);
        const next = {};
        for (const name of staves) {
            if (empty) {
                next[name] = name === d.partName && d.anchorRange ? d.anchorRange : (d.before[name] ?? null);
            }
            else {
                next[name] = span.includes(name) ? { start, end, voice: 'all', base: { start, end } } : (d.before[name] ?? null);
            }
        }
        setSelectionsBulk(next, d.partName);
        return;
    }
    // Edit: from the note pressed to the note under the cursor, whole notes of every voice
    if (!d.anchorBase)
        return;
    const total = totalLength();
    const t = Math.min(Math.max(rawTimeFromX(d.partName, pt.x), 0), total - 1e-6);
    const base = { start: Math.min(d.anchorBase.start, t), end: Math.max(d.anchorBase.end, t + 1e-6) };
    setSelection(d.partName, makeSelection(staff, base, 'all'));
}
function updateHandleDrag(d, e) {
    const pt = localPoint(d.partName, e);
    if (!pt)
        return;
    const t = pickHandleTime(d.partName, pt.x, d);
    handlePreview = d.side === 'left'
        ? { partName: d.partName, start: t, end: d.origEnd }
        : { partName: d.partName, start: d.origStart, end: t };
    renderGridOverlays(Object.values(getActiveStaves()));
}
function getUnprocessedTimeline(notes) {
    const timeline = [];
    let t = 0;
    let tupletStart = 0;
    notes.forEach((note, index) => {
        if (note.tupletInfo) {
            const { totalTupletDuration, count, index: tIndex, id } = note.tupletInfo;
            if (tIndex === 1)
                tupletStart = t;
            const perNote = totalTupletDuration / count;
            timeline.push({ start: round(tupletStart + (tIndex - 1) * perNote), dur: perNote, tupletId: id, index });
            if (tIndex === count)
                t = round(tupletStart + totalTupletDuration);
        }
        else {
            const dur = getNoteDuration(note);
            timeline.push({ start: t, dur, tupletId: null, index });
            t = round(t + dur);
        }
    });
    return timeline;
}
function cloneNotes(notes) {
    return notes.map(n => {
        const c = new UnprocessedNote([...n.noteName], [...n.octaves], n.duration, n.dotted, n.tiedToNext);
        if (n.tupletInfo)
            c.tupletInfo = { ...n.tupletInfo };
        return c;
    });
}
function renumberTuplets(notes) {
    let id = 0;
    for (const n of notes) {
        if (!n.tupletInfo)
            continue;
        if (n.tupletInfo.index === 1)
            id++;
        n.tupletInfo = { ...n.tupletInfo, id };
    }
}
// True if any tuplet starting inside [rangeStart, rangeEnd) crosses a barline.
function tupletCrossesBarline(notes, rangeStart, rangeEnd) {
    const timeline = getUnprocessedTimeline(notes);
    let groupStart = 0;
    for (const e of timeline) {
        const info = notes[e.index].tupletInfo;
        if (!info)
            continue;
        if (info.index === 1)
            groupStart = e.start;
        if (info.index === info.count) {
            if (groupStart < rangeStart - 1e-9 || groupStart >= rangeEnd - 1e-9)
                continue;
            const end = round(e.start + e.dur);
            const startMeasure = measureIndexAt(groupStart);
            const endMeasure = measureIndexAt(round(end - 1e-6));
            if (startMeasure !== endMeasure)
                return true;
        }
    }
    return false;
}
function getAtoms(staff) {
    const atoms = [];
    const notes = staff.unprocessedNotes;
    let t = 0;
    let i = 0;
    while (i < notes.length) {
        const note = notes[i];
        if (note.tupletInfo) {
            const group = [];
            const start = t;
            let total = 0;
            while (i < notes.length) {
                const info = notes[i].tupletInfo;
                group.push(notes[i]);
                total = info.totalTupletDuration;
                i++;
                if (info.index === info.count)
                    break;
            }
            t = round(start + total);
            atoms.push({ notes: group, start, end: t, isTuplet: true });
        }
        else {
            const dur = getNoteDuration(note);
            atoms.push({ notes: [note], start: t, end: round(t + dur), isTuplet: false });
            t = round(t + dur);
            i++;
        }
    }
    console.log('atoms', staff.name, atoms.length);
    return atoms;
}
function sliceRange(staff, start, end) {
    const atoms = getAtoms(staff);
    const before = [];
    const selected = [];
    const after = [];
    for (const atom of atoms) {
        if (atom.end <= start + 1e-9) {
            before.push(...atom.notes);
        }
        else if (atom.start >= end - 1e-9) {
            after.push(...atom.notes);
        }
        else if (atom.start >= start - 1e-9 && atom.end <= end + 1e-9) {
            selected.push(...atom.notes);
        }
        else if (atom.isTuplet) {
            return { before: [], selected: [], after: [], ok: false };
        }
        else {
            const note = atom.notes[0];
            if (atom.start < start) {
                const beforeDur = round(start - atom.start);
                before.push(...fillDurationAsUnprocessed(beforeDur, note));
                const remainingDur = round(atom.end - start);
                if (remainingDur > 1e-9) {
                    if (round(start + remainingDur) <= end + 1e-9) {
                        selected.push(...fillDurationAsUnprocessed(remainingDur, note));
                    }
                    else {
                        const selDur = round(end - start);
                        const afterDur = round(remainingDur - selDur);
                        selected.push(...fillDurationAsUnprocessed(selDur, note));
                        after.push(...fillDurationAsUnprocessed(afterDur, note));
                    }
                }
            }
            else {
                const selDur = round(end - atom.start);
                const afterDur = round(atom.end - end);
                selected.push(...fillDurationAsUnprocessed(selDur, note));
                after.push(...fillDurationAsUnprocessed(afterDur, note));
            }
        }
    }
    return { before, selected, after, ok: true };
}
// What a transform would do to one voice's part of a selection: the voice's new notes, or null if it can't be done
// Rests for [startPos, startPos + duration), written the way they are read: the largest first, never across a
// barline, and each one starting where a rest of its size belongs (a half rest on beat 1 or 3, never on beat 2)
// barline, and following the measure's beat groups. A rest stays inside one group, or covers whole groups from
// one group's start to another's end. In simple time (2/2, 3/4, 4/4...) a rest also starts where one of its
// size belongs: a half rest on beat 1 or 3, never on beat 2.
function naturalRests(duration, startPos) {
    const rests = [];
    let remaining = round(duration);
    let pos = round(startPos);
    while (remaining > 1e-9) {
        const bar = measureIndexAt(pos);
        const barStart = measureStartOf(bar);
        const into = round(pos - barStart);
        const limit = Math.min(remaining, spaceToBarline(pos));
        const cuts = groupCuts(bar);
        const simple = sigOf(bar).den <= 4;
        const near = (x, y) => Math.abs(x - y) < 1e-9;
        const onCut = (x) => cuts.some(c => near(c, x));
        let pick = null;
        for (const [key, val] of durationsLargestFirst) {
            if (val > limit + 1e-9)
                continue;
            const end = round(into + val);
            const whole = near(into, 0) && near(end, cuts[cuts.length - 1]);
            const inOne = cuts.some((c, k) => k < cuts.length - 1 && into >= c - 1e-9 && end <= cuts[k + 1] + 1e-9);
            if (!(whole || inOne || (onCut(into) && onCut(end))))
                continue;
            if (simple) {
                const unit = key.endsWith('d') ? val * 4 / 3 : val;
                const k = into / unit;
                if (Math.abs(k - Math.round(k)) > 1e-6)
                    continue;
            }
            pick = [key, val];
            break;
        }
        if (!pick) {
            rests.push(...greedyRests(remaining, pos));
            break;
        }
        rests.push(new UnprocessedNote(['Rest'], 4, pick[0], false));
        remaining = round(remaining - pick[1]);
        pos = round(pos + pick[1]);
    }
    return rests;
}
// Merges every run of plain rests that contains a "fresh" one (fresh(index, start, end)) into the fewest natural
// rests, so deleted notes leave one tidy rest instead of a copy of each note's length. Rests inside a tuplet stay.
function coalesceRests(notes, fresh) {
    const starts = [];
    const ends = [];
    let pos = 0;
    for (const n of notes) {
        const d = n.tupletInfo ? n.tupletInfo.totalTupletDuration / n.tupletInfo.count : getNoteDuration(n);
        starts.push(round(pos));
        pos = round(pos + d);
        ends.push(pos);
    }
    const plain = (n) => n.isRest && !n.tupletInfo;
    const out = [];
    let i = 0;
    while (i < notes.length) {
        if (!plain(notes[i])) {
            out.push(notes[i]);
            i++;
            continue;
        }
        let j = i;
        while (j < notes.length && plain(notes[j]))
            j++;
        let any = false;
        for (let k = i; k < j; k++)
            if (fresh(k, starts[k], ends[k]))
                any = true;
        if (any)
            out.push(...naturalRests(round(ends[j - 1] - starts[i]), starts[i]));
        else
            out.push(...notes.slice(i, j));
        i = j;
    }
    return out;
}
// What deleting these notes leaves behind: a rest for each note, and for a tuplet one set of ordinary rests (the
// tuplet itself goes). The rests are merged afterwards by computeRangeEdit.
function clearedToRests(notes, startOffset) {
    const out = [];
    let pos = startOffset;
    let groupStart = startOffset;
    for (const n of notes) {
        if (n.tupletInfo) {
            if (n.tupletInfo.index === 1)
                groupStart = pos;
            pos = round(pos + n.tupletInfo.totalTupletDuration / n.tupletInfo.count);
            if (n.tupletInfo.index === n.tupletInfo.count)
                out.push(...naturalRests(n.tupletInfo.totalTupletDuration, groupStart));
        }
        else {
            out.push(n.isRest ? n : new UnprocessedNote(['Rest'], 4, n.duration, n.dotted, false));
            pos = round(pos + getNoteDuration(n));
        }
    }
    return out;
}
function computeRangeEdit(store, sel, transform) {
    // Pad the voice with rests up to the end of the piece
    const neededLength = totalLength();
    const haveLength = getTotalDuration(store);
    if (haveLength < neededLength - 1e-9) {
        const padded = [...store.unprocessedNotes, ...fillDurationWithRests(round(neededLength - haveLength), haveLength)];
        resetVoice(store);
        processNotes(store, padded);
    }
    const { before, selected, after, ok } = sliceRange(store, sel.start, sel.end);
    if (!ok) {
        alert(`Selection in ${store.name} cuts through a tuplet — adjust it to cover the whole tuplet.`);
        return null;
    }
    let transformed = [];
    let valid = false;
    for (let attempt = 0; attempt < 30 && !valid; attempt++) {
        transformed = transform(cloneNotes(selected), sel.start);
        valid = !tupletCrossesBarline([...before, ...transformed, ...after], sel.start, sel.end);
    }
    if (!valid) {
        alert(`Couldn't fit the tuplets in ${store.name} within their measures — try a different selection.`);
        return null;
    }
    const newNotes = [...before, ...transformed, ...after];
    const beforeLen = before.length;
    const selLen = transformed.length;
    if (beforeLen > 0 && beforeLen - 1 < newNotes.length)
        newNotes[beforeLen - 1].tiedToNext = false;
    if (beforeLen + selLen > 0 && beforeLen + selLen - 1 < newNotes.length)
        newNotes[beforeLen + selLen - 1].tiedToNext = false;
    // Rests in or beside the selection are merged, so several rests in a row read the way they would be written
    const merged = coalesceRests(newNotes, (_k, s, e) => s < sel.end - 1e-9 && e > sel.start + 1e-9);
    renumberTuplets(merged);
    return merged;
}
// Runs a transform on each listed voice's part of a selection. Nothing changes unless every one of them can be done.
function applyRangeJobs(sel, jobs) {
    const results = [];
    for (const job of jobs) {
        const notes = computeRangeEdit(job.store, sel, job.transform);
        if (!notes)
            return false;
        results.push({ store: job.store, notes });
    }
    for (const r of results) {
        resetVoice(r.store);
        processNotes(r.store, r.notes);
    }
    return results.length > 0;
}
// Generate Phrase: clears the selection and writes a new phrase into the selected voice. With all voices
// selected, every voice in the range is cleared and the phrase goes into Up 1.
function generateIntoSelection(staff) {
    const sel = getSelection(staff.name);
    if (!sel)
        return false;
    const targets = selectionTargets(staff, sel);
    const allSelected = !sel.voice || sel.voice === 'all';
    const writer = allSelected ? staff : targets[0];
    const generate = (notes, startOffset) => {
        const duration = round(sumUnprocessedDuration(notes));
        const temp = new Staff(staff.name, staff.pitchRange, staff.rhythmRange, staff.scale);
        temp.harmonize = staff.harmonize;
        totalDuration = startOffset;
        generatePhrase(temp, duration, true, startOffset);
        return temp.unprocessedNotes.length > 0 ? temp.unprocessedNotes : notes;
    };
    const clear = clearedToRests;
    const jobs = targets.map(store => ({ store, transform: store === writer ? generate : clear }));
    if (!jobs.some(j => j.store === writer))
        jobs.push({ store: writer, transform: generate });
    return applyRangeJobs(sel, jobs);
}
// Runs transform(selectedNotes, selectionStartOffset) on the part of the staff covered by its selection: in the
// selected voice, or in every voice drawn there when all are selected. Returns false (no-op) if nothing is selected
// on this track or the selection cuts through a tuplet.
function applyToRange(staff, transform) {
    if (!gridViewOn)
        return false;
    const sel = getSelection(staff.name);
    if (!sel)
        return false;
    return applyRangeJobs(sel, selectionTargets(staff, sel).map(store => ({ store, transform })));
}
let lastPlainClick = null;
// Every note and rest sounding at time t in the voices that are drawn there
function candidatesAt(staff, t, y) {
    const bar = measureIndexAt(t);
    const out = [];
    for (const voice of staffVoices(staff)) {
        if (!voiceShownInBar(voice, bar))
            continue;
        const hit = findNoteAtTime(voice, t);
        if (!hit)
            continue;
        const ys = hit.note.getYs();
        const lines = hit.note.isRest() ? [] : hit.note.getKeyProps().map((k) => k.line);
        out.push({
            voice,
            note: hit.note,
            start: hit.start,
            dur: hit.dur,
            top: lines.length ? Math.max(...lines) : -Infinity,
            dist: Math.min(...ys.map(v => Math.abs(v - y))),
        });
    }
    return out;
}
// The note nearest the click; clicking the same spot again goes on to the next note there
// (earliest start first, then highest pitch), and after the last one back to the first.
// The note nearest the press, in whichever voice it is
function pickCandidate(cands, staffName, x, y) {
    if (!cands.length)
        return null;
    const ordered = [...cands].sort((a, b) => a.start - b.start || b.top - a.top);
    let best = ordered[0];
    for (const c of ordered)
        if (c.dist < best.dist - 1e-6)
            best = c;
    return best;
}
function setupGridInteraction() {
    for (const partName of Object.keys(containers)) {
        const el = containers[partName];
        el.addEventListener('mousedown', (e) => {
            if (!gridViewOn || e.button !== 0)
                return;
            const staff = getActiveStaves()[partName];
            const pt = localPoint(partName, e);
            if (!staff || !pt)
                return;
            e.preventDefault();
            // A click on the notation outside the staff's vertical range clears this track's selection;
            // clicking there again brings the cleared selection back
            if (!inStaffBand(partName, pt.y)) {
                blankClick(partName);
                return;
            }
            // 1. Grabbing a resize handle
            const grab = handleHit(partName, pt.x);
            if (grab) {
                const store = selectionStore(staff, selections[currentLayer][partName]);
                drag = {
                    kind: 'handle', partName, side: grab.side,
                    origStart: grab.range.start, origEnd: grab.range.end,
                    invalid: tupletSpans(store),
                };
                handlePreview = { partName, start: grab.range.start, end: grab.range.end };
                document.body.style.cursor = 'ew-resize';
                return;
            }
            // 2. Anywhere else: a click cycles the voice if it is inside the selection, otherwise it selects the
            //    note nearest the press (all voices); moving the mouse turns either into a new drag selection
            const sel = selections[currentLayer][partName];
            const inside = !!sel && pt.x >= timeToX(partName, sel.start) && pt.x <= timeToX(partName, sel.end);
            const total = totalLength();
            const t = rawTimeFromX(partName, pt.x);
            const pick = pickCandidate(candidatesAt(staff, Math.min(t, total - 1e-6), pt.y), partName, pt.x, pt.y);
            let anchorBase = null;
            let anchorRange = null;
            if (pick) {
                const span = expandToTieGroup(pick.voice, pick.note, pick.start, pick.start + pick.dur);
                anchorBase = { start: span.start, end: span.end };
                anchorRange = makeSelection(staff, anchorBase, 'all');
            }
            drag = {
                kind: 'select', partName, anchorT: t, anchorRange, anchorBase, inside,
                before: { ...selections[currentLayer] },
                startClientX: e.clientX, startClientY: e.clientY, moved: false,
            };
        });
        // Resize cursor when hovering a handle
        el.addEventListener('mousemove', (e) => {
            if (drag || !gridViewOn)
                return;
            const pt = localPoint(partName, e);
            el.style.cursor = pt && inStaffBand(partName, pt.y) && handleHit(partName, pt.x) ? 'ew-resize' : '';
        });
    }
    document.addEventListener('mousemove', (e) => {
        const d = drag;
        if (!d)
            return;
        if (d.kind === 'handle')
            updateHandleDrag(d, e);
        else
            updateSelectDrag(d, e);
    });
    document.addEventListener('mouseup', (e) => {
        const d = drag;
        if (!d)
            return;
        drag = null;
        document.body.style.cursor = '';
        if (d.kind === 'select') {
            updateSelectDrag(d, e); // the release position is authoritative for drags
            if (!d.moved) {
                if (d.inside)
                    cycleSelection(d.partName);
                else if (d.anchorRange)
                    setSelection(d.partName, d.anchorRange);
            }
            return;
        }
        updateHandleDrag(d, e);
        const prev = handlePreview;
        handlePreview = null;
        const staff = getActiveStaves()[d.partName];
        const changed = !!prev && (Math.abs(prev.start - d.origStart) > 1e-9 || Math.abs(prev.end - d.origEnd) > 1e-9);
        // Notes are only rebuilt now, on release
        const sel = selections[currentLayer][d.partName];
        const targets = staff ? selectionTargets(staff, sel) : [];
        const store = targets.length === 1 ? targets[0] : null;
        if (store && prev && changed && resizeNote(store, d.origStart, d.origEnd, prev.start, prev.end)) {
            selections[currentLayer][d.partName] = {
                start: prev.start, end: prev.end, voice: sel ? sel.voice : undefined, base: { start: prev.start, end: prev.end },
            };
            drawAllStaves();
            updateMemory();
        }
        else {
            renderGridOverlays(Object.values(getActiveStaves()));
        }
    });
}
setupGridInteraction();
function setGridView(on) {
    gridViewOn = on;
    drag = null;
    handlePreview = null;
    document.body.style.cursor = '';
    document.body.classList.toggle('gridView', on);
    renderGridOverlays(Object.values(getActiveStaves()));
}
document.addEventListener('keydown', (e) => {
    const t = e.target;
    const typing = (t.tagName === 'INPUT' && t.type !== 'range') ||
        t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable;
    if (typing)
        return;
    if ((e.key === 'g' || e.key === 'G') && !e.ctrlKey && !e.metaKey)
        setGridView(!gridViewOn);
});
const gridSlider = document.getElementById('gridSlider');
const gridSliderValue = document.getElementById('gridSliderValue');
gridSlider?.addEventListener('input', () => {
    const i = parseInt(gridSlider.value, 10);
    gridDivision = GRID_DIVISIONS[i];
    gridSliderValue.textContent = GRID_LABELS[i];
    drawAllStaves();
});
gridSlider?.addEventListener('change', () => gridSlider.blur()); // keeps Space/Ctrl shortcuts working
setGridView(true);
/////////////////////////////////////////////////////////////////////////////////////
// Generate
/////////////////////////////////////////////////////////////////////////////////////
function generatePhrase(staff, duration, allowTuplets = true, startOffset = 0) {
    const totalDurationOriginal = totalDuration;
    let notes = [];
    let currentDuration = 0;
    const durationKeys = Object.keys(durationMapping);
    const allowedDurations = [];
    let tupletId = 0;
    for (const durationKey of durationKeys) {
        if (durationMapping[durationKey] >= staff.rhythmRange[0] && durationMapping[durationKey] <= staff.rhythmRange[1]) {
            allowedDurations.push(durationKey);
        }
    }
    if (allowedDurations.length === 0) {
        return;
    }
    const minAllowed = Math.min(...allowedDurations.map(d => durationMapping[d]));
    if (round(duration % minAllowed) > 1e-9) {
        return;
    }
    while (currentDuration < duration) {
        const remaining = round(duration - currentDuration);
        const fittingDurations = allowedDurations.filter(d => durationMapping[d] <= remaining + 1e-9);
        if (fittingDurations.length === 0) {
            currentDuration = 0;
            notes = [];
            totalDuration = totalDurationOriginal;
            continue;
        }
        const durationStr = fittingDurations[Math.floor(Math.random() * fittingDurations.length)];
        const shouldTryTuplet = (allowTuplets &&
            !durationStr.includes("d") &&
            durationMapping[durationStr] < 1 &&
            Math.random() < 0.5 &&
            durationMapping[durationStr] >= 1 / sigOf(measureIndexAt(round(startOffset + currentDuration))).den);
        if (shouldTryTuplet) {
            const notesOccupied = 2;
            const possibleTupletSizes = [3, 5, 7];
            const numTupletNotes = possibleTupletSizes[Math.floor(Math.random() * possibleTupletSizes.length)];
            const realDuration = 2 * durationMapping[durationStr];
            const measureRemaining = spaceToBarline(round(startOffset + currentDuration));
            if (realDuration > measureRemaining + 1e-9)
                continue;
            if (realDuration > remaining + 1e-9)
                continue;
            ++tupletId;
            for (let i = 1; i <= numTupletNotes; i++) {
                const [noteName, noteOctave] = randomPitchFromScale(staff, durationMapping[durationStr]);
                const tupletNote = new UnprocessedNote(noteName, noteOctave, durationStr);
                tupletNote.setTuplet(tupletId, realDuration, [numTupletNotes, notesOccupied], numTupletNotes, i);
                notes.push(tupletNote);
                totalDuration += durationMapping[durationStr] * 2 / numTupletNotes;
            }
            currentDuration = round(currentDuration + realDuration);
        }
        else {
            const [noteName, noteOctave] = randomPitchFromScale(staff, durationMapping[durationStr]);
            notes.push(new UnprocessedNote(noteName, noteOctave, durationStr));
            currentDuration = round(currentDuration + durationMapping[durationStr]);
            totalDuration = round(totalDuration + durationMapping[durationStr]);
        }
    }
    processNotes(staff, notes);
}
/////////////////////////////////////////////////////////////////////////////////////
// Accompany
/////////////////////////////////////////////////////////////////////////////////////
// Cuts notes at the given times (tied pieces), starting from startOffset. Tuplets stay whole.
function splitNotesAt(notes, startOffset, breaks) {
    const out = [];
    let pos = startOffset;
    let groupStart = pos;
    for (const note of notes) {
        if (note.tupletInfo) {
            const info = note.tupletInfo;
            if (info.index === 1)
                groupStart = pos;
            out.push(note);
            if (info.index === info.count)
                pos = round(groupStart + info.totalTupletDuration);
            continue;
        }
        const dur = getNoteDuration(note);
        const end = round(pos + dur);
        const cuts = Array.from(new Set(breaks.map(round)))
            .filter(b => b > pos + 1e-9 && b < end - 1e-9)
            .sort((a, b) => a - b);
        if (cuts.length === 0) {
            out.push(note);
        }
        else {
            const edges = [pos, ...cuts, end];
            for (let i = 0; i < edges.length - 1; i++) {
                const pieces = fillDurationAsUnprocessed(round(edges[i + 1] - edges[i]), note);
                pieces[pieces.length - 1].tiedToNext = i < edges.length - 2 ? true : note.tiedToNext;
                out.push(...pieces);
            }
        }
        pos = end;
    }
    return out;
}
function separateStaff() {
    const active = getActiveStaves();
    const selectedNames = staves.filter(n => getSelection(n)); // `voices` is ordered top to bottom
    if (selectedNames.length < 2)
        return false;
    const sourceName = selectedNames[0]; // highest selected track
    const S = getSelection(sourceName);
    padStavesToLength();
    const srcSlice = sliceRange(active[sourceName], S.start, S.end);
    if (!srcSlice.ok) {
        alert(`Selection in ${sourceName} cuts through a tuplet — adjust it to cover the whole tuplet.`);
        return false;
    }
    // Cut the source's notes wherever another track's range begins or ends
    const breaks = [];
    for (const n of selectedNames) {
        if (n === sourceName)
            continue;
        const r = getSelection(n);
        breaks.push(r.start, r.end);
    }
    const pieces = splitNotesAt(srcSlice.selected, S.start, breaks);
    const timeline = [];
    const tupletAtoms = [];
    let pos = S.start;
    let gStart = pos;
    let gEnd = pos;
    for (const note of pieces) {
        if (note.tupletInfo) {
            const info = note.tupletInfo;
            if (info.index === 1) {
                gStart = pos;
                gEnd = round(pos + info.totalTupletDuration);
                tupletAtoms.push({ start: gStart, end: gEnd });
            }
            const per = info.totalTupletDuration / info.count;
            timeline.push({
                note,
                start: round(gStart + (info.index - 1) * per),
                end: round(gStart + info.index * per),
                atomStart: gStart,
                atomEnd: gEnd,
            });
            if (info.index === info.count)
                pos = gEnd;
        }
        else {
            const d = getNoteDuration(note);
            timeline.push({ note, start: pos, end: round(pos + d), atomStart: pos, atomEnd: round(pos + d) });
            pos = round(pos + d);
        }
    }
    // Each track's effective range: its own range clipped to the source's, never cutting a source tuplet
    const eff = { [sourceName]: { start: S.start, end: S.end } };
    for (const name of selectedNames) {
        if (name === sourceName)
            continue;
        const r = getSelection(name);
        let start = Math.max(r.start, S.start);
        let end = Math.min(r.end, S.end);
        for (const a of tupletAtoms) {
            if (start > a.start + 1e-9 && start < a.end - 1e-9)
                start = a.end;
            if (end > a.start + 1e-9 && end < a.end - 1e-9)
                end = a.start;
        }
        if (end - start > 1e-9)
            eff[name] = { start, end };
    }
    const targets = selectedNames.filter(n => eff[n]);
    if (targets.length < 2)
        return false;
    // Every target must be sliceable before anything is written
    const slices = {};
    for (const name of targets) {
        const s = sliceRange(active[name], eff[name].start, eff[name].end);
        if (!s.ok) {
            alert(`Selection in ${name} cuts through a tuplet — adjust it to cover the whole tuplet.`);
            return false;
        }
        slices[name] = s;
    }
    // Distribute: a piece may only go to a track whose range covers it
    const out = {};
    for (const name of targets)
        out[name] = [];
    let chainTarget = null; // keeps a tied chain in one track while that stays possible
    for (const p of timeline) {
        const note = p.note;
        totalDuration = p.start;
        const covering = targets.filter(n => eff[n].start <= p.atomStart + 1e-9 && eff[n].end >= p.atomEnd - 1e-9);
        const canon = note.isRest ? null : canonicalPitch(note.noteName[0], note.octaves[0]);
        const candidates = covering.filter(n => note.isRest || getAllowedPitches(active[n], getNoteDuration(note)).includes(canon.name + canon.octave));
        let target;
        if (chainTarget && covering.includes(chainTarget)) {
            target = chainTarget;
        }
        else {
            target = candidates.length > 0
                ? candidates[Math.floor(Math.random() * candidates.length)]
                : sourceName;
        }
        chainTarget = note.tiedToNext && !note.isRest ? target : null;
        for (const name of targets) {
            const r = eff[name];
            if (p.start < r.start - 1e-9 || p.end > r.end + 1e-9)
                continue; // outside this track's range
            const newNote = (name === target && !note.isRest)
                ? new UnprocessedNote([...note.noteName], [...note.octaves], note.duration, note.dotted, note.tiedToNext)
                : new UnprocessedNote(["Rest"], 4, note.duration, note.dotted);
            if (note.tupletInfo)
                newNote.tupletInfo = { ...note.tupletInfo };
            out[name].push(newNote);
        }
    }
    for (const name of targets) {
        const { before, after } = slices[name];
        const newNotes = [...before, ...out[name], ...after];
        renumberTuplets(newNotes);
        if (before.length > 0)
            newNotes[before.length - 1].tiedToNext = false;
        const endIdx = before.length + out[name].length - 1;
        if (endIdx >= 0 && endIdx < newNotes.length)
            newNotes[endIdx].tiedToNext = false;
        resetStaff(active[name]);
        processNotes(active[name], newNotes);
    }
    return true;
}
/////////////////////////////////////////////////////////////////////////////////////
// Modify
/////////////////////////////////////////////////////////////////////////////////////
function reverseNotes(notes) {
    const reversed = [...notes].reverse();
    for (const note of reversed) {
        if (note.tupletInfo) {
            const { id, totalTupletDuration, ratio, count, index } = note.tupletInfo;
            note.tupletInfo = { id, totalTupletDuration, ratio, count, index: count - index + 1 };
        }
    }
    return reversed;
}
function reflectNotes(notes, staff, axisPitch) {
    const axisOctave = 4;
    const scale = scalesMapping[staff.scale[1]];
    const axisDistanceFromRoot = Math.abs(noteMapping[staff.scale[0]] - noteMapping[axisPitch]);
    const axisScalarIndex = scale.indexOf(axisDistanceFromRoot);
    const reflectedNotes = [];
    for (const note of notes) {
        let reflectedNote;
        if (note.isRest) {
            reflectedNote = new UnprocessedNote(note.noteName, note.octave, getDurationString(note));
        }
        else {
            const canon = canonicalPitch(note.noteName[0], note.octaves[0]);
            const noteNameStr = canon.name;
            let workScale = scale;
            const noteIsInScale = checkNoteInScale(note, staff);
            if (!noteIsInScale)
                workScale = scalesMapping["Chromatic"];
            const noteDistanceFromRoot = Math.abs(noteMapping[staff.scale[0]] - noteMapping[noteNameStr]);
            const noteScalarIndex = workScale.indexOf(noteDistanceFromRoot);
            let reflectedScalarIndex;
            if (axisScalarIndex === -1 && noteIsInScale) {
                let searchInterval = axisDistanceFromRoot;
                while (workScale.indexOf(searchInterval % 12) === -1)
                    searchInterval++;
                const nearestScaleDegree = workScale.indexOf(searchInterval % 12);
                const distanceFromNearest = Math.abs((noteScalarIndex - nearestScaleDegree + workScale.length) % workScale.length);
                reflectedScalarIndex = (nearestScaleDegree - distanceFromNearest - 1 + workScale.length) % workScale.length;
            }
            else {
                reflectedScalarIndex = ((axisScalarIndex - noteScalarIndex) + axisScalarIndex + workScale.length) % workScale.length;
            }
            const reflectedPitchIndex = (noteMapping[staff.scale[0]] + workScale[reflectedScalarIndex]) % 12;
            const reflectedPitch = Object.keys(noteMapping).find(key => noteMapping[key] === reflectedPitchIndex);
            const noteAbs = canon.octave * 12 + noteDistanceFromRoot;
            const axisAbs = axisOctave * 12 + axisDistanceFromRoot;
            let newOctave = Math.floor((2 * axisAbs - noteAbs) / 12);
            const noteIdx = pitchIndex(reflectedPitch + newOctave);
            const minIdx = pitchIndex(staff.pitchRange[0]);
            const maxIdx = pitchIndex(staff.pitchRange[1]);
            if (noteIdx < minIdx)
                newOctave += Math.ceil((minIdx - noteIdx) / 12);
            else if (noteIdx > maxIdx)
                newOctave -= Math.ceil((noteIdx - maxIdx) / 12);
            reflectedNote = new UnprocessedNote([reflectedPitch], newOctave, getDurationString(note));
        }
        if (note.tupletInfo)
            reflectedNote.tupletInfo = { ...note.tupletInfo };
        reflectedNotes.push(reflectedNote);
    }
    return reflectedNotes;
}
// Shift: every voice of the staff moves later by the same amount
function shiftStaff(staff, distance) {
    const shiftDur = durationMapping[distance];
    // Plan every voice first; nothing changes unless all of them can shift
    const plans = [];
    for (const voice of staffVoices(staff)) {
        // Check tuplets won't cross barlines after shift
        let currentPos = shiftDur;
        for (const note of voice.unprocessedNotes) {
            if (note.tupletInfo) {
                const { index, count, totalTupletDuration } = note.tupletInfo;
                if (index === 1) {
                    const measureEnd = barlineAfter(round(currentPos));
                    if (currentPos + totalTupletDuration > measureEnd) {
                        console.warn("Shift rejected: tuplet would cross measure boundary");
                        return;
                    }
                }
                if (index === count)
                    currentPos += totalTupletDuration;
            }
            else {
                currentPos += getNoteDuration(note);
            }
        }
        const shifted = [new UnprocessedNote(["Rest"], 4, distance), ...voice.unprocessedNotes];
        let totalDur = 0;
        for (const note of shifted) {
            if (note.tupletInfo) {
                if (note.tupletInfo.index === note.tupletInfo.count)
                    totalDur += note.tupletInfo.totalTupletDuration;
            }
            else {
                totalDur += getNoteDuration(note);
            }
        }
        totalDur = round(totalDur);
        const remainder = posInMeasureAt(totalDur) > 1e-9 ? spaceToBarline(totalDur) : 0;
        if (remainder > 1e-9)
            shifted.push(...fillDurationWithRests(remainder, totalDur));
        plans.push({ voice, notes: shifted });
    }
    for (const plan of plans) {
        resetVoice(plan.voice);
        processNotes(plan.voice, plan.notes);
    }
    drawAllStaves();
}
function transposeNotes(notes, staff, scaleDegreeDifference) {
    const rootIndex = noteMapping[staff.scale[0]];
    const scale = scalesMapping[staff.scale[1]];
    const direction = scaleDegreeDifference < 0 ? "down" : "up";
    const transposedNotes = [];
    for (const note of notes) {
        let transposedNote;
        if (note.isRest) {
            transposedNote = new UnprocessedNote("Rest", note.octave, getDurationString(note));
        }
        else {
            const canon = canonicalPitch(note.noteName[0], note.octaves[0]);
            const noteOctave = canon.octave;
            const noteIndex = noteMapping[canon.name];
            const originalInterval = (noteIndex + 12 - rootIndex) % 12;
            const originalScaleDegree = scale.indexOf(originalInterval);
            const newScaleDegree = (originalScaleDegree + scaleDegreeDifference + scale.length) % scale.length;
            const transposedIndex = (rootIndex + scale[newScaleDegree]) % 12;
            const transposedPitch = Object.keys(noteMapping).find(key => noteMapping[key] === transposedIndex);
            const originalAbs = noteIndex + 12 * noteOctave;
            let newOctave = noteOctave;
            const transposedAbs = noteMapping[transposedPitch] + 12 * newOctave;
            if (originalAbs <= transposedAbs && direction === "down")
                newOctave--;
            else if (originalAbs >= transposedAbs && direction === "up")
                newOctave++;
            const newIdx = pitchIndex(transposedPitch + newOctave);
            const minIdx = pitchIndex(staff.pitchRange[0]);
            const maxIdx = pitchIndex(staff.pitchRange[1]);
            if (newIdx < minIdx)
                newOctave += Math.ceil((minIdx - newIdx) / 12);
            else if (newIdx > maxIdx)
                newOctave -= Math.ceil((newIdx - maxIdx) / 12);
            transposedNote = new UnprocessedNote(transposedPitch, newOctave, getDurationString(note));
        }
        if (note.tupletInfo)
            transposedNote.tupletInfo = { ...note.tupletInfo };
        transposedNotes.push(transposedNote);
    }
    return transposedNotes;
}
function shuffleRhythmNotes(notes) {
    const pitches = notes.map(note => ({ noteName: note.noteName, octave: note.octave, isRest: note.isRest }));
    const rhythmGroups = [];
    const seenTupletIds = new Set();
    for (const note of notes) {
        if (note.tupletInfo) {
            const tupletId = note.tupletInfo.id;
            if (!seenTupletIds.has(tupletId)) {
                seenTupletIds.add(tupletId);
                const tupletNotes = [];
                for (const candidate of notes) {
                    if (candidate.tupletInfo?.id === tupletId)
                        tupletNotes.push(candidate);
                }
                rhythmGroups.push({ type: 'tuplet', notes: tupletNotes });
            }
        }
        else {
            rhythmGroups.push({ type: 'note', note });
        }
    }
    for (let i = rhythmGroups.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rhythmGroups[i], rhythmGroups[j]] = [rhythmGroups[j], rhythmGroups[i]];
    }
    const newNotes = [];
    let pitchIdx = 0;
    let newTupletId = 0;
    for (const group of rhythmGroups) {
        if (group.type === 'note' && group.note) {
            const pitch = pitches[pitchIdx++];
            newNotes.push(new UnprocessedNote(pitch.noteName, pitch.octave, getDurationString(group.note)));
        }
        else if (group.type === 'tuplet' && group.notes) {
            ++newTupletId;
            const firstNoteInfo = group.notes[0].tupletInfo;
            for (let i = 0; i < group.notes.length; i++) {
                const rhythmNote = group.notes[i];
                const pitch = pitches[pitchIdx++];
                const newNote = new UnprocessedNote(pitch.noteName, pitch.octave, rhythmNote.duration, rhythmNote.dotted);
                newNote.setTuplet(newTupletId, firstNoteInfo.totalTupletDuration, [...firstNoteInfo.ratio], firstNoteInfo.count, i + 1);
                newNotes.push(newNote);
            }
        }
    }
    return newNotes;
}
function shuffleNotesNotes(notes) {
    const groups = [];
    const seenIds = new Set();
    for (const note of notes) {
        if (note.tupletInfo) {
            const { id } = note.tupletInfo;
            if (!seenIds.has(id)) {
                seenIds.add(id);
                const tupletNotes = [];
                for (const candidate of notes) {
                    if (candidate.tupletInfo?.id === id)
                        tupletNotes.push(candidate);
                }
                groups.push({ type: 'tuplet', notes: tupletNotes });
            }
        }
        else {
            groups.push({ type: 'note', note });
        }
    }
    for (let i = groups.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [groups[i], groups[j]] = [groups[j], groups[i]];
    }
    const newNotes = [];
    let tupletId = 0;
    for (const group of groups) {
        if (group.type === 'note' && group.note) {
            newNotes.push(group.note);
        }
        else if (group.type === 'tuplet' && group.notes) {
            ++tupletId;
            const firstNoteInfo = group.notes[0].tupletInfo;
            const shuffled = [...group.notes];
            for (let i = shuffled.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }
            for (let i = 0; i < shuffled.length; i++) {
                const tupletNote = shuffled[i];
                const newNote = new UnprocessedNote(tupletNote.noteName, tupletNote.octave, tupletNote.duration, tupletNote.dotted);
                newNote.setTuplet(tupletId, firstNoteInfo.totalTupletDuration, [...firstNoteInfo.ratio], firstNoteInfo.count, i + 1);
                newNotes.push(newNote);
            }
        }
    }
    return newNotes;
}
function shufflePitchNotes(notes) {
    const pitches = [];
    for (const note of notes) {
        if (!note.isRest)
            pitches.push({ noteName: note.noteName, octave: note.octave });
    }
    for (let i = pitches.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pitches[i], pitches[j]] = [pitches[j], pitches[i]];
    }
    const newNotes = [];
    let pitchIdx = 0;
    for (const note of notes) {
        let newNote;
        if (note.isRest) {
            newNote = new UnprocessedNote(["Rest"], 4, note.duration, note.dotted);
        }
        else {
            const pitch = pitches[pitchIdx++];
            newNote = new UnprocessedNote(pitch.noteName, pitch.octave, note.duration, note.dotted);
        }
        if (note.tupletInfo)
            newNote.tupletInfo = { ...note.tupletInfo };
        newNotes.push(newNote);
    }
    return newNotes;
}
function changeRhythmNotes(notes, staff, startOffset) {
    const originalNotes = notes;
    if (!originalNotes.length)
        return [];
    const durationKeys = Object.keys(durationMapping);
    let targetDuration = 0;
    for (const note of originalNotes) {
        if (note.tupletInfo) {
            if (note.tupletInfo.index === note.tupletInfo.count)
                targetDuration += note.tupletInfo.totalTupletDuration;
        }
        else {
            targetDuration += getNoteDuration(note);
        }
    }
    targetDuration = round(targetDuration);
    let newNotes = [];
    let success = false;
    let attempts = 0;
    while (!success) {
        // Some selections (a single note, say) have no other way to be written: leave them as they are
        if (++attempts > 300)
            return cloneNotes(originalNotes);
        newNotes = [];
        let currentDuration = 0;
        success = true;
        for (let i = 0; i < originalNotes.length - 1; i++) {
            const note = originalNotes[i];
            const remaining = round(targetDuration - currentDuration);
            const notesLeft = originalNotes.length - i - 1;
            const minReserve = round(staff.rhythmRange[0] * notesLeft);
            const spaceInMeasure = spaceToBarline(round(startOffset + currentDuration));
            const fittingDurations = durationKeys.filter(key => {
                const val = durationMapping[key];
                const leftover = round(remaining - val);
                return val < remaining - 1e-9 && leftover >= minReserve - 1e-9 && round(val) <= round(spaceInMeasure);
            });
            if (fittingDurations.length === 0) {
                success = false;
                break;
            }
            const randomDur = fittingDurations[Math.floor(Math.random() * fittingDurations.length)];
            newNotes.push(new UnprocessedNote(note.noteName, note.octave, randomDur));
            currentDuration = round(currentDuration + durationMapping[randomDur]);
        }
        if (!success)
            continue;
        const lastNote = originalNotes[originalNotes.length - 1];
        const lastRemaining = round(targetDuration - currentDuration);
        const spaceInMeasure = spaceToBarline(round(startOffset + currentDuration));
        const lastDurStr = getDurationKeyFromValue(lastRemaining);
        if (!lastDurStr || round(lastRemaining) > round(spaceInMeasure)) {
            success = false;
            continue;
        }
        newNotes.push(new UnprocessedNote(lastNote.noteName, lastNote.octave, lastDurStr));
    }
    return newNotes;
}
function changePitchNotes(notes, staff, startOffset) {
    totalDuration = startOffset;
    const newNotes = notes.map(note => {
        let newNote;
        if (note.isRest) {
            newNote = new UnprocessedNote(["Rest"], 4, note.duration, note.dotted);
        }
        else {
            const [noteName, octave] = randomPitchFromScale(staff, getNoteDuration(note), false);
            newNote = new UnprocessedNote(noteName, octave, note.duration, note.dotted);
        }
        if (note.tupletInfo)
            newNote.tupletInfo = { ...note.tupletInfo };
        totalDuration += note.tupletInfo
            ? note.tupletInfo.totalTupletDuration / note.tupletInfo.count
            : getNoteDuration(note);
        return newNote;
    });
    return newNotes;
}
/////////////////////////////////////////////////////////////////////////////////////
// Develop
/////////////////////////////////////////////////////////////////////////////////////
function simplifyNotes(notes, startOffset) {
    const currentNotes = notes;
    const simplifiedNotes = [];
    let i = 0;
    let elapsed = 0;
    while (i < currentNotes.length) {
        const note = currentNotes[i];
        if (note.tupletInfo) {
            const id = note.tupletInfo.id;
            const tupletNotes = [];
            while (i < currentNotes.length && currentNotes[i].tupletInfo?.id === id) {
                tupletNotes.push(currentNotes[i]);
                i++;
            }
            const { totalTupletDuration, ratio } = tupletNotes[0].tupletInfo;
            const [, notesOccupied] = ratio;
            elapsed = round(elapsed + totalTupletDuration);
            let kept = [...tupletNotes];
            const target = Math.max(3, 2 + Math.floor(Math.random() * (kept.length - 2)));
            while (kept.length > target)
                kept.splice(Math.floor(Math.random() * kept.length), 1);
            if (kept.length % 2 === 1) {
                for (let idx = 0; idx < kept.length; idx++) {
                    const keptNote = kept[idx];
                    const newNote = new UnprocessedNote(keptNote.noteName, keptNote.octave, keptNote.duration, keptNote.dotted);
                    newNote.setTuplet(id, totalTupletDuration, [kept.length, notesOccupied], kept.length, idx + 1);
                    simplifiedNotes.push(newNote);
                }
            }
            else {
                const perNote = totalTupletDuration / kept.length;
                const durStr = getDurationKeyFromValue(perNote) ?? "q";
                for (const keptNote of kept) {
                    simplifiedNotes.push(new UnprocessedNote(keptNote.noteName, keptNote.octave, durStr));
                }
            }
        }
        else {
            const noteName = note.noteName;
            const noteOctave = note.octave;
            let combinedDuration = round(getNoteDuration(note));
            let j = i + 1;
            let merged = false;
            while (j < currentNotes.length) {
                if (currentNotes[j].tupletInfo)
                    break;
                combinedDuration = round(combinedDuration + getNoteDuration(currentNotes[j]));
                const durStr = getDurationKeyFromValue(combinedDuration);
                const from = round(startOffset + elapsed);
                const to = round(startOffset + elapsed + combinedDuration);
                const wouldCrossBarline = posInMeasureAt(to) > 1e-9 && measureIndexAt(from) !== measureIndexAt(to);
                if (!wouldCrossBarline && round(combinedDuration) !== round(measureLenOf(measureIndexAt(from))) && durStr && Math.random() < 0.5) {
                    simplifiedNotes.push(new UnprocessedNote(noteName, noteOctave, durStr));
                    elapsed = round(elapsed + combinedDuration);
                    i = j + 1;
                    merged = true;
                    break;
                }
                j++;
            }
            if (!merged) {
                simplifiedNotes.push(note);
                elapsed = round(elapsed + getNoteDuration(note));
                i++;
            }
        }
    }
    return simplifiedNotes;
}
function complicateNotes(notes, staff, startOffset) {
    const originalNotes = notes;
    const newNotes = [];
    const seenIds = new Set();
    let position = startOffset;
    // A new phrase is generated on a scratch staff, so no voice of the real staff is touched while it runs
    const generateSub = (duration) => {
        const temp = new Staff(staff.name, staff.pitchRange, staff.rhythmRange, staff.scale);
        temp.harmonize = staff.harmonize;
        totalDuration = position;
        generatePhrase(temp, duration, false);
        return [...temp.unprocessedNotes];
    };
    for (const note of originalNotes) {
        if (note.tupletInfo) {
            const { id, totalTupletDuration } = note.tupletInfo;
            if (seenIds.has(id))
                continue;
            seenIds.add(id);
            const subNotes = generateSub(totalTupletDuration);
            subNotes.forEach((subNote, idx) => {
                if (idx === 0 || Math.random() < 0.3) {
                    const newNote = new UnprocessedNote(note.noteName, note.octave, subNote.duration, subNote.dotted);
                    if (subNote.tupletInfo)
                        newNote.tupletInfo = { ...subNote.tupletInfo };
                    newNotes.push(newNote);
                }
                else {
                    newNotes.push(subNote);
                }
            });
            position = round(position + totalTupletDuration);
        }
        else if (note.duration !== "32" && Math.random() < 0.5) {
            const noteDur = getNoteDuration(note);
            const subNotes = generateSub(noteDur);
            subNotes.forEach((subNote, idx) => {
                if (idx === 0 || Math.random() < 0.3) {
                    const newNote = new UnprocessedNote(note.noteName, note.octave, subNote.duration, subNote.dotted);
                    if (subNote.tupletInfo)
                        newNote.tupletInfo = { ...subNote.tupletInfo };
                    newNotes.push(newNote);
                }
                else {
                    newNotes.push(subNote);
                }
            });
            position = round(position + noteDur);
        }
        else {
            newNotes.push(note);
            position = round(position + getNoteDuration(note));
        }
    }
    return newNotes;
}
/////////////////////////////////////////////////////////////////////////////////////
// Audio
/////////////////////////////////////////////////////////////////////////////////////
let isPlaying = false;
let playStartMeasure = 0;
let stopTimeoutId = null;
async function playAllStaves(staffList, button) {
    await Tone.start();
    Tone.Transport.stop();
    Tone.Transport.cancel();
    Tone.Transport.position = 0;
    const bpm = parseFloat(bpmSlider.value) || 120;
    const secondsPerWhole = (60 / bpm) * 4;
    const startT = measureStartOf(playStartMeasure);
    let endT = startT;
    staffList.forEach(staff => {
        if (staff.muted)
            return;
        staffVoices(staff).forEach(voice => {
            let t = 0; // whole notes from the start of the piece
            voice.toneNotes.forEach(([pitch, duration]) => {
                const noteStart = t;
                const noteEnd = round(t + duration);
                t = noteEnd;
                if (noteEnd > endT)
                    endT = noteEnd;
                if (noteEnd <= startT + 1e-9 || pitch == null)
                    return; // before the start, or a rest
                // A note already sounding at the start plays its remaining length
                const from = Math.max(noteStart, startT);
                const when = (from - startT) * secondsPerWhole;
                const dur = (noteEnd - from) * secondsPerWhole;
                Tone.Transport.schedule((time) => {
                    for (const p of pitch)
                        sampler.triggerAttackRelease(p, dur, time);
                }, when);
            });
        });
    });
    if (endT - startT < 1e-9)
        return; // nothing to play from here
    isPlaying = true;
    button.classList.add("active");
    Tone.Transport.start();
    stopTimeoutId = window.setTimeout(() => stopPlayback(button), (endT - startT) * secondsPerWhole * 1000 + 250);
}
function stopPlayback(button) {
    Tone.Transport.stop();
    Tone.Transport.cancel();
    if (sampler)
        sampler.releaseAll();
    if (stopTimeoutId !== null) {
        clearTimeout(stopTimeoutId);
        stopTimeoutId = null;
    }
    isPlaying = false;
    if (button)
        button.classList.remove("active");
}
function staveNoteToToneJSNote(staveNote) {
    if (staveNote.isRest())
        return null;
    return staveNote.getKeys().map(k => k.replace("/", ""));
}
async function setupSampler() {
    if (sampler)
        return;
    const sampleMap = {};
    pianoKeys.forEach(key => { sampleMap[key] = `${key}.mp3`; });
    await new Promise(resolve => {
        sampler = new Tone.Sampler({
            urls: sampleMap,
            baseUrl: "/static/notes/",
            onload: resolve,
        }).toDestination();
    });
    await Tone.start();
}
/////////////////////////////////////////////////////////////////////////////////////
// Settings
/////////////////////////////////////////////////////////////////////////////////////
function generateHarmony() {
    const durationValues = Object.values(durationMapping);
    const noteValues = Object.values(noteMapping).filter(value => value < 12);
    const chords = Object.values(chordMapping);
    const allNotes = [];
    let currentDuration = 0;
    while (currentDuration < totalLength() - 1e-9) {
        const unit = 1 / sigOf(measureIndexAt(currentDuration)).den;
        const allowedDurations = durationValues.filter(duration => round(duration % unit) === 0);
        const duration = allowedDurations[Math.floor(Math.random() * allowedDurations.length)];
        if (duration > spaceToBarline(currentDuration) + 1e-9)
            continue;
        const rootNote = noteValues[Math.floor(Math.random() * noteValues.length)];
        const chord = chords[Math.floor(Math.random() * chords.length)];
        const chordNotes = chord.map(interval => Object.keys(noteMapping).find(key => noteMapping[key] === ((rootNote + interval) % 12)));
        let durationStr = Object.keys(durationMapping).find(key => durationMapping[key] === duration);
        let isDotted = false;
        if (durationStr.includes("d")) {
            durationStr = durationStr.replace("d", "");
            isDotted = true;
        }
        allNotes.push(new UnprocessedNote(chordNotes, 4, durationStr, isDotted));
        currentDuration = round(currentDuration + duration);
    }
    drawAllStaves(true);
}
/////////////////////////////////////////////////////////////////////////////////////
// Export
/////////////////////////////////////////////////////////////////////////////////////
const musicXmlTypeMapping = {
    w: "whole", h: "half", q: "quarter", "8": "eighth", "16": "16th", "32": "32nd",
};
function getMusicXmlTypeAndDot(note) {
    const key = getDurationString(note) ?? note.duration;
    const isDotted = key.endsWith('d');
    const baseKey = isDotted ? key.slice(0, -1) : key;
    return { type: musicXmlTypeMapping[baseKey] ?? "quarter", dotted: isDotted };
}
function exportLayerToMidi() {
    const midi = new Midi();
    const layerStaves = getActiveStaves();
    for (const staffName of staves) {
        const staff = layerStaves[staffName];
        const track = midi.addTrack();
        track.name = staffName;
        // every voice of the staff goes on the staff's track
        for (const voice of staffVoices(staff)) {
            const notesToExport = voice.unprocessedNotes.length > 0
                ? voice.unprocessedNotes
                : fillDurationWithRests(totalLength());
            let currentTime = 0;
            for (const note of notesToExport) {
                const noteDurationInSeconds = getNoteDurationInSeconds(staff, note);
                if (note.isRest) {
                    currentTime += noteDurationInSeconds;
                    continue;
                }
                note.noteName.forEach((noteName, i) => {
                    track.addNote({ name: toToneName(noteName, note.octaves[i]), time: currentTime, duration: noteDurationInSeconds });
                });
                currentTime += noteDurationInSeconds;
            }
        }
    }
    const filename = `${currentTitle || 'composition'}_${currentLayer}.mid`;
    const blob = new Blob([midi.toArray()], { type: 'audio/midi' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
function exportLayerToMusicXML() {
    const DIVS_PER_QUARTER = 32;
    const DIVS_PER_WHOLE = DIVS_PER_QUARTER * 4;
    const layerStaves = getActiveStaves();
    let partList = '';
    staves.forEach((staffName, i) => {
        partList += `    <score-part id="P${i + 1}">\n      <part-name>${staffName}</part-name>\n    </score-part>\n`;
    });
    let parts = '';
    staves.forEach((staffName, i) => {
        const staff = layerStaves[staffName];
        parts += `  <part id="P${i + 1}">\n    <measure number="1">\n      <attributes>\n        <divisions>${DIVS_PER_QUARTER}</divisions>\n        <time>\n          <beats>${measureSigs[0].num}</beats>\n          <beat-type>${measureSigs[0].den}</beat-type>\n        </time>\n        <clef>\n          <sign>G</sign>\n          <line>2</line>\n        </clef>\n      </attributes>\n`;
        const voicesHere = staffVoices(staff);
        voicesHere.forEach((voice, voiceIdx) => {
            const voiceNumber = VOICE_DEFS.findIndex(d => d.id === voice.id) + 1;
            const notesToExport = voice.unprocessedNotes.length > 0
                ? voice.unprocessedNotes
                : fillDurationWithRests(totalLength());
            let voiceDivs = 0;
            for (const note of notesToExport) {
                const { type, dotted } = getMusicXmlTypeAndDot(note);
                const isTuplet = !!note.tupletInfo;
                const actualDuration = isTuplet
                    ? getNoteDuration(note) * note.tupletInfo.ratio[1] / note.tupletInfo.ratio[0]
                    : getNoteDuration(note);
                const durationDivs = Math.round(actualDuration * DIVS_PER_WHOLE);
                voiceDivs += durationDivs;
                // a chord is one <note> per pitch, the later ones marked <chord/>
                const pitchCount = note.isRest ? 1 : note.noteName.length;
                for (let k = 0; k < pitchCount; k++) {
                    parts += `<note>\n`;
                    if (k > 0)
                        parts += `  <chord/>\n`;
                    if (note.isRest) {
                        parts += `  <rest/>\n`;
                    }
                    else {
                        const { letter, acc } = parsePitchName(note.noteName[k]);
                        parts += `  <pitch>\n    <step>${letter}</step>\n`;
                        if (ACC_SEMITONE[acc] !== 0)
                            parts += `    <alter>${ACC_SEMITONE[acc]}</alter>\n`;
                        parts += `    <octave>${note.octaves[k]}</octave>\n  </pitch>\n`;
                    }
                    parts += `  <duration>${durationDivs}</duration>\n`;
                    parts += `  <voice>${voiceNumber}</voice>\n`;
                    parts += `  <type>${type}</type>\n`;
                    if (dotted)
                        parts += `  <dot/>\n`;
                    if (isTuplet) {
                        const [actualNotes, normalNotes] = note.tupletInfo.ratio;
                        parts += `  <time-modification>\n    <actual-notes>${actualNotes}</actual-notes>\n    <normal-notes>${normalNotes}</normal-notes>\n  </time-modification>\n`;
                        const { index, count } = note.tupletInfo;
                        if (k === 0 && (index === 1 || index === count)) {
                            parts += `  <notations>\n`;
                            if (index === 1)
                                parts += `    <tuplet type="start"/>\n`;
                            if (index === count)
                                parts += `    <tuplet type="stop"/>\n`;
                            parts += `  </notations>\n`;
                        }
                    }
                    parts += `</note>\n`;
                }
            }
            // the next voice starts again at the beginning of the staff
            if (voiceIdx < voicesHere.length - 1)
                parts += `<backup>\n  <duration>${voiceDivs}</duration>\n</backup>\n`;
        });
        parts += `    </measure>\n  </part>\n`;
    });
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<score-partwise version="3.1">\n  <part-list>\n${partList}  </part-list>\n${parts}</score-partwise>`;
    const filename = `${currentTitle || 'composition'}_${currentLayer}.musicxml`;
    const blob = new Blob([xml], { type: "application/vnd.recordare.musicxml+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Pitch spelling helpers: letter + accidental + octave
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
const LETTER_ORDER = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ACC_SEMITONE = { bb: -2, b: -1, '': 0, '#': 1, '##': 2 };
const FLAT_SPELLING = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
// "Db" -> { letter: 'D', acc: 'b' }, "F##" -> { letter: 'F', acc: '##' }, "C" -> { letter: 'C', acc: '' }
function parsePitchName(name) {
    const letter = name.charAt(0).toUpperCase();
    const tail = name.slice(1);
    return { letter, acc: Object.prototype.hasOwnProperty.call(ACC_SEMITONE, tail) ? tail : '' };
}
function pitchClassOf(name) {
    const { letter, acc } = parsePitchName(name);
    return (((LETTER_SEMITONE[letter] + ACC_SEMITONE[acc]) % 12) + 12) % 12;
}
// MIDI number of the sounding pitch (B#3 and C4 are both 60)
function soundingMidi(name, octave) {
    const { letter, acc } = parsePitchName(name);
    return 12 * (octave + 1) + LETTER_SEMITONE[letter] + ACC_SEMITONE[acc];
}
// Flat-spelled equivalent: B#3 -> { name: 'C', octave: 4 }, Cb4 -> { name: 'B', octave: 3 }
function canonicalPitch(name, octave) {
    const m = soundingMidi(name, octave);
    return { name: FLAT_SPELLING[((m % 12) + 12) % 12], octave: Math.floor(m / 12) - 1 };
}
// Name Tone.js understands (it has no double sharps), e.g. "F##3" -> "G3"
function toToneName(name, octave) {
    const c = canonicalPitch(name, octave);
    return c.name + c.octave;
}
// Vertical position on the staff (spelling matters here: B#3 sits on B3's line)
function staffPosition(name, octave) {
    return octave * 7 + LETTER_ORDER.indexOf(parsePitchName(name).letter);
}
// "Db4" -> { name: 'Db', octave: 4 }
function parsePitchString(s) {
    return { name: s.slice(0, -1), octave: parseInt(s.slice(-1), 10) };
}
const ACC_GLYPH = { bb: '\u{1D12B}', b: '\u266D', '': '\u266E', '#': '\u266F', '##': '\u{1D12A}' };
function samePitches(a, b) {
    if (a.noteName.length !== b.noteName.length)
        return false;
    const key = (n) => n.noteName.map((nm, i) => `${nm}${n.octaves[i]}`).sort().join(',');
    return key(a) === key(b);
}
// Cells = whole tuplets, rests, and "logical notes" (a chain of tied same-pitch pieces is one note)
function buildCells(notes) {
    const cells = [];
    let t = 0;
    let i = 0;
    while (i < notes.length) {
        const n = notes[i];
        if (n.tupletInfo) {
            const group = [];
            const start = t;
            let total = 0;
            while (i < notes.length && notes[i].tupletInfo) {
                const info = notes[i].tupletInfo;
                group.push(notes[i]);
                total = info.totalTupletDuration;
                i++;
                if (info.index === info.count)
                    break;
            }
            t = round(start + total);
            cells.push({ start, end: t, notes: group, isTuplet: true, isRest: group.every(g => g.isRest) });
            continue;
        }
        const chain = [n];
        let end = round(t + getNoteDuration(n));
        i++;
        while (!n.isRest && chain[chain.length - 1].tiedToNext && i < notes.length &&
            !notes[i].tupletInfo && !notes[i].isRest && samePitches(chain[chain.length - 1], notes[i])) {
            chain.push(notes[i]);
            end = round(end + getNoteDuration(notes[i]));
            i++;
        }
        cells.push({ start: t, end, notes: chain, isTuplet: false, isRest: n.isRest });
        t = end;
    }
    return cells;
}
// Duration key ("q", "hd", ...) of a cell, or null when its length isn't a single note value
function cellKey(c) {
    return getDurationKeyFromValue(round(c.end - c.start));
}
// New base value. By default the dot state is kept; a dotted 32nd isn't supported, so the dot is dropped.
function keyWithBase(c, base, keepDot = true) {
    const cur = cellKey(c);
    const dotted = keepDot && cur ? cur.endsWith('d') : false;
    if (dotted && base === '32')
        return '32';
    return base + (dotted ? 'd' : '');
}
function keyWithDot(c, wantDot) {
    const cur = cellKey(c);
    if (!cur)
        return null;
    const base = cur.replace(/d$/, '');
    if (wantDot && base === '32')
        return null;
    return base + (wantDot ? 'd' : '');
}
function restPieces(start, end) {
    const dur = round(end - start);
    return dur > 1e-9 ? fillDurationWithRests(dur, start) : [];
}
function pitchedPieces(template, start, end) {
    const dur = round(end - start);
    if (dur <= 1e-9)
        return [];
    const pieces = fillDurationAsUnprocessed(dur, template);
    pieces[pieces.length - 1].tiedToNext = false;
    return pieces;
}
function piecesFor(c, start, end) {
    return c.isRest ? restPieces(start, end) : pitchedPieces(c.notes[0], start, end);
}
function noteWithDuration(template, key) {
    return template.isRest
        ? new UnprocessedNote(['Rest'], 4, key)
        : new UnprocessedNote([...template.noteName], [...template.octaves], key, false, false);
}
// Overwrites [s, e) with `fresh`. Cells partly covered are cut; a tuplet may only be removed whole.
function paint(cells, s, e, fresh) {
    const out = [];
    let inserted = false;
    const flush = () => {
        if (!inserted) {
            out.push({ start: s, end: e, notes: fresh, isTuplet: false, isRest: fresh[0].isRest });
            inserted = true;
        }
    };
    for (const c of cells) {
        if (c.end <= s + 1e-9) {
            out.push(c);
            continue;
        }
        if (c.start >= e - 1e-9) {
            flush();
            out.push(c);
            continue;
        }
        if (c.isTuplet) {
            if (c.start >= s - 1e-9 && c.end <= e + 1e-9)
                continue; // swallowed whole
            return null;
        }
        if (c.start < s - 1e-9)
            out.push({ ...c, end: s, notes: piecesFor(c, c.start, s) });
        flush();
        if (c.end > e + 1e-9)
            out.push({ ...c, start: e, notes: piecesFor(c, e, c.end) });
    }
    flush();
    return out;
}
function selectedCellIndices(cells, selStart, selEnd) {
    const idx = [];
    cells.forEach((c, i) => {
        if (c.start >= selStart - 1e-9 && c.end <= selEnd + 1e-9)
            idx.push(i);
    });
    return idx;
}
// Overwrite: every selected note keeps its start. Time it gives up becomes rests; time it takes
// replaces what was there. Earlier notes win over later ones when they collide. Extending past
// the end grows the piece (the caller adds measures).
function overwriteEdit(cells, selStart, selEnd, total, keyFor) {
    const sel = selectedCellIndices(cells, selStart, selEnd);
    if (!sel.length || sel.some(i => cells[i].isTuplet))
        return null;
    let work = cells.map((c, i) => sel.includes(i) ? { start: c.start, end: c.end, notes: restPieces(c.start, c.end), isTuplet: false, isRest: true } : c);
    let newStart = Infinity;
    let newEnd = -Infinity;
    let newTotal = total; // grows when a note is extended past the current end
    for (const i of [...sel].reverse()) {
        const c = cells[i];
        const key = keyFor(c);
        if (!key)
            return null;
        const e = round(c.start + durationMapping[key]);
        const painted = paint(work, c.start, e, [noteWithDuration(c.notes[0], key)]);
        if (!painted)
            return null;
        work = painted;
        newStart = Math.min(newStart, c.start);
        newEnd = Math.max(newEnd, e);
        newTotal = Math.max(newTotal, e);
    }
    return { notes: work.flatMap(c => c.notes), selection: { start: newStart, end: newEnd }, newTotal };
}
// Insert: the selected notes are laid end to end at their new lengths and everything after
// (rests included) moves with them. Longer = the track grows; shorter = rests pad the end.
function insertEdit(cells, selStart, selEnd, total, keyFor) {
    const sel = selectedCellIndices(cells, selStart, selEnd);
    if (!sel.length || sel.some(i => cells[i].isTuplet))
        return null;
    const first = sel[0];
    const last = sel[sel.length - 1];
    if (last - first + 1 !== sel.length)
        return null;
    const start = cells[first].start;
    let pos = start;
    let oldSpan = 0;
    const placed = [];
    for (const i of sel) {
        const c = cells[i];
        const key = keyFor(c);
        if (!key)
            return null;
        placed.push(noteWithDuration(c.notes[0], key));
        pos = round(pos + durationMapping[key]);
        oldSpan = round(oldSpan + (c.end - c.start));
    }
    const newSpan = round(pos - start);
    const delta = round(newSpan - oldSpan);
    const before = cells.slice(0, first).flatMap(c => c.notes);
    const after = cells.slice(last + 1).flatMap(c => c.notes);
    let notes = [...before, ...placed, ...after];
    let newTotal = round(total + delta);
    if (delta < -1e-9) {
        notes = [...notes, ...restPieces(newTotal, total)];
        newTotal = total;
    }
    return { notes, selection: { start, end: pos }, newTotal };
}
// A pitch is identified by its spelling and octave, e.g. "Gb4" or "G#4"
function pitchKey(name, octave) {
    return `${name}${octave}`;
}
// Pitch indices of a note, highest sounding pitch first
function orderedPitchIdx(note) {
    return note.noteName
        .map((nm, i) => ({ i, m: soundingMidi(nm, note.octaves[i]) }))
        .sort((a, b) => b.m - a.m || a.i - b.i)
        .map(x => x.i);
}
// Keys of a note's pitches, highest first
function notePitchKeys(note) {
    return orderedPitchIdx(note).map(i => pitchKey(note.noteName[i], note.octaves[i]));
}
function dedupePitches(p) {
    const seen = new Set();
    const names = [];
    const octaves = [];
    p.names.forEach((nm, i) => {
        const k = pitchKey(nm, p.octaves[i]);
        if (seen.has(k))
            return;
        seen.add(k);
        names.push(nm);
        octaves.push(p.octaves[i]);
    });
    return { names, octaves };
}
// Changes one parameter of the pitches named in `targets` (null = every pitch). Nothing is
// restricted: any letter, accidental or octave is allowed. newKeys says where the edited pitches ended up.
function editNotePitches(note, targets, kind, value) {
    const names = [...note.noteName];
    const octaves = [...note.octaves];
    const newKeys = [];
    for (let i = 0; i < names.length; i++) {
        if (targets && !targets.includes(pitchKey(names[i], octaves[i])))
            continue;
        const p = parsePitchName(names[i]);
        let letter = p.letter;
        let acc = p.acc;
        let oct = octaves[i];
        if (kind === 'letter')
            letter = String(value);
        else if (kind === 'acc')
            acc = String(value);
        else
            oct = Math.max(0, Math.min(8, Number(value)));
        names[i] = letter + acc;
        octaves[i] = oct;
        newKeys.push(pitchKey(names[i], octaves[i]));
    }
    return { set: dedupePitches({ names, octaves }), newKeys };
}
function addPitchToNote(note, name, octave) {
    return dedupePitches({ names: [...note.noteName, name], octaves: [...note.octaves, octave] });
}
// null when that would remove every pitch (the caller turns the note into a rest instead)
function removePitchesFromNote(note, keys) {
    const names = [];
    const octaves = [];
    note.noteName.forEach((nm, i) => {
        if (keys.includes(pitchKey(nm, note.octaves[i])))
            return;
        names.push(nm);
        octaves.push(note.octaves[i]);
    });
    return names.length ? { names, octaves } : null;
}
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Edit tab UI. Uses the pure functions in editEngine.ts.
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
let insertMode = false; // Insert
let polyphonyMode = false; // Polyphony (reserved, nothing reads it yet). Neither = Overwrite
let editSession = null;
let editRefreshQueued = false;
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
const ACC_BUTTONS = ['bb', 'b', '', '#', '##'];
const OCTAVE_BUTTONS = [0, 1, 2, 3, 4, 5, 6, 7];
const DURATION_KEYS = { 1: 'w', 0.5: 'h', 0.25: 'q', 0.125: '8', 0.0625: '16', 0.03125: '32' };
function getEditContext() {
    if (!gridViewOn || currentTab !== 'edit')
        return null;
    const active = getActiveStaves();
    for (const name of staves) {
        const sel = getSelection(name);
        if (!sel)
            continue;
        const staff = active[name];
        const groups = [];
        for (const store of selectionTargets(staff, sel)) {
            const entries = getUnprocessedTimeline(store.unprocessedNotes)
                .filter(e => e.start >= sel.start - 1e-9 && round(e.start + e.dur) <= sel.end + 1e-9);
            if (entries.length)
                groups.push({ store, entries, notes: entries.map(e => store.unprocessedNotes[e.index]) });
        }
        if (!groups.length)
            return null;
        return {
            part: staff, store: groups[0].store, sel,
            entries: groups.flatMap(g => g.entries), notes: groups.flatMap(g => g.notes),
            groups, multi: groups.length > 1,
        };
    }
    return null;
}
// Tied same-pitch pieces count as one note
function logicalNoteCount(notes) {
    let count = 0;
    let prev = null;
    for (const n of notes) {
        const continues = prev && prev.tiedToNext && !prev.isRest && !n.isRest && !n.tupletInfo && samePitches(prev, n);
        if (!continues)
            count++;
        prev = n;
    }
    return count;
}
function firstPitched(ctx) {
    return ctx.notes.find(n => !n.isRest) ?? null;
}
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Is a pitch "in key"? (scale, range, and the harmony chord when Harmonize is on)
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
function isPitchAllowed(staff, name, octave) {
    const lo = parsePitchString(toPitchStr(staff.pitchRange[0]));
    const hi = parsePitchString(toPitchStr(staff.pitchRange[1]));
    const m = soundingMidi(name, octave);
    if (m < soundingMidi(lo.name, lo.octave) || m > soundingMidi(hi.name, hi.octave))
        return false;
    const rootPc = noteMapping[staff.scale[0]];
    const scale = scalesMapping[staff.scale[1]];
    return scale.includes((((m % 12) - rootPc) % 12 + 12) % 12);
}
function harmonyChordAt(staff, t) {
    const hv = harmonyStaves[staff.name];
    if (!hv)
        return null;
    const e = getUnprocessedTimeline(hv.unprocessedNotes)
        .find(x => t >= x.start - 1e-9 && t < x.start + x.dur - 1e-9);
    const n = e ? hv.unprocessedNotes[e.index] : null;
    return n && !n.isRest ? n : null;
}
function pitchIsOutOfKey(staff, name, octave, startTime) {
    if (!isPitchAllowed(staff, name, octave))
        return true;
    if (currentLayer === 'main' && staff.harmonize) {
        const chord = harmonyChordAt(staff, startTime);
        if (chord && !chord.noteName.some(nm => pitchClassOf(nm) === pitchClassOf(name)))
            return true;
    }
    return false;
}
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Session (which pitch of the selected note the rows edit)
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
function ensureSession(ctx) {
    const s = editSession;
    const same = !!s && s.partName === ctx.part.name && s.voice === ctx.store.id &&
        Math.abs(s.start - ctx.sel.start) < 1e-9 && Math.abs(s.end - ctx.sel.end) < 1e-9;
    const note = firstPitched(ctx);
    const keys = note ? notePitchKeys(note) : [];
    if (!same) {
        editSession = {
            partName: ctx.part.name, voice: ctx.store.id, start: ctx.sel.start, end: ctx.sel.end,
            selected: keys[0] ?? null, pending: null,
        };
    }
    else {
        const cur = editSession;
        if (!cur.selected || !keys.includes(cur.selected))
            cur.selected = keys[0] ?? null; // highest pitch
    }
    return editSession;
}
function targetFromKey(key) {
    const p = parsePitchString(key);
    const n = parsePitchName(p.name);
    return { letter: n.letter, acc: n.acc, octave: p.octave };
}
function uniform(vals) {
    return vals.length > 0 && vals.every(v => v === vals[0]) ? vals[0] : null;
}
function wrapSingleVoice(r, id) {
    return r ? { changes: { [id]: r.notes }, selection: { ...r.selection, voice: id }, newTotal: r.newTotal } : null;
}
function midisOf(note) {
    return note.noteName.map((nm, i) => soundingMidi(nm, note.octaves[i]));
}
function overlappingCells(cells, s, e) {
    return cells.filter(c => c.start < e - 1e-9 && c.end > s + 1e-9);
}
// The cells of a voice that doesn't exist yet: rests all the way
function emptyVoiceCells(total) {
    return [{ start: 0, end: total, notes: restPieces(0, total), isTuplet: false, isRest: true }];
}
// Turns [s, e) into rests
function clearCells(cells, s, e) {
    if (e - s < 1e-9)
        return cells;
    return paint(cells, s, e, restPieces(s, e));
}
// Removes the given pitches from the notes inside [s, e). A note that loses every pitch becomes rests;
// a chord keeps its other pitches. Tuplets are never cut (the callers treat them as blockers).
function erasePitches(cells, s, e, remove) {
    const out = [];
    for (const c of cells) {
        if (c.isRest || c.isTuplet || c.end <= s + 1e-9 || c.start >= e - 1e-9) {
            out.push(c);
            continue;
        }
        const tpl = c.notes[0];
        const keep = tpl.noteName.map((_, i) => i).filter(i => !remove.has(soundingMidi(tpl.noteName[i], tpl.octaves[i])));
        if (keep.length === tpl.noteName.length) {
            out.push(c);
            continue;
        } // nothing shared
        const a = Math.max(c.start, s);
        const b = Math.min(c.end, e);
        if (c.start < a - 1e-9)
            out.push({ ...c, end: a, notes: pitchedPieces(tpl, c.start, a) });
        if (keep.length === 0) {
            out.push({ start: a, end: b, notes: restPieces(a, b), isTuplet: false, isRest: true });
        }
        else {
            const reduced = new UnprocessedNote(keep.map(i => tpl.noteName[i]), keep.map(i => tpl.octaves[i]), tpl.duration, tpl.dotted, false);
            out.push({ ...c, start: a, end: b, notes: pitchedPieces(reduced, a, b) });
        }
        if (c.end > b + 1e-9)
            out.push({ ...c, start: b, notes: pitchedPieces(tpl, b, c.end) });
    }
    return out;
}
// A note blocks another when some of its pitches would survive the other one passing over it
function blocksPitches(c, mine) {
    if (c.isRest)
        return false;
    if (c.isTuplet)
        return true;
    return !midisOf(c.notes[0]).every(m => mine.has(m));
}
// Polyphony mode. Like Overwrite, except that a note extended over other notes (of other pitches)
// moves to the first free voice instead of overwriting them. Same pitches under the extension are
// overwritten; a chord only loses the pitches it shares. Shortening works like Overwrite.
function polyphonyEdit(staff, sourceId, selStart, selEnd, total, keyFor) {
    const source = getVoice(staff, sourceId);
    if (!source)
        return null;
    const work = {};
    const touched = new Set();
    const cellsOf = (id) => {
        if (!work[id]) {
            const v = getVoice(staff, id);
            work[id] = v ? buildCells(v.unprocessedNotes) : emptyVoiceCells(total);
        }
        return work[id];
    };
    const startCells = cellsOf(sourceId);
    const sel = selectedCellIndices(startCells, selStart, selEnd);
    if (!sel.length || sel.some(i => startCells[i].isTuplet))
        return null;
    const selected = sel.map(i => startCells[i]);
    const placed = [];
    let newTotal = total;
    for (const c of selected) {
        const key = keyFor(c);
        if (!key)
            return null;
        const e1 = round(c.start + durationMapping[key]);
        newTotal = Math.max(newTotal, e1);
        const note = noteWithDuration(c.notes[0], key);
        const S = cellsOf(sourceId);
        // an earlier selected note may already have overwritten this one
        const stillThere = S.some(x => !x.isTuplet && Math.abs(x.start - c.start) < 1e-9 && Math.abs(x.end - c.end) < 1e-9);
        if (!stillThere)
            continue;
        const overwriteHere = () => {
            const cleared = clearCells(S, c.start, c.end);
            const painted = cleared && paint(cleared, c.start, e1, [note]);
            if (!painted)
                return false;
            work[sourceId] = painted;
            touched.add(sourceId);
            placed.push({ id: sourceId, start: c.start, end: e1 });
            return true;
        };
        // rests, shortening and an equal length: plain overwrite
        if (c.isRest || e1 <= c.end + 1e-9) {
            if (!overwriteHere())
                return null;
            continue;
        }
        const mine = new Set(midisOf(c.notes[0]));
        const blockers = overlappingCells(S, c.end, e1).filter(b => blocksPitches(b, mine));
        if (blockers.length === 0) {
            if (!overwriteHere())
                return null;
            continue;
        }
        // the extension would run over other notes: find a voice that is free for the whole new length
        const others = VOICE_DEFS.map(d => d.id).filter(id => id !== sourceId);
        let dest = null;
        let destCells = null;
        for (const id of others) {
            const T = cellsOf(id);
            if (overlappingCells(T, c.start, e1).some(x => blocksPitches(x, mine)))
                continue;
            const painted = paint(T, c.start, e1, [note]);
            if (painted) {
                dest = id;
                destCells = painted;
                break;
            }
        }
        if (!dest || !destCells)
            return null;
        const cleared = clearCells(S, c.start, c.end);
        if (!cleared)
            return null;
        work[sourceId] = erasePitches(cleared, c.end, e1, mine); // same pitches under the extension go; others stay
        work[dest] = destCells;
        touched.add(sourceId);
        touched.add(dest);
        placed.push({ id: dest, start: c.start, end: e1 });
    }
    if (!placed.length)
        return null;
    const mineVoice = placed.find(p => p.id === sourceId)?.id ?? placed[0].id;
    const group = placed.filter(p => p.id === mineVoice);
    const changes = {};
    for (const id of touched)
        changes[id] = work[id].flatMap(c => c.notes);
    return {
        changes,
        selection: { start: Math.min(...group.map(p => p.start)), end: Math.max(...group.map(p => p.end)), voice: mineVoice },
        newTotal,
    };
}
// The Voice row: moves the selected notes to another voice, if that voice has only rests there
function moveToVoiceEdit(staff, sourceId, destId, selStart, selEnd, total) {
    if (sourceId === destId)
        return null;
    const source = getVoice(staff, sourceId);
    if (!source)
        return null;
    const sourceCells = buildCells(source.unprocessedNotes);
    const idx = selectedCellIndices(sourceCells, selStart, selEnd);
    if (!idx.length)
        return null;
    const moved = idx.map(i => sourceCells[i]);
    if (moved.every(c => c.isRest))
        return null; // nothing to move
    const dest = getVoice(staff, destId);
    let T = dest ? buildCells(dest.unprocessedNotes) : emptyVoiceCells(total);
    const from = moved[0].start;
    const to = moved[moved.length - 1].end;
    if (overlappingCells(T, from, to).some(c => !c.isRest))
        return null; // not free
    let S = sourceCells;
    for (const c of moved) {
        const t2 = paint(T, c.start, c.end, c.notes);
        const s2 = paint(S, c.start, c.end, restPieces(c.start, c.end));
        if (!t2 || !s2)
            return null;
        T = t2;
        S = s2;
    }
    return {
        changes: { [sourceId]: S.flatMap(c => c.notes), [destId]: T.flatMap(c => c.notes) },
        selection: { start: from, end: to, voice: destId },
        newTotal: total,
    };
}
// Adds (d > 0) or removes (d < 0) time at point P in one voice. A note or rest that spans the point gets longer or
// shorter; at a boundary a rest is added. Removed time takes whatever is inside it. Null if a tuplet would have to stretch.
function shiftCellsAt(cells, P, d) {
    const out = [];
    if (d > 0) {
        let done = false;
        for (const c of cells) {
            if (!done && c.start < P - 1e-9 && c.end > P + 1e-9) {
                if (c.isTuplet)
                    return null;
                const end = round(c.end + d);
                out.push({ ...c, end, notes: piecesFor(c, c.start, end) });
                done = true;
                continue;
            }
            if (!done && c.start >= P - 1e-9) {
                out.push({ start: P, end: round(P + d), notes: restPieces(P, round(P + d)), isTuplet: false, isRest: true });
                done = true;
            }
            out.push(c);
        }
        if (!done)
            out.push({ start: P, end: round(P + d), notes: restPieces(P, round(P + d)), isTuplet: false, isRest: true });
        return out;
    }
    const q = round(P + d);
    for (const c of cells) {
        if (c.end <= q + 1e-9 || c.start >= P - 1e-9) {
            out.push(c);
            continue;
        }
        const length = round(c.end - c.start);
        const cut = round(Math.min(c.end, P) - Math.max(c.start, q));
        if (cut >= length - 1e-9)
            continue; // entirely inside the removed time
        if (c.isTuplet)
            return null;
        const end = round(c.end - cut);
        out.push({ ...c, end, notes: piecesFor(c, c.start, end) });
    }
    return out;
}
// Insert mode: the edited voice is laid out as before, and every other voice of the staff gets the same time
// added or removed at the end of each edited note, so the voices stay in step.
function insertAcrossVoices(staff, sourceId, cells, selStart, selEnd, total, keyFor) {
    const own = insertEdit(cells, selStart, selEnd, total, keyFor);
    if (!own)
        return null;
    const changes = { [sourceId]: own.notes };
    const deltas = selectedCellIndices(cells, selStart, selEnd).map(i => {
        const c = cells[i];
        return { at: c.end, delta: round(durationMapping[keyFor(c)] - (c.end - c.start)) };
    }).filter(x => Math.abs(x.delta) > 1e-9);
    const endOf = (notes) => {
        const cs = buildCells(notes);
        return cs.length ? cs[cs.length - 1].end : 0;
    };
    for (const voice of staffVoices(staff)) {
        if (voice.id === sourceId)
            continue;
        const had = endOf(voice.unprocessedNotes);
        let vc = buildCells(voice.unprocessedNotes);
        for (const { at, delta } of [...deltas].reverse()) { // latest first, so earlier positions stay valid
            const next = shiftCellsAt(vc, at, delta);
            if (!next)
                return null;
            vc = next;
        }
        let notes = vc.flatMap(c => c.notes);
        const now = endOf(notes);
        if (now < had - 1e-9)
            notes = [...notes, ...restPieces(now, had)]; // removed time: keep the voice's length
        changes[voice.id] = notes;
    }
    return { changes, selection: { ...own.selection, voice: sourceId }, newTotal: own.newTotal };
}
// What the mouse wheel steps through while writing (scroll up = longer)
const ENTRY_DURATIONS = [
    { key: '32', label: '32nd' },
    { key: '16', label: '16th' },
    { key: '16d', label: 'Dotted 16th' },
    { key: '8', label: '8th' },
    { key: '8d', label: 'Dotted 8th' },
    { key: 'q', label: 'Quarter' },
    { key: 'qd', label: 'Dotted quarter' },
    { key: 'h', label: 'Half' },
    { key: 'hd', label: 'Dotted half' },
    { key: 'w', label: 'Whole' },
];
const entryState = { entry: null, durIndex: 5, wheel: 0, message: '', midi: 'unknown', chord: [], chordTimer: null, clicks: [] };
// Keys pressed within this long of the first one make one chord
const CHORD_WINDOW_MS = 50;
// A MIDI key as a note name: sharps in the keys that have sharps, flats otherwise
function spellMidi(midi, scale) {
    const pc = ((midi % 12) + 12) % 12;
    const octave = Math.floor(midi / 12) - 1;
    const root = noteMapping[scale[0]] ?? 0;
    const mode = scale[1];
    const home = mode === 'Minor' ? (root + 3) % 12 : root; // the major key it belongs to
    const sharpKeys = [7, 2, 9, 4, 11, 6]; // G D A E B F#
    const useSharps = (mode === 'Major' || mode === 'Minor') && sharpKeys.includes(home);
    const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    return { name: (useSharps ? SHARPS : FLAT_SPELLING)[pc], octave };
}
// The little readout next to the mode buttons: the length being written and the voice
// The readout next to the mode buttons: the length being written and the voice
function entryDisplayEl() {
    let el = document.getElementById('entryDisplay');
    if (!el) {
        // Sizes live in a rule placed first in <head>, so a rule of your own in composer.css wins over it
        const style = document.createElement('style');
        style.id = 'entryDisplayStyle';
        style.textContent =
            '#entryDisplay { white-space: pre; box-sizing: border-box; display: flex; align-items: center; cursor: pointer; user-select: none; }\n' +
                '#entryDisplay[hidden] { display: none; }\n' +
                '#entryDisplay .entryVoice { margin-left: auto; }\n' +
                '#entryDisplay .entrySymbol { font-size: 2.4em; line-height: 1; vertical-align: middle; }\n' +
                '#entryDisplay .entryDuration { display: inline-block; width: 84px; vertical-align: middle; }\n' +
                '#entryDisplay .entryDot { display: inline-block; width: 11px; height: 11px; margin: 0 6px 0 12px; border-radius: 50%; background: currentColor; font-size: 0; vertical-align: middle; }';
        document.head.prepend(style);
        el = document.createElement('span');
        el.id = 'entryDisplay';
        el.className = 'row'; // a row like the others in the settings panel, so it lines up with them
        el.hidden = true;
        el.addEventListener('mousedown', e => e.stopPropagation()); // a click on it is not a click on the settings under it
        el.addEventListener('click', e => { e.stopPropagation(); cycleEntryVoice(); }); // click it to change the voice you write in
        const home = document.querySelector('.modeButton')?.parentElement ?? document.body;
        home.appendChild(el);
    }
    return el;
}
// The readout in the settings of the track being written on: just the voice (click it to change it).
// The length is shown under the caret.
function updateEntryDisplay() {
    const el = entryDisplayEl();
    const en = entryState.entry;
    if (!en) {
        el.hidden = true;
        el.textContent = '';
        el.title = '';
        return;
    }
    const voice = VOICE_DEFS.find(d => d.id === en.voice)?.label ?? en.voice;
    const midiHint = {
        unsupported: 'MIDI needs Chrome or Edge', blocked: 'MIDI access was blocked', none: 'No MIDI keyboard found',
    };
    const hint = entryState.message || midiHint[entryState.midi] || '';
    el.hidden = false;
    const settings = document.querySelector(`.staffSettings[data-staff="${en.staffName}"]`);
    const blank = settings?.querySelector('.staffSettingsBlank');
    if (blank && blank.parentElement) {
        if (el.nextElementSibling !== blank)
            blank.parentElement.insertBefore(el, blank);
    } // the last settings row
    else if (settings && el.parentElement !== settings)
        settings.appendChild(el);
    el.title = 'Click to change the voice' + (hint ? ` (${hint})` : '');
    el.textContent = '';
    const part = document.createElement('span');
    part.className = 'entryVoice';
    part.textContent = voice;
    el.appendChild(part);
    // If the panel is too narrow for the readout, shrink its text a pixel at a time until it fits.
    el.style.fontSize = '';
    for (let px = parseFloat(getComputedStyle(el).fontSize); px > 9 && el.scrollWidth > el.clientWidth; px--)
        el.style.fontSize = `${px - 1}px`;
}
// The vertical line that shows where the next note will go
// The size of the symbol under the caret
const PREVIEW_SIZE = 34;
// Each symbol's width, measured once
const previewWidths = new Map();
let entryRefreshQueued = false;
// Sets the symbol under the caret to the current length. Cheap on purpose: it only changes text, and the
// browser is asked for a symbol's width once, not on every step of the wheel.
function updateEntryPreview() {
    const en = entryState.entry;
    if (!en)
        return;
    const note = containers[en.staffName]?.querySelector('.entryCaretNote');
    const group = note?.parentElement;
    if (!note || !group)
        return;
    const dur = ENTRY_DURATIONS[entryState.durIndex];
    const base = durationMapping[dur.key.replace('d', '')];
    const glyph = rhythmOptions.find(r => Math.abs(r.id - base) < 1e-9)?.symbol ?? dur.label;
    if (note.textContent !== glyph)
        note.textContent = glyph;
    let dot = group.querySelector('.entryCaretDot');
    if (!dur.key.endsWith('d')) {
        dot?.remove();
        return;
    }
    if (!previewWidths.has(base)) {
        try {
            previewWidths.set(base, note.getBBox().width);
        }
        catch (err) {
            return;
        }
    }
    if (!dot) {
        dot = document.createElementNS(SVG_NS, 'circle');
        dot.setAttribute('class', 'entryCaretDot');
        dot.setAttribute('fill', '#c0392b');
        group.appendChild(dot);
    }
    const x = Number(note.getAttribute('x'));
    const y = Number(note.getAttribute('y'));
    dot.setAttribute('cx', String(x + previewWidths.get(base) / 2 + PREVIEW_SIZE * 0.15)); // just after the symbol
    dot.setAttribute('cy', String(y - PREVIEW_SIZE * 0.22));
    dot.setAttribute('r', String(PREVIEW_SIZE * 0.07));
}
// Redraws the readout and the preview once per screen frame, however many wheel events arrived in it
function scheduleEntryRefresh() {
    if (entryRefreshQueued)
        return;
    entryRefreshQueued = true;
    window.requestAnimationFrame(() => {
        entryRefreshQueued = false;
        updateEntryPreview();
    });
}
function drawEntryCaret() {
    for (const name of staves) {
        const svg = containers[name]?.querySelector('svg');
        if (!svg)
            continue;
        svg.querySelector('.entryCaretLayer')?.remove();
        const en = entryState.entry;
        if (!en || en.staffName !== name || en.layer !== currentLayer)
            continue;
        const band = selectionBand(name);
        if (!band)
            continue;
        const x = timeToX(name, en.t);
        const g = document.createElementNS(SVG_NS, 'g');
        g.setAttribute('class', 'entryCaretLayer');
        g.setAttribute('pointer-events', 'none');
        const line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('class', 'entryCaret');
        line.setAttribute('x1', String(x));
        line.setAttribute('x2', String(x));
        line.setAttribute('y1', String(band.yTop));
        line.setAttribute('y2', String(band.yBottom));
        line.setAttribute('stroke', '#c0392b');
        line.setAttribute('stroke-width', '2');
        g.appendChild(line);
        const note = document.createElementNS(SVG_NS, 'text');
        note.setAttribute('class', 'entryCaretNote');
        note.setAttribute('x', String(x));
        note.setAttribute('y', String(band.yBottom + PREVIEW_SIZE));
        note.setAttribute('text-anchor', 'middle');
        note.setAttribute('font-size', String(PREVIEW_SIZE));
        note.setAttribute('fill', '#c0392b');
        g.appendChild(note);
        svg.appendChild(g);
        updateEntryPreview(); // fills in the symbol (and dot)
    }
}
function startEntry(staffName, t, voice) {
    entryState.entry = { staffName, layer: currentLayer, voice, t };
    entryState.message = '';
    entryState.chord = [];
    entryState.wheel = 0;
    connectMidi();
    updateEntryDisplay();
    drawEntryCaret();
}
function stopEntry() {
    if (!entryState.entry)
        return;
    entryState.entry = null;
    entryState.message = '';
    entryState.chord = [];
    if (entryState.chordTimer !== null) {
        window.clearTimeout(entryState.chordTimer);
        entryState.chordTimer = null;
    }
    updateEntryDisplay();
    drawEntryCaret();
}
// Clicking the readout: write in the next voice (Up 1, Down 1, Up 2, Down 2, then Up 1 again).
// A voice that doesn't exist yet is created by the first note written in it.
function cycleEntryVoice() {
    const en = entryState.entry;
    if (!en)
        return;
    const ids = VOICE_DEFS.map(def => def.id);
    en.voice = ids[(ids.indexOf(en.voice) + 1) % ids.length];
    entryState.message = '';
    updateEntryDisplay();
}
// Insert mode, in the voice being written: the note goes in at time t. A note that spans t is divided there
// (two separate notes, not tied) and its second half moves later; at a boundary the note just goes in.
function insertCellAt(cells, t, note, d) {
    const fresh = { start: t, end: round(t + d), notes: [note], isTuplet: false, isRest: note.isRest };
    const out = [];
    let done = false;
    for (const c of cells) {
        if (done || c.end <= t + 1e-9) {
            out.push(c);
            continue;
        }
        if (c.start >= t - 1e-9) {
            out.push(fresh, c);
            done = true;
            continue;
        }
        if (c.isTuplet)
            return null; // a tuplet can't be divided
        out.push({ ...c, end: t, notes: piecesFor(c, c.start, t) }, fresh, { ...c, start: t, notes: piecesFor(c, t, c.end) });
        done = true;
    }
    if (!done)
        out.push(fresh);
    return out;
}
// Writes one note (or chord, or rest) of length d at time t in a voice, following the mode:
//  Overwrite  replaces what is there in this voice; other voices are left alone
//  Insert     divides the note at t and pushes everything later, in every voice (held notes get longer)
//  Polyphony  like Overwrite, but if the note would overwrite notes of other pitches it goes to the first free voice
function writeEdit(staff, sourceId, t, note, d) {
    const e = round(t + d);
    const total = getTotalDuration(staff);
    const cellsOf = (id) => {
        const v = getVoice(staff, id);
        return v ? buildCells(v.unprocessedNotes) : emptyVoiceCells(total);
    };
    const sourceCells = cellsOf(sourceId);
    const changes = {};
    const result = (newTotal) => ({ changes, selection: { start: t, end: e, voice: sourceId }, newTotal });
    if (insertMode) {
        const inserted = insertCellAt(sourceCells, t, note, d);
        if (!inserted)
            return null;
        changes[sourceId] = inserted.flatMap(c => c.notes);
        for (const voice of staffVoices(staff)) {
            if (voice.id === sourceId)
                continue;
            const shifted = shiftCellsAt(buildCells(voice.unprocessedNotes), t, d);
            if (!shifted)
                return null; // a tuplet would have to stretch
            changes[voice.id] = shifted.flatMap(c => c.notes);
        }
        return result(round(total + d));
    }
    const newTotal = Math.max(total, e);
    const overwrite = () => {
        const painted = paint(sourceCells, t, e, [note]);
        if (!painted)
            return null;
        changes[sourceId] = painted.flatMap(c => c.notes);
        return result(newTotal);
    };
    if (!polyphonyMode || note.isRest)
        return overwrite();
    const mine = new Set(midisOf(note));
    if (!overlappingCells(sourceCells, t, e).some(c => blocksPitches(c, mine)))
        return overwrite();
    // it would overwrite notes of other pitches: find a voice that is free for the whole length
    for (const id of VOICE_DEFS.map(def => def.id).filter(id => id !== sourceId)) {
        const target = cellsOf(id);
        if (overlappingCells(target, t, e).some(c => blocksPitches(c, mine)))
            continue;
        const painted = paint(target, t, e, [note]);
        if (!painted)
            continue;
        changes[id] = painted.flatMap(c => c.notes);
        changes[sourceId] = erasePitches(sourceCells, t, e, mine).flatMap(c => c.notes); // same pitches under it go
        return result(newTotal);
    }
    return null;
}
// Writes at the caret with the current length, then moves the caret on
function writeAtCaret(content) {
    const en = entryState.entry;
    if (!en)
        return false;
    if (en.layer !== currentLayer || !gridViewOn) {
        stopEntry();
        return false;
    }
    const staff = getActiveStaves()[en.staffName];
    const key = ENTRY_DURATIONS[entryState.durIndex].key;
    const template = content === 'rest' ? new UnprocessedNote(['Rest'], 4, 'q') : new UnprocessedNote(content.names, content.octaves, 'q');
    const note = noteWithDuration(template, key);
    const d = durationMapping[key];
    const r = writeEdit(staff, en.voice, en.t, note, d);
    const fits = !!r && Object.keys(r.changes).every(id => !tupletCrossesBarline(r.changes[id], 0, Infinity));
    if (!r || !fits) {
        entryState.message = "Can't write here";
        updateEntryDisplay();
        return false;
    }
    entryState.message = '';
    commitVoiceEdits(staff, r.changes, null, r.newTotal);
    en.t = round(en.t + d);
    updateEntryDisplay();
    drawEntryCaret();
    return true;
}
// Plays what was just pressed, so you hear it as you write
async function soundPitches(pitches) {
    try {
        const setup = window.setupSampler;
        if (!sampler && typeof setup === 'function')
            await setup();
        if (!sampler)
            return;
        for (const p of pitches)
            sampler.triggerAttackRelease(toToneName(p.name, p.octave), 0.6);
    }
    catch (err) {
        // no sound is not a reason to stop writing
    }
}
function flushChord() {
    entryState.chordTimer = null;
    const pressed = entryState.chord;
    entryState.chord = [];
    if (!pressed.length)
        return;
    const byPitch = new Map();
    for (const p of pressed)
        byPitch.set(soundingMidi(p.name, p.octave), p);
    const ordered = [...byPitch.entries()].sort((a, b) => a[0] - b[0]).map(x => x[1]);
    writeAtCaret({ names: ordered.map(p => p.name), octaves: ordered.map(p => p.octave) });
}
// One MIDI message from the keyboard. Note-ons within the chord window of the first one become one chord.
function handleMidiMessage(data) {
    const en = entryState.entry;
    if (!en)
        return;
    const isNoteOn = (data[0] & 0xf0) === 0x90 && data[2] > 0; // a note-on with velocity 0 is a note-off
    if (!isNoteOn)
        return;
    const staff = getActiveStaves()[en.staffName];
    const pitch = spellMidi(data[1], staff.scale);
    entryState.chord.push(pitch);
    soundPitches([pitch]);
    if (entryState.chordTimer === null)
        entryState.chordTimer = window.setTimeout(flushChord, CHORD_WINDOW_MS);
}
// Asks the browser for MIDI keyboards the first time you start writing (Chrome and Edge only)
function connectMidi() {
    if (entryState.midi !== 'unknown')
        return;
    const nav = navigator;
    if (typeof nav.requestMIDIAccess !== 'function') {
        entryState.midi = 'unsupported';
        return;
    }
    entryState.midi = 'pending';
    nav.requestMIDIAccess().then((access) => {
        const hook = () => {
            let count = 0;
            access.inputs.forEach((input) => { input.onmidimessage = (ev) => handleMidiMessage(ev.data); count++; });
            entryState.midi = count ? 'ok' : 'none';
            updateEntryDisplay();
        };
        hook();
        access.onstatechange = hook; // keyboards plugged in later
    }).catch(() => { entryState.midi = 'blocked'; updateEntryDisplay(); });
}
// The grid line nearest x where a note may start in this voice (never strictly inside one of its tuplets)
function entryTimeFromX(partName, x, voice) {
    const m = findMeasureAtX(partName, x);
    if (!m)
        return 0;
    const spans = tupletSpans(voice);
    let best = null;
    let bestDist = Infinity;
    for (const line of m.lines) {
        if (insideTuplet(spans, line.t))
            continue;
        const dist = Math.abs(line.x - x);
        if (dist < bestDist) {
            best = line;
            bestDist = dist;
        }
    }
    return best ? best.t : rawTimeFromX(partName, x);
}
// Called before each press on the notation, so the two clicks of a double-click can be taken back
function rememberClickState() {
    entryState.clicks.push({
        time: performance.now(),
        layer: currentLayer,
        sel: JSON.parse(JSON.stringify(selections[currentLayer])),
        cleared: JSON.parse(JSON.stringify(clearedSelections)),
    });
    if (entryState.clicks.length > 4)
        entryState.clicks.shift();
}
// A double-click only starts writing: put the selection back as it was before its first click
function restoreClickState() {
    const before = entryState.clicks[entryState.clicks.length - 2];
    if (!before || before.layer !== currentLayer || performance.now() - before.time > 900)
        return;
    selections[currentLayer] = before.sel;
    for (const k of Object.keys(clearedSelections))
        delete clearedSelections[k];
    Object.assign(clearedSelections, before.cleared);
    renderGridOverlays(Object.values(getActiveStaves()));
}
function setupEntryInteraction() {
    for (const partName of Object.keys(containers)) {
        const el = containers[partName];
        // Capture phase, so this runs before the selection handler: remember the selection, and any click stops writing
        el.addEventListener('mousedown', (e) => {
            if (e.button !== 0)
                return;
            rememberClickState();
            stopEntry();
        }, true);
        // Double-click: start writing here, in the voice of the nearest note (Up 1 if there is none).
        // This staff's selection goes away; other staves keep theirs.
        el.addEventListener('dblclick', (e) => {
            if (!gridViewOn)
                return;
            const staff = getActiveStaves()[partName];
            const pt = localPoint(partName, e);
            if (!staff || !pt || !inStaffBand(partName, pt.y))
                return;
            restoreClickState();
            selections[currentLayer][partName] = null; // writing starts clean: nothing on this staff stays selected
            renderGridOverlays(Object.values(getActiveStaves()));
            const total = totalLength();
            const tHit = Math.min(rawTimeFromX(partName, pt.x), total - 1e-6);
            const pick = pickCandidate(candidatesAt(staff, tHit, pt.y), partName, pt.x, pt.y);
            const voice = pick ? pick.voice : staff;
            startEntry(partName, entryTimeFromX(partName, pt.x, voice), voice.id);
        });
        // The caret lives inside the drawing, so it has to be put back whenever the staff is redrawn
        new MutationObserver(() => drawEntryCaret()).observe(el, { childList: true });
    }
    // Mouse wheel: the length of the next note (the page does not scroll while writing)
    document.addEventListener('wheel', (e) => {
        if (!entryState.entry)
            return;
        e.preventDefault();
        const pixels = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 100 : e.deltaY;
        entryState.wheel += pixels;
        while (Math.abs(entryState.wheel) >= 100) {
            const up = entryState.wheel < 0; // scroll up = longer
            entryState.durIndex = Math.min(ENTRY_DURATIONS.length - 1, Math.max(0, entryState.durIndex + (up ? 1 : -1)));
            entryState.wheel += up ? 100 : -100;
        }
        scheduleEntryRefresh();
    }, { passive: false });
    document.addEventListener('keydown', (e) => {
        if (!entryState.entry)
            return;
        const target = e.target;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA' || target.isContentEditable))
            return;
        if (e.key === 'Escape') {
            e.preventDefault();
            stopEntry();
        }
        else if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            writeAtCaret('rest');
        }
    });
}
function computeDurationEdit(ctx, kind, value) {
    if (ctx.multi)
        return null; // several voices at once: pick one voice first
    const staff = ctx.part;
    const store = ctx.store;
    const total = getTotalDuration(store);
    const cells = buildCells(store.unprocessedNotes);
    const { start, end } = ctx.sel;
    // A tuplet touching the selection, even partly, blocks duration edits
    if (cells.some(c => c.isTuplet && c.start < end - 1e-9 && c.end > start + 1e-9))
        return null;
    const selCells = selectedCellIndices(cells, start, end).map(i => cells[i]);
    if (!selCells.length)
        return null;
    // Overwrite changes this voice only, Polyphony may also move the note into another voice, and Insert moves every voice
    const run = (keyFor) => {
        const r = insertMode
            ? insertAcrossVoices(staff, store.id, cells, start, end, total, keyFor)
            : polyphonyMode
                ? polyphonyEdit(staff, store.id, start, end, total, keyFor)
                : wrapSingleVoice(overwriteEdit(cells, start, end, total, keyFor), store.id);
        if (!r)
            return null;
        for (const id of Object.keys(r.changes)) {
            if (tupletCrossesBarline(r.changes[id], 0, Infinity))
                return null;
        }
        return r;
    };
    if (kind === 'dot') {
        const wantDot = !selCells.every(c => (cellKey(c) ?? '').endsWith('d'));
        return run(c => keyWithDot(c, wantDot));
    }
    // Keep the dot when it fits, otherwise fall back to the plain value
    return run(c => keyWithBase(c, value)) ?? run(c => keyWithBase(c, value, false));
}
// Writes the new notes of every changed voice of a staff, then redraws
function commitVoiceEdits(staff, changes, newSel, newTotal) {
    for (const id of Object.keys(changes)) {
        const notes = changes[id];
        renumberTuplets(notes);
        const voice = getOrCreateVoice(staff, id);
        resetVoice(voice);
        processNotes(voice, notes);
    }
    if (newTotal !== null) {
        const measures = measuresCovering(newTotal);
        if (measures > numMeasures)
            numMeasures = measures;
    }
    if (newSel) {
        selections[currentLayer][staff.name] = newSel;
        lastSelectedStaff[currentLayer] = staff.name;
    }
    drawAllStaves();
    updateMemory();
}
function commitEdit(ctx, notes, newSel, newTotal) {
    commitVoiceEdits(ctx.part, { [ctx.store.id]: notes }, newSel ? { ...newSel, voice: newSel.voice ?? ctx.store.id } : null, newTotal);
}
function applyDurationEdit(ctx, kind, value) {
    if (ctx.multi)
        return;
    const r = computeDurationEdit(ctx, kind, value);
    if (!r)
        return;
    // a selection of "all voices" stays that way while the note stays in its voice
    const stays = (!ctx.sel.voice || ctx.sel.voice === 'all') && r.selection.voice === ctx.store.id;
    commitVoiceEdits(ctx.part, r.changes, {
        start: r.selection.start, end: r.selection.end,
        voice: stays ? 'all' : r.selection.voice,
        base: { start: r.selection.start, end: r.selection.end },
    }, r.newTotal);
}
// Rewrites every note in the selection. fn returns the new pitches, 'rest', or null to leave a note alone.
// Rewrites every note in the selection, in every voice it covers. fn returns the new pitches, 'rest', or null to leave a note alone.
function rewriteNotes(ctx, fn) {
    const changes = {};
    for (const g of ctx.groups) {
        const notes = [...g.store.unprocessedNotes];
        let changed = false;
        for (const e of g.entries) {
            const src = notes[e.index];
            const r = fn(src);
            if (!r)
                continue;
            const c = r === 'rest'
                ? new UnprocessedNote(['Rest'], 4, src.duration, src.dotted, false)
                : new UnprocessedNote(r.names, r.octaves, src.duration, src.dotted, src.tiedToNext);
            if (src.tupletInfo)
                c.tupletInfo = { ...src.tupletInfo };
            notes[e.index] = c;
            changed = true;
        }
        if (changed)
            changes[g.store.id] = notes;
    }
    if (Object.keys(changes).length)
        commitVoiceEdits(ctx.part, changes, null, null);
}
// The pending pitch has its note and octave: write it into the note (or turn the rest into a note)
function writePending(ctx, s) {
    const p = s.pending;
    const name = p.letter + (p.acc ?? '');
    const octave = p.octave;
    s.pending = null;
    s.selected = pitchKey(name, octave);
    rewriteNotes(ctx, n => (n.isRest ? { names: [name], octaves: [octave] } : addPitchToNote(n, name, octave)));
}
// A click in the Note / Accidental / Octave rows
function handlePitchRowClick(kind, value) {
    const ctx = getEditContext();
    if (!ctx)
        return;
    if (!ctx.multi && logicalNoteCount(ctx.notes) === 1) {
        const s = ensureSession(ctx);
        // Building a new pitch: a rest has no pitch yet, so clicking a row starts one
        if (s.pending || !firstPitched(ctx)) {
            const p = s.pending ?? (s.pending = { letter: null, acc: null, octave: null });
            if (kind === 'letter')
                p.letter = value;
            else if (kind === 'acc')
                p.acc = value;
            else
                p.octave = Number(value);
            if (p.letter !== null && p.octave !== null)
                writePending(ctx, s); // accidental is optional (natural)
            else
                scheduleEditRefresh();
            return;
        }
        const targets = s.selected ? [s.selected] : [];
        let newKey = s.selected;
        rewriteNotes(ctx, n => {
            const r = editNotePitches(n, targets, kind, kind === 'octave' ? Number(value) : value);
            newKey = r.newKeys[0] ?? newKey;
            return r.set;
        });
        s.selected = newKey;
        return;
    }
    // Several notes, or several voices: edit every pitch of every pitched note
    rewriteNotes(ctx, n => (n.isRest ? null : editNotePitches(n, null, kind, kind === 'octave' ? Number(value) : value).set));
}
function handlePitchButton(key) {
    const ctx = getEditContext();
    if (!ctx)
        return;
    const s = ensureSession(ctx);
    s.pending = null;
    s.selected = key;
    scheduleEditRefresh();
}
function handleAddPitch() {
    const ctx = getEditContext();
    if (!ctx || ctx.multi || logicalNoteCount(ctx.notes) !== 1)
        return;
    ensureSession(ctx).pending = { letter: null, acc: null, octave: null };
    scheduleEditRefresh();
}
// A click on the Voice row: move the selected note(s) to that voice
function handleVoiceMove(destId) {
    const ctx = getEditContext();
    if (!ctx || ctx.multi)
        return;
    const r = moveToVoiceEdit(ctx.part, ctx.store.id, destId, ctx.sel.start, ctx.sel.end, getTotalDuration(ctx.store));
    if (!r)
        return;
    commitVoiceEdits(ctx.part, r.changes, {
        ...r.selection, base: { start: r.selection.start, end: r.selection.end },
    }, r.newTotal);
}
function handleEditClick(kind, value) {
    const ctx = getEditContext();
    if (!ctx)
        return;
    if (kind === 'duration' || kind === 'dot')
        applyDurationEdit(ctx, kind, value);
    else
        handlePitchRowClick(kind, value);
}
// Delete: cancels a pending pitch, removes the selected pitches, or makes the note a rest
// Edit tab Delete: every selected note becomes rests, merged with the rests beside it. A tuplet goes whole.
function deleteSelectedToRests(ctx) {
    const changes = {};
    for (const g of ctx.groups) {
        const src = g.store.unprocessedNotes;
        const hit = new Set(g.entries.map(e => e.index));
        const out = [];
        const fresh = [];
        let pos = 0;
        let changed = false;
        for (let i = 0; i < src.length;) {
            const n = src[i];
            if (n.tupletInfo) {
                let j = i;
                while (j < src.length - 1 && src[j].tupletInfo && src[j].tupletInfo.index !== src[j].tupletInfo.count)
                    j++;
                const total = src[j].tupletInfo.totalTupletDuration;
                let any = false;
                for (let k = i; k <= j; k++)
                    if (hit.has(k))
                        any = true;
                if (any) {
                    for (const r of naturalRests(total, pos)) {
                        out.push(r);
                        fresh.push(true);
                    }
                    changed = true;
                }
                else {
                    for (let k = i; k <= j; k++) {
                        out.push(src[k]);
                        fresh.push(false);
                    }
                }
                pos = round(pos + total);
                i = j + 1;
                continue;
            }
            if (hit.has(i) && !n.isRest) {
                out.push(new UnprocessedNote(['Rest'], 4, n.duration, n.dotted, false));
                fresh.push(true);
                changed = true;
            }
            else {
                out.push(n);
                fresh.push(false);
            }
            pos = round(pos + getNoteDuration(n));
            i++;
        }
        if (changed)
            changes[g.store.id] = coalesceRests(out, k => fresh[k]);
    }
    if (Object.keys(changes).length)
        commitVoiceEdits(ctx.part, changes, null, null);
}
function deleteAtSelection() {
    const ctx = getEditContext();
    if (!ctx)
        return;
    if (!ctx.multi && logicalNoteCount(ctx.notes) === 1) {
        const s = ensureSession(ctx);
        if (s.pending) {
            s.pending = null;
            scheduleEditRefresh();
            return;
        }
        const note = firstPitched(ctx);
        if (!note)
            return;
        const keys = notePitchKeys(note);
        if (keys.length <= 1 || !s.selected) {
            deleteSelectedToRests(ctx);
            return;
        }
        const removing = [s.selected];
        rewriteNotes(ctx, n => removePitchesFromNote(n, removing));
        s.selected = keys.filter(k => k !== removing[0])[0] ?? null;
        return;
    }
    deleteSelectedToRests(ctx);
}
// Kept so grid.ts's existing call still works; clicking a note again no longer cycles pitches
function editOnPlainClick(_sameAsBefore) { }
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Menu: build + highlight + enable
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
function buildEditMenu() {
    const host = document.getElementById('edit-menu');
    if (!host)
        return;
    host.innerHTML = '';
    const heading = (title) => {
        const h = document.createElement('div');
        h.className = 'buttonDescription';
        h.textContent = title;
        host.appendChild(h);
    };
    const addRow = (title, buttons) => {
        heading(title);
        const row = document.createElement('div');
        row.className = 'row';
        for (const b of buttons) {
            const el = document.createElement('button');
            el.className = 'editBtn';
            el.textContent = b.label;
            el.dataset.kind = b.kind;
            el.dataset.value = b.value;
            el.disabled = true;
            el.addEventListener('click', () => { handleEditClick(b.kind, b.value); el.blur(); });
            row.appendChild(el);
        }
        host.appendChild(row);
    };
    heading('Voice');
    const voiceRow = document.createElement('div');
    voiceRow.id = 'voiceRow';
    voiceRow.className = 'row';
    host.appendChild(voiceRow);
    heading('Pitches');
    const pitchRow = document.createElement('div');
    pitchRow.id = 'pitchRow';
    pitchRow.className = 'row';
    host.appendChild(pitchRow);
    addRow('Note', LETTERS.map(l => ({ label: l, kind: 'letter', value: l })));
    addRow('Accidental', ACC_BUTTONS.map(a => ({ label: ACC_GLYPH[a], kind: 'acc', value: a })));
    addRow('Octave', OCTAVE_BUTTONS.map(o => ({ label: String(o), kind: 'octave', value: String(o) })));
    addRow('Duration', rhythmOptions.slice().reverse().map(r => ({
        label: r.symbol, kind: 'duration', value: DURATION_KEYS[r.id],
    })));
    addRow('Dot', [{ label: '\u00B7', kind: 'dot', value: 'dot' }]);
}
function scheduleEditRefresh() {
    if (editRefreshQueued)
        return;
    editRefreshQueued = true;
    requestAnimationFrame(refreshEditMenu);
}
function pitchLabel(name, octave) {
    const { letter, acc } = parsePitchName(name);
    return `${letter}${acc === '' ? '' : ACC_GLYPH[acc]}${octave}`;
}
function refreshEditMenu() {
    editRefreshQueued = false;
    const host = document.getElementById('edit-menu');
    const pitchRow = document.getElementById('pitchRow');
    const voiceRow = document.getElementById('voiceRow');
    if (!host || !pitchRow || !voiceRow)
        return;
    const buttons = host.querySelectorAll('.editBtn');
    pitchRow.innerHTML = '';
    voiceRow.innerHTML = '';
    const ctx = getEditContext();
    // The Voice row: which voice the selection is in, and where it can move to
    for (const def of VOICE_DEFS) {
        const b = document.createElement('button');
        b.className = 'voiceBtn';
        b.textContent = def.label;
        const here = !!ctx && !ctx.multi && ctx.store.id === def.id;
        const canMove = !!ctx && !ctx.multi && !here &&
            moveToVoiceEdit(ctx.part, ctx.store.id, def.id, ctx.sel.start, ctx.sel.end, getTotalDuration(ctx.store)) !== null;
        b.classList.toggle('active', here);
        b.disabled = !ctx || (!here && !canMove);
        if (canMove)
            b.addEventListener('click', () => { handleVoiceMove(def.id); b.blur(); });
        voiceRow.appendChild(b);
    }
    if (!ctx) {
        buttons.forEach(b => { b.classList.remove('active'); b.disabled = true; });
        return;
    }
    const staff = ctx.part;
    const single = !ctx.multi && logicalNoteCount(ctx.notes) === 1;
    const note = firstPitched(ctx);
    // What the Note / Accidental / Octave rows show and whether they can be used
    let litLetter = null;
    let litAcc = null;
    let litOct = null;
    let canEditPitch = false;
    if (single) {
        const s = ensureSession(ctx);
        canEditPitch = true;
        if (s.pending) {
            litLetter = s.pending.letter;
            litAcc = s.pending.acc;
            litOct = s.pending.octave;
        }
        else if (note) {
            const t = s.selected ? [targetFromKey(s.selected)] : [];
            litLetter = uniform(t.map(x => x.letter));
            litAcc = uniform(t.map(x => x.acc));
            litOct = uniform(t.map(x => x.octave));
        }
        // The pitch row: the note's pitches (red when out of key), the pending pitch, and "+"
        if (note) {
            for (const key of notePitchKeys(note)) {
                const p = parsePitchString(key);
                const b = document.createElement('button');
                b.className = 'pitchBtn';
                b.textContent = pitchLabel(p.name, p.octave);
                if (s.selected === key && !s.pending)
                    b.classList.add('active');
                if (pitchIsOutOfKey(staff, p.name, p.octave, ctx.sel.start))
                    b.classList.add('bad');
                b.addEventListener('click', () => { handlePitchButton(key); b.blur(); });
                pitchRow.appendChild(b);
            }
        }
        if (s.pending) {
            const p = s.pending;
            const b = document.createElement('button');
            b.className = 'pitchBtn pending active';
            b.textContent = `${p.letter ?? '\u00B7'}${p.acc ? ACC_GLYPH[p.acc] : ''}${p.octave ?? '\u00B7'}`;
            pitchRow.appendChild(b);
        }
        const add = document.createElement('button');
        add.className = 'pitchBtn pitchAdd';
        add.textContent = '+';
        add.addEventListener('click', () => { handleAddPitch(); add.blur(); });
        pitchRow.appendChild(add);
    }
    else {
        const t = [];
        for (const n of ctx.notes) {
            if (n.isRest)
                continue;
            n.noteName.forEach((nm, i) => {
                const p = parsePitchName(nm);
                t.push({ letter: p.letter, acc: p.acc, octave: n.octaves[i] });
            });
        }
        canEditPitch = t.length > 0;
        litLetter = uniform(t.map(x => x.letter));
        litAcc = uniform(t.map(x => x.acc));
        litOct = uniform(t.map(x => x.octave));
    }
    // Duration / dot come from the logical notes (the nominal value for tuplet notes)
    let keys;
    if (ctx.notes.some(n => n.tupletInfo)) {
        keys = ctx.notes.map(n => getDurationKeyFromValue(getNoteDuration(n)));
    }
    else {
        const cells = buildCells(ctx.store.unprocessedNotes);
        keys = selectedCellIndices(cells, ctx.sel.start, ctx.sel.end).map(i => cellKey(cells[i]));
    }
    const known = !ctx.multi && keys.length > 0 && keys.every(k => k !== null);
    const litBase = known ? uniform(keys.map(k => k.replace(/d$/, ''))) : null;
    const litDot = known ? uniform(keys.map(k => k.endsWith('d'))) : null;
    buttons.forEach(b => {
        const kind = b.dataset.kind;
        const value = b.dataset.value;
        let on = false;
        let enabled = false;
        if (kind === 'letter') {
            on = litLetter !== null && litLetter === value;
            enabled = canEditPitch;
        }
        else if (kind === 'acc') {
            on = litAcc !== null && litAcc === value;
            enabled = canEditPitch;
        }
        else if (kind === 'octave') {
            on = litOct !== null && litOct === Number(value);
            enabled = canEditPitch;
        }
        else if (kind === 'duration') {
            on = litBase === value;
            enabled = computeDurationEdit(ctx, 'duration', value) !== null;
        }
        else {
            on = litDot === true;
            enabled = computeDurationEdit(ctx, 'dot', value) !== null;
        }
        b.classList.toggle('active', on);
        b.disabled = !enabled;
    });
}
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Top-bar mode buttons + keyboard
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
document.querySelectorAll('.modeButton').forEach(btn => {
    btn.addEventListener('click', () => {
        const mode = btn.dataset.mode; // 'insert' | 'overwrite' | 'polyphony'
        insertMode = mode === 'insert';
        polyphonyMode = mode === 'polyphony';
        document.querySelectorAll('.modeButton')
            .forEach(b => b.classList.toggle('active', b === btn));
        btn.blur(); // so Space still triggers Play
        scheduleEditRefresh();
    });
});
// Create tab: Delete turns whatever is inside each track's selected range into rests
function deleteNotesInRanges() {
    const active = getActiveStaves();
    let any = false;
    for (const name of staves) {
        const applied = applyToRange(active[name], clearedToRests);
        if (applied)
            any = true;
    }
    if (any) {
        drawAllStaves();
        updateMemory();
    }
}
const isVisibleTab = (id) => !document.getElementById(id)?.classList.contains('hidden');
document.addEventListener('keydown', (e) => {
    if (!gridViewOn)
        return;
    if (e.key !== 'Delete' && e.key !== 'Backspace')
        return;
    const t = e.target;
    const typing = (t.tagName === 'INPUT' && t.type !== 'range') ||
        t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable;
    if (typing)
        return;
    if (currentTab === 'edit' && isVisibleTab('edit-menu')) {
        e.preventDefault();
        deleteAtSelection();
    }
    else if (currentTab === 'create' && isVisibleTab('input-menu')) {
        e.preventDefault();
        deleteNotesInRanges();
    }
});
buildEditMenu();
scheduleEditRefresh();
setupEntryInteraction();
setupClipboardKeys();
ignoreBlankClicksWhileWriting();
