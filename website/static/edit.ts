////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Edit tab: edit engine, pitch edits, edit menu
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

interface Cell {
  start: number;
  end: number;
  notes: UnprocessedNote[];   // the pieces this cell emits as they are
  isTuplet: boolean;
  isRest: boolean;
}

function samePitches(left: UnprocessedNote, right: UnprocessedNote): boolean {
  if (left.noteName.length !== right.noteName.length) return false;
  const key = (note: UnprocessedNote) => note.noteName.map((nm, index) => `${nm}${note.octaves[index]}`).sort().join(',');
  return key(left) === key(right);
}

// Cells = whole tuplets, rests, and "logical notes" (a chain of tied same-pitch pieces is one note)
function buildCells(notes: UnprocessedNote[]): Cell[] {
  const cells: Cell[] = [];
  let time = 0;
  let itemIndex = 0;

  while (itemIndex < notes.length) {
    const note = notes[itemIndex];

    if (note.tupletInfo) {
      const group: UnprocessedNote[] = [];
      const start = time;
      let total = 0;
      while (itemIndex < notes.length && notes[itemIndex].tupletInfo) {
        const info = notes[itemIndex].tupletInfo!;
        group.push(notes[itemIndex]);
        total = info.totalTupletDuration;
        itemIndex++;
        if (info.index === info.count) break;
      }
      time = round(start + total);
      cells.push({ start, end: time, notes: group, isTuplet: true, isRest: group.every(note => note.isRest) });
      continue;
    }

    const chain: UnprocessedNote[] = [note];
    let end = round(time + getNoteDuration(note));
    itemIndex++;
    while (
      !note.isRest && chain[chain.length - 1].tiedToNext && itemIndex < notes.length &&
      !notes[itemIndex].tupletInfo && !notes[itemIndex].isRest && samePitches(chain[chain.length - 1], notes[itemIndex])
    ) {
      chain.push(notes[itemIndex]);
      end = round(end + getNoteDuration(notes[itemIndex]));
      itemIndex++;
    }
    cells.push({ start: time, end, notes: chain, isTuplet: false, isRest: note.isRest });
    time = end;
  }
  return cells;
}

// Duration key ("q", "hd", ...) of a cell, or null when its length isn't a single note value
function cellKey(cell: Cell): string | null {
  return getDurationKeyFromValue(round(cell.end - cell.start));
}

// New base value. By default the dot state is kept; a dotted 32nd isn't supported, so the dot is dropped.
function keyWithBase(cell: Cell, base: string, keepDot: boolean = true): string | null {
  const cur = cellKey(cell);
  const dotted = keepDot && cur ? cur.endsWith('d') : false;
  if (dotted && base === '32') return '32';
  return base + (dotted ? 'd' : '');
}

function keyWithDot(cell: Cell, wantDot: boolean): string | null {
  const cur = cellKey(cell);
  if (!cur) return null;
  const base = cur.replace(/d$/, '');
  if (wantDot && base === '32') return null;
  return base + (wantDot ? 'd' : '');
}

// The notes that fill [start, end) the way cell `c` does: rests, or its pitch tied across the time
function piecesFor(cell: Cell, start: number, end: number): UnprocessedNote[] {
  const length = round(end - start);
  return cell.isRest ? fillDurationWithRests(length, start) : fillDurationAsUnprocessed(length, cell.notes[0]);
}

function noteWithDuration(template: UnprocessedNote, key: string): UnprocessedNote {
  return template.isRest
    ? makeRest(key)
    : new UnprocessedNote([...template.noteName], [...template.octaves], key, false, false);
}

// Overwrites [s, e) with `fresh`. Cells partly covered are cut; a tuplet may only be removed whole.
function paint(cells: Cell[], from: number, to: number, fresh: UnprocessedNote[]): Cell[] | null {
  const out: Cell[] = [];
  let inserted = false;
  const flush = () => {
    if (!inserted) {
      out.push({ start: from, end: to, notes: fresh, isTuplet: false, isRest: fresh[0].isRest });
      inserted = true;
    }
  };

  for (const cell of cells) {
    if (cell.end <= from + 1e-9) { out.push(cell); continue; }
    if (cell.start >= to - 1e-9) { flush(); out.push(cell); continue; }

    if (cell.isTuplet) {
      if (cell.start >= from - 1e-9 && cell.end <= to + 1e-9) continue;   // swallowed whole
      return null;
    }
    if (cell.start < from - 1e-9) out.push({ ...cell, end: from, notes: piecesFor(cell, cell.start, from) });
    flush();
    if (cell.end > to + 1e-9) out.push({ ...cell, start: to, notes: piecesFor(cell, to, cell.end) });
  }
  flush();
  return out;
}

type KeyFor = (cell: Cell) => string | null;

interface DurationEditResult {
  notes: UnprocessedNote[];
  selection: SelectionRange;
  newTotal: number;
}

function selectedCellIndices(cells: Cell[], selStart: number, selEnd: number): number[] {
  const idx: number[] = [];
  cells.forEach((cell, index) => {
    if (cell.start >= selStart - 1e-9 && cell.end <= selEnd + 1e-9) idx.push(index);
  });
  return idx;
}

// Overwrite: every selected note keeps its start. Time it gives up becomes rests; time it takes
// replaces what was there. Earlier notes win over later ones when they collide. Extending past
// the end grows the piece (the caller adds measures).
function overwriteEdit(cells: Cell[], selStart: number, selEnd: number, total: number, keyFor: KeyFor): DurationEditResult | null {
  const sel = selectedCellIndices(cells, selStart, selEnd);
  if (!sel.length || sel.some(index => cells[index].isTuplet)) return null;

  let work: Cell[] = cells.map((cell, index) =>
    sel.includes(index) ? { start: cell.start, end: cell.end, notes: fillDurationWithRests(round(cell.end - cell.start), cell.start), isTuplet: false, isRest: true } : cell
  );

  let newStart = Infinity;
  let newEnd = -Infinity;
  let newTotal = total;   // grows when a note is extended past the current end
  for (const itemIndex of [...sel].reverse()) {
    const current = cells[itemIndex];
    const key = keyFor(current);
    if (!key) return null;
    const extendedEnd = round(current.start + durationMapping[key]);

    const painted = paint(work, current.start, extendedEnd, [noteWithDuration(current.notes[0], key)]);
    if (!painted) return null;
    work = painted;
    newStart = Math.min(newStart, current.start);
    newEnd = Math.max(newEnd, extendedEnd);
    newTotal = Math.max(newTotal, extendedEnd);
  }

  return { notes: work.flatMap(cell => cell.notes), selection: { start: newStart, end: newEnd }, newTotal };
}

