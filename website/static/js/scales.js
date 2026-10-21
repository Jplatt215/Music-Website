"use strict";
////////////////////////////////////////////////////////////////////////////////////////////////////
// Scale calculator: a draggable popout opened from the icon in the top bar
////////////////////////////////////////////////////////////////////////////////////////////////////
// Semitones above the root. The overtone series is counted in keys, so it reaches up several octaves.
const calculatorScales = {
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
    'Overtone (Theoretical)': [0, 12, 19, 24, 28, 31, 34, 36, 38, 40, 42, 43, 45, 46, 47, 48],
    'Overtone (Audible)': [0, 12, 19, 24, 28, 31, 36, 38, 40, 43, 47, 48],
};
const OVERTONE_SCALES = ['Overtone (Theoretical)', 'Overtone (Audible)'];
// In keyboard order: the piano starts on A
const keyboardNoteNames = ['A', 'Bb', 'B', 'C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab'];
const MIN_NOTES_TO_FIND_SCALE = 3;
const MAX_SCALES = 3;
// Three shades of blue: the first scale is the lightest, the third the darkest
const SCALE_COLORS = ['#bcd8ff', '#6aa5f5', '#2f66c8'];
// Where each new scale starts out, so a second scale does not simply cover the first
const NEW_SCALE_DEFAULTS = [
    { root: 'C', scaleName: 'Major' },
    { root: 'A', scaleName: 'Minor' },
    { root: 'G', scaleName: 'Major' },
];
// Text and buttons are sized in em, so changing the panel's font size scales them together.
// The keyboard always stretches to the panel's width, so all 88 keys stay visible.
const BASE_PANEL_WIDTH = 900; // the width at which the font size is exactly BASE_FONT_PX
const BASE_FONT_PX = 14;
const DEFAULT_PANEL_WIDTH = 1100;
const MIN_PANEL_WIDTH = 560;
const MAX_PANEL_WIDTH = 2000;
const BLACK_KEY_WIDTH_RATIO = 0.58; // of a white key
const WIDTH_STORAGE_KEY = 'scaleWidgetSize';
let scaleWidget = null;
// The note without its octave: "Bb3" -> "Bb"
function pitchClassOfKey(keyName) {
    return keyName.replace(/\d/g, '');
}
// Indexes into pianoKeys of every key in the scale
function scaleKeyIndexes(root, scaleName) {
    const highlighted = new Set();
    const intervals = calculatorScales[scaleName];
    const isOvertone = OVERTONE_SCALES.includes(scaleName);
    for (let keyIndex = 0; keyIndex < pianoKeys.length; keyIndex++) {
        if (pitchClassOfKey(pianoKeys[keyIndex]) !== root)
            continue;
        highlighted.add(keyIndex);
        for (const interval of intervals) {
            const above = keyIndex + interval;
            if (above < pianoKeys.length)
                highlighted.add(above);
            if (isOvertone)
                continue;
            const below = keyIndex - (12 - interval);
            if (below >= 0)
                highlighted.add(below);
        }
        if (isOvertone)
            break; // the series starts from the lowest root only
    }
    return highlighted;
}
const FIND_COLORS = ['#f8d0d0', '#ee9a9a', '#d96b6b']; // three shades of red, like the blues of the Scales List
const MIN_NOTES_TO_FIND_COMPONENTS = 7;
const MAX_FIND_RESULTS = 60;
// Notes as a bit set (bit 0 = A, matching keyboardNoteNames)
function noteMask(noteNumbers) {
    let mask = 0;
    for (const noteNumber of noteNumbers)
        mask |= 1 << noteNumber;
    return mask;
}
// Every scale on every root, one per distinct set of notes (a whole-tone scale on C and on D is the same scale)
function everyScale() {
    const scales = [];
    const seen = new Set();
    for (const scaleName in calculatorScales) {
        keyboardNoteNames.forEach((root, rootNumber) => {
            const mask = noteMask(calculatorScales[scaleName].map(interval => (rootNumber + interval) % 12));
            if (seen.has(`${scaleName}|${mask}`))
                return;
            seen.add(`${scaleName}|${mask}`);
            scales.push({ entry: { root, scaleName }, mask });
        });
    }
    return scales;
}
// Scales that contain every one of the notes
function compatibleScales(noteNumbers) {
    const wanted = noteMask(noteNumbers);
    return everyScale().filter(scale => (scale.mask & wanted) === wanted).map(scale => [scale.entry]);
}
// Groups of up to MAX_SCALES scales, each made only of the chosen notes, that together use all of them
function componentScaleGroups(noteNumbers) {
    const wanted = noteMask(noteNumbers);
    const candidates = everyScale().filter(scale => (scale.mask & ~wanted) === 0);
    const unionOf = (group) => group.reduce((mask, scale) => mask | scale.mask, 0);
    const groups = [];
    const extend = (start, chosen) => {
        if (chosen.length > 0 && unionOf(chosen) === wanted) {
            // keep it only if every scale in it is needed
            if (chosen.every((scale, index) => unionOf(chosen.filter((other, otherIndex) => otherIndex !== index)) !== wanted))
                groups.push(chosen);
            return;
        }
        if (chosen.length === MAX_SCALES)
            return;
        for (let index = start; index < candidates.length; index++)
            extend(index + 1, [...chosen, candidates[index]]);
    };
    extend(0, []);
    groups.sort((first, second) => first.length - second.length);
    return groups.map(group => group.map(scale => scale.entry));
}
function makeScaleButton(label, className, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
}
// A key lit by one scale gets that scale's color; a key in several gets a band of each color
function keyBackground(colors) {
    if (colors.length === 0)
        return '';
    if (colors.length === 1)
        return colors[0];
    const bandSize = 100 / colors.length;
    const bands = colors.map((color, bandIndex) => `${color} ${bandIndex * bandSize}% ${(bandIndex + 1) * bandSize}%`);
    return `linear-gradient(135deg, ${bands.join(', ')})`;
}
function highlightScale(widget) {
    if (widget.activeTab === 'selected') {
        refreshSelectedNotes();
        return;
    }
    if (widget.activeTab === 'find') {
        highlightFindKeys(widget);
        return;
    }
    const litKeys = widget.scaleEntries.map(entry => scaleKeyIndexes(entry.root, entry.scaleName));
    widget.keys.forEach((key, keyIndex) => {
        const colors = SCALE_COLORS.filter((color, entryIndex) => litKeys[entryIndex]?.has(keyIndex));
        key.classList.toggle('highlighted', colors.length > 0);
        key.classList.remove('sw-selected-note');
        key.style.background = keyBackground(colors);
    });
}
// Rebuild the little colored tabs (one per scale) and the "add scale" button
function refreshEntryTabs(widget) {
    widget.entryTabs.replaceChildren();
    widget.scaleEntries.forEach((entry, entryIndex) => {
        const tab = document.createElement('div');
        tab.className = `sw-scaletab sw-color-${entryIndex}${entryIndex === widget.currentEntry ? ' active' : ''}`;
        const pick = makeScaleButton(`${entry.root} ${entry.scaleName}`, 'sw-scalepick', () => selectEntry(widget, entryIndex));
        tab.appendChild(pick);
        if (widget.scaleEntries.length > 1) {
            const remove = makeScaleButton('\u2715', 'sw-scaleclose', () => removeEntry(widget, entryIndex));
            remove.setAttribute('aria-label', 'Remove this scale');
            tab.appendChild(remove);
        }
        widget.entryTabs.appendChild(tab);
    });
    if (widget.scaleEntries.length < MAX_SCALES) {
        widget.entryTabs.appendChild(makeScaleButton('+ Add scale', 'sw-btn sw-addscale', () => addEntry(widget)));
    }
    widget.rootSelect.value = widget.scaleEntries[widget.currentEntry].root;
    widget.scaleSelect.value = widget.scaleEntries[widget.currentEntry].scaleName;
    // the dropdowns take the color of the scale tab they are editing
    widget.rootSelect.className = `sw-select sw-color-${widget.currentEntry}`;
    widget.scaleSelect.className = `sw-select sw-color-${widget.currentEntry}`;
}
function selectEntry(widget, entryIndex) {
    widget.currentEntry = entryIndex;
    refreshEntryTabs(widget);
}
function addEntry(widget) {
    if (widget.scaleEntries.length >= MAX_SCALES)
        return;
    widget.scaleEntries.push({ ...NEW_SCALE_DEFAULTS[widget.scaleEntries.length] });
    widget.currentEntry = widget.scaleEntries.length - 1;
    refreshEntryTabs(widget);
    highlightScale(widget);
}
function removeEntry(widget, entryIndex) {
    if (widget.scaleEntries.length <= 1)
        return;
    widget.scaleEntries.splice(entryIndex, 1);
    widget.currentEntry = Math.min(widget.currentEntry, widget.scaleEntries.length - 1);
    refreshEntryTabs(widget);
    highlightScale(widget);
}
async function playScaleKey(keyName) {
    await setupSampler();
    sampler.triggerAttackRelease(keyName, '2n');
}
function buildKeyboard(widget) {
    const whiteKeyCount = pianoKeys.filter(keyName => !pitchClassOfKey(keyName).includes('b')).length;
    const whiteKeyPercent = 100 / whiteKeyCount;
    const blackKeyPercent = whiteKeyPercent * BLACK_KEY_WIDTH_RATIO;
    let whiteKeysSoFar = 0;
    pianoKeys.forEach(keyName => {
        const isBlack = pitchClassOfKey(keyName).includes('b');
        const key = document.createElement('div');
        key.className = isBlack ? 'sw-key sw-black' : 'sw-key sw-white';
        key.title = keyName;
        key.style.width = `${isBlack ? blackKeyPercent : whiteKeyPercent}%`;
        key.style.left = `${isBlack ? whiteKeysSoFar * whiteKeyPercent - blackKeyPercent / 2 : whiteKeysSoFar * whiteKeyPercent}%`;
        key.addEventListener('click', () => playScaleKey(keyName));
        if (!isBlack)
            whiteKeysSoFar++;
        widget.keyboard.appendChild(key);
        widget.keys.push(key);
    });
}
function makeSelect(options, onChange) {
    const select = document.createElement('select');
    select.className = 'sw-select';
    for (const optionName of options) {
        const option = document.createElement('option');
        option.value = optionName;
        option.textContent = optionName;
        select.appendChild(option);
    }
    select.addEventListener('change', () => onChange(select.value));
    return select;
}
function buildShowTab(widget) {
    const tab = document.createElement('div');
    tab.className = 'sw-tab sw-show-body';
    const dropdowns = document.createElement('div');
    dropdowns.className = 'sw-row';
    widget.rootSelect = makeSelect(keyboardNoteNames, root => {
        widget.scaleEntries[widget.currentEntry].root = root;
        refreshEntryTabs(widget);
        highlightScale(widget);
    });
    widget.scaleSelect = makeSelect(Object.keys(calculatorScales), scaleName => {
        widget.scaleEntries[widget.currentEntry].scaleName = scaleName;
        refreshEntryTabs(widget);
        highlightScale(widget);
    });
    const copyFindButton = makeScaleButton('Copy Find Scales', 'sw-btn', () => {
        if (!widget.findPick)
            return;
        widget.scaleEntries = widget.findPick.map(entry => ({ ...entry }));
        widget.currentEntry = 0;
        refreshEntryTabs(widget);
        highlightScale(widget);
    });
    dropdowns.append(widget.rootSelect, widget.scaleSelect, copyFindButton);
    tab.append(widget.entryTabs, dropdowns);
    return tab;
}
const MIDDLE_C_MIDI = 60;
const LOWEST_KEY_MIDI = 21; // A0, the first entry of pianoKeys
const STAFF_WIDTH = 170;
const LINE_STEP_PX = 5; // one line or space of a staff
// Every distinct sounding pitch in the current selection of every track, lowest first (unisons count once)
function collectSelectedPitches() {
    const active = getActiveStaves();
    const pitchByMidi = new Map();
    for (const staffName of staves) {
        const selection = getSelection(staffName);
        const staff = active[staffName];
        if (!selection || !staff)
            continue;
        for (const store of selectionTargets(staff, selection)) {
            for (const entry of getUnprocessedTimeline(store.unprocessedNotes)) {
                if (entry.start >= selection.end - 1e-9 || entry.start + entry.dur <= selection.start + 1e-9)
                    continue;
                const note = store.unprocessedNotes[entry.index];
                if (note.isRest)
                    continue;
                note.noteName.forEach((name, pitchIndex) => {
                    const octave = note.octaves[pitchIndex];
                    const midi = soundingMidi(name, octave);
                    if (!pitchByMidi.has(midi))
                        pitchByMidi.set(midi, { name, octave, midi });
                });
            }
        }
    }
    return [...pitchByMidi.values()].sort((first, second) => first.midi - second.midi);
}
// One of each pitch class, all placed in the octave above middle C
function foldIntoOneOctave(pitches) {
    const byPitchClass = new Map();
    for (const pitch of pitches) {
        const pitchClass = ((pitch.midi % 12) + 12) % 12;
        if (!byPitchClass.has(pitchClass))
            byPitchClass.set(pitchClass, { name: pitch.name, octave: 4, midi: soundingMidi(pitch.name, 4) });
    }
    return [...byPitchClass.values()].sort((first, second) => staffPosition(first.name, first.octave) - staffPosition(second.name, second.octave));
}
// How far a chord reaches past the five lines, in pixels (room for its ledger lines)
function clefGroup(clef, pitches) {
    const bottomLine = clef === 'treble' ? 4 * 7 + 2 : 2 * 7 + 4; // E4, G2
    const topLine = bottomLine + 8;
    const positions = pitches.map(pitch => staffPosition(pitch.name, pitch.octave));
    return {
        clef,
        pitches,
        above: Math.max(0, Math.max(...positions) - topLine) * LINE_STEP_PX,
        below: Math.max(0, bottomLine - Math.min(...positions)) * LINE_STEP_PX,
    };
}
function drawChordStaff(container, pitches, compress) {
    container.replaceChildren();
    if (!pitches.length) {
        container.textContent = 'Select notes on the grid to see them here.';
        return;
    }
    const groups = [];
    const trebleNotes = compress ? pitches : pitches.filter(pitch => pitch.midi >= MIDDLE_C_MIDI);
    const bassNotes = compress ? [] : pitches.filter(pitch => pitch.midi < MIDDLE_C_MIDI);
    if (trebleNotes.length)
        groups.push(clefGroup('treble', trebleNotes));
    if (bassNotes.length)
        groups.push(clefGroup('bass', bassNotes));
    const staveHeight = 40;
    const margin = 30;
    const gap = 24;
    let nextTop = margin;
    const tops = groups.map(group => {
        const top = nextTop + group.above;
        nextTop = top + staveHeight + group.below + gap;
        return top;
    });
    const totalHeight = nextTop - gap + margin;
    const totalWidth = STAFF_WIDTH + 50;
    const renderer = new Renderer(container, Renderer.Backends.SVG);
    renderer.resize(totalWidth, totalHeight);
    const context = renderer.getContext();
    const drawnStaves = groups.map((group, groupIndex) => {
        const stave = new Stave(30, tops[groupIndex], STAFF_WIDTH, { space_above_staff_ln: 0, space_below_staff_ln: 0 });
        stave.addClef(group.clef);
        stave.setContext(context).draw();
        return stave;
    });
    groups.forEach((group, groupIndex) => {
        const note = new StaveNote({ clef: group.clef, keys: group.pitches.map(pitch => `${parsePitchName(pitch.name).letter}/${pitch.octave}`), duration: 'w' });
        group.pitches.forEach((pitch, pitchIndex) => {
            const accidental = parsePitchName(pitch.name).acc;
            if (accidental !== '')
                note.addModifier(new Accidental(accidental), pitchIndex);
        });
        const voice = new VFVoice({ num_beats: 4, beat_value: 4 }).setStrict(false);
        voice.addTickables([note]);
        new Formatter().joinVoices([voice]).format([voice], STAFF_WIDTH - 70);
        voice.draw(context, drawnStaves[groupIndex]);
    });
    if (drawnStaves.length === 2) {
        const { StaveConnector } = Vex.Flow;
        new StaveConnector(drawnStaves[0], drawnStaves[1]).setType('brace').setContext(context).draw();
        new StaveConnector(drawnStaves[0], drawnStaves[1]).setType('singleLeft').setContext(context).draw();
    }
}
function highlightSelectedKeys(widget, pitches) {
    const exactMidis = new Set(pitches.map(pitch => pitch.midi));
    const pitchClasses = new Set(pitches.map(pitch => ((pitch.midi % 12) + 12) % 12));
    widget.keys.forEach((key, keyIndex) => {
        const midi = LOWEST_KEY_MIDI + keyIndex;
        const lit = widget.compress ? pitchClasses.has(midi % 12) : exactMidis.has(midi);
        key.classList.toggle('highlighted', lit);
        key.classList.toggle('sw-selected-note', lit);
        key.style.background = '';
    });
}
// Redraw the Selected Notes tab (staff + keyboard) from the grid's current selection
function refreshSelectedNotes() {
    const widget = scaleWidget;
    if (!widget || widget.activeTab !== 'selected' || widget.panel.classList.contains('hidden'))
        return;
    const pitches = collectSelectedPitches();
    const shown = widget.compress ? foldIntoOneOctave(pitches) : pitches;
    drawChordStaff(widget.selectedStaff, shown, widget.compress);
    highlightSelectedKeys(widget, pitches);
    const selectedNoteNumbers = new Set(pitches.map(pitch => ((pitch.midi - LOWEST_KEY_MIDI) % 12 + 12) % 12));
    widget.selectedNoteButtons.forEach((button, noteNumber) => button.classList.toggle('active', selectedNoteNumbers.has(noteNumber)));
}
function buildSelectedTab(widget) {
    const tab = document.createElement('div');
    tab.className = 'sw-tab sw-selected-body';
    const row = document.createElement('div');
    row.className = 'sw-row';
    const compressButton = makeScaleButton('Compress', 'sw-btn', () => {
        widget.compress = !widget.compress;
        compressButton.classList.toggle('active', widget.compress);
        refreshSelectedNotes();
    });
    row.appendChild(compressButton);
    const noteRow = document.createElement('div');
    noteRow.className = 'sw-row sw-notedisplay';
    keyboardNoteNames.forEach(noteName => {
        const button = makeScaleButton(noteName, 'sw-btn', () => { });
        button.tabIndex = -1;
        widget.selectedNoteButtons.push(button);
        noteRow.appendChild(button);
    });
    widget.selectedStaff.className = 'sw-staffbox';
    tab.append(row, widget.selectedStaff, noteRow);
    return tab;
}
// Keys for the Find tab: the picked result's scales (one red, or three shades), else every octave of the chosen notes
function highlightFindKeys(widget) {
    let litKeys;
    let colors;
    if (widget.findPick) {
        litKeys = widget.findPick.map(entry => scaleKeyIndexes(entry.root, entry.scaleName));
        colors = widget.findPick.length === 1 ? [FIND_COLORS[1]] : FIND_COLORS.slice(0, widget.findPick.length);
    }
    else {
        litKeys = [new Set(pianoKeys.map((keyName, keyIndex) => keyIndex).filter(keyIndex => widget.findNotes.has(keyIndex % 12)))];
        colors = [FIND_COLORS[1]];
    }
    widget.keys.forEach((key, keyIndex) => {
        const keyColors = colors.filter((color, colorIndex) => litKeys[colorIndex].has(keyIndex));
        key.classList.toggle('highlighted', keyColors.length > 0);
        key.classList.remove('sw-selected-note');
        key.style.background = keyBackground(keyColors);
    });
}
function showFindResults(widget, groups, emptyMessage) {
    widget.findPick = null;
    widget.results.replaceChildren();
    if (groups.length === 0) {
        widget.results.textContent = emptyMessage;
        return;
    }
    const boxes = groups.slice(0, MAX_FIND_RESULTS).map(group => {
        const box = document.createElement('button');
        box.type = 'button';
        box.className = 'sw-resultbox';
        for (const entry of group) {
            const line = document.createElement('span');
            line.textContent = `${entry.root} ${entry.scaleName}`;
            box.appendChild(line);
        }
        box.addEventListener('click', () => {
            const turnOn = widget.findPick !== group;
            widget.findPick = turnOn ? group : null;
            boxes.forEach(other => other.classList.toggle('active', turnOn && other === box));
            highlightFindKeys(widget);
        });
        return box;
    });
    widget.results.append(...boxes);
}
function buildFindTab(widget) {
    const tab = document.createElement('div');
    tab.className = 'sw-tab sw-find-body';
    const hint = document.createElement('p');
    hint.className = 'sw-hint';
    // anything that changes the chosen notes or the mode throws the old results away
    function resetResults() {
        const compatible = widget.findMode === 'compatible';
        hint.textContent = compatible
            ? `Pick at least ${MIN_NOTES_TO_FIND_SCALE} notes to see the scales that contain them.`
            : `Pick at least ${MIN_NOTES_TO_FIND_COMPONENTS} notes to see groups of scales that together make up those notes.`;
        widget.findPick = null;
        widget.results.replaceChildren();
        widget.findButtons.forEach((button, noteNumber) => button.classList.toggle('active', widget.findNotes.has(noteNumber)));
        highlightScale(widget);
    }
    const modeRow = document.createElement('div');
    modeRow.className = 'sw-row';
    const modes = [
        { mode: 'compatible', label: 'Find compatible scales' },
        { mode: 'component', label: 'Find component scales' },
    ];
    const modeButtons = modes.map(({ mode, label }) => {
        const button = makeScaleButton(label, `sw-btn${mode === widget.findMode ? ' active' : ''}`, () => {
            widget.findMode = mode;
            modeButtons.forEach((other, otherIndex) => other.classList.toggle('active', modes[otherIndex].mode === mode));
            resetResults();
        });
        return button;
    });
    modeRow.append(...modeButtons);
    const noteRow = document.createElement('div');
    noteRow.className = 'sw-row';
    keyboardNoteNames.forEach((noteName, noteNumber) => {
        const button = makeScaleButton(noteName, 'sw-btn', () => {
            if (widget.findNotes.has(noteNumber))
                widget.findNotes.delete(noteNumber);
            else
                widget.findNotes.add(noteNumber);
            resetResults();
        });
        widget.findButtons.push(button);
        noteRow.appendChild(button);
    });
    const findButton = makeScaleButton('Find Scales', 'sw-btn sw-run', () => {
        const compatible = widget.findMode === 'compatible';
        const minimum = compatible ? MIN_NOTES_TO_FIND_SCALE : MIN_NOTES_TO_FIND_COMPONENTS;
        if (widget.findNotes.size < minimum) {
            showFindResults(widget, [], `Please choose at least ${minimum} notes.`);
        }
        else if (compatible) {
            showFindResults(widget, compatibleScales(widget.findNotes), 'No scale contains all of those notes.');
        }
        else {
            showFindResults(widget, componentScaleGroups(widget.findNotes), 'Those notes cannot be built from up to three scales.');
        }
        highlightFindKeys(widget);
    });
    const clearButton = makeScaleButton('Clear', 'sw-btn sw-clear', () => {
        widget.findNotes.clear();
        resetResults();
    });
    const copyButton = makeScaleButton('Copy Selected Notes', 'sw-btn', () => {
        widget.findNotes.clear();
        for (const pitch of collectSelectedPitches())
            widget.findNotes.add(((pitch.midi - LOWEST_KEY_MIDI) % 12 + 12) % 12);
        resetResults();
    });
    // A two-column grid: the notes and Find Scales on the left, Copy and Clear (same width) on the right
    const findGroup = document.createElement('div');
    findGroup.className = 'sw-findgroup';
    const copyScalesButton = makeScaleButton('Copy Scales List', 'sw-btn', () => {
        widget.findNotes.clear();
        for (const entry of widget.scaleEntries) {
            const rootNumber = keyboardNoteNames.indexOf(entry.root);
            for (const interval of calculatorScales[entry.scaleName])
                widget.findNotes.add((rootNumber + interval) % 12);
        }
        resetResults();
    });
    findGroup.append(noteRow, copyScalesButton, copyButton, findButton, clearButton);
    tab.append(hint, modeRow, findGroup, widget.results);
    return tab;
}
// Set the panel width; the font size follows it, which scales every em-sized part of the widget
function setPanelWidth(panel, width) {
    const widest = Math.min(MAX_PANEL_WIDTH, window.innerWidth - 16);
    const clamped = Math.max(MIN_PANEL_WIDTH, Math.min(width, widest));
    panel.style.width = `${clamped}px`;
    panel.style.fontSize = `${BASE_FONT_PX * clamped / BASE_PANEL_WIDTH}px`;
}
function defaultPanelWidth() {
    return Math.min(DEFAULT_PANEL_WIDTH, window.innerWidth - 40);
}
function savedPanelWidth() {
    try {
        const saved = Number(localStorage.getItem(WIDTH_STORAGE_KEY));
        if (saved > 0)
            return saved;
    }
    catch { /* storage can be blocked; use the default */ }
    return defaultPanelWidth();
}
// Drag the grip in the bottom-right corner to resize
function makePanelResizable(panel, grip) {
    grip.addEventListener('pointerdown', (downEvent) => {
        downEvent.preventDefault();
        const box = panel.getBoundingClientRect();
        panel.style.left = `${box.left}px`; // keep the left edge still while the right edge moves
        panel.style.top = `${box.top}px`;
        panel.style.right = 'auto';
        const onMove = (moveEvent) => {
            setPanelWidth(panel, box.width + moveEvent.clientX - downEvent.clientX);
        };
        const onUp = () => {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            try {
                localStorage.setItem(WIDTH_STORAGE_KEY, String(Math.round(panel.getBoundingClientRect().width)));
            }
            catch { /* ignore */ }
        };
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
    });
}
// Let the panel be dragged by its title bar
function makePanelDraggable(panel, handle) {
    handle.addEventListener('pointerdown', (downEvent) => {
        if (downEvent.target.closest('button'))
            return;
        const box = panel.getBoundingClientRect();
        const grabX = downEvent.clientX - box.left;
        const grabY = downEvent.clientY - box.top;
        const onMove = (moveEvent) => {
            const left = Math.min(Math.max(0, moveEvent.clientX - grabX), window.innerWidth - 60);
            const top = Math.min(Math.max(0, moveEvent.clientY - grabY), window.innerHeight - 40);
            panel.style.left = `${left}px`;
            panel.style.top = `${top}px`;
            panel.style.right = 'auto';
        };
        const onUp = () => {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
        };
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
    });
}
function buildScaleWidget() {
    const panel = document.createElement('div');
    panel.id = 'scaleWidget';
    panel.className = 'sw-panel hidden';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Scale calculator');
    const widget = {
        panel,
        keys: [],
        scaleEntries: [{ ...NEW_SCALE_DEFAULTS[0] }],
        currentEntry: 0,
        entryTabs: document.createElement('div'),
        rootSelect: document.createElement('select'),
        scaleSelect: document.createElement('select'),
        findButtons: [],
        results: document.createElement('div'),
        keyboard: document.createElement('div'),
        scroller: document.createElement('div'),
        placed: false,
        activeTab: 'scales',
        findMode: 'compatible',
        findPick: null,
        compress: false,
        selectedStaff: document.createElement('div'),
        selectedNoteButtons: [],
        findNotes: new Set(),
    };
    widget.entryTabs.className = 'sw-entrytabs';
    widget.results.className = 'sw-results';
    widget.keyboard.className = 'sw-keyboard';
    const titleBar = document.createElement('div');
    titleBar.className = 'sw-title';
    const title = document.createElement('span');
    title.textContent = 'Scale Calculator';
    const closeButton = makeScaleButton('✕', 'sw-close', () => toggleScaleWidget(false));
    closeButton.setAttribute('aria-label', 'Close scale calculator');
    titleBar.append(title, closeButton);
    const showTab = buildShowTab(widget);
    const selectedTab = buildSelectedTab(widget);
    const findTab = buildFindTab(widget);
    selectedTab.hidden = true;
    findTab.hidden = true;
    const tabBar = document.createElement('div');
    tabBar.className = 'sw-tabs';
    const tabs = [
        { key: 'scales', body: showTab, button: makeScaleButton('Scales List', 'sw-tabbtn sw-select-tab active', () => switchTab('scales')) },
        { key: 'selected', body: selectedTab, button: makeScaleButton('Selected Notes', 'sw-tabbtn sw-selected-tab', () => switchTab('selected')) },
        { key: 'find', body: findTab, button: makeScaleButton('Find Scales', 'sw-tabbtn sw-find-tab', () => switchTab('find')) },
    ];
    tabBar.append(...tabs.map(tab => tab.button));
    function switchTab(tabKey) {
        widget.activeTab = tabKey;
        for (const tab of tabs) {
            tab.body.hidden = tab.key !== tabKey;
            tab.button.classList.toggle('active', tab.key === tabKey);
        }
        highlightScale(widget); // paints the scale colors, or the Selected Notes keys
    }
    widget.scroller.className = 'sw-scroller';
    buildKeyboard(widget);
    widget.scroller.appendChild(widget.keyboard);
    const grip = document.createElement('div');
    grip.className = 'sw-grip';
    grip.title = 'Drag to resize';
    panel.append(titleBar, tabBar, showTab, selectedTab, findTab, widget.scroller, grip);
    makePanelDraggable(panel, titleBar);
    makePanelResizable(panel, grip);
    setPanelWidth(panel, savedPanelWidth());
    document.body.appendChild(panel);
    refreshEntryTabs(widget);
    highlightScale(widget);
    return widget;
}
// Open or close the popout (no argument: flip it)
function toggleScaleWidget(open) {
    if (!scaleWidget)
        scaleWidget = buildScaleWidget();
    const shouldOpen = open ?? scaleWidget.panel.classList.contains('hidden');
    scaleWidget.panel.classList.toggle('hidden', !shouldOpen);
    if (shouldOpen && !scaleWidget.placed) {
        // the first time it opens, put it in the middle of the page (it has to be visible to be measured)
        const box = scaleWidget.panel.getBoundingClientRect();
        scaleWidget.panel.style.left = `${Math.max(8, (window.innerWidth - box.width) / 2)}px`;
        scaleWidget.panel.style.top = `${Math.max(60, (window.innerHeight - box.height) / 2)}px`;
        scaleWidget.panel.style.right = 'auto';
        scaleWidget.placed = true;
    }
    if (shouldOpen)
        refreshSelectedNotes();
    document.getElementById('scaleWidgetBtn')?.setAttribute('aria-expanded', String(shouldOpen));
}
function setupScaleWidget() {
    document.getElementById('scaleWidgetBtn')?.addEventListener('click', () => toggleScaleWidget());
}
