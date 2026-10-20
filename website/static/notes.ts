////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Notes: durations, measures and time signatures, rests, processNotes, undo memory, pitch spelling
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

function getNoteDuration(note: UnprocessedNote): number {
  const dur = note.dotted ? note.duration + "d" : note.duration;
  return durationMapping[dur];
}

function getDurationString(note: UnprocessedNote): string | null {
  const frac = getNoteDuration(note);
  for (const [durStr, value] of Object.entries(durationMapping)) {
    if (Math.abs(value - frac) < 1e-6) return durStr;
  }
  return null;
}

function getAllowedPitches(staff: Staff, noteDuration: number): string[] {
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
    if (!staffHarmony || !staffHarmony.unprocessedNotes.length) return scalePitches;

    let durationSearched = 0;
    let currentChord: UnprocessedNote | null = null;
    for (let index = 0; index < staffHarmony.unprocessedNotes.length; ++index) {
      currentChord = staffHarmony.unprocessedNotes[index];
      durationSearched += durationMapping[currentChord.duration];
      if (durationSearched <= totalDuration && index + 1 < staffHarmony.unprocessedNotes.length) continue;
      const currentOverlap = durationSearched - totalDuration;
      const nextOverlap = noteDuration - currentOverlap;
      if (nextOverlap > currentOverlap && index + 1 < staffHarmony.unprocessedNotes.length) {
        currentChord = staffHarmony.unprocessedNotes[index + 1];
      }
      if (currentChord.isRest) return [];
      const chordClasses = new Set(currentChord.noteName.map(pitchClassOf));
      return scalePitches.filter(pitch => chordClasses.has(pitchClassOf(pitch.slice(0, -1))));
    }
  }
  return scalePitches;
}

function getNoteDurationInSeconds(staff: Staff, note: UnprocessedNote): number {
  const bpm = parseFloat(bpmSlider.value) || 120;
  const quarterNoteSeconds = 60 / bpm;
  let durationInWholeNotes = getNoteDuration(note);
  if (note.tupletInfo) {
    const { ratio } = note.tupletInfo;
    durationInWholeNotes = durationInWholeNotes * ratio[1] / ratio[0];
  }
  return durationInWholeNotes * 4 * quarterNoteSeconds;
}

function checkNoteInScale(note: UnprocessedNote, staff: Staff): boolean {
  if (note.isRest) return true;
  const canon = canonicalPitch(note.noteName[0], note.octaves[0]);
  const interval = (noteMapping[canon.name] - noteMapping[staff.scale[0]] + 12) % 12;
  return scalesMapping[staff.scale[1]].includes(interval);
}

function randomPitchFromScale(staff: Staff, noteDuration: number, allowRest: boolean = true): [string, number] {
  const scalePitches = getAllowedPitches(staff, noteDuration);
  if (allowRest && (!scalePitches.length || Math.random() < 0.2)) return ["Rest", 4];
  const pick = scalePitches[Math.floor(Math.random() * scalePitches.length)];
  return [pick.slice(0, -1), parseInt(pick.slice(-1), 10)];
}

function createNote(noteNames: string[], noteOctaves: number | number[], noteDuration: string): any {
  let keys: string[] = [];
  let accidentals: string[] = [];
  let durationInfo = noteDuration;

  if (noteNames[0] === "Rest") {
    keys = ["B/4"];
    durationInfo = noteDuration + "r";
  } else {
    const entries = noteNames.map((name, index) => {
      const { letter, acc } = parsePitchName(name);
      const octave = Array.isArray(noteOctaves) ? (noteOctaves[index] ?? noteOctaves[0]) : noteOctaves;
      return { letter, acc, octave };
    });
    entries.sort((first, second) => staffPosition(first.letter, first.octave) - staffPosition(second.letter, second.octave));
    keys = entries.map(entry => `${entry.letter}/${entry.octave}`);
    accidentals = entries.map(entry => entry.acc);
  }

  const note = new StaveNote({ keys, duration: durationInfo });
  accidentals.forEach((acc, index) => { if (acc !== '') note.addModifier(new Accidental(acc), index); });

  if (noteDuration.includes("d")) {
    note.dotted = true;
    Dot.buildAndAttach([note], { all: true });
  }
  return note;
}