// Insert: the selected notes are laid end to end at their new lengths and everything after
// (rests included) moves with them. Longer = the track grows; shorter = rests pad the end.
function insertEdit(cells: Cell[], selStart: number, selEnd: number, total: number, keyFor: KeyFor): DurationEditResult | null {
  const sel = selectedCellIndices(cells, selStart, selEnd);
  if (!sel.length || sel.some(index => cells[index].isTuplet)) return null;

  const first = sel[0];
  const last = sel[sel.length - 1];
  if (last - first + 1 !== sel.length) return null;

  const start = cells[first].start;
  let pos = start;
  let oldSpan = 0;
  const placed: UnprocessedNote[] = [];
  for (const itemIndex of sel) {
    const cell = cells[itemIndex];
    const key = keyFor(cell);
    if (!key) return null;
    placed.push(noteWithDuration(cell.notes[0], key));
    pos = round(pos + durationMapping[key]);
    oldSpan = round(oldSpan + (cell.end - cell.start));
  }
  const newSpan = round(pos - start);
  const delta = round(newSpan - oldSpan);

  const before = cells.slice(0, first).flatMap(cell => cell.notes);
  const after = cells.slice(last + 1).flatMap(cell => cell.notes);
  let notes = [...before, ...placed, ...after];
  let newTotal = round(total + delta);

  if (delta < -1e-9) {
    notes = [...notes, ...fillDurationWithRests(round(total - newTotal), newTotal)];
    newTotal = total;
  }
  return { notes, selection: { start, end: pos }, newTotal };
}

type PitchKind = 'letter' | 'acc' | 'octave';

interface PitchSet {
  names: string[];
  octaves: number[];
}

// A pitch is identified by its spelling and octave, e.g. "Gb4" or "G#4"
function pitchKey(name: string, octave: number): string {
  return `${name}${octave}`;
}

// Pitch indices of a note, highest sounding pitch first
function orderedPitchIdx(note: UnprocessedNote): number[] {
  return note.noteName
    .map((nm, index) => ({ i: index, m: soundingMidi(nm, note.octaves[index]) }))
    .sort((first, second) => second.m - first.m || first.i - second.i)
    .map(entry => entry.i);
}

// Keys of a note's pitches, highest first
function notePitchKeys(note: UnprocessedNote): string[] {
  return orderedPitchIdx(note).map(index => pitchKey(note.noteName[index], note.octaves[index]));
}

function dedupePitches(pitches: PitchSet): PitchSet {
  const seen = new Set<string>();
  const names: string[] = [];
  const octaves: number[] = [];
  pitches.names.forEach((nm, index) => {
    const key = pitchKey(nm, pitches.octaves[index]);
    if (seen.has(key)) return;
    seen.add(key);
    names.push(nm);
    octaves.push(pitches.octaves[index]);
  });
  return { names, octaves };
}

// Changes one parameter of the pitches named in `targets` (null = every pitch). Nothing is
// restricted: any letter, accidental or octave is allowed. newKeys says where the edited pitches ended up.
function editNotePitches(
  note: UnprocessedNote, targets: string[] | null, kind: PitchKind, value: string | number
): { set: PitchSet; newKeys: string[] } {
  const names = [...note.noteName];
  const octaves = [...note.octaves];
  const newKeys: string[] = [];

  for (let index = 0; index < names.length; index++) {
    if (targets && !targets.includes(pitchKey(names[index], octaves[index]))) continue;
    const parsed = parsePitchName(names[index]);
    let letter = parsed.letter;
    let acc = parsed.acc;
    let oct = octaves[index];
    if (kind === 'letter') letter = String(value);
    else if (kind === 'acc') acc = String(value);
    else oct = Math.max(0, Math.min(8, Number(value)));
    names[index] = letter + acc;
    octaves[index] = oct;
    newKeys.push(pitchKey(names[index], octaves[index]));
  }
  return { set: dedupePitches({ names, octaves }), newKeys };
}

function addPitchToNote(note: UnprocessedNote, name: string, octave: number): PitchSet {
  return dedupePitches({ names: [...note.noteName, name], octaves: [...note.octaves, octave] });
}

// null when that would remove every pitch (the caller turns the note into a rest instead)
function removePitchesFromNote(note: UnprocessedNote, keys: string[]): PitchSet | null {
  const names: string[] = [];
  const octaves: number[] = [];
  note.noteName.forEach((nm, index) => {
    if (keys.includes(pitchKey(nm, note.octaves[index]))) return;
    names.push(nm);
    octaves.push(note.octaves[index]);
  });
  return names.length ? { names, octaves } : null;
}

let insertMode = false;       // Insert
let polyphonyMode = false;    // Polyphony (reserved, nothing reads it yet). Neither = Overwrite

type EditKind = 'letter' | 'acc' | 'octave' | 'duration' | 'dot';

interface EditCtx {
  part: Staff;                          // the staff (its scale and pitch range apply to every voice)
  store: VoiceLike;                     // the voice the selection is in (the first one, when several)
  sel: SelectionRange;
  entries: UnprocessedTimingEntry[];    // one per note (tuplet notes individually)
  notes: UnprocessedNote[];             // every selected note of every voice
  groups: EditGroup[];                  // the same, voice by voice
  multi: boolean;                       // several voices at once: only pitch edits and Delete apply
}

// A pitch being built with "+". It exists only in this menu until its note and octave are chosen.
interface Pending { letter: string | null; acc: string | null; octave: number | null; }

