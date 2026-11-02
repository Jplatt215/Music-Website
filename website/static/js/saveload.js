"use strict";
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Save/Load State
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
let currentSlug = null;
let currentTitle = null;
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Element References
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
const saveButton = document.querySelector('.saveButton');
const newCompositionButton = document.querySelector('.newCompositionButton');
const compositionList = document.getElementById('compositionList');
const currentCompositionTitle = document.getElementById('currentCompositionTitle');
const projectTitleBtn = document.getElementById('projectTitleBtn');
const createTabBtn = document.getElementById('createTabBtn');
const editTabBtn = document.getElementById('editTabBtn');
const detailTabBtn = document.getElementById('detailTabBtn');
const loadTabBtn = document.getElementById('loadTabBtn');
const exportTabBtn = document.getElementById('exportTabBtn');
const importTabBtn = document.createElement('button');
importTabBtn.className = 'tab-btn hidden';
importTabBtn.id = 'importTabBtn';
importTabBtn.dataset.target = 'import-menu';
importTabBtn.textContent = 'Import';
loadTabBtn?.parentElement?.insertBefore(importTabBtn, loadTabBtn);
let previousTabId = 'input-menu';
projectTitleBtn?.addEventListener('click', () => {
    const loadMenu = document.getElementById('load-menu');
    const exportMenu = document.getElementById('export-menu');
    const isLoadAreaOpen = !loadTabBtn.classList.contains('hidden');
    if (isLoadAreaOpen) {
        // Switch back to Create/Edit
        importTabBtn.classList.add('hidden');
        loadTabBtn.classList.add('hidden');
        exportTabBtn.classList.add('hidden');
        importTabBtn.classList.remove('active');
        loadTabBtn.classList.remove('active');
        exportTabBtn.classList.remove('active');
        createTabBtn.classList.remove('hidden');
        editTabBtn.classList.remove('hidden');
        detailTabBtn?.classList.remove('hidden');
        loadMenu.classList.add('hidden');
        exportMenu.classList.add('hidden');
        document.getElementById('import-menu')?.classList.add('hidden');
        projectTitleBtn.classList.remove('active');
        const prevBtn = document.querySelector(`.tab-btn[data-target="${previousTabId}"]`);
        prevBtn?.classList.add('active');
        document.getElementById(previousTabId)?.classList.remove('hidden');
    }
    else {
        // Remember which tab was active, then switch to Load/Export
        const activeBtn = document.querySelector('.tab-btn.active');
        previousTabId = activeBtn?.dataset.target ?? 'input-menu';
        document.querySelectorAll('.tab-btn').forEach(button => button.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(content => content.classList.add('hidden'));
        createTabBtn.classList.add('hidden');
        editTabBtn.classList.add('hidden');
        detailTabBtn?.classList.add('hidden');
        importTabBtn.classList.remove('hidden');
        loadTabBtn.classList.remove('hidden');
        exportTabBtn.classList.remove('hidden');
        loadTabBtn.classList.add('active');
        loadMenu.classList.remove('hidden');
        projectTitleBtn.classList.add('active');
        loadCompositionList();
    }
});
const exportMidiButton = document.querySelector('.exportMidiButton');
const exportMusicXMLButton = document.querySelector('.exportMusicXMLButton');
exportMidiButton?.addEventListener('click', () => exportLayerToMidi());
exportMusicXMLButton?.addEventListener('click', () => exportLayerToMusicXML());
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Helpers
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
function showSaveError(message) {
    const existing = document.getElementById('saveErrorMsg');
    if (existing)
        existing.remove();
    const msg = document.createElement('p');
    msg.id = 'saveErrorMsg';
    msg.textContent = message;
    msg.style.cssText = 'color: red; font-size: 12px; padding: 4px 0; margin: 0;';
    compositionList.insertAdjacentElement('beforebegin', msg);
    setTimeout(() => msg.remove(), 4000);
}
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Serialize / Deserialize
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Saves made before the staff rename used the keys upperVoice ... voice4
function migrateLegacyStaffKeys(data) {
    const legacy = { upperVoice: 'staff1', middleVoice: 'staff2', lowerVoice: 'staff3', voice4: 'staff4' };
    const rename = (obj) => {
        if (!obj)
            return obj;
        const out = {};
        for (const key of Object.keys(obj))
            out[legacy[key] ?? key] = obj[key];
        return out;
    };
    return { ...data, main: rename(data.main), harmony: rename(data.harmony) };
}
function serializeNotes(notes) {
    return notes.map(note => ({
        noteName: note.noteName,
        octave: note.octave,
        octaves: note.octaves,
        duration: note.duration,
        dotted: note.dotted,
        tupletInfo: note.tupletInfo,
        innerTuplets: note.innerTuplets.length ? note.innerTuplets : undefined,
        tiedToNext: note.tiedToNext,
        articulations: note.articulations,
        graceNotes: note.graceNotes.length ? note.graceNotes : undefined,
    }));
}
function savedNotesToUnprocessed(saved) {
    return (saved ?? []).map((savedNote) => {
        const note = new UnprocessedNote(savedNote.noteName, savedNote.octaves ?? savedNote.octave, savedNote.duration, savedNote.dotted, savedNote.tiedToNext ?? false);
        if (savedNote.tupletInfo)
            note.tupletInfo = { ...savedNote.tupletInfo };
        note.innerTuplets = (savedNote.innerTuplets ?? []).map((level) => ({ ...level }));
        note.articulations = [...(savedNote.articulations ?? [])];
        note.graceNotes = copyGraceNotes(savedNote.graceNotes);
        return note;
    });
}
// "notes" is Up 1, so older versions of the app still open new saves; the other voices are in "extraVoices"
function serializeStaff(staff) {
    return {
        pitchRange: staff.pitchRange,
        rhythmRange: staff.rhythmRange,
        scale: staff.scale,
        harmonize: staff.harmonize,
        muted: staff.muted,
        dynamics: staff.dynamics.map(mark => ({ ...mark })),
        techniques: staff.techniques.map(mark => ({ ...mark })),
        slurs: staff.slurs.map(mark => ({ ...mark })),
        glissandos: staff.glissandos.map(mark => ({ ...mark })),
        notes: serializeNotes(staff.unprocessedNotes),
        extraVoices: staff.extraVoices.map(voice => ({ id: voice.id, notes: serializeNotes(voice.unprocessedNotes) })),
    };
}
function restoreStaff(staff, saved) {
    if (!saved)
        return;
    staff.pitchRange = saved.pitchRange;
    staff.rhythmRange = saved.rhythmRange;
    staff.scale = saved.scale;
    staff.harmonize = saved.harmonize ?? staff.harmonize;
    staff.muted = saved.muted ?? false;
    staff.dynamics = (saved.dynamics ?? []).map((mark) => ({ ...mark }));
    staff.techniques = (saved.techniques ?? []).map((mark) => ({ ...mark }));
    staff.slurs = (saved.slurs ?? []).map((mark) => ({ ...mark }));
    staff.glissandos = (saved.glissandos ?? []).map((mark) => ({ ...mark }));
    staff.extraVoices = [];
    resetStaff(staff);
    processNotes(staff, savedNotesToUnprocessed(saved.notes));
    for (const extra of saved.extraVoices ?? []) {
        if (extra.id === 'up1' || !VOICE_DEFS.some(voiceDef => voiceDef.id === extra.id))
            continue;
        const voice = getOrCreateVoice(staff, extra.id);
        resetVoice(voice);
        processNotes(voice, savedNotesToUnprocessed(extra.notes));
    }
}
function getCompositionData() {
    const mainData = {};
    const harmonyData = {};
    for (const staffName of staves) {
        mainData[staffName] = serializeStaff(mainStaves[staffName]);
        harmonyData[staffName] = serializeStaff(harmonyStaves[staffName]);
    }
    return { timeSignature: [measureSigs[0].num, measureSigs[0].den], measureSigs: sigsForSave(), numMeasures, trackOrder: [...staves], clefs: copyTrackChanges(trackClefs), keys: copyTrackChanges(trackKeys), main: mainData, harmony: harmonyData };
}
function loadCompositionData(data) {
    data = migrateLegacyStaffKeys(data);
    numMeasures = data.numMeasures;
    measureSigs = sigsFromData(data);
    // saves made before tracks could be added or moved have the four original tracks
    applyTrackOrder(Array.isArray(data.trackOrder) && data.trackOrder.length ? data.trackOrder : DEFAULT_TRACKS);
    trackClefs = copyTrackChanges(data.clefs);
    trackKeys = copyTrackChanges(data.keys);
    for (const staffName of staves) {
        restoreStaff(mainStaves[staffName], data.main[staffName]);
        restoreStaff(harmonyStaves[staffName], data.harmony[staffName]);
    }
    // Sync the settings panel UI (scale, pitch/rhythm range, harmonize toggle, mute)
    // to match whichever layer's voices were just restored.
    document.querySelectorAll(".staffSettings").forEach(settings => {
        const staffName = settings.dataset.staff;
        populateStaffSettings(settings, staffName);
    });
    for (const layer of ['main', 'harmony']) {
        selections[layer] = {};
        lastSelectedStaff[layer] = null;
    }
    drawAllStaves();
}
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Composition List
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
async function loadCompositionList() {
    try {
        const res = await fetch('/api/compositions');
        if (!res.ok) {
            compositionList.innerHTML = '<p style="padding: 8px; font-size: 12px; color: red;">Failed to load compositions.</p>';
            return;
        }
        const compositions = await res.json();
        compositionList.innerHTML = '';
        if (!compositions.length) {
            compositionList.innerHTML = '<p style="padding: 8px; font-size: 12px; color: #888;">No saved compositions</p>';
            return;
        }
        for (const comp of compositions) {
            const row = document.createElement('div');
            row.style.cssText = 'padding: 6px 8px; cursor: pointer; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
            row.textContent = (comp.is_public ? '🌐 ' : '🔒 ') + comp.title;
            row.title = comp.title;
            row.dataset.slug = comp.slug;
            if (comp.slug === currentSlug) {
                row.style.backgroundColor = '#d3d3d3';
            }
            row.addEventListener('click', () => {
                saveToLocalStorage();
                loadComposition(comp.slug, comp.title);
                compositionList.querySelectorAll('div').forEach(row => {
                    row.style.backgroundColor = '';
                });
                row.style.backgroundColor = '#d3d3d3';
            });
            compositionList.appendChild(row);
        }
    }
    catch (error) {
        compositionList.innerHTML = '<p style="padding: 8px; font-size: 12px; color: red;">Network error. Could not load compositions.</p>';
    }
}
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Load a Composition
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
async function loadComposition(slug, title) {
    try {
        const res = await fetch(`/api/compositions/${slug}`);
        if (!res.ok) {
            if (res.status === 404) {
                showSaveError('Composition not found.');
                localStorage.removeItem('composerCurrentSlug');
                localStorage.removeItem('composerCurrentTitle');
            }
            else if (res.status === 403) {
                showSaveError('This composition is private.');
            }
            else {
                showSaveError('Failed to load composition. Please try again.');
            }
            return;
        }
        const data = await res.json();
        if (!data.success) {
            showSaveError(data.message || 'Failed to load composition.');
            return;
        }
        loadCompositionData(data.data);
        currentSlug = slug;
        currentTitle = title || data.title;
        currentCompositionTitle.textContent = currentTitle;
        history.pushState({}, '', `/compositions/${slug}`);
        saveToLocalStorage();
    }
    catch (error) {
        showSaveError('Network error. Could not load composition.');
    }
}
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Delete a Composition (button handler)
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
const deleteCompositionButton = document.querySelector('.deleteCompositionButton');
deleteCompositionButton?.addEventListener('click', async () => {
    if (!currentSlug) {
        alert('No project selected.');
        return;
    }
    if (!confirm(`Delete "${currentTitle}"? This cannot be undone.`))
        return;
    try {
        const res = await fetch(`/api/compositions/${currentSlug}`, { method: 'DELETE' });
        if (!res.ok) {
            showSaveError('Failed to delete composition. Please try again.');
            return;
        }
        currentSlug = null;
        currentTitle = null;
        currentCompositionTitle.textContent = 'Untitled';
        history.pushState({}, '', '/composer');
        localStorage.removeItem('composerCurrentSlug');
        localStorage.removeItem('composerCurrentTitle');
        loadCompositionList();
    }
    catch (error) {
        showSaveError('Network error. Could not delete composition.');
    }
});
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Save Button
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
saveButton?.addEventListener('click', async () => {
    if (!isLoggedIn) {
        const authModal = document.getElementById('authModal');
        authModal.classList.remove('hidden');
        return;
    }
    if (currentSlug) {
        const overwrite = confirm(`Overwrite "${currentTitle}"?\n\nOK to overwrite — Cancel to save as new.`);
        if (overwrite) {
            try {
                const res = await fetch(`/api/compositions/${currentSlug}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ data: getCompositionData() }),
                });
                if (!res.ok) {
                    showSaveError('Failed to save. Please try again.');
                    return;
                }
            }
            catch (error) {
                showSaveError('Network error. Could not save composition.');
                return;
            }
        }
        else {
            await saveAsNew();
        }
    }
    else {
        await saveAsNew();
    }
    loadCompositionList();
});
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Save as New
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
async function saveAsNew() {
    try {
        const listRes = await fetch('/api/compositions');
        const existing = listRes.ok ? await listRes.json() : [];
        const existingTitles = existing.map((cell) => cell.title);
        const baseName = currentTitle || 'Project';
        let newTitle = baseName;
        if (existingTitles.includes(newTitle)) {
            let num = 2;
            while (existingTitles.includes(`${baseName} (${num})`))
                num++;
            newTitle = `${baseName} (${num})`;
        }
        const title = prompt('Save as:', newTitle);
        if (!title)
            return;
        const isPublic = confirm('Make this composition public?\n\nOK = public   Cancel = private');
        const saveRes = await fetch('/api/compositions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, is_public: isPublic, data: getCompositionData() }),
        });
        if (!saveRes.ok) {
            showSaveError('Failed to save. Please try again.');
            return;
        }
        const data = await saveRes.json();
        if (data.success) {
            currentSlug = data.slug;
            currentTitle = title;
            currentCompositionTitle.textContent = title;
            history.pushState({}, '', `/compositions/${data.slug}`);
            saveToLocalStorage();
        }
        else {
            showSaveError(data.message || 'Failed to save composition.');
        }
    }
    catch (error) {
        showSaveError('Network error. Could not save composition.');
    }
}
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// New Composition Button
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
newCompositionButton?.addEventListener('click', () => {
    if (!confirm('Start a new composition? Unsaved changes will be lost.'))
        return;
    numMeasures = 1;
    measureSigs = [makeSig(4, 4)];
    applyTrackOrder(DEFAULT_TRACKS);
    trackClefs = {};
    trackKeys = {};
    for (const staffName of staves) {
        resetStaffToDefaults(mainStaves[staffName], [0.03125, 1]);
        resetStaffToDefaults(harmonyStaves[staffName], [0.25, 1]);
    }
    for (const staffName of staves) {
        processNotes(mainStaves[staffName], fillDurationWithRests(totalLength()));
        processNotes(harmonyStaves[staffName], fillDurationWithRests(totalLength()));
    }
    // Selection reset (replaces the old per-tab block)
    for (const layer of ['main', 'harmony']) {
        selections[layer] = {};
        lastSelectedStaff[layer] = null;
    }
    const fullLength = totalLength();
    selections.main['staff1'] = { start: 0, end: fullLength };
    selections.harmony['staff1'] = { start: 0, end: fullLength };
    lastSelectedStaff.main = 'staff1';
    lastSelectedStaff.harmony = 'staff1';
    document.querySelectorAll(".staffSettings").forEach(settings => {
        const staffName = settings.dataset.staff;
        populateStaffSettings(settings, staffName);
    });
    drawAllStaves();
    currentSlug = null;
    currentTitle = null;
    currentCompositionTitle.textContent = 'Untitled';
    history.pushState({}, '', '/composer');
    saveToLocalStorage();
});
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Autosave to localStorage
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
function saveToLocalStorage() {
    try {
        localStorage.setItem('composerAutosave', JSON.stringify(getCompositionData()));
        if (currentSlug)
            localStorage.setItem('composerCurrentSlug', currentSlug);
        if (currentTitle)
            localStorage.setItem('composerCurrentTitle', currentTitle);
    }
    catch (error) {
        console.warn('Failed to autosave:', error);
    }
}
function loadFromLocalStorage() {
    const saved = localStorage.getItem('composerAutosave');
    if (!saved)
        return;
    try {
        loadCompositionData(JSON.parse(saved));
        const slug = localStorage.getItem('composerCurrentSlug');
        const title = localStorage.getItem('composerCurrentTitle');
        if (slug && title) {
            currentSlug = slug;
            currentTitle = title;
            currentCompositionTitle.textContent = title;
        }
    }
    catch (error) {
        console.warn('Failed to load autosave:', error);
        localStorage.removeItem('composerAutosave');
        localStorage.removeItem('composerCurrentSlug');
        localStorage.removeItem('composerCurrentTitle');
    }
}
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Startup
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
loadFromLocalStorage();
const urlSlug = window.location.pathname.match(/\/compositions\/([^/]+)/)?.[1];
if (urlSlug) {
    loadComposition(urlSlug, '');
}
const MX_STEP_SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const MX_TYPE_KEYS = { whole: 'w', half: 'h', quarter: 'q', eighth: '8', '16th': '16', '32nd': '32' };
const MX_ARTICULATIONS = { staccato: 'a.', accent: 'a>', tenuto: 'a-', staccatissimo: 'av', 'strong-accent': 'a^' };
const MX_TECHNIQUE_WORDS = {
    'pizz.': 'pizz.', 'pizz': 'pizz.', 'pizzicato': 'pizz.',
    'arco': 'arco',
    'col legno': 'col legno',
    'sul pont.': 'sul pont.', 'sul pont': 'sul pont.', 'sul ponticello': 'sul pont.',
    'sul tasto': 'sul tasto',
    'con sord.': 'con sord.', 'con sord': 'con sord.', 'con sordino': 'con sord.',
    'senza sord.': 'senza sord.', 'senza sord': 'senza sord.', 'senza sordino': 'senza sord.',
    'trem.': 'trem.', 'trem': 'trem.', 'tremolo': 'trem.',
    'harm.': 'harm.', 'harm': 'harm.', 'harmonic': 'harm.', 'harmonics': 'harm.',
    'flutter': 'flutter', 'flutter-tongue': 'flutter', 'flutter tongue': 'flutter',
};
const MX_TUPLET_CANDIDATES = [[3, 2], [5, 4], [6, 4], [7, 4], [2, 3], [4, 3], [5, 3], [9, 8], [7, 8], [10, 8], [11, 8]];
const MX_CLOSE = 1e-6;
function mxKids(parent, tag) {
    return Array.from(parent.children).filter(child => child.tagName === tag);
}
function mxKid(parent, tag) {
    return mxKids(parent, tag)[0] ?? null;
}
function mxText(parent, tag) {
    return mxKid(parent, tag)?.textContent?.trim() ?? '';
}
function mxGcd(first, second) {
    return second === 0 ? Math.abs(first) : mxGcd(second, first % second);
}
// A length in whole notes as a time signature (num/den, den 2 to 16), trying `preferDen` first
function mxExpressSig(length, preferDen) {
    for (const den of [preferDen, 4, 8, 16, 2]) {
        if (![2, 4, 8, 16].includes(den))
            continue;
        const num = length * den;
        if (Math.abs(num - Math.round(num)) < 1e-6 && Math.round(num) >= 1 && Math.round(num) <= 32)
            return { num: Math.round(num), den };
    }
    return null;
}
// The key of durationMapping ("q", "8d"...) for a length, or null if no single note is that long
function mxKeyFor(length) {
    for (const [key, value] of Object.entries(durationMapping))
        if (Math.abs(value - length) < MX_CLOSE)
            return key;
    return null;
}
function mxWrittenKey(event) {
    if (!event.typeKey)
        return null;
    const key = event.dots === 1 ? event.typeKey + 'd' : event.typeKey;
    return event.dots <= 1 && durationMapping[key] !== undefined ? key : null;
}
// "hd" is a dotted half: the note keeps its value in `duration` and the dot in `dotted`
function mxTidy(notes) {
    for (const note of notes) {
        if (!note.dotted && note.duration.length > 1 && note.duration.endsWith('d')) {
            note.duration = note.duration.slice(0, -1);
            note.dotted = true;
        }
    }
    return notes;
}
const MX_LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const MX_SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const MX_FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const MX_STEPS_FOR_SEMITONES = [0, 1, 1, 2, 2, 3, 3, 4, 5, 5, 6, 6]; // diatonic steps to guess when a transposition gives none
// A written pitch as it sounds: moved by the instrument's transposition, spelled by letter and octave
function mxTransposePitch(step, alter, octave, transpose) {
    const writtenMidi = 12 * (octave + 1) + (MX_STEP_SEMITONES[step] ?? 0) + alter;
    const targetMidi = writtenMidi + transpose.chromatic + 12 * transpose.octaves;
    let diatonic = transpose.diatonic;
    if (diatonic === null) {
        const size = Math.abs(transpose.chromatic);
        diatonic = Math.sign(transpose.chromatic) * (MX_STEPS_FOR_SEMITONES[size % 12] + 7 * Math.floor(size / 12));
    }
    const index = MX_LETTERS.indexOf(step) + diatonic;
    const letter = MX_LETTERS[((index % 7) + 7) % 7];
    const newOctave = octave + Math.floor(index / 7) + transpose.octaves;
    const newAlter = targetMidi - (12 * (newOctave + 1) + MX_STEP_SEMITONES[letter]);
    if (Math.abs(newAlter) <= 2) {
        return { name: letter + ['bb', 'b', '', '#', '##'][newAlter + 2], octave: newOctave, midi: targetMidi };
    }
    const names = transpose.chromatic < 0 ? MX_FLAT_NAMES : MX_SHARP_NAMES;
    return { name: names[((targetMidi % 12) + 12) % 12], octave: Math.floor(targetMidi / 12) - 1, midi: targetMidi };
}
// The key signature (as sharps or flats) of a transposed key
function mxSoundingFifths(fifths, transpose) {
    if (!transpose)
        return fifths;
    const tonic = Object.entries(KEY_ACCIDENTAL_COUNT).find(([, count]) => count === fifths)?.[0];
    if (!tonic)
        return fifths;
    const { letter, acc } = parsePitchName(tonic);
    const moved = mxTransposePitch(letter, ACC_SEMITONE[acc], 4, transpose);
    const movedName = moved.name.replace(/(.)(bb|##)$/, '$1');
    if (KEY_ACCIDENTAL_COUNT[movedName] !== undefined)
        return KEY_ACCIDENTAL_COUNT[movedName];
    const pitchClass = ((moved.midi % 12) + 12) % 12;
    const candidates = Object.entries(KEY_ACCIDENTAL_COUNT).filter(([name]) => {
        const parsed = parsePitchName(name);
        return (((MX_STEP_SEMITONES[parsed.letter] + ACC_SEMITONE[parsed.acc]) % 12) + 12) % 12 === pitchClass;
    });
    candidates.sort((first, second) => Math.abs(first[1]) - Math.abs(second[1]));
    return candidates.length ? candidates[0][1] : fifths;
}
function mxPitch(pitchEl, warn, transpose = null) {
    const step = mxText(pitchEl, 'step') || 'C';
    const alterValue = parseFloat(mxText(pitchEl, 'alter') || '0');
    const alter = Math.max(-2, Math.min(2, Math.round(alterValue)));
    if (alterValue !== alter)
        warn('Microtonal or out-of-range accidentals were rounded.');
    const octave = parseInt(mxText(pitchEl, 'octave') || '4', 10);
    if (transpose)
        return mxTransposePitch(step, alter, octave, transpose);
    const accidental = ['bb', 'b', '', '#', '##'][alter + 2];
    return { name: step + accidental, octave, midi: 12 * (octave + 1) + (MX_STEP_SEMITONES[step] ?? 0) + alter };
}
// Reads one <time> element: the total length and a num/den to show
function mxReadTime(timeEl) {
    const beats = mxKids(timeEl, 'beats');
    const types = mxKids(timeEl, 'beat-type');
    if (!beats.length || beats.length !== types.length)
        return null;
    let total = 0;
    let firstNum = 0;
    beats.forEach((beatEl, index) => {
        const count = (beatEl.textContent ?? '').split('+').reduce((sum, part) => sum + (parseInt(part, 10) || 0), 0);
        const unit = parseInt(types[index].textContent ?? '4', 10) || 4;
        total += count / unit;
        if (index === 0)
            firstNum = unit;
    });
    if (total <= 0)
        return null;
    const shown = beats.length === 1 && [2, 4, 8, 16].includes(firstNum) ? mxExpressSig(total, firstNum) : mxExpressSig(total, 4);
    if (!shown)
        return null;
    return { num: shown.num, den: shown.den, total };
}
function mxClefName(clefEl, warn) {
    const sign = mxText(clefEl, 'sign').toUpperCase();
    const line = parseInt(mxText(clefEl, 'line') || '0', 10);
    if (sign === 'G')
        return 'treble';
    if (sign === 'F')
        return 'bass';
    if (sign === 'C')
        return line === 4 ? 'tenor' : 'alto';
    warn('Percussion and tab clefs were imported as treble clefs.');
    return 'treble';
}
// One part: its measures with every note, direction, clef and key in them
const MX_GRACE_VALUES = { eighth: '8', '16th': '16', '32nd': '32', quarter: '8', '64th': '32', '128th': '32' };
function mxParsePart(partEl, warn) {
    const measures = [];
    let divisions = 1;
    let staffCount = 1;
    let transpose = null;
    const pendingGraces = new Map(); // grace notes waiting for the note they lead into, by voice
    const openSpans = new Map();
    const slurPairs = [];
    const glissPairs = [];
    // a slur or glissando is opened by one note and closed by a later one with the same number
    const registerSpans = (target, kind, starts, stops) => {
        for (const number of stops) {
            const key = `${kind}:${target.staffNumber}:${number}`;
            const from = openSpans.get(key);
            if (from) {
                (kind === 'slur' ? slurPairs : glissPairs).push({ from, to: target });
                openSpans.delete(key);
            }
        }
        for (const number of starts)
            openSpans.set(`${kind}:${target.staffNumber}:${number}`, target);
    };
    mxKids(partEl, 'measure').forEach((measureEl, measureIndex) => {
        const measure = { events: [], staffNumbers: [], directions: [], clefs: [], keys: [], sig: null, implicit: measureEl.getAttribute('implicit') === 'yes', contentEnd: 0 };
        const wholeNotes = (units) => units / (divisions * 4);
        let position = 0;
        let lastEvent = null;
        for (const child of Array.from(measureEl.children)) {
            if (child.tagName === 'attributes') {
                const divisionsText = mxText(child, 'divisions');
                if (divisionsText)
                    divisions = parseFloat(divisionsText) || divisions;
                staffCount = Math.max(staffCount, parseInt(mxText(child, 'staves') || '1', 10) || 1);
                const transposeEl = mxKid(child, 'transpose');
                if (transposeEl) {
                    const chromatic = parseInt(mxText(transposeEl, 'chromatic') || '0', 10) || 0;
                    const octaves = parseInt(mxText(transposeEl, 'octave-change') || '0', 10) || 0;
                    const diatonicText = mxText(transposeEl, 'diatonic');
                    transpose = chromatic === 0 && octaves === 0 ? null : { diatonic: diatonicText === '' ? null : parseInt(diatonicText, 10), chromatic, octaves };
                    if (transpose)
                        warn('Transposing instruments were converted to the pitch they sound (concert pitch), with their key signatures.');
                }
                const timeEl = mxKid(child, 'time');
                if (timeEl) {
                    measure.sig = mxReadTime(timeEl);
                    if (!measure.sig)
                        warn('A time signature that could not be read was replaced by 4/4.');
                }
                for (const clefEl of mxKids(child, 'clef')) {
                    measure.clefs.push({ staffNumber: parseInt(clefEl.getAttribute('number') ?? '1', 10) || 1, value: mxClefName(clefEl, warn), position });
                }
                for (const keyEl of mxKids(child, 'key')) {
                    const numberAttr = keyEl.getAttribute('number');
                    measure.keys.push({ staffNumber: numberAttr ? parseInt(numberAttr, 10) : null, fifths: mxSoundingFifths(parseInt(mxText(keyEl, 'fifths') || '0', 10) || 0, transpose), position });
                }
            }
            else if (child.tagName === 'backup') {
                position -= wholeNotes(parseFloat(mxText(child, 'duration') || '0'));
                if (position < 0)
                    position = 0;
            }
            else if (child.tagName === 'forward') {
                position += wholeNotes(parseFloat(mxText(child, 'duration') || '0'));
                measure.contentEnd = Math.max(measure.contentEnd, position);
            }
            else if (child.tagName === 'direction') {
                const staffNumber = parseInt(mxText(child, 'staff') || '1', 10) || 1;
                const offset = mxText(child, 'offset');
                const directionPosition = Math.max(0, position + (offset ? wholeNotes(parseFloat(offset) || 0) : 0));
                for (const typeEl of mxKids(child, 'direction-type')) {
                    for (const item of Array.from(typeEl.children)) {
                        if (item.tagName === 'dynamics') {
                            for (const level of Array.from(item.children)) {
                                if (DYNAMIC_LEVELS.includes(level.tagName))
                                    measure.directions.push({ kind: 'level', text: level.tagName, number: '', position: directionPosition, staffNumber });
                            }
                        }
                        else if (item.tagName === 'wedge') {
                            measure.directions.push({ kind: 'wedge', text: item.getAttribute('type') ?? '', number: item.getAttribute('number') ?? '1', position: directionPosition, staffNumber });
                        }
                        else if (item.tagName === 'words') {
                            measure.directions.push({ kind: 'words', text: (item.textContent ?? '').trim(), number: '', position: directionPosition, staffNumber });
                        }
                    }
                }
            }
            else if (child.tagName === 'note') {
                const graceEl = mxKid(child, 'grace');
                if (graceEl) {
                    const gracePitchEl = mxKid(child, 'pitch');
                    if (!gracePitchEl)
                        continue;
                    const gracePitch = mxPitch(gracePitchEl, warn, transpose);
                    const graceVoice = mxText(child, 'voice') || '1';
                    const waiting = pendingGraces.get(graceVoice) ?? [];
                    if (mxKid(child, 'chord') && waiting.length) {
                        waiting[waiting.length - 1].noteName.push(gracePitch.name);
                        waiting[waiting.length - 1].octaves.push(gracePitch.octave);
                    }
                    else {
                        waiting.push({ noteName: [gracePitch.name], octaves: [gracePitch.octave], duration: MX_GRACE_VALUES[mxText(child, 'type')] ?? '8', slash: graceEl.getAttribute('slash') === 'yes' });
                    }
                    pendingGraces.set(graceVoice, waiting);
                    continue;
                }
                const durationText = mxText(child, 'duration');
                if (!durationText)
                    continue;
                const duration = wholeNotes(parseFloat(durationText));
                const staffNumber = parseInt(mxText(child, 'staff') || '1', 10) || 1;
                staffCount = Math.max(staffCount, staffNumber);
                const voice = mxText(child, 'voice') || '1';
                const pitchEl = mxKid(child, 'pitch');
                const isRest = !!mxKid(child, 'rest') || !pitchEl;
                if (!pitchEl && !mxKid(child, 'rest'))
                    warn('Unpitched (percussion) notes were imported as rests.');
                const tieStart = mxKids(child, 'tie').some(tie => tie.getAttribute('type') === 'start') ||
                    mxKids(child, 'notations').some(notation => mxKids(notation, 'tied').some(tied => tied.getAttribute('type') === 'start'));
                const articulations = [];
                const tupletStarts = [];
                const slurStarts = [];
                const slurStops = [];
                const glissStarts = [];
                const glissStops = [];
                const tupletStops = [];
                for (const notation of mxKids(child, 'notations')) {
                    for (const group of mxKids(notation, 'articulations')) {
                        for (const mark of Array.from(group.children)) {
                            const code = MX_ARTICULATIONS[mark.tagName];
                            if (code && !articulations.includes(code))
                                articulations.push(code);
                        }
                    }
                    if (mxKid(notation, 'fermata'))
                        articulations.push('a@a');
                    for (const slurEl of mxKids(notation, 'slur')) {
                        const number = parseInt(slurEl.getAttribute('number') ?? '1', 10) || 1;
                        if (slurEl.getAttribute('type') === 'start')
                            slurStarts.push(number);
                        else if (slurEl.getAttribute('type') === 'stop')
                            slurStops.push(number);
                    }
                    for (const glissEl of [...mxKids(notation, 'glissando'), ...mxKids(notation, 'slide')]) {
                        const number = parseInt(glissEl.getAttribute('number') ?? '1', 10) || 1;
                        if (glissEl.getAttribute('type') === 'start')
                            glissStarts.push(number);
                        else if (glissEl.getAttribute('type') === 'stop')
                            glissStops.push(number);
                    }
                    for (const tupletEl of mxKids(notation, 'tuplet')) {
                        const number = parseInt(tupletEl.getAttribute('number') ?? '1', 10) || 1;
                        if (tupletEl.getAttribute('type') === 'start') {
                            const actualEl = mxKid(tupletEl, 'tuplet-actual');
                            const normalEl = mxKid(tupletEl, 'tuplet-normal');
                            const actual = actualEl ? parseInt(mxText(actualEl, 'tuplet-number'), 10) || null : null;
                            const normal = normalEl ? parseInt(mxText(normalEl, 'tuplet-number'), 10) || null : null;
                            tupletStarts.push({ number, actual, normal });
                        }
                        else if (tupletEl.getAttribute('type') === 'stop') {
                            tupletStops.push(number);
                        }
                    }
                }
                const pitch = pitchEl ? mxPitch(pitchEl, warn, transpose) : null;
                if (mxKid(child, 'chord') && lastEvent && !lastEvent.isRest && pitch) {
                    lastEvent.pitches.push(pitch);
                    lastEvent.tieStart = lastEvent.tieStart || tieStart;
                    for (const code of articulations)
                        if (!lastEvent.articulations.includes(code))
                            lastEvent.articulations.push(code);
                    registerSpans(lastEvent, 'slur', slurStarts, slurStops);
                    registerSpans(lastEvent, 'gliss', glissStarts, glissStops);
                    continue;
                }
                const modEl = mxKid(child, 'time-modification');
                const actualNotes = modEl ? parseInt(mxText(modEl, 'actual-notes'), 10) : 0;
                const normalNotes = modEl ? parseInt(mxText(modEl, 'normal-notes'), 10) : 0;
                const dotCount = mxKids(child, 'dot').length;
                // tuplet notes are timed from their written value, since <duration> is often rounded
                let exactDuration = duration;
                const writtenType = MX_TYPE_KEYS[mxText(child, 'type')];
                if (actualNotes > 0 && normalNotes > 0 && writtenType && dotCount <= 1) {
                    exactDuration = durationMapping[dotCount ? writtenType + 'd' : writtenType] * normalNotes / actualNotes;
                }
                const event = {
                    measure: measureIndex, position, start: 0, duration: exactDuration, trackName: '', voice, isRest,
                    pitches: pitch ? [pitch] : [],
                    typeKey: MX_TYPE_KEYS[mxText(child, 'type')] ?? null,
                    dots: mxKids(child, 'dot').length,
                    timeMod: actualNotes > 0 && normalNotes > 0 ? [actualNotes, normalNotes] : null,
                    tupletStarts, tupletStops, tieStart: tieStart && !isRest, articulations, staffNumber, graces: [],
                };
                const waitingGraces = pendingGraces.get(voice);
                if (waitingGraces && !isRest) {
                    if (waitingGraces.length > MAX_GRACE_NOTES)
                        warn(`Only ${MAX_GRACE_NOTES} grace notes fit before a note; the earlier ones were left out.`);
                    event.graces = waitingGraces.slice(-MAX_GRACE_NOTES);
                }
                pendingGraces.delete(voice);
                registerSpans(event, 'slur', slurStarts, slurStops);
                registerSpans(event, 'gliss', glissStarts, glissStops);
                measure.events.push(event);
                measure.staffNumbers.push(staffNumber);
                lastEvent = event;
                position += exactDuration;
                measure.contentEnd = Math.max(measure.contentEnd, position);
            }
        }
        measures.push(measure);
    });
    return { measures, staffCount, slurPairs, glissPairs };
}
// Works out the ratio of every open tuplet that has none yet, from the note's time-modification
function mxResolveRatios(frames, timeMod) {
    const open = frames.filter(frame => !frame.ratio);
    if (!open.length)
        return;
    let knownNum = 1;
    let knownDen = 1;
    for (const frame of frames)
        if (frame.ratio) {
            knownNum *= frame.ratio[0];
            knownDen *= frame.ratio[1];
        }
    let leftNum = timeMod[0] * knownDen;
    let leftDen = timeMod[1] * knownNum;
    const divisor = mxGcd(leftNum, leftDen) || 1;
    leftNum /= divisor;
    leftDen /= divisor;
    if (open.length === 1) {
        open[0].ratio = [leftNum, leftDen];
        return;
    }
    for (const first of MX_TUPLET_CANDIDATES) {
        for (const second of MX_TUPLET_CANDIDATES) {
            if (open.length === 2 && first[0] * second[0] * leftDen === leftNum * first[1] * second[1]) {
                open[0].ratio = [...first];
                open[1].ratio = [...second];
                return;
            }
        }
    }
    open[0].ratio = [leftNum, leftDen]; // can't tell the levels apart: one tuplet with the combined ratio
    for (const extra of open.slice(1))
        extra.ratio = null;
}
// One voice's events as notes: rests for gaps, ties, tuplets (nested too) and articulations
function mxBuildVoice(events, totalLength, warn) {
    const sorted = [...events].sort((first, second) => first.start - second.start);
    const notes = [];
    let cursor = 0;
    let frames = [];
    let nextId = 1;
    for (const event of sorted) {
        if (event.start < cursor - MX_CLOSE) {
            warn('Notes that overlap inside one voice were skipped.');
            continue;
        }
        if (event.start > cursor + MX_CLOSE) {
            frames = [];
            notes.push(...mxTidy(fillDurationWithRests(round(event.start - cursor), cursor)));
        }
        if (event.start >= totalLength - MX_CLOSE)
            break;
        for (const start of event.tupletStarts) {
            frames.push({ id: nextId++, number: start.number, ratio: start.actual && start.normal ? [start.actual, start.normal] : null, remaining: 0 });
        }
        if (event.timeMod) {
            mxResolveRatios(frames, event.timeMod);
            if (!frames.length)
                frames.push({ id: nextId++, number: 0, ratio: [event.timeMod[0], event.timeMod[1]], remaining: event.timeMod[0] });
        }
        frames = frames.filter(frame => frame.ratio);
        const names = [...event.pitches].sort((first, second) => first.midi - second.midi);
        const template = event.isRest ? makeRest('q') : new UnprocessedNote(names.map(pitch => pitch.name), names.map(pitch => pitch.octave), 'q');
        let key = null;
        if (frames.length) {
            let nominal = event.duration;
            for (const frame of frames)
                nominal = nominal * frame.ratio[0] / frame.ratio[1];
            key = mxKeyFor(nominal);
            if (!key) {
                warn('A tuplet whose notes could not be written was imported as plain notes.');
                frames = [];
            }
        }
        if (!frames.length)
            key = mxKeyFor(event.duration);
        if (key) {
            const note = event.isRest ? makeRest(key) : new UnprocessedNote(names.map(pitch => pitch.name), names.map(pitch => pitch.octave), key, false, event.tieStart);
            note.articulations = [...event.articulations];
            note.graceNotes = copyGraceNotes(event.graces);
            if (frames.length) {
                const levels = frames.map(frame => ({ id: frame.id, totalTupletDuration: 0, ratio: [frame.ratio[0], frame.ratio[1]], count: 0, index: 0 }));
                note.tupletInfo = levels[0];
                note.innerTuplets = levels.slice(1);
            }
            notes.push(...mxTidy([note]));
        }
        else if (event.isRest) {
            notes.push(...mxTidy(fillDurationWithRests(event.duration, event.start)));
        }
        else {
            const pieces = mxTidy(fillDurationAsUnprocessed(event.duration, template));
            if (pieces.length) {
                pieces[pieces.length - 1].tiedToNext = event.tieStart;
                pieces[0].articulations = [...event.articulations];
                pieces[0].graceNotes = copyGraceNotes(event.graces);
            }
            notes.push(...pieces);
        }
        cursor = event.start + event.duration;
        for (const stop of event.tupletStops) {
            for (let at = frames.length - 1; at >= 0; at--)
                if (frames[at].number === stop) {
                    frames.length = at;
                    break;
                }
        }
        for (const frame of frames)
            if (frame.remaining > 0)
                frame.remaining--;
        frames = frames.filter(frame => frame.number !== 0 || frame.remaining > 0);
    }
    if (cursor < totalLength - MX_CLOSE)
        notes.push(...mxTidy(fillDurationWithRests(round(totalLength - cursor), cursor)));
    reindexTuplets(notes);
    renumberTuplets(notes);
    return notes;
}
// Converts MusicXML text into tracks, measures and notes (nothing in the app changes until applyImportedPiece)
function importMusicXML(text) {
    const warnings = [];
    const warn = (message) => { if (!warnings.includes(message))
        warnings.push(message); };
    const doc = new DOMParser().parseFromString(text.trim(), 'application/xml');
    if (doc.getElementsByTagName('parsererror').length)
        throw new Error('That is not valid XML.');
    const root = doc.documentElement;
    if (root.tagName === 'score-timewise')
        throw new Error('Timewise MusicXML is not supported. Export it as partwise.');
    if (root.tagName !== 'score-partwise')
        throw new Error('That does not look like MusicXML.');
    const parts = mxKids(root, 'part').map(partEl => mxParsePart(partEl, warn));
    if (!parts.length || !parts.some(part => part.measures.length))
        throw new Error('No notes were found in that MusicXML.');
    const measureCount = Math.max(...parts.map(part => part.measures.length));
    const trackNames = [];
    const trackOf = parts.map(part => {
        const names = [];
        for (let staffNumber = 1; staffNumber <= part.staffCount; staffNumber++) {
            const name = 'staff' + (trackNames.length + 1);
            trackNames.push(name);
            names.push(name);
        }
        return names;
    });
    // measure signatures and lengths
    const sigs = [];
    const starts = [0];
    let current = { num: 4, den: 4, total: 1 };
    for (let measureIndex = 0; measureIndex < measureCount; measureIndex++) {
        const written = parts.map(part => part.measures[measureIndex]?.sig).find(sig => !!sig);
        if (written)
            current = written;
        const present = parts.map(part => part.measures[measureIndex]).filter((measure) => !!measure);
        const content = Math.max(0, ...present.map(measure => measure.contentEnd));
        const implicit = present.some(measure => measure.implicit);
        let length = current.total;
        if (content > current.total + MX_CLOSE)
            length = content;
        else if (content > MX_CLOSE && content < current.total - MX_CLOSE && (measureIndex === 0 || implicit))
            length = content;
        if (Math.abs(length - current.total) < MX_CLOSE) {
            sigs.push(makeSig(current.num, current.den));
            length = current.total;
        }
        else {
            const shown = mxExpressSig(length, current.den);
            if (shown)
                sigs.push(makeSig(shown.num, shown.den));
            else {
                warn('A measure with an unusual length was changed to the time signature.');
                sigs.push(makeSig(current.num, current.den));
                length = current.total;
            }
        }
        starts.push(starts[measureIndex] + length);
    }
    const totalLength = starts[measureCount];
    // the app's own measure list is needed for rests (put back below)
    const savedSigs = measureSigs;
    const savedMeasures = numMeasures;
    measureSigs = sigs;
    numMeasures = measureCount;
    try {
        const clefs = {};
        const keys = {};
        const eventsByVoice = {};
        const dynamics = {};
        const techniques = {};
        for (const track of trackNames) {
            eventsByVoice[track] = new Map();
            dynamics[track] = [];
            techniques[track] = [];
        }
        const openWedges = {};
        const keyNames = {};
        for (const [name, count] of Object.entries(KEY_ACCIDENTAL_COUNT))
            keyNames[count] = name;
        parts.forEach((part, partIndex) => {
            const tracks = trackOf[partIndex];
            const trackFor = (staffNumber) => tracks[Math.min(Math.max(staffNumber, 1), tracks.length) - 1];
            part.measures.forEach((measure, measureIndex) => {
                const measureStart = starts[measureIndex];
                const changeMeasure = (position) => position > MX_CLOSE ? measureIndex + 1 : measureIndex;
                measure.events.forEach((event, eventIndex) => {
                    event.trackName = trackFor(measure.staffNumbers[eventIndex]);
                    event.start = measureStart + event.position;
                    const voices = eventsByVoice[event.trackName];
                    if (!voices.has(event.voice))
                        voices.set(event.voice, []);
                    voices.get(event.voice).push(event);
                });
                for (const clef of measure.clefs) {
                    const at = changeMeasure(clef.position);
                    if (at < measureCount)
                        setTrackChange(clefs, trackFor(clef.staffNumber), at, clef.value, 'treble');
                }
                for (const key of measure.keys) {
                    const at = changeMeasure(key.position);
                    const name = keyNames[key.fifths];
                    if (!name) {
                        warn('A key signature with more than 7 sharps or flats was left out.');
                        continue;
                    }
                    if (at >= measureCount)
                        continue;
                    for (const track of key.staffNumber ? [trackFor(key.staffNumber)] : tracks)
                        setTrackChange(keys, track, at, name, 'C');
                }
                for (const item of measure.directions) {
                    const track = trackFor(item.staffNumber);
                    const time = measureStart + item.position;
                    if (item.kind === 'level') {
                        dynamics[track] = dynamics[track].filter(mark => !(mark.kind === 'level' && Math.abs(mark.start - time) < MX_CLOSE));
                        dynamics[track].push({ kind: 'level', level: item.text, start: time, end: time });
                    }
                    else if (item.kind === 'wedge') {
                        const wedgeKey = track + ':' + item.number;
                        if (item.text === 'crescendo' || item.text === 'diminuendo') {
                            openWedges[wedgeKey] = { kind: item.text, start: time };
                        }
                        else if (item.text === 'stop' && openWedges[wedgeKey]) {
                            const wedge = openWedges[wedgeKey];
                            delete openWedges[wedgeKey];
                            if (time - wedge.start > MX_CLOSE)
                                dynamics[track].push({ kind: wedge.kind, start: wedge.start, end: time });
                        }
                    }
                    else {
                        const text = MX_TECHNIQUE_WORDS[item.text.toLowerCase()];
                        if (text)
                            techniques[track].push({ text, start: time, end: totalLength });
                    }
                }
            });
        });
        const voices = {};
        const voiceIds = {};
        for (const track of trackNames) {
            dynamics[track].sort((first, second) => first.start - second.start);
            techniques[track].sort((first, second) => first.start - second.start);
            techniques[track].forEach((mark, index) => { if (index + 1 < techniques[track].length)
                mark.end = techniques[track][index + 1].start; });
            const ordered = Array.from(eventsByVoice[track].keys()).sort((first, second) => (parseInt(first, 10) || 0) - (parseInt(second, 10) || 0));
            const used = ordered.filter((voice, index) => index === 0 || eventsByVoice[track].get(voice).some(event => !event.isRest));
            if (used.length > VOICE_DEFS.length)
                warn(`Only ${VOICE_DEFS.length} voices fit on one track, so the extra voices were left out.`);
            voiceIds[track] = new Map(used.slice(0, VOICE_DEFS.length).map((voice, index) => [voice, VOICE_DEFS[index].id]));
            voices[track] = used.slice(0, VOICE_DEFS.length).map((voice, index) => ({ id: VOICE_DEFS[index].id, notes: mxBuildVoice(eventsByVoice[track].get(voice), totalLength, warn) }));
            if (!voices[track].length)
                voices[track] = [{ id: 'up1', notes: mxTidy(fillDurationWithRests(totalLength, 0)) }];
        }
        // slurs and glissandos, now that the voices have their ids
        const slurs = {};
        const glissandos = {};
        for (const track of trackNames) {
            slurs[track] = [];
            glissandos[track] = [];
        }
        for (const part of parts) {
            const sameVoice = (pair) => {
                if (pair.from.trackName !== pair.to.trackName || pair.from.voice !== pair.to.voice)
                    return null;
                return voiceIds[pair.from.trackName]?.get(pair.from.voice) ?? null;
            };
            for (const pair of part.slurPairs) {
                const voice = sameVoice(pair);
                if (voice && pair.to.start > pair.from.start + MX_CLOSE)
                    slurs[pair.from.trackName].push({ start: pair.from.start, end: pair.to.start + pair.to.duration, voice });
            }
            for (const pair of part.glissPairs) {
                const voice = sameVoice(pair);
                if (voice && pair.to.start > pair.from.start + MX_CLOSE)
                    glissandos[pair.from.trackName].push({ start: pair.from.start, end: pair.to.start, voice });
            }
        }
        for (const track of trackNames) {
            slurs[track].sort((first, second) => first.start - second.start);
            glissandos[track].sort((first, second) => first.start - second.start);
        }
        return { trackNames, sigs, numMeasures: measureCount, clefs, keys, voices, dynamics, techniques, slurs, glissandos, warnings };
    }
    finally {
        measureSigs = savedSigs;
        numMeasures = savedMeasures;
    }
}
// Replaces the composition with the imported piece, adding or removing tracks to match
function applyImportedPiece(piece) {
    applyTrackOrder(piece.trackNames);
    measureSigs = piece.sigs;
    numMeasures = piece.numMeasures;
    const mainData = {};
    const harmonyData = {};
    for (const track of piece.trackNames) {
        const imported = piece.voices[track];
        mainData[track] = {
            ...serializeStaff(mainStaves[track]),
            dynamics: piece.dynamics[track],
            techniques: piece.techniques[track],
            slurs: piece.slurs[track],
            glissandos: piece.glissandos[track],
            notes: serializeNotes(imported[0].notes),
            extraVoices: imported.slice(1).map(voice => ({ id: voice.id, notes: serializeNotes(voice.notes) })),
        };
        harmonyData[track] = {
            ...serializeStaff(harmonyStaves[track]),
            dynamics: [],
            techniques: [],
            slurs: [],
            glissandos: [],
            notes: serializeNotes(fillDurationWithRests(totalLength(), 0)),
            extraVoices: [],
        };
    }
    loadCompositionData({
        timeSignature: [piece.sigs[0].num, piece.sigs[0].den],
        measureSigs: piece.sigs.map(sig => ({ num: sig.num, den: sig.den, groups: [...sig.groups] })),
        numMeasures: piece.numMeasures,
        trackOrder: piece.trackNames,
        clefs: piece.clefs,
        keys: piece.keys,
        main: mainData,
        harmony: harmonyData,
    });
    renderGridOverlays(Object.values(getActiveStaves()));
}
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Import tab
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
(function buildImportTab() {
    const loadMenu = document.getElementById('load-menu');
    if (!loadMenu || !loadTabBtn || !importTabBtn)
        return;
    const menu = document.createElement('div');
    menu.id = 'import-menu';
    menu.className = 'tab-content hidden';
    menu.style.cssText = 'padding: 8px; font-size: 12px;';
    loadMenu.parentElement.insertBefore(menu, loadMenu);
    const intro = document.createElement('div');
    intro.textContent = 'Paste MusicXML (partwise, uncompressed). Importing replaces the composition; tracks are added or removed to match the score.';
    intro.style.cssText = 'margin-bottom: 6px;';
    menu.appendChild(intro);
    const area = document.createElement('textarea');
    area.placeholder = '<?xml version="1.0" ...';
    area.spellcheck = false;
    area.style.cssText = 'width: 100%; height: 120px; box-sizing: border-box; font-family: monospace; font-size: 11px;';
    menu.appendChild(area);
    const row = document.createElement('div');
    row.style.cssText = 'margin-top: 6px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap;';
    menu.appendChild(row);
    const importButton = document.createElement('button');
    importButton.type = 'button';
    importButton.textContent = 'Import';
    row.appendChild(importButton);
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.xml,.musicxml,text/xml,application/xml';
    row.appendChild(fileInput);
    const status = document.createElement('div');
    status.style.cssText = 'margin-top: 6px; white-space: pre-wrap;';
    menu.appendChild(status);
    fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        if (!file)
            return;
        const reader = new FileReader();
        reader.onload = () => { area.value = String(reader.result ?? ''); };
        reader.readAsText(file);
    });
    importButton.addEventListener('click', () => {
        status.style.color = '';
        if (!area.value.trim()) {
            status.style.color = 'red';
            status.textContent = 'Paste some MusicXML first.';
            return;
        }
        let piece;
        try {
            piece = importMusicXML(area.value);
        }
        catch (error) {
            status.style.color = 'red';
            status.textContent = error instanceof Error ? error.message : 'The MusicXML could not be read.';
            return;
        }
        if (staves.some(trackHasNotes) && !confirm('Replace the current composition with the imported MusicXML?'))
            return;
        try {
            applyImportedPiece(piece);
        }
        catch (error) {
            status.style.color = 'red';
            status.textContent = 'The import failed: ' + (error instanceof Error ? error.message : String(error));
            return;
        }
        currentSlug = null;
        currentTitle = null;
        currentCompositionTitle.textContent = 'Untitled';
        history.pushState({}, '', '/composer');
        saveToLocalStorage();
        updateMemory();
        status.textContent = `Imported ${piece.trackNames.length} track${piece.trackNames.length === 1 ? '' : 's'}, ${piece.numMeasures} measure${piece.numMeasures === 1 ? '' : 's'}.` +
            (piece.warnings.length ? '\n' + piece.warnings.map(warning => '• ' + warning).join('\n') : '');
    });
    importTabBtn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(button => button.classList.remove('active'));
        projectTitleBtn.classList.remove('active');
        importTabBtn.classList.add('active');
        document.querySelectorAll('.tab-content').forEach(content => content.classList.add('hidden'));
        menu.classList.remove('hidden');
        renderGridOverlays(Object.values(getActiveStaves()));
    });
})();