// Like fillDurationAsUnprocessed, but as VexFlow notes (each remembers its length in `_dur`)
function fillDuration(duration: number, source: UnprocessedNote): any[] {
  return fillDurationAsUnprocessed(duration, source).map(piece => {
    const note = piece.toStaveNote();
    note._dur = getNoteDuration(piece);
    return note;
  });
}

function toneNamesFor(note: UnprocessedNote): string[] | null {
  if (note.isRest) return null;
  return note.noteName.map((nm, index) => toToneName(nm, note.octaves[index]));
}

function round(val: number): number {
  return Math.round(val * 1e9) / 1e9;
}

// A tie is only valid between two pitched, non-tuplet notes with identical pitch.
function sanitizeTies(notes: UnprocessedNote[]): void {
  for (let index = 0; index < notes.length; index++) {
    const note = notes[index];
    if (!note.tiedToNext) continue;
    const next = notes[index + 1];
    const valid = !!next && !note.isRest && !next.isRest && !note.tupletInfo && !next.tupletInfo &&
      samePitches(note, next);
    if (!valid) note.tiedToNext = false;
  }
}

// Every measure has its own time signature. `groups` is how its beats are grouped, in units of 1/den and adding up
// to num (7/8 as 2+2+3 is [2, 2, 3]). Beams, and the rests written to fill a measure, follow the groups.
interface MeasureSig {
  num: number;
  den: number;
  groups: number[];
}

// The usual grouping of a time signature: a group per beat in simple time, threes in compound time (6/8 = 3+3),
// and twos and a three in odd meters (5/8 = 2+3, 7/8 = 2+2+3)
function defaultGroups(num: number, den: number): number[] {
  if (den <= 4) return Array(num).fill(1);
  if (num <= 3) return [num];
  if (num % 3 === 0) return Array(num / 3).fill(3);
  if (num % 2 === 0) return Array(num / 2).fill(2);
  return [...Array((num - 3) / 2).fill(2), 3];
}

function makeSig(num: number, den: number, groups?: number[]): MeasureSig {
  const ok = !!groups && groups.length > 0 && groups.every(groupSize => Number.isInteger(groupSize) && groupSize > 0) && groups.reduce((total, groupSize) => total + groupSize, 0) === num;
  return { num, den, groups: ok ? [...groups!] : defaultGroups(num, den) };
}

// The measure signatures of a saved composition (older saves have one signature for the whole piece)
function sigsFromData(data: any): MeasureSig[] {
  const valid = (sig: any): boolean => !!sig && Number.isInteger(sig.num) && sig.num >= 1 && sig.num <= 32 && [2, 4, 8, 16].includes(sig.den);
  if (Array.isArray(data.measureSigs) && data.measureSigs.length > 0 && data.measureSigs.every(valid)) {
    return data.measureSigs.map((sig: any) => makeSig(sig.num, sig.den, sig.groups));
  }
  const ts = Array.isArray(data.timeSignature) ? data.timeSignature : [4, 4];
  return [makeSig(ts[0], ts[1])];
}

// The signature of measure i (measures past the end of the list keep the last signature)
function sigOf(index: number): MeasureSig {
  return measureSigs[Math.min(Math.max(index, 0), measureSigs.length - 1)];
}

function measureLenOf(index: number): number {
  const sig = sigOf(index);
  return sig.num / sig.den;
}

// Where measure i begins, in whole notes
function measureStartOf(index: number): number {
  let time = 0;
  for (let barIndex = 0; barIndex < index; barIndex++) time += measureLenOf(barIndex);
  return round(time);
}

// The measure that contains time t (a barline belongs to the measure that starts there)
function measureIndexAt(time: number): number {
  let index = 0;
  let start = 0;
  for (;;) {
    const end = round(start + measureLenOf(index));
    if (time < end - 1e-9 || index > 100000) return index;
    start = end;
    index++;
  }
}

// The first barline after time t
function barlineAfter(time: number): number {
  return measureStartOf(measureIndexAt(time) + 1);
}

function posInMeasureAt(time: number): number {
  return round(time - measureStartOf(measureIndexAt(time)));
}

// How much room is left in the measure at time t (a whole measure if t is on a barline)
function spaceToBarline(time: number): number {
  return round(barlineAfter(time) - time);
}

// The length of the whole piece, in whole notes
function totalLength(): number {
  return measureStartOf(numMeasures);
}