// Menu state for the current single-note selection. Not saved, not part of undo.
interface EditSession {
  partName: string;
  voice: VoiceId;
  start: number;
  end: number;
  selected: string | null;     // key of the pitch the rows below edit (null while the note is a rest)
  pending: Pending | null;
}
let editSession: EditSession | null = null;
let editRefreshQueued = false;

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
const ACC_BUTTONS = ['bb', 'b', '', '#', '##'];
const OCTAVE_BUTTONS = [0, 1, 2, 3, 4, 5, 6, 7];
const DURATION_KEYS: Record<number, string> = { 1: 'w', 0.5: 'h', 0.25: 'q', 0.125: '8', 0.0625: '16', 0.03125: '32' };

// The selected notes of one voice
interface EditGroup {
  store: VoiceLike;
  entries: UnprocessedTimingEntry[];
  notes: UnprocessedNote[];
}

function getEditContext(): EditCtx | null {
  if (!gridViewOn || currentTab !== 'edit') return null;
  const active = getActiveStaves();
  for (const name of staves) {
    const sel = getSelection(name);
    if (!sel) continue;
    const staff = active[name];

    const groups: EditGroup[] = [];
    for (const store of selectionTargets(staff, sel)) {
      const entries = getUnprocessedTimeline(store.unprocessedNotes)
        .filter(entry => entry.start >= sel.start - 1e-9 && round(entry.start + entry.dur) <= sel.end + 1e-9);
      if (entries.length) groups.push({ store, entries, notes: entries.map(entry => store.unprocessedNotes[entry.index]) });
    }
    if (!groups.length) return null;

    return {
      part: staff, store: groups[0].store, sel,
      entries: groups.flatMap(group => group.entries), notes: groups.flatMap(group => group.notes),
      groups, multi: groups.length > 1,
    };
  }
  return null;
}

// Tied same-pitch pieces count as one note
function logicalNoteCount(notes: UnprocessedNote[]): number {
  let count = 0;
  let prev: UnprocessedNote | null = null;
  for (const note of notes) {
    const continues = prev && prev.tiedToNext && !prev.isRest && !note.isRest && !note.tupletInfo && samePitches(prev, note);
    if (!continues) count++;
    prev = note;
  }
  return count;
}

function firstPitched(ctx: EditCtx): UnprocessedNote | null {
  return ctx.notes.find(note => !note.isRest) ?? null;
}

function isPitchAllowed(staff: Staff, name: string, octave: number): boolean {
  const lo = parsePitchString(toPitchStr(staff.pitchRange[0]));
  const hi = parsePitchString(toPitchStr(staff.pitchRange[1]));
  const midi = soundingMidi(name, octave);
  if (midi < soundingMidi(lo.name, lo.octave) || midi > soundingMidi(hi.name, hi.octave)) return false;
  const rootPc = noteMapping[staff.scale[0]];
  const scale = scalesMapping[staff.scale[1]];
  return scale.includes((((midi % 12) - rootPc) % 12 + 12) % 12);
}

function harmonyChordAt(staff: Staff, time: number): UnprocessedNote | null {
  const hv = harmonyStaves[staff.name];
  if (!hv) return null;
  const entry = getUnprocessedTimeline(hv.unprocessedNotes)
    .find(item => time >= item.start - 1e-9 && time < item.start + item.dur - 1e-9);
  const note = entry ? hv.unprocessedNotes[entry.index] : null;
  return note && !note.isRest ? note : null;
}

function pitchIsOutOfKey(staff: Staff, name: string, octave: number, startTime: number): boolean {
  if (!isPitchAllowed(staff, name, octave)) return true;
  if (currentLayer === 'main' && staff.harmonize) {
    const chord = harmonyChordAt(staff, startTime);
    if (chord && !chord.noteName.some(nm => pitchClassOf(nm) === pitchClassOf(name))) return true;
  }
  return false;
}

function ensureSession(ctx: EditCtx): EditSession {
  const session = editSession;
  const same = !!session && session.partName === ctx.part.name && session.voice === ctx.store.id &&
    Math.abs(session.start - ctx.sel.start) < 1e-9 && Math.abs(session.end - ctx.sel.end) < 1e-9;
  const note = firstPitched(ctx);
  const keys = note ? notePitchKeys(note) : [];

  if (!same) {
    editSession = {
      partName: ctx.part.name, voice: ctx.store.id, start: ctx.sel.start, end: ctx.sel.end,
      selected: keys[0] ?? null, pending: null,
    };
  } else {
    const cur = editSession!;
    if (!cur.selected || !keys.includes(cur.selected)) cur.selected = keys[0] ?? null;   // highest pitch
  }
  return editSession!;
}

interface PitchTarget { letter: string; acc: string; octave: number; }

function targetFromKey(key: string): PitchTarget {
  const parsed = parsePitchString(key);
  const nameParts = parsePitchName(parsed.name);
  return { letter: nameParts.letter, acc: nameParts.acc, octave: parsed.octave };
}

function commonValue<T>(vals: T[]): T | null {
  return vals.length > 0 && vals.every(value => value === vals[0]) ? vals[0] : null;
}

// The result of an edit that may touch several voices of one staff
interface VoiceEditResult {
  changes: Partial<Record<VoiceId, UnprocessedNote[]>>;   // the new notes of every voice that changed
  selection: SelectionRange;                              // where the edited note(s) ended up (voice included)
  newTotal: number;
}

function singleVoiceResult(result: DurationEditResult | null, id: VoiceId): VoiceEditResult | null {
  return result ? { changes: { [id]: result.notes }, selection: { ...result.selection, voice: id }, newTotal: result.newTotal } : null;
}

function midiPitches(note: UnprocessedNote): number[] {
  return note.noteName.map((nm, index) => soundingMidi(nm, note.octaves[index]));
}

function overlappingCells(cells: Cell[], from: number, to: number): Cell[] {
  return cells.filter(cell => cell.start < to - 1e-9 && cell.end > from + 1e-9);
}

