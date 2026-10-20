////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Write: MIDI note entry, copy / paste / cut
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// What was copied from one track: the notes of the selected range, voice by voice
interface ClipTrack {
  length: number;                                        // how long the copied range is
  voices: Partial<Record<VoiceId, MemorySnapshot[]>>;    // each voice's notes in that range
}

// Insert-mode paste, in one voice: the copied notes go in at time t. A note that spans t is divided there
// (two separate notes, not tied) and its second half moves later; at a boundary the notes just go in.
function insertCellsAt(cells: Cell[], time: number, notes: UnprocessedNote[], len: number): Cell[] | null {
  const fresh: Cell = { start: time, end: round(time + len), notes, isTuplet: false, isRest: notes.every(note => note.isRest) };
  const out: Cell[] = [];
  let done = false;
  for (const cell of cells) {
    if (done || cell.end <= time + 1e-9) { out.push(cell); continue; }
    if (cell.start >= time - 1e-9) { out.push(fresh, cell); done = true; continue; }
    if (cell.isTuplet) return null;                                   // a tuplet can't be divided
    out.push({ ...cell, end: time, notes: piecesFor(cell, cell.start, time) }, fresh, { ...cell, start: time, notes: piecesFor(cell, time, cell.end) });
    done = true;
  }
  if (!done) out.push(fresh);
  return out;
}

// What a paste would do to one track, worked out before anything is changed
interface PastePlan {
  staff: Staff;
  changes: Partial<Record<VoiceId, UnprocessedNote[]>>;   // the new notes of every voice that changes
  newTotal: number;
  start: number;                                          // the pasted range
  end: number;
  state: VoiceState;                                      // the voice state the selection will have afterwards
}

// Pastes at the start of the selection, for the whole length of what was copied:
//  Overwrite  replaces that range in the voices pasted into; other voices are left alone
//  Insert     pushes everything after it later in every voice (a held note gets longer)
//  Polyphony  like Overwrite, and every copied voice goes to the same voice it came from
// A single copied voice goes into the selected voice, unless Polyphony is on.
function planPaste(staff: Staff, clip: ClipTrack, sel: SelectionRange): PastePlan | null {
  const total = notesDuration(staff.unprocessedNotes);
  const time = sel.start;
  const len = clip.length;
  const endTime = round(time + len);
  const ids = Object.keys(clip.voices) as VoiceId[];
  if (!ids.length || len < 1e-9) return null;

  const chosen = sel.voice && sel.voice !== 'all' ? sel.voice : null;
  const remap = !!chosen && ids.length === 1 && !polyphonyMode;
  const destOf = (id: VoiceId): VoiceId => (remap ? chosen! : id);

  const cellsOf = (id: VoiceId): Cell[] => {
    const voice = getVoice(staff, id);
    return voice ? buildCells(voice.unprocessedNotes) : emptyVoiceCells(total);
  };
  const notesOf = (id: VoiceId): UnprocessedNote[] => {
    const notes = notesFromSnapshot(clip.voices[id]!);
    if (notes.length) notes[notes.length - 1].tiedToNext = false;   // never tied on into what follows
    return notes;
  };

  const changes: Partial<Record<VoiceId, UnprocessedNote[]>> = {};
  let newTotal: number;

  if (insertMode) {
    const pasted = new Set(ids.map(destOf));
    for (const voice of staffVoices(staff)) {
      if (pasted.has(voice.id)) continue;
      const shifted = shiftCellsAt(buildCells(voice.unprocessedNotes), time, len);
      if (!shifted) return null;                                    // a tuplet would have to stretch
      changes[voice.id] = shifted.flatMap(cell => cell.notes);
    }
    for (const id of ids) {
      const inserted = insertCellsAt(cellsOf(destOf(id)), time, notesOf(id), len);
      if (!inserted) return null;
      changes[destOf(id)] = inserted.flatMap(cell => cell.notes);
    }
    newTotal = round(total + len);
  } else {
    for (const id of ids) {
      const painted = paint(cellsOf(destOf(id)), time, endTime, notesOf(id));
      if (!painted) return null;                                    // it would cut through a tuplet
      changes[destOf(id)] = painted.flatMap(cell => cell.notes);
    }
    newTotal = Math.max(total, endTime);
  }

  for (const id of Object.keys(changes) as VoiceId[]) {
    if (tupletCrossesBarline(changes[id]!, 0, Infinity)) return null;   // a tuplet would end up across a barline
  }
  return { staff, changes, newTotal, start: time, end: endTime, state: remap ? chosen! : 'all' };
}