// How many measures it takes to hold `total` whole notes
function measuresCovering(total: number): number {
  let index = 0;
  let time = 0;
  while (time < total - 1e-9 && index < 100000) { time = round(time + measureLenOf(index)); index++; }
  return index;
}

// One signature per measure: extra entries go, missing ones repeat the last signature
function normalizeSigs(): void {
  const count = Math.max(1, numMeasures);
  const last = measureSigs[measureSigs.length - 1];
  const next = measureSigs.slice(0, count);
  while (next.length < count) next.push({ ...last, groups: [...last.groups] });
  measureSigs = next;
}

function sigsForSave(): MeasureSig[] {
  normalizeSigs();
  return measureSigs.map(sig => ({ num: sig.num, den: sig.den, groups: [...sig.groups] }));
}

// A signature is written at the start of the piece and wherever it changes
function sigShownAt(index: number): boolean {
  if (index <= 0) return true;
  const previous = sigOf(index - 1);
  const current = sigOf(index);
  return previous.num !== current.num || previous.den !== current.den;
}

// Where the beat groups of a measure begin, in whole notes from its barline, ending with the measure's length
function groupCuts(index: number): number[] {
  const sig = sigOf(index);
  const cuts = [0];
  let acc = 0;
  for (const group of sig.groups) { acc += group; cuts.push(round(acc / sig.den)); }
  if (acc !== sig.num) return [0, round(sig.num / sig.den)];
  return cuts;
}

// The groups in the form VexFlow's beaming wants
function beamGroups(index: number): any[] {
  const sig = sigOf(index);
  return sig.groups.map(group => new Vex.Flow.Fraction(group, sig.den));
}

// Where processNotes has got to while it fills measures one note at a time
interface MeasureFill {
  staff: NoteStore;
  measure: any[];            // VexFlow notes of the measure being filled
  pos: number;               // how far into that measure we are
  tuplet: any[];             // notes of the tuplet being collected
  tupletStart: number;       // absolute position where that tuplet began
  tie: any[];                // notes of the tie being collected
  tieHead: number;           // index in toneNotes of the note a tie is continuing, so tied notes sound once
}

function measureLength(fill: MeasureFill): number {
  return measureLenOf(fill.staff.notes.length);
}

function measureStart(fill: MeasureFill): number {
  return measureStartOf(fill.staff.notes.length);
}

// Close the measure being filled and start the next one
function finishMeasure(fill: MeasureFill, carry: number = 0): void {
  if (fill.measure.length > 0) fill.staff.notes.push([...fill.measure]);
  fill.measure = [];
  fill.pos = carry;
}

function addTupletNote(fill: MeasureFill, source: UnprocessedNote, note: any): void {
  const { id, totalTupletDuration, ratio, count, index } = source.tupletInfo!;
  const staff = fill.staff;

  if (index === 1) fill.tupletStart = round(measureStart(fill) + fill.pos);
  const perNote = totalTupletDuration / count;
  noteTiming.set(note, { start: round(fill.tupletStart + (index - 1) * perNote), dur: perNote, tupletId: id });

  fill.tuplet.push(note);
  fill.measure.push(note);
  staff.toneNotes.push([toneNamesFor(source), getNoteDuration(source) * ratio[1] / ratio[0]]);
  fill.tieHead = -1;

  if (index !== count) return;
  const vfTuplet = new Tuplet(fill.tuplet, { num_notes: ratio[0], notes_occupied: ratio[1], ratioed: true });
  staff.tuplets.push({ tupletNotes: [...fill.tuplet], vfTuplet, realDuration: totalTupletDuration });
  fill.pos = round(fill.pos + totalTupletDuration);
  fill.tuplet = [];

  if (fill.pos >= measureLength(fill) - 1e-9) {
    const len = measureLength(fill);
    finishMeasure(fill, round(Math.max(0, fill.pos - len)));
  }
}