// The cells of a voice that doesn't exist yet: rests all the way
function emptyVoiceCells(total: number): Cell[] {
  return [{ start: 0, end: total, notes: fillDurationWithRests(round(total - 0), 0), isTuplet: false, isRest: true }];
}

// Turns [s, e) into rests
function clearCells(cells: Cell[], start: number, end: number): Cell[] | null {
  if (end - start < 1e-9) return cells;
  return paint(cells, start, end, fillDurationWithRests(round(end - start), start));
}

// Removes the given pitches from the notes inside [s, e). A note that loses every pitch becomes rests;
// a chord keeps its other pitches. Tuplets are never cut (the callers treat them as blockers).
function erasePitches(cells: Cell[], from: number, to: number, remove: Set<number>): Cell[] {
  const out: Cell[] = [];
  for (const cell of cells) {
    if (cell.isRest || cell.isTuplet || cell.end <= from + 1e-9 || cell.start >= to - 1e-9) { out.push(cell); continue; }
    const tpl = cell.notes[0];
    const keep = tpl.noteName.map((ignoredName, index) => index).filter(index => !remove.has(soundingMidi(tpl.noteName[index], tpl.octaves[index])));
    if (keep.length === tpl.noteName.length) { out.push(cell); continue; }       // nothing shared

    const overlapStart = Math.max(cell.start, from);
    const overlapEnd = Math.min(cell.end, to);
    if (cell.start < overlapStart - 1e-9) out.push({ ...cell, end: overlapStart, notes: fillDurationAsUnprocessed(round(overlapStart - cell.start), tpl) });
    if (keep.length === 0) {
      out.push({ start: overlapStart, end: overlapEnd, notes: fillDurationWithRests(round(overlapEnd - overlapStart), overlapStart), isTuplet: false, isRest: true });
    } else {
      const reduced = new UnprocessedNote(keep.map(index => tpl.noteName[index]), keep.map(index => tpl.octaves[index]), tpl.duration, tpl.dotted, false);
      out.push({ ...cell, start: overlapStart, end: overlapEnd, notes: fillDurationAsUnprocessed(round(overlapEnd - overlapStart), reduced) });
    }
    if (cell.end > overlapEnd + 1e-9) out.push({ ...cell, start: overlapEnd, notes: fillDurationAsUnprocessed(round(cell.end - overlapEnd), tpl) });
  }
  return out;
}

// A note blocks another when some of its pitches would survive the other one passing over it
function blocksPitches(cell: Cell, mine: Set<number>): boolean {
  if (cell.isRest) return false;
  if (cell.isTuplet) return true;
  return !midiPitches(cell.notes[0]).every(midi => mine.has(midi));
}

// Polyphony mode. Like Overwrite, except that a note extended over other notes (of other pitches)
// moves to the first free voice instead of overwriting them. Same pitches under the extension are
// overwritten; a chord only loses the pitches it shares. Shortening works like Overwrite.
function polyphonyEdit(
  staff: Staff, sourceId: VoiceId, selStart: number, selEnd: number, total: number, keyFor: KeyFor
): VoiceEditResult | null {
  const source = getVoice(staff, sourceId);
  if (!source) return null;

  const work: Partial<Record<VoiceId, Cell[]>> = {};
  const touched = new Set<VoiceId>();
  const cellsOf = (id: VoiceId): Cell[] => {
    if (!work[id]) {
      const voice = getVoice(staff, id);
      work[id] = voice ? buildCells(voice.unprocessedNotes) : emptyVoiceCells(total);
    }
    return work[id]!;
  };

  const startCells = cellsOf(sourceId);
  const sel = selectedCellIndices(startCells, selStart, selEnd);
  if (!sel.length || sel.some(index => startCells[index].isTuplet)) return null;
  const selected = sel.map(index => startCells[index]);

  const placed: { id: VoiceId; start: number; end: number }[] = [];
  let newTotal = total;

  for (const cell of selected) {
    const key = keyFor(cell);
    if (!key) return null;
    const e1 = round(cell.start + durationMapping[key]);
    newTotal = Math.max(newTotal, e1);
    const note = noteWithDuration(cell.notes[0], key);
    const sourceVoiceCells = cellsOf(sourceId);

    // an earlier selected note may already have overwritten this one
    const stillThere = sourceVoiceCells.some(other => !other.isTuplet && Math.abs(other.start - cell.start) < 1e-9 && Math.abs(other.end - cell.end) < 1e-9);
    if (!stillThere) continue;

    const overwriteHere = (): boolean => {
      const cleared = clearCells(sourceVoiceCells, cell.start, cell.end);
      const painted = cleared && paint(cleared, cell.start, e1, [note]);
      if (!painted) return false;
      work[sourceId] = painted;
      touched.add(sourceId);
      placed.push({ id: sourceId, start: cell.start, end: e1 });
      return true;
    };

    // rests, shortening and an equal length: plain overwrite
    if (cell.isRest || e1 <= cell.end + 1e-9) {
      if (!overwriteHere()) return null;
      continue;
    }

    const mine = new Set(midiPitches(cell.notes[0]));
    const blockers = overlappingCells(sourceVoiceCells, cell.end, e1).filter(blocker => blocksPitches(blocker, mine));
    if (blockers.length === 0) {
      if (!overwriteHere()) return null;
      continue;
    }

    // the extension would run over other notes: find a voice that is free for the whole new length
    const others = VOICE_DEFS.map(voiceDef => voiceDef.id).filter(id => id !== sourceId);
    let dest: VoiceId | null = null;
    let destCells: Cell[] | null = null;
    for (const id of others) {
      const destVoiceCells = cellsOf(id);
      if (overlappingCells(destVoiceCells, cell.start, e1).some(cell => blocksPitches(cell, mine))) continue;
      const painted = paint(destVoiceCells, cell.start, e1, [note]);
      if (painted) { dest = id; destCells = painted; break; }
    }
    if (!dest || !destCells) return null;

    const cleared = clearCells(sourceVoiceCells, cell.start, cell.end);
    if (!cleared) return null;
    work[sourceId] = erasePitches(cleared, cell.end, e1, mine);   // same pitches under the extension go; others stay
    work[dest] = destCells;
    touched.add(sourceId);
    touched.add(dest);
    placed.push({ id: dest, start: cell.start, end: e1 });
  }

  if (!placed.length) return null;
  const mineVoice = placed.find(placement => placement.id === sourceId)?.id ?? placed[0].id;
  const group = placed.filter(placement => placement.id === mineVoice);

  const changes: Partial<Record<VoiceId, UnprocessedNote[]>> = {};
  for (const id of touched) changes[id] = (work[id] as Cell[]).flatMap(cell => cell.notes);
  return {
    changes,
    selection: { start: Math.min(...group.map(placement => placement.start)), end: Math.max(...group.map(placement => placement.end)), voice: mineVoice },
    newTotal,
  };
}