// Copy, then turn the copied range into rests. Returns false if nothing was cut.
function cutSelection(): boolean {
  if (!copySelection()) return false;
  const clear: RangeTransform = clearedToRests;
  for (const staff of getSelectedStaves()) applyToRange(staff, clear);
  drawAllStaves();
  return true;
}

// Ctrl+X (Cmd+X) cuts. Copy and paste keep whatever shortcuts and buttons you already have.
// While writing, a click on the blank part of a track's settings does nothing (it would select the whole track)
function ignoreBlankClicksWhileWriting(): void {
  document.addEventListener('click', event => {
    if (entryState.entry && (event.target as HTMLElement)?.closest?.('.staffSettingsBlank')) event.stopPropagation();
  }, true);
}

function setupClipboardKeys(): void {
  document.addEventListener('keydown', (event: KeyboardEvent) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'x') return;
    const target = event.target as HTMLElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    if (!gridViewOn) return;
    event.preventDefault();
    if (cutSelection()) updateMemory();
  });
}

// Copies the selected range of every selected track: the selected voice, or every voice drawn there when all
// are selected. Copies nothing (and says why) if a selection cuts through a tuplet.
function copySelection(): boolean {
  const next: Record<string, ClipTrack> = {};
  for (const staff of getSelectedStaves()) {
    const sel = getSelection(staff.name);
    if (!sel) continue;
    const clip: ClipTrack = { length: round(sel.end - sel.start), voices: {} };
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
  if (!Object.keys(next).length) return false;
  clipboard = next;
  return true;
}

// Pastes what was copied at the start of the selection of each selected track (in order, as before).
// It does not save an undo step itself: the paste button calls updateMemory() afterwards.
function pasteSelection(): void {
  const names = Object.keys(clipboard);
  const targets = getSelectedStaves();
  if (!names.length || !targets.length) return;

  // work out every track first; nothing changes unless all of them can be pasted
  const plans: PastePlan[] = [];
  for (let index = 0; index < targets.length; index++) {
    const sel = getSelection(targets[index].name);
    const plan = sel ? planPaste(targets[index], clipboard[names[index % names.length]], sel) : null;
    if (!plan) {
      alert(`Can't paste into ${targets[index].name} here: it would cut through a tuplet, or put a tuplet across a barline.`);
      return;
    }
    plans.push(plan);
  }

  for (const plan of plans) {
    for (const id of Object.keys(plan.changes) as VoiceId[]) {
      const notes = plan.changes[id]!;
      renumberTuplets(notes);
      const voice = getOrCreateVoice(plan.staff, id);
      resetVoice(voice);
      processNotes(voice, notes);
    }
    const measures = measuresCovering(plan.newTotal);
    if (measures > numMeasures) numMeasures = measures;
  }
  drawAllStaves();

  // the pasted range ends up selected (after the drawing, so the Edit tab can snap it to whole notes)
  for (const plan of plans) {
    selections[currentLayer][plan.staff.name] = makeSelection(plan.staff, { start: plan.start, end: plan.end }, plan.state);
    lastSelectedStaff[currentLayer] = plan.staff.name;
  }
  renderGridOverlays(Object.values(getActiveStaves()));
}

// Double-click writing: where the next note goes
interface EntryState {
  staffName: string;
  layer: 'main' | 'harmony';
  voice: VoiceId;
  t: number;
}

// What the mouse wheel steps through while writing (scroll up = longer)
const ENTRY_DURATIONS: { key: string; label: string }[] = [
  { key: '32',  label: '32nd' },
  { key: '16',  label: '16th' },
  { key: '16d', label: 'Dotted 16th' },
  { key: '8',   label: '8th' },
  { key: '8d',  label: 'Dotted 8th' },
  { key: 'q',   label: 'Quarter' },
  { key: 'qd',  label: 'Dotted quarter' },
  { key: 'h',   label: 'Half' },
  { key: 'hd',  label: 'Dotted half' },
  { key: 'w',   label: 'Whole' },
];

const entryState: {
  entry: EntryState | null;
  durIndex: number;                 // into ENTRY_DURATIONS
  wheel: number;                    // wheel movement not yet turned into a step
  message: string;                  // a short note shown next to the duration ("Can't write here")
  midi: 'unknown' | 'pending' | 'ok' | 'none' | 'unsupported' | 'blocked';
  chord: { name: string; octave: number }[];   // keys pressed within the chord window
  chordTimer: number | null;
  clicks: { time: number; layer: 'main' | 'harmony'; sel: Record<string, SelectionRange | null>; cleared: Record<string, SelectionRange | null> }[];
} = { entry: null, durIndex: 5, wheel: 0, message: '', midi: 'unknown', chord: [], chordTimer: null, clicks: [] };

// Keys pressed within this long of the first one make one chord
const CHORD_WINDOW_MS = 50;

// A MIDI key as a note name: sharps in the keys that have sharps, flats otherwise
function spellMidi(midi: number, scale: string[]): { name: string; octave: number } {
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  const root = noteMapping[scale[0]] ?? 0;
  const mode = scale[1];
  const home = mode === 'Minor' ? (root + 3) % 12 : root;                      // the major key it belongs to
  const sharpKeys = [7, 2, 9, 4, 11, 6];                                       // G D A E B F#
  const useSharps = (mode === 'Major' || mode === 'Minor') && sharpKeys.includes(home);
  const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return { name: (useSharps ? SHARPS : FLAT_SPELLING)[pc], octave };
}

// The readout next to the mode buttons: the length being written and the voice
function entryDisplayEl(): HTMLElement {
  let el = document.getElementById('entryDisplay');
  if (!el) {
    // Sizes live in a rule placed first in <head>, so a rule of your own in composer.css wins over it
    const style = document.createElement('style');
    style.id = 'entryDisplayStyle';
    style.textContent =
      '#entryDisplay { white-space: pre; box-sizing: border-box; display: flex; flex-wrap: nowrap; justify-content: flex-start; align-items: center; cursor: pointer; user-select: none; }\n' +
      '#entryDisplay.entryBlocked { border-color: #c0392b; color: #c0392b; }\n' +
      '#entryDisplay[hidden] { display: none; }\n' +
      '#entryDisplay .entryVoice { margin-left: auto; }\n' +
      '#entryDisplay .entrySymbol { font-size: 2.4em; line-height: 1; vertical-align: middle; }\n' +
      '#entryDisplay .entryDuration { display: inline-block; position: relative; text-align: left; width: 84px; vertical-align: middle; }\n' +
      '#entryDisplay .entryDot { display: inline-block; width: 11px; height: 11px; margin: 0 6px 0 12px; border-radius: 50%; background: currentColor; font-size: 0; position: absolute; top: 50%; transform: translateY(-50%); }';
    document.head.prepend(style);

    el = document.createElement('span');
    el.id = 'entryDisplay';
    el.className = 'row';                                          // a row like the others in the settings panel, so it lines up with them
    el.hidden = true;
    el.addEventListener('mousedown', event => event.stopPropagation());     // a click on it is not a click on the settings under it
    el.addEventListener('click', event => { event.stopPropagation(); cycleEntryVoice(); });   // click it to change the voice you write in
    const home = document.querySelector('.modeButton')?.parentElement ?? document.body;
    home.appendChild(el);
  }
  return el;
}

// The readout in the settings of the track being written on: just the voice (click it to change it).
// The length is shown under the caret.
function updateEntryDisplay(): void {
  const el = entryDisplayEl();
  const en = entryState.entry;
  if (!en) { el.hidden = true; el.textContent = ''; el.title = ''; return; }

  const voice = VOICE_DEFS.find(voiceDef => voiceDef.id === en.voice)?.label ?? en.voice;
  const midiHint: Record<string, string> = {
    unsupported: 'MIDI needs Chrome or Edge', blocked: 'MIDI access was blocked', none: 'No MIDI keyboard found',
  };
  const hint = entryState.message || midiHint[entryState.midi] || '';

  el.hidden = false;
  const settings = document.querySelector(`.staffSettings[data-staff="${en.staffName}"]`);
  const blank = settings?.querySelector('.staffSettingsBlank');
  if (blank && blank.parentElement) { if (el.nextElementSibling !== blank) blank.parentElement.insertBefore(el, blank); }   // the last settings row
  else if (settings && el.parentElement !== settings) settings.appendChild(el);
  el.title = 'Click to change the voice' + (hint ? ` (${hint})` : '');

  el.textContent = '';
  const part = document.createElement('span');
  part.className = 'entryVoice';
  part.textContent = voice;
  el.appendChild(part);

  // If the panel is too narrow for the readout, shrink its text a pixel at a time until it fits.
  el.style.fontSize = '';
  for (let px = parseFloat(getComputedStyle(el).fontSize); px > 9 && el.scrollWidth > el.clientWidth; px--) el.style.fontSize = `${px - 1}px`;
}

// The size of the symbol under the caret
const PREVIEW_SIZE = 34;

// Each symbol's width, measured once
const previewWidths = new Map<number, number>();

let entryRefreshQueued = false;

// Sets the symbol under the caret to the current length. Cheap on purpose: it only changes text, and the
// browser is asked for a symbol's width once, not on every step of the wheel.
function updateEntryPreview(): void {
  const en = entryState.entry;
  if (!en) return;
  const note = containers[en.staffName]?.querySelector('.entryCaretNote');
  const group = note?.parentElement;
  if (!note || !group) return;

  const dur = ENTRY_DURATIONS[entryState.durIndex];
  const base = durationMapping[dur.key.replace('d', '')];
  const glyph = rhythmOptions.find(option => Math.abs(option.id - base) < 1e-9)?.symbol ?? dur.label;
  if (note.textContent !== glyph) note.textContent = glyph;

  let dot = group.querySelector('.entryCaretDot');
  if (!dur.key.endsWith('d')) { dot?.remove(); return; }

  if (!previewWidths.has(base)) {
    try { previewWidths.set(base, (note as SVGGraphicsElement).getBBox().width); } catch (err) { return; }
  }
  if (!dot) {
    dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('class', 'entryCaretDot');
    dot.setAttribute('fill', '#c0392b');
    group.appendChild(dot);
  }
  const xPos = Number(note.getAttribute('x'));
  const yPos = Number(note.getAttribute('y'));
  dot.setAttribute('cx', String(xPos + previewWidths.get(base)! / 2 + PREVIEW_SIZE * 0.15));   // just after the symbol
  dot.setAttribute('cy', String(yPos - PREVIEW_SIZE * 0.22));
  dot.setAttribute('r', String(PREVIEW_SIZE * 0.07));
}

// Redraws the preview under the caret once per screen frame, however many wheel events arrived in it
function scheduleEntryRefresh(): void {
  if (entryRefreshQueued) return;
  entryRefreshQueued = true;
  window.requestAnimationFrame(() => {
    entryRefreshQueued = false;
    updateEntryPreview();
  });
}

// The vertical line that shows where the next note will go
function drawEntryCaret(): void {
  for (const name of staves) {
    const svg = containers[name]?.querySelector('svg');
    if (!svg) continue;
    svg.querySelector('.entryCaretLayer')?.remove();

    const en = entryState.entry;
    if (!en || en.staffName !== name || en.layer !== currentLayer) continue;
    const band = staffBand(name);
    if (!band) continue;

    const xPos = timeToX(name, en.t);
    const group = document.createElementNS(SVG_NS, 'g');
    group.setAttribute('class', 'entryCaretLayer');
    group.setAttribute('pointer-events', 'none');
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('class', 'entryCaret');
    line.setAttribute('x1', String(xPos));
    line.setAttribute('x2', String(xPos));
    line.setAttribute('y1', String(band.yTop));
    line.setAttribute('y2', String(band.yBottom));
    line.setAttribute('stroke', '#c0392b');
    line.setAttribute('stroke-width', '2');
    group.appendChild(line);

    const note = document.createElementNS(SVG_NS, 'text');
    note.setAttribute('class', 'entryCaretNote');
    note.setAttribute('x', String(xPos));
    note.setAttribute('y', String(band.yBottom + PREVIEW_SIZE));
    note.setAttribute('text-anchor', 'middle');
    note.setAttribute('font-size', String(PREVIEW_SIZE));
    note.setAttribute('fill', '#c0392b');
    group.appendChild(note);
    svg.appendChild(group);
    updateEntryPreview();                                               // fills in the symbol (and dot)
  }
}

function startEntry(staffName: string, time: number, voice: VoiceId): void {
  entryState.entry = { staffName, layer: currentLayer, voice, t: time };
  entryState.message = '';
  entryState.chord = [];
  entryState.wheel = 0;
  connectMidi();
  updateEntryDisplay();
  drawEntryCaret();
}

function stopEntry(): void {
  if (!entryState.entry) return;
  entryState.entry = null;
  entryState.message = '';
  entryState.chord = [];
  if (entryState.chordTimer !== null) { window.clearTimeout(entryState.chordTimer); entryState.chordTimer = null; }
  updateEntryDisplay();
  drawEntryCaret();
}

// Clicking the readout: write in the next voice (Up 1, Down 1, Up 2, Down 2, then Up 1 again).
// A voice that doesn't exist yet is created by the first note written in it.
function cycleEntryVoice(): void {
  const en = entryState.entry;
  if (!en) return;
  const ids = VOICE_DEFS.map(def => def.id);
  en.voice = ids[(ids.indexOf(en.voice) + 1) % ids.length];
  entryState.message = '';
  updateEntryDisplay();
}

// Insert mode, in the voice being written: the note goes in at time t. A note that spans t is divided there
// (two separate notes, not tied) and its second half moves later; at a boundary the note just goes in.
function insertCellAt(cells: Cell[], time: number, note: UnprocessedNote, duration: number): Cell[] | null {
  const fresh: Cell = { start: time, end: round(time + duration), notes: [note], isTuplet: false, isRest: note.isRest };
  const out: Cell[] = [];
  let done = false;
  for (const cell of cells) {
    if (done || cell.end <= time + 1e-9) { out.push(cell); continue; }
    if (cell.start >= time - 1e-9) { out.push(fresh, cell); done = true; continue; }
    if (cell.isTuplet) return null;                                   // a tuplet can't be divided
    out.push({ ...cell, end: time, notes: piecesFor(cell, cell.start, time) }, fresh, { ...cell, start: time, notes: piecesFor(cell, time, cell.end) });
    done = true;
  }
  if (!done) out.push(fresh);
  return out;
}

// Writes one note (or chord, or rest) of length d at time t in a voice, following the mode:
//  Overwrite  replaces what is there in this voice; other voices are left alone
//  Insert     divides the note at t and pushes everything later, in every voice (held notes get longer)
//  Polyphony  like Overwrite, but if the note would overwrite notes of other pitches it goes to the first free voice
function writeEdit(staff: Staff, sourceId: VoiceId, time: number, note: UnprocessedNote, duration: number): VoiceEditResult | null {
  const endTime = round(time + duration);
  const total = notesDuration(staff.unprocessedNotes);
  const cellsOf = (id: VoiceId): Cell[] => {
    const voice = getVoice(staff, id);
    return voice ? buildCells(voice.unprocessedNotes) : emptyVoiceCells(total);
  };
  const sourceCells = cellsOf(sourceId);
  const changes: Partial<Record<VoiceId, UnprocessedNote[]>> = {};
  const result = (newTotal: number): VoiceEditResult => ({ changes, selection: { start: time, end: endTime, voice: sourceId }, newTotal });

  if (insertMode) {
    const inserted = insertCellAt(sourceCells, time, note, duration);
    if (!inserted) return null;
    changes[sourceId] = inserted.flatMap(cell => cell.notes);
    for (const voice of staffVoices(staff)) {
      if (voice.id === sourceId) continue;
      const shifted = shiftCellsAt(buildCells(voice.unprocessedNotes), time, duration);
      if (!shifted) return null;                                   // a tuplet would have to stretch
      changes[voice.id] = shifted.flatMap(cell => cell.notes);
    }
    return result(round(total + duration));
  }

  const newTotal = Math.max(total, endTime);
  const overwrite = (): VoiceEditResult | null => {
    const painted = paint(sourceCells, time, endTime, [note]);
    if (!painted) return null;
    changes[sourceId] = painted.flatMap(cell => cell.notes);
    return result(newTotal);
  };

  if (!polyphonyMode || note.isRest) return overwrite();

  const mine = new Set(midiPitches(note));
  if (!overlappingCells(sourceCells, time, endTime).some(cell => blocksPitches(cell, mine))) return overwrite();

  // it would overwrite notes of other pitches: find a voice that is free for the whole length
  for (const id of VOICE_DEFS.map(def => def.id).filter(id => id !== sourceId)) {
    const target = cellsOf(id);
    if (overlappingCells(target, time, endTime).some(cell => blocksPitches(cell, mine))) continue;
    const painted = paint(target, time, endTime, [note]);
    if (!painted) continue;
    changes[id] = painted.flatMap(cell => cell.notes);
    changes[sourceId] = erasePitches(sourceCells, time, endTime, mine).flatMap(cell => cell.notes);   // same pitches under it go
    return result(newTotal);
  }
  return null;
}

// Writes at the caret with the current length, then moves the caret on
function writeAtCaret(content: { names: string[]; octaves: number[] } | 'rest'): boolean {
  const en = entryState.entry;
  if (!en) return false;
  if (en.layer !== currentLayer || !gridViewOn) { stopEntry(); return false; }

  const staff = getActiveStaves()[en.staffName];
  const key = ENTRY_DURATIONS[entryState.durIndex].key;
  const template = content === 'rest' ? makeRest('q') : new UnprocessedNote(content.names, content.octaves, 'q');
  const note = noteWithDuration(template, key);
  const duration = durationMapping[key];

  const result = writeEdit(staff, en.voice, en.t, note, duration);
  const fits = !!result && (Object.keys(result.changes) as VoiceId[]).every(id => !tupletCrossesBarline(result.changes[id]!, 0, Infinity));
  if (!result || !fits) {
    entryState.message = "Can't write here";
    updateEntryDisplay();
    const box = entryDisplayEl();                                    // a blocked write: the box flashes red for a moment
    box.classList.add('entryBlocked');
    window.setTimeout(() => box.classList.remove('entryBlocked'), 700);
    return false;
  }

  entryState.message = '';
  commitVoiceEdits(staff, result.changes, null, result.newTotal);
  en.t = round(en.t + duration);
  updateEntryDisplay();
  drawEntryCaret();
  return true;
}

// Plays what was just pressed, so you hear it as you write
async function soundPitches(pitches: { name: string; octave: number }[]): Promise<void> {
  try {
    const setup = (window as any).setupSampler;
    if (!sampler && typeof setup === 'function') await setup();
    if (!sampler) return;
    for (const pitch of pitches) sampler.triggerAttackRelease(toToneName(pitch.name, pitch.octave), 0.6);
  } catch (err) {
    // no sound is not a reason to stop writing
  }
}

function flushChord(): void {
  entryState.chordTimer = null;
  const pressed = entryState.chord;
  entryState.chord = [];
  if (!pressed.length) return;

  const byPitch = new Map<number, { name: string; octave: number }>();
  for (const pitch of pressed) byPitch.set(soundingMidi(pitch.name, pitch.octave), pitch);
  const ordered = [...byPitch.entries()].sort((first, second) => first[0] - second[0]).map(entry => entry[1]);
  writeAtCaret({ names: ordered.map(pitch => pitch.name), octaves: ordered.map(pitch => pitch.octave) });
}

// One MIDI message from the keyboard. Note-ons within the chord window of the first one become one chord.
function handleMidiMessage(data: ArrayLike<number>): void {
  const en = entryState.entry;
  if (!en) return;
  const isNoteOn = (data[0] & 0xf0) === 0x90 && data[2] > 0;        // a note-on with velocity 0 is a note-off
  if (!isNoteOn) return;

  const staff = getActiveStaves()[en.staffName];
  const pitch = spellMidi(data[1], staff.scale);
  entryState.chord.push(pitch);
  soundPitches([pitch]);
  if (entryState.chordTimer === null) entryState.chordTimer = window.setTimeout(flushChord, CHORD_WINDOW_MS);
}

// Asks the browser for MIDI keyboards the first time you start writing (Chrome and Edge only)
function connectMidi(): void {
  if (entryState.midi !== 'unknown') return;
  const nav = navigator as any;
  if (typeof nav.requestMIDIAccess !== 'function') { entryState.midi = 'unsupported'; return; }

  entryState.midi = 'pending';
  nav.requestMIDIAccess().then((access: any) => {
    const hook = (): void => {
      let count = 0;
      access.inputs.forEach((input: any) => { input.onmidimessage = (ev: any) => handleMidiMessage(ev.data); count++; });
      entryState.midi = count ? 'ok' : 'none';
      updateEntryDisplay();
    };
    hook();
    access.onstatechange = hook;                                   // keyboards plugged in later
  }).catch(() => { entryState.midi = 'blocked'; updateEntryDisplay(); });
}

// The grid line nearest x where a note may start in this voice (never strictly inside one of its tuplets)
function entryTimeFromX(partName: string, xPos: number, voice: NoteStore): number {
  const measure = findMeasureAtX(partName, xPos);
  if (!measure) return 0;
  const spans = tupletSpans(voice);
  let best: GridLine | null = null;
  let bestDist = Infinity;
  for (const line of measure.lines) {
    if (insideTuplet(spans, line.t)) continue;
    const dist = Math.abs(line.x - xPos);
    if (dist < bestDist) { best = line; bestDist = dist; }
  }
  return best ? best.t : rawTimeFromX(partName, xPos);
}

// Called before each press on the notation, so the two clicks of a double-click can be taken back
function rememberClickState(): void {
  entryState.clicks.push({
    time: performance.now(),
    layer: currentLayer,
    sel: JSON.parse(JSON.stringify(selections[currentLayer])),
    cleared: JSON.parse(JSON.stringify(clearedSelections)),
  });
  if (entryState.clicks.length > 4) entryState.clicks.shift();
}

// A double-click only starts writing: put the selection back as it was before its first click
function restoreClickState(): void {
  const before = entryState.clicks[entryState.clicks.length - 2];
  if (!before || before.layer !== currentLayer || performance.now() - before.time > 900) return;
  selections[currentLayer] = before.sel;
  for (const key of Object.keys(clearedSelections)) delete clearedSelections[key];
  Object.assign(clearedSelections, before.cleared);
  renderGridOverlays(Object.values(getActiveStaves()));
}

function setupEntryInteraction(): void {
  for (const partName of Object.keys(containers)) {
    const el = containers[partName];

    // Capture phase, so this runs before the selection handler: remember the selection, and any click stops writing
    el.addEventListener('mousedown', (event: MouseEvent) => {
      if (event.button !== 0) return;
      rememberClickState();
      stopEntry();
    }, true);

    // Double-click: start writing here, in the voice of the nearest note (Up 1 if there is none).
    // This staff's selection goes away; other staves keep theirs.
    el.addEventListener('dblclick', (event: MouseEvent) => {
      if (!gridViewOn) return;
      const staff = getActiveStaves()[partName];
      const pt = localPoint(partName, event);
      if (!staff || !pt || !inStaffBand(partName, pt.y)) return;

      restoreClickState();
      selections[currentLayer][partName] = null;               // writing starts clean: nothing on this staff stays selected
      renderGridOverlays(Object.values(getActiveStaves()));
      const total = totalLength();
      const tHit = Math.min(rawTimeFromX(partName, pt.x), total - 1e-6);
      const pick = pickCandidate(candidatesAt(staff, tHit, pt.y), partName, pt.x, pt.y);
      const voice: VoiceLike = pick ? pick.voice : staff;
      startEntry(partName, entryTimeFromX(partName, pt.x, voice), voice.id);
    });

    // The caret lives inside the drawing, so it has to be put back whenever the staff is redrawn
    new MutationObserver(() => drawEntryCaret()).observe(el, { childList: true });
  }

  // Mouse wheel: the length of the next note (the page does not scroll while writing)
  document.addEventListener('wheel', (event: WheelEvent) => {
    if (!entryState.entry) return;
    event.preventDefault();
    const pixels = event.deltaMode === 1 ? event.deltaY * 33 : event.deltaMode === 2 ? event.deltaY * 100 : event.deltaY;
    entryState.wheel += pixels;
    while (Math.abs(entryState.wheel) >= 100) {
      const up = entryState.wheel < 0;                             // scroll up = longer
      entryState.durIndex = Math.min(ENTRY_DURATIONS.length - 1, Math.max(0, entryState.durIndex + (up ? 1 : -1)));
      entryState.wheel += up ? 100 : -100;
    }
    scheduleEntryRefresh();
  }, { passive: false });

  document.addEventListener('keydown', (event: KeyboardEvent) => {
    if (!entryState.entry) return;
    const target = event.target as HTMLElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    if (event.key === 'Escape') { event.preventDefault(); stopEntry(); }
    else if ((event.key === 'r' || event.key === 'R') && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); writeAtCaret('rest'); }
  });
}