// A note too long for what is left of the measure: split it over the barlines and tie the pieces
function addNoteAcrossBarline(fill: MeasureFill, source: UnprocessedNote, note: any, noteDur: number): void {
  const room = round(measureLength(fill) - fill.pos);
  let overflow = round(noteDur - room);
  const pieces: any[] = [...fill.tie];
  fill.tie = [];

  const first = fillDuration(room, source);
  stampSequence(first, round(measureStart(fill) + fill.pos));
  fill.measure.push(...first);
  pieces.push(...first);
  finishMeasure(fill);

  while (overflow >= measureLength(fill) - 1e-9) {
    const len = measureLength(fill);
    const wholeMeasure = fillDuration(len, source);
    stampSequence(wholeMeasure, measureStart(fill));
    pieces.push(...wholeMeasure);
    fill.staff.notes.push([...wholeMeasure]);
    overflow = round(overflow - len);
  }

  if (overflow > 1e-9) {
    const tail = fillDuration(overflow, source);
    stampSequence(tail, measureStart(fill));
    fill.measure.push(...tail);
    pieces.push(...tail);
    fill.pos = overflow;
  }

  if (note.isRest()) return;
  if (source.tiedToNext) fill.tie = pieces;   // the tie continues into the next note
  else fill.staff.ties.push(pieces);
}

function addNoteInMeasure(fill: MeasureFill, source: UnprocessedNote, note: any, noteDur: number): void {
  if (source.tiedToNext && !source.isRest) {
    fill.tie.push(note);
  } else if (fill.tie.length > 0 && !source.isRest) {
    fill.tie.push(note);
    fill.staff.ties.push([...fill.tie]);
    fill.tie = [];
  } else {
    fill.tie = [];
  }

  noteTiming.set(note, { start: round(measureStart(fill) + fill.pos), dur: noteDur, tupletId: null });
  fill.measure.push(note);
  fill.pos = round(fill.pos + noteDur);
  if (fill.pos >= measureLength(fill) - 1e-9) finishMeasure(fill);
}

// A note tied from the one before only lengthens it; it is not played again
function addSoundingNote(fill: MeasureFill, source: UnprocessedNote, noteDur: number): void {
  const toneNotes = fill.staff.toneNotes;
  if (fill.tieHead >= 0) toneNotes[fill.tieHead][1] = round(toneNotes[fill.tieHead][1] + noteDur);
  else toneNotes.push([toneNamesFor(source), noteDur]);

  if (source.tiedToNext && !source.isRest) {
    if (fill.tieHead < 0) fill.tieHead = toneNotes.length - 1;
  } else {
    fill.tieHead = -1;
  }
}

// Turn the notes into VexFlow notes, one array per measure, with their ties, tuplets and playback notes
function processNotes(staff: NoteStore, unprocessedNotes: UnprocessedNote[]): void {
  sanitizeTies(unprocessedNotes);
  const fill: MeasureFill = { staff, measure: [], pos: 0, tuplet: [], tupletStart: 0, tie: [], tieHead: -1 };

  for (const source of unprocessedNotes) {
    // move on to the next measure if this one is already full
    while (fill.pos >= measureLength(fill) - 1e-9) {
      const len = measureLength(fill);
      finishMeasure(fill, round(Math.max(0, fill.pos - len)));
    }

    staff.unprocessedNotes.push(source);
    const note = source.toStaveNote();

    if (source.tupletInfo) {
      addTupletNote(fill, source, note);
      continue;
    }
    const noteDur = getNoteDuration(source);
    if (round(fill.pos + noteDur) > measureLength(fill)) addNoteAcrossBarline(fill, source, note, noteDur);
    else addNoteInMeasure(fill, source, note, noteDur);
    addSoundingNote(fill, source, noteDur);
  }

  if (fill.tie.length > 1) staff.ties.push([...fill.tie]);
  finishMeasure(fill);
}

function resetStaff(staff: Staff): void {
  staff.unprocessedNotes = [];
  staff.notes = [];
  staff.ties = [];
  staff.tuplets = [];
  staff.toneNotes = [];
  staff.duration = 0;
}