// The Voice row: moves the selected notes to another voice, if that voice has only rests there
function moveToVoiceEdit(
  staff: Staff, sourceId: VoiceId, destId: VoiceId, selStart: number, selEnd: number, total: number
): VoiceEditResult | null {
  if (sourceId === destId) return null;
  const source = getVoice(staff, sourceId);
  if (!source) return null;

  const sourceCells = buildCells(source.unprocessedNotes);
  const idx = selectedCellIndices(sourceCells, selStart, selEnd);
  if (!idx.length) return null;
  const moved = idx.map(index => sourceCells[index]);
  if (moved.every(cell => cell.isRest)) return null;                   // nothing to move

  const dest = getVoice(staff, destId);
  let destCells = dest ? buildCells(dest.unprocessedNotes) : emptyVoiceCells(total);
  const from = moved[0].start;
  const to = moved[moved.length - 1].end;
  if (overlappingCells(destCells, from, to).some(cell => !cell.isRest)) return null;   // not free

  let workingSource = sourceCells;
  for (const moving of moved) {
    const t2 = paint(destCells, moving.start, moving.end, moving.notes);
    const s2 = paint(workingSource, moving.start, moving.end, fillDurationWithRests(round(moving.end - moving.start), moving.start));
    if (!t2 || !s2) return null;
    destCells = t2;
    workingSource = s2;
  }
  return {
    changes: { [sourceId]: workingSource.flatMap(cell => cell.notes), [destId]: destCells.flatMap(cell => cell.notes) },
    selection: { start: from, end: to, voice: destId },
    newTotal: total,
  };
}

// Adds (d > 0) or removes (d < 0) time at point P in one voice. A note or rest that spans the point gets longer or
// shorter; at a boundary a rest is added. Removed time takes whatever is inside it. Null if a tuplet would have to stretch.
function shiftCellsAt(cells: Cell[], position: number, duration: number): Cell[] | null {
  const out: Cell[] = [];

  if (duration > 0) {
    let done = false;
    for (const cell of cells) {
      if (!done && cell.start < position - 1e-9 && cell.end > position + 1e-9) {
        if (cell.isTuplet) return null;
        const end = round(cell.end + duration);
        out.push({ ...cell, end, notes: piecesFor(cell, cell.start, end) });
        done = true;
        continue;
      }
      if (!done && cell.start >= position - 1e-9) {
        out.push({ start: position, end: round(position + duration), notes: fillDurationWithRests(round(round(position + duration) - position), position), isTuplet: false, isRest: true });
        done = true;
      }
      out.push(cell);
    }
    if (!done) out.push({ start: position, end: round(position + duration), notes: fillDurationWithRests(round(round(position + duration) - position), position), isTuplet: false, isRest: true });
    return out;
  }

  const endPos = round(position + duration);
  for (const existing of cells) {
    if (existing.end <= endPos + 1e-9 || existing.start >= position - 1e-9) { out.push(existing); continue; }
    const length = round(existing.end - existing.start);
    const cut = round(Math.min(existing.end, position) - Math.max(existing.start, endPos));
    if (cut >= length - 1e-9) continue;                       // entirely inside the removed time
    if (existing.isTuplet) return null;
    const end = round(existing.end - cut);
    out.push({ ...existing, end, notes: piecesFor(existing, existing.start, end) });
  }
  return out;
}

// Insert mode: the edited voice is laid out as before, and every other voice of the staff gets the same time
// added or removed at the end of each edited note, so the voices stay in step.
function insertAcrossVoices(
  staff: Staff, sourceId: VoiceId, cells: Cell[], selStart: number, selEnd: number, total: number, keyFor: KeyFor
): VoiceEditResult | null {
  const own = insertEdit(cells, selStart, selEnd, total, keyFor);
  if (!own) return null;
  const changes: Partial<Record<VoiceId, UnprocessedNote[]>> = { [sourceId]: own.notes };

  const deltas = selectedCellIndices(cells, selStart, selEnd).map(index => {
    const cell = cells[index];
    return { at: cell.end, delta: round(durationMapping[keyFor(cell)!] - (cell.end - cell.start)) };
  }).filter(shift => Math.abs(shift.delta) > 1e-9);

  const endOf = (notes: UnprocessedNote[]): number => {
    const cs = buildCells(notes);
    return cs.length ? cs[cs.length - 1].end : 0;
  };

  for (const voice of staffVoices(staff)) {
    if (voice.id === sourceId) continue;
    const had = endOf(voice.unprocessedNotes);
    let vc = buildCells(voice.unprocessedNotes);
    for (const { at, delta } of [...deltas].reverse()) {       // latest first, so earlier positions stay valid
      const next = shiftCellsAt(vc, at, delta);
      if (!next) return null;
      vc = next;
    }
    let notes = vc.flatMap(cell => cell.notes);
    const now = endOf(notes);
    if (now < had - 1e-9) notes = [...notes, ...fillDurationWithRests(round(had - now), now)];   // removed time: keep the voice's length
    changes[voice.id] = notes;
  }
  return { changes, selection: { ...own.selection, voice: sourceId }, newTotal: own.newTotal };
}