function snapshotNotes(notes: UnprocessedNote[]): MemorySnapshot[] {
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

function notesFromSnapshot(snapshot: MemorySnapshot[]): UnprocessedNote[] {
  return snapshot.map(sig => {
    const note = new UnprocessedNote([...sig.noteName], sig.octaves, sig.duration, sig.dotted, sig.tiedToNext);
    if (sig.tupletInfo) note.tupletInfo = { ...sig.tupletInfo };
    return note;
  });
}

function snapshotStaffNotes(staff: Staff): StaffSnapshot {
  const snap: StaffSnapshot = {};
  for (const voice of staffVoices(staff)) {
    if (voice.id === 'up1' || voice.unprocessedNotes.length > 0) snap[voice.id] = snapshotNotes(voice.unprocessedNotes);
  }
  return snap;
}

function updateMemory(): void {
  globalMemory.splice(globalMemoryIndex + 1);

  const snapshot: GlobalSnapshot = {
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

  if (typeof saveToLocalStorage === 'function') saveToLocalStorage();
}

function restoreStaffFromSnapshot(staff: Staff, snapshot: StaffSnapshot): void {
  staff.extraVoices = [];
  resetStaff(staff);
  processNotes(staff, notesFromSnapshot(snapshot['up1'] ?? []));

  for (const def of VOICE_DEFS) {
    if (def.id === 'up1' || !snapshot[def.id]) continue;
    const voice = getOrCreateVoice(staff, def.id);
    resetVoice(voice);
    processNotes(voice, notesFromSnapshot(snapshot[def.id]));
  }
}

function accessMemory(indexDifference: number): void {
  const newIdx = globalMemoryIndex + indexDifference;
  if (newIdx < 0 || newIdx >= globalMemory.length) return;
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

// The longest note value that fits in `room` (a whole note is 1)
function largestFitting(room: number): [string, number] | undefined {
  return durationsLargestFirst.find(([, value]) => value <= room + 1e-9);
}

// A rest of the given length
function makeRest(duration: string, dotted: boolean = false): UnprocessedNote {
  return new UnprocessedNote(['Rest'], 4, duration, dotted);
}

// A length of time written as note values of `source`'s pitches, largest first and tied together
// (or as rests, if the source is a rest)
function fillDurationAsUnprocessed(duration: number, source: UnprocessedNote): UnprocessedNote[] {
  const pieces: UnprocessedNote[] = [];
  let remaining = duration;
  while (remaining > 1e-9) {
    const fit = largestFitting(remaining);
    if (!fit) break;
    const [key, value] = fit;
    pieces.push(source.isRest ? makeRest(key) : new UnprocessedNote([...source.noteName], [...source.octaves], key, false, true));
    remaining = round(remaining - value);
  }
  if (pieces.length > 0) pieces[pieces.length - 1].tiedToNext = false;
  return pieces;
}

// How long a list of notes lasts (a tuplet counts once, on its last note)
function notesDuration(notes: UnprocessedNote[]): number {
  let total = 0;
  for (const note of notes) {
    if (!note.tupletInfo) total += getNoteDuration(note);
    else if (note.tupletInfo.index === note.tupletInfo.count) total += note.tupletInfo.totalTupletDuration;
  }
  return round(total);
}

// Stamps a run of notes made by fillDuration() (each carries its own _dur).
function stampSequence(notes: any[], start: number): void {
  let time = start;
  for (const note of notes) {
    noteTiming.set(note, { start: time, dur: note._dur, tupletId: null });
    time = round(time + note._dur);
  }
}

  function getUnprocessedTimeline(notes: UnprocessedNote[]): UnprocessedTimingEntry[] {
    const timeline: UnprocessedTimingEntry[] = [];
    let time = 0;
    let tupletStart = 0;

    notes.forEach((note, index) => {
      if (note.tupletInfo) {
        const { totalTupletDuration, count, index: tIndex, id } = note.tupletInfo;
        if (tIndex === 1) tupletStart = time;
        const perNote = totalTupletDuration / count;
        timeline.push({ start: round(tupletStart + (tIndex - 1) * perNote), dur: perNote, tupletId: id, index });
        if (tIndex === count) time = round(tupletStart + totalTupletDuration);
      } else {
        const dur = getNoteDuration(note);
        timeline.push({ start: time, dur, tupletId: null, index });
        time = round(time + dur);
      }
    });

    return timeline;
  }

function cloneNotes(notes: UnprocessedNote[]): UnprocessedNote[] {
  return notes.map(note => {
    const copy = new UnprocessedNote([...note.noteName], [...note.octaves], note.duration, note.dotted, note.tiedToNext);
    if (note.tupletInfo) copy.tupletInfo = { ...note.tupletInfo };
    return copy;
  });
}

function renumberTuplets(notes: UnprocessedNote[]): void {
  let id = 0;
  for (const note of notes) {
    if (!note.tupletInfo) continue;
    if (note.tupletInfo.index === 1) id++;
    note.tupletInfo = { ...note.tupletInfo, id };
  }
}

// True if any tuplet starting inside [rangeStart, rangeEnd) crosses a barline.
function tupletCrossesBarline(notes: UnprocessedNote[], rangeStart: number, rangeEnd: number): boolean {
  const timeline = getUnprocessedTimeline(notes);
  let groupStart = 0;
  for (const piece of timeline) {
    const info = notes[piece.index].tupletInfo;
    if (!info) continue;
    if (info.index === 1) groupStart = piece.start;
    if (info.index === info.count) {
      if (groupStart < rangeStart - 1e-9 || groupStart >= rangeEnd - 1e-9) continue;
      const end = round(piece.start + piece.dur);
      const startMeasure = measureIndexAt(groupStart);
      const endMeasure = measureIndexAt(round(end - 1e-6));
      if (startMeasure !== endMeasure) return true;
    }
  }
  return false;
}

// What a transform would do to one voice's part of a selection: the voice's new notes, or null if it can't be done
// Rests for [startPos, startPos + duration), written the way they are read: the largest first, never across a
// barline, and each one starting where a rest of its size belongs (a half rest on beat 1 or 3, never on beat 2)
// barline, and following the measure's beat groups. A rest stays inside one group, or covers whole groups from
// one group's start to another's end. In simple time (2/2, 3/4, 4/4...) a rest also starts where one of its
// size belongs: a half rest on beat 1 or 3, never on beat 2.
// Rests for [startPos, startPos + duration): the largest that fit, never across a barline, and following the
// measure's beat groups. A rest stays inside one group, or runs from the start of one group to the end of another.
// In simple time (2/2, 3/4, 4/4...) a rest also starts where one of its size belongs: a half rest on beat 1 or 3,
// never on beat 2.
function fillDurationWithRests(duration: number, startPos: number = 0): UnprocessedNote[] {
  const rests: UnprocessedNote[] = [];
  let remaining = round(duration);
  let pos = round(startPos);

  while (remaining > 1e-9) {
    const bar = measureIndexAt(pos);
    const into = round(pos - measureStartOf(bar));
    const room = Math.min(remaining, spaceToBarline(pos));
    const cuts = groupCuts(bar);
    const simpleTime = sigOf(bar).den <= 4;
    const atCut = (xPos: number): boolean => cuts.some(cut => Math.abs(cut - xPos) < 1e-9);

    const fitsGroups = (value: number): boolean => {
      const end = round(into + value);
      const wholeMeasure = into < 1e-9 && Math.abs(end - cuts[cuts.length - 1]) < 1e-9;
      const insideOneGroup = cuts.some((cut, cutIndex) => cutIndex < cuts.length - 1 && into >= cut - 1e-9 && end <= cuts[cutIndex + 1] + 1e-9);
      return wholeMeasure || insideOneGroup || (atCut(into) && atCut(end));
    };
    const startsWhereItBelongs = (key: string, value: number): boolean => {
      const unit = key.endsWith('d') ? value * 4 / 3 : value;
      return Math.abs(into / unit - Math.round(into / unit)) < 1e-6;
    };

    const pick = durationsLargestFirst.find(([key, value]) =>
      value <= room + 1e-9 && fitsGroups(value) && (!simpleTime || startsWhereItBelongs(key, value))
    ) ?? largestFitting(room);
    if (!pick) break;

    rests.push(makeRest(pick[0]));
    remaining = round(remaining - pick[1]);
    pos = round(pos + pick[1]);
  }
  return rests;
}

// Merges every run of plain rests that contains a "fresh" one (fresh(index, start, end)) into the fewest natural
// rests, so deleted notes leave one tidy rest instead of a copy of each note's length. Rests inside a tuplet stay.
function coalesceRests(notes: UnprocessedNote[], fresh: (index: number, start: number, end: number) => boolean): UnprocessedNote[] {
  const starts: number[] = [];
  const ends: number[] = [];
  let pos = 0;
  for (const note of notes) {
    const duration = note.tupletInfo ? note.tupletInfo.totalTupletDuration / note.tupletInfo.count : getNoteDuration(note);
    starts.push(round(pos));
    pos = round(pos + duration);
    ends.push(pos);
  }
  const plain = (note: UnprocessedNote): boolean => note.isRest && !note.tupletInfo;
  const out: UnprocessedNote[] = [];
  let itemIndex = 0;
  while (itemIndex < notes.length) {
    if (!plain(notes[itemIndex])) { out.push(notes[itemIndex]); itemIndex++; continue; }
    let runEnd = itemIndex;
    while (runEnd < notes.length && plain(notes[runEnd])) runEnd++;
    let any = false;
    for (let runIndex = itemIndex; runIndex < runEnd; runIndex++) if (fresh(runIndex, starts[runIndex], ends[runIndex])) any = true;
    if (any) out.push(...fillDurationWithRests(round(ends[runEnd - 1] - starts[itemIndex]), starts[itemIndex]));
    else out.push(...notes.slice(itemIndex, runEnd));
    itemIndex = runEnd;
  }
  return out;
}

// What deleting these notes leaves behind: a rest for each note, and for a tuplet one set of ordinary rests (the
// tuplet itself goes). The rests are merged afterwards by computeRangeEdit.
function clearedToRests(notes: UnprocessedNote[], startOffset: number): UnprocessedNote[] {
  const out: UnprocessedNote[] = [];
  let pos = startOffset;
  let groupStart = startOffset;
  for (const note of notes) {
    if (note.tupletInfo) {
      if (note.tupletInfo.index === 1) groupStart = pos;
      pos = round(pos + note.tupletInfo.totalTupletDuration / note.tupletInfo.count);
      if (note.tupletInfo.index === note.tupletInfo.count) out.push(...fillDurationWithRests(note.tupletInfo.totalTupletDuration, groupStart));
    } else {
      out.push(note.isRest ? note : makeRest(note.duration, note.dotted));
      pos = round(pos + getNoteDuration(note));
    }
  }
  return out;
}

const LETTER_ORDER = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ACC_SEMITONE: Record<string, number> = { bb: -2, b: -1, '': 0, '#': 1, '##': 2 };
const FLAT_SPELLING = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

// "Db" -> { letter: 'D', acc: 'b' }, "F##" -> { letter: 'F', acc: '##' }, "C" -> { letter: 'C', acc: '' }
function parsePitchName(name: string): { letter: string; acc: string } {
  const letter = name.charAt(0).toUpperCase();
  const tail = name.slice(1);
  return { letter, acc: Object.prototype.hasOwnProperty.call(ACC_SEMITONE, tail) ? tail : '' };
}

function pitchClassOf(name: string): number {
  const { letter, acc } = parsePitchName(name);
  return (((LETTER_SEMITONE[letter] + ACC_SEMITONE[acc]) % 12) + 12) % 12;
}

// MIDI number of the sounding pitch (B#3 and C4 are both 60)
function soundingMidi(name: string, octave: number): number {
  const { letter, acc } = parsePitchName(name);
  return 12 * (octave + 1) + LETTER_SEMITONE[letter] + ACC_SEMITONE[acc];
}

// Flat-spelled equivalent: B#3 -> { name: 'C', octave: 4 }, Cb4 -> { name: 'B', octave: 3 }
function canonicalPitch(name: string, octave: number): { name: string; octave: number } {
  const midi = soundingMidi(name, octave);
  return { name: FLAT_SPELLING[((midi % 12) + 12) % 12], octave: Math.floor(midi / 12) - 1 };
}

// Name Tone.js understands (it has no double sharps), e.g. "F##3" -> "G3"
function toToneName(name: string, octave: number): string {
  const cell = canonicalPitch(name, octave);
  return cell.name + cell.octave;
}

// Vertical position on the staff (spelling matters here: B#3 sits on B3's line)
function staffPosition(name: string, octave: number): number {
  return octave * 7 + LETTER_ORDER.indexOf(parsePitchName(name).letter);
}

// "Db4" -> { name: 'Db', octave: 4 }
function parsePitchString(text: string): { name: string; octave: number } {
  return { name: text.slice(0, -1), octave: parseInt(text.slice(-1), 10) };
}

const ACC_GLYPH: Record<string, string> = { bb: '\u{1D12B}', b: '\u266D', '': '\u266E', '#': '\u266F', '##': '\u{1D12A}' };