function computeDurationEdit(ctx: EditCtx, kind: 'duration' | 'dot', value: string): VoiceEditResult | null {
  if (ctx.multi) return null;                 // several voices at once: pick one voice first
  const staff = ctx.part;
  const store = ctx.store;
  const total = notesDuration(store.unprocessedNotes);
  const cells = buildCells(store.unprocessedNotes);
  const { start, end } = ctx.sel;

  // A tuplet touching the selection, even partly, blocks duration edits
  if (cells.some(cell => cell.isTuplet && cell.start < end - 1e-9 && cell.end > start + 1e-9)) return null;
  const selCells = selectedCellIndices(cells, start, end).map(index => cells[index]);
  if (!selCells.length) return null;

  // Overwrite changes this voice only, Polyphony may also move the note into another voice, and Insert moves every voice
  const run = (keyFor: KeyFor): VoiceEditResult | null => {
    const result = insertMode
      ? insertAcrossVoices(staff, store.id, cells, start, end, total, keyFor)
      : polyphonyMode
        ? polyphonyEdit(staff, store.id, start, end, total, keyFor)
        : singleVoiceResult(overwriteEdit(cells, start, end, total, keyFor), store.id);
    if (!result) return null;
    for (const id of Object.keys(result.changes) as VoiceId[]) {
      if (tupletCrossesBarline(result.changes[id]!, 0, Infinity)) return null;
    }
    return result;
  };

  if (kind === 'dot') {
    const wantDot = !selCells.every(cell => (cellKey(cell) ?? '').endsWith('d'));
    return run(cell => keyWithDot(cell, wantDot));
  }
  // Keep the dot when it fits, otherwise fall back to the plain value
  return run(cell => keyWithBase(cell, value)) ?? run(cell => keyWithBase(cell, value, false));
}

// Writes the new notes of every changed voice of a staff, then redraws
function commitVoiceEdits(
  staff: Staff, changes: Partial<Record<VoiceId, UnprocessedNote[]>>, newSel: SelectionRange | null, newTotal: number | null
): void {
  for (const id of Object.keys(changes) as VoiceId[]) {
    const notes = changes[id]!;
    renumberTuplets(notes);
    const voice = getOrCreateVoice(staff, id);
    resetVoice(voice);
    processNotes(voice, notes);
  }

  if (newTotal !== null) {
    const measures = measuresCovering(newTotal);
    if (measures > numMeasures) numMeasures = measures;
  }
  if (newSel) {
    selections[currentLayer][staff.name] = newSel;
    lastSelectedStaff[currentLayer] = staff.name;
  }
  drawAllStaves();
  updateMemory();
}

function applyDurationEdit(ctx: EditCtx, kind: 'duration' | 'dot', value: string): void {
  if (ctx.multi) return;
  const result = computeDurationEdit(ctx, kind, value);
  if (!result) return;
  // a selection of "all voices" stays that way while the note stays in its voice
  const stays = (!ctx.sel.voice || ctx.sel.voice === 'all') && result.selection.voice === ctx.store.id;
  commitVoiceEdits(ctx.part, result.changes, {
    start: result.selection.start, end: result.selection.end,
    voice: stays ? 'all' : result.selection.voice,
    base: { start: result.selection.start, end: result.selection.end },
  }, result.newTotal);
}

// Rewrites every note in the selection. fn returns the new pitches, 'rest', or null to leave a note alone.
// Rewrites every note in the selection, in every voice it covers. fn returns the new pitches, 'rest', or null to leave a note alone.
function rewriteNotes(ctx: EditCtx, fn: (note: UnprocessedNote) => PitchSet | 'rest' | null): void {
  const changes: Partial<Record<VoiceId, UnprocessedNote[]>> = {};
  for (const group of ctx.groups) {
    const notes = [...group.store.unprocessedNotes];
    let changed = false;
    for (const entry of group.entries) {
      const src = notes[entry.index];
      const result = fn(src);
      if (!result) continue;
      const replacement = result === 'rest'
        ? makeRest(src.duration, src.dotted)
        : new UnprocessedNote(result.names, result.octaves, src.duration, src.dotted, src.tiedToNext);
      if (src.tupletInfo) replacement.tupletInfo = { ...src.tupletInfo };
      notes[entry.index] = replacement;
      changed = true;
    }
    if (changed) changes[group.store.id] = notes;
  }
  if (Object.keys(changes).length) commitVoiceEdits(ctx.part, changes, null, null);
}

// The pending pitch has its note and octave: write it into the note (or turn the rest into a note)
function writePending(ctx: EditCtx, session: EditSession): void {
  const pendingPitch = session.pending!;
  const name = pendingPitch.letter! + (pendingPitch.acc ?? '');
  const octave = pendingPitch.octave!;
  session.pending = null;
  session.selected = pitchKey(name, octave);
  rewriteNotes(ctx, note => (note.isRest ? { names: [name], octaves: [octave] } : addPitchToNote(note, name, octave)));
}

// A click in the Note / Accidental / Octave rows
function handlePitchRowClick(kind: PitchKind, value: string): void {
  const ctx = getEditContext();
  if (!ctx) return;

  if (!ctx.multi && logicalNoteCount(ctx.notes) === 1) {
    const session = ensureSession(ctx);

    // Building a new pitch: a rest has no pitch yet, so clicking a row starts one
    if (session.pending || !firstPitched(ctx)) {
      const pendingPitch = session.pending ?? (session.pending = { letter: null, acc: null, octave: null });
      if (kind === 'letter') pendingPitch.letter = value;
      else if (kind === 'acc') pendingPitch.acc = value;
      else pendingPitch.octave = Number(value);

      if (pendingPitch.letter !== null && pendingPitch.octave !== null) writePending(ctx, session);   // accidental is optional (natural)
      else scheduleEditRefresh();
      return;
    }

    const targets = session.selected ? [session.selected] : [];
    let newKey = session.selected;
    rewriteNotes(ctx, note => {
      const result = editNotePitches(note, targets, kind, kind === 'octave' ? Number(value) : value);
      newKey = result.newKeys[0] ?? newKey;
      return result.set;
    });
    session.selected = newKey;
    return;
  }

  // Several notes, or several voices: edit every pitch of every pitched note
  rewriteNotes(ctx, note => (note.isRest ? null : editNotePitches(note, null, kind, kind === 'octave' ? Number(value) : value).set));
}

function handlePitchButton(key: string): void {
  const ctx = getEditContext();
  if (!ctx) return;
  const session = ensureSession(ctx);
  session.pending = null;
  session.selected = key;
  scheduleEditRefresh();
}

function handleAddPitch(): void {
  const ctx = getEditContext();
  if (!ctx || ctx.multi || logicalNoteCount(ctx.notes) !== 1) return;
  ensureSession(ctx).pending = { letter: null, acc: null, octave: null };
  scheduleEditRefresh();
}

// A click on the Voice row: move the selected note(s) to that voice
function handleVoiceMove(destId: VoiceId): void {
  const ctx = getEditContext();
  if (!ctx || ctx.multi) return;
  const result = moveToVoiceEdit(ctx.part, ctx.store.id, destId, ctx.sel.start, ctx.sel.end, notesDuration(ctx.store.unprocessedNotes));
  if (!result) return;
  commitVoiceEdits(ctx.part, result.changes, {
    ...result.selection, base: { start: result.selection.start, end: result.selection.end },
  }, result.newTotal);
}

function handleEditClick(kind: EditKind, value: string): void {
  const ctx = getEditContext();
  if (!ctx) return;
  if (kind === 'duration' || kind === 'dot') applyDurationEdit(ctx, kind, value);
  else handlePitchRowClick(kind, value);
}

// Delete: cancels a pending pitch, removes the selected pitches, or makes the note a rest
// Edit tab Delete: every selected note becomes rests, merged with the rests beside it. A tuplet goes whole.
function deleteSelectedToRests(ctx: EditCtx): void {
  const changes: Partial<Record<VoiceId, UnprocessedNote[]>> = {};
  for (const group of ctx.groups) {
    const src = group.store.unprocessedNotes;
    const hit = new Set<number>(group.entries.map(entry => entry.index));
    const out: UnprocessedNote[] = [];
    const fresh: boolean[] = [];
    let pos = 0;
    let changed = false;
    for (let itemIndex = 0; itemIndex < src.length;) {
      const note = src[itemIndex];
      if (note.tupletInfo) {
        let runEnd = itemIndex;
        while (runEnd < src.length - 1 && src[runEnd].tupletInfo && src[runEnd].tupletInfo!.index !== src[runEnd].tupletInfo!.count) runEnd++;
        const total = src[runEnd].tupletInfo!.totalTupletDuration;
        let any = false;
        for (let runIndex = itemIndex; runIndex <= runEnd; runIndex++) if (hit.has(runIndex)) any = true;
        if (any) {
          for (const rest of fillDurationWithRests(total, pos)) { out.push(rest); fresh.push(true); }
          changed = true;
        } else {
          for (let sourceIndex = itemIndex; sourceIndex <= runEnd; sourceIndex++) { out.push(src[sourceIndex]); fresh.push(false); }
        }
        pos = round(pos + total);
        itemIndex = runEnd + 1;
        continue;
      }
      if (hit.has(itemIndex) && !note.isRest) {
        out.push(makeRest(note.duration, note.dotted));
        fresh.push(true);
        changed = true;
      } else {
        out.push(note);
        fresh.push(false);
      }
      pos = round(pos + getNoteDuration(note));
      itemIndex++;
    }
    if (changed) changes[group.store.id] = coalesceRests(out, index => fresh[index]);
  }
  if (Object.keys(changes).length) commitVoiceEdits(ctx.part, changes, null, null);
}

function deleteAtSelection(): void {
  const ctx = getEditContext();
  if (!ctx) return;

  if (!ctx.multi && logicalNoteCount(ctx.notes) === 1) {
    const session = ensureSession(ctx);
    if (session.pending) { session.pending = null; scheduleEditRefresh(); return; }
    const note = firstPitched(ctx);
    if (!note) return;

    const keys = notePitchKeys(note);
    if (keys.length <= 1 || !session.selected) { deleteSelectedToRests(ctx); return; }

    const removing = [session.selected];
    rewriteNotes(ctx, note => removePitchesFromNote(note, removing));
    session.selected = keys.filter(key => key !== removing[0])[0] ?? null;
    return;
  }
  deleteSelectedToRests(ctx);
}

// Kept so grid.ts's existing call still works; clicking a note again no longer cycles pitches

function buildEditMenu(): void {
  const host = document.getElementById('edit-menu');
  if (!host) return;
  host.innerHTML = '';

  const heading = (title: string) => {
    const heading = document.createElement('div');
    heading.className = 'buttonDescription';
    heading.textContent = title;
    host.appendChild(heading);
  };

  const addRow = (title: string, buttons: { label: string; kind: EditKind; value: string }[]) => {
    heading(title);
    const row = document.createElement('div');
    row.className = 'row';
    for (const button of buttons) {
      const el = document.createElement('button');
      el.className = 'editBtn';
      el.textContent = button.label;
      el.dataset.kind = button.kind;
      el.dataset.value = button.value;
      el.disabled = true;
      el.addEventListener('click', () => { handleEditClick(button.kind, button.value); el.blur(); });
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

  addRow('Note', LETTERS.map(letter => ({ label: letter, kind: 'letter' as EditKind, value: letter })));
  addRow('Accidental', ACC_BUTTONS.map(accidental => ({ label: ACC_GLYPH[accidental], kind: 'acc' as EditKind, value: accidental })));
  addRow('Octave', OCTAVE_BUTTONS.map(octave => ({ label: String(octave), kind: 'octave' as EditKind, value: String(octave) })));
  addRow('Duration', rhythmOptions.slice().reverse().map(option => ({
    label: option.symbol, kind: 'duration' as EditKind, value: DURATION_KEYS[option.id],
  })));
  addRow('Dot', [{ label: '\u00B7', kind: 'dot', value: 'dot' }]);
}

function scheduleEditRefresh(): void {
  if (editRefreshQueued) return;
  editRefreshQueued = true;
  requestAnimationFrame(refreshEditMenu);
}

function pitchLabel(name: string, octave: number): string {
  const { letter, acc } = parsePitchName(name);
  return `${letter}${acc === '' ? '' : ACC_GLYPH[acc]}${octave}`;
}

function refreshEditMenu(): void {
  editRefreshQueued = false;
  const host = document.getElementById('edit-menu');
  const pitchRow = document.getElementById('pitchRow');
  const voiceRow = document.getElementById('voiceRow');
  if (!host || !pitchRow || !voiceRow) return;
  const buttons = host.querySelectorAll<HTMLButtonElement>('.editBtn');
  pitchRow.innerHTML = '';
  voiceRow.innerHTML = '';

  const ctx = getEditContext();

  // The Voice row: which voice the selection is in, and where it can move to
  for (const def of VOICE_DEFS) {
    const button = document.createElement('button');
    button.className = 'voiceBtn';
    button.textContent = def.label;
    const here = !!ctx && !ctx.multi && ctx.store.id === def.id;
    const canMove = !!ctx && !ctx.multi && !here &&
      moveToVoiceEdit(ctx.part, ctx.store.id, def.id, ctx.sel.start, ctx.sel.end, notesDuration(ctx.store.unprocessedNotes)) !== null;
    button.classList.toggle('active', here);
    button.disabled = !ctx || (!here && !canMove);
    if (canMove) button.addEventListener('click', () => { handleVoiceMove(def.id); button.blur(); });
    voiceRow.appendChild(button);
  }

  if (!ctx) {
    buttons.forEach(button => { button.classList.remove('active'); button.disabled = true; });
    return;
  }

  const staff = ctx.part;
  const single = !ctx.multi && logicalNoteCount(ctx.notes) === 1;
  const note = firstPitched(ctx);

  // What the Note / Accidental / Octave rows show and whether they can be used
  let litLetter: string | null = null;
  let litAcc: string | null = null;
  let litOct: number | null = null;
  let canEditPitch = false;

  if (single) {
    const session = ensureSession(ctx);
    canEditPitch = true;

    if (session.pending) {
      litLetter = session.pending.letter;
      litAcc = session.pending.acc;
      litOct = session.pending.octave;
    } else if (note) {
      const targets = session.selected ? [targetFromKey(session.selected)] : [];
      litLetter = commonValue(targets.map(target => target.letter));
      litAcc = commonValue(targets.map(target => target.acc));
      litOct = commonValue(targets.map(target => target.octave));
    }

    // The pitch row: the note's pitches (red when out of key), the pending pitch, and "+"
    if (note) {
      for (const key of notePitchKeys(note)) {
        const parsed = parsePitchString(key);
        const pitchButton = document.createElement('button');
        pitchButton.className = 'pitchBtn';
        pitchButton.textContent = pitchLabel(parsed.name, parsed.octave);
        if (session.selected === key && !session.pending) pitchButton.classList.add('active');
        if (pitchIsOutOfKey(staff, parsed.name, parsed.octave, ctx.sel.start)) pitchButton.classList.add('bad');
        pitchButton.addEventListener('click', () => { handlePitchButton(key); pitchButton.blur(); });
        pitchRow.appendChild(pitchButton);
      }
    }
    if (session.pending) {
      const pendingPitch = session.pending;
      const pendingButton = document.createElement('button');
      pendingButton.className = 'pitchBtn pending active';
      pendingButton.textContent = `${pendingPitch.letter ?? '\u00B7'}${pendingPitch.acc ? ACC_GLYPH[pendingPitch.acc] : ''}${pendingPitch.octave ?? '\u00B7'}`;
      pitchRow.appendChild(pendingButton);
    }
    const add = document.createElement('button');
    add.className = 'pitchBtn pitchAdd';
    add.textContent = '+';
    add.addEventListener('click', () => { handleAddPitch(); add.blur(); });
    pitchRow.appendChild(add);
  } else {
    const pitchTargets: PitchTarget[] = [];
    for (const editNote of ctx.notes) {
      if (editNote.isRest) continue;
      editNote.noteName.forEach((nm, index) => {
        const parsed = parsePitchName(nm);
        pitchTargets.push({ letter: parsed.letter, acc: parsed.acc, octave: editNote.octaves[index] });
      });
    }
    canEditPitch = pitchTargets.length > 0;
    litLetter = commonValue(pitchTargets.map(target => target.letter));
    litAcc = commonValue(pitchTargets.map(target => target.acc));
    litOct = commonValue(pitchTargets.map(target => target.octave));
  }

  // Duration / dot come from the logical notes (the nominal value for tuplet notes)
  let keys: (string | null)[];
  if (ctx.notes.some(note => note.tupletInfo)) {
    keys = ctx.notes.map(note => getDurationKeyFromValue(getNoteDuration(note)));
  } else {
    const cells = buildCells(ctx.store.unprocessedNotes);
    keys = selectedCellIndices(cells, ctx.sel.start, ctx.sel.end).map(index => cellKey(cells[index]));
  }
  const known = !ctx.multi && keys.length > 0 && keys.every(key => key !== null);
  const litBase = known ? commonValue(keys.map(key => key!.replace(/d$/, ''))) : null;
  const litDot = known ? commonValue(keys.map(key => key!.endsWith('d'))) : null;

  buttons.forEach(button => {
    const kind = button.dataset.kind as EditKind;
    const value = button.dataset.value!;
    let on = false;
    let enabled = false;

    if (kind === 'letter') {
      on = litLetter !== null && litLetter === value;
      enabled = canEditPitch;
    } else if (kind === 'acc') {
      on = litAcc !== null && litAcc === value;
      enabled = canEditPitch;
    } else if (kind === 'octave') {
      on = litOct !== null && litOct === Number(value);
      enabled = canEditPitch;
    } else if (kind === 'duration') {
      on = litBase === value;
      enabled = computeDurationEdit(ctx, 'duration', value) !== null;
    } else {
      on = litDot === true;
      enabled = computeDurationEdit(ctx, 'dot', value) !== null;
    }
    button.classList.toggle('active', on);
    button.disabled = !enabled;
  });
}
