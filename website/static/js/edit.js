"use strict";
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Edit tab: edit engine, pitch edits, edit menu
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
function samePitches(left, right) {
    if (left.noteName.length !== right.noteName.length)
        return false;
    const key = (note) => note.noteName.map((nm, index) => `${nm}${note.octaves[index]}`).sort().join(',');
    return key(left) === key(right);
}
// Cells = whole tuplets, rests, and "logical notes" (a chain of tied same-pitch pieces is one note)
function buildCells(notes) {
    const cells = [];
    let time = 0;
    let itemIndex = 0;
    while (itemIndex < notes.length) {
        const note = notes[itemIndex];
        if (note.tupletInfo) {
            const group = [];
            const start = time;
            let total = 0;
            while (itemIndex < notes.length && notes[itemIndex].tupletInfo) {
                const info = notes[itemIndex].tupletInfo;
                group.push(notes[itemIndex]);
                total += getRealDuration(notes[itemIndex]);
                itemIndex++;
                if (info.index === info.count)
                    break;
            }
            time = round(start + total);
            cells.push({ start, end: time, notes: group, isTuplet: true, isRest: group.every(note => note.isRest) });
            continue;
        }
        const chain = [note];
        let end = round(time + getNoteDuration(note));
        itemIndex++;
        while (!note.isRest && chain[chain.length - 1].tiedToNext && itemIndex < notes.length &&
            !notes[itemIndex].tupletInfo && !notes[itemIndex].isRest && samePitches(chain[chain.length - 1], notes[itemIndex])) {
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
function cellKey(cell) {
    return getDurationKeyFromValue(round(cell.end - cell.start));
}
// New base value. By default the dot state is kept; a dotted 32nd isn't supported, so the dot is dropped.
function keyWithBase(cell, base, keepDot = true) {
    const cur = cellKey(cell);
    const dotted = keepDot && cur ? cur.endsWith('d') : false;
    if (dotted && base === '32')
        return '32';
    return base + (dotted ? 'd' : '');
}
function keyWithDot(cell, wantDot) {
    const cur = cellKey(cell);
    if (!cur)
        return null;
    const base = cur.replace(/d$/, '');
    if (wantDot && base === '32')
        return null;
    return base + (wantDot ? 'd' : '');
}
// The notes that fill [start, end) the way cell `c` does: rests, or its pitch tied across the time
function piecesFor(cell, start, end) {
    const length = round(end - start);
    if (cell.isRest)
        return fillDurationWithRests(length, start);
    const pieces = fillDurationAsUnprocessed(length, cell.notes[0]);
    if (start > cell.start + 1e-9)
        pieces.forEach(piece => { piece.articulations = []; }); // the cut-off tail of a note is not a new attack
    return pieces;
}
// A key is a note value ("q", "8d") or, for a drag, an exact length ("len:0.3125") that may need several tied notes
function keyLength(key) {
    return key.startsWith('len:') ? Number(key.slice(4)) : durationMapping[key];
}
function notesForKey(template, key) {
    if (!key.startsWith('len:'))
        return [noteWithDuration(template, key)];
    return fillDurationAsUnprocessed(round(keyLength(key)), template);
}
function noteWithDuration(template, key) {
    if (template.isRest)
        return makeRest(key);
    const note = new UnprocessedNote([...template.noteName], [...template.octaves], key, false, false);
    note.articulations = [...template.articulations];
    return note;
}
let paintReach = null; // where an overwrite into the start of a tuplet really ended (at a note of the tuplet)
// A note reaching into the start of a tuplet: the tuplet's notes it covers take over its pitch (tied on from it).
// A tuplet note it only partly covers stays as it was. Null if it doesn't reach the end of even the first one.
function coverTupletStart(cell, from, to, fresh) {
    const template = fresh[0];
    const members = [...cell.notes];
    let position = cell.start;
    let reach = cell.start;
    let coveredCount = 0;
    for (const member of members) {
        const end = round(position + getRealDuration(member));
        if (end > to + 1e-9)
            break;
        coveredCount++;
        reach = end;
        position = end;
    }
    if (!coveredCount)
        return null;
    const replaced = members.map((member, at) => {
        if (at >= coveredCount)
            return member;
        const copy = template.isRest
            ? makeRest(member.duration, member.dotted)
            : new UnprocessedNote([...template.noteName], [...template.octaves], member.duration, member.dotted, at < coveredCount - 1);
        copyTuplets(member, copy);
        return copy;
    });
    let head = null;
    if (cell.start - from > 1e-9) {
        head = fillDurationAsUnprocessed(round(cell.start - from), template);
        if (head.length && !template.isRest)
            head[head.length - 1].tiedToNext = true; // held on into the tuplet
    }
    return { head, tuplet: { ...cell, notes: replaced }, reach };
}
// Overwrites [s, e) with `fresh`. Cells partly covered are cut; a tuplet may only be removed whole
// (or, with intoTuplets, have its first notes taken over by a note that reaches into it).
function paint(cells, from, to, fresh, intoTuplets = false) {
    paintReach = null;
    if (intoTuplets) {
        const partial = cells.find(cell => cell.isTuplet && cell.start >= from - 1e-9 && cell.start < to - 1e-9 && cell.end > to + 1e-9);
        if (partial) {
            const split = coverTupletStart(partial, from, to, fresh);
            if (!split)
                return null;
            const swapped = cells.map(cell => (cell === partial ? split.tuplet : cell));
            const done = split.head ? paint(swapped, from, partial.start, split.head) : swapped;
            paintReach = split.reach;
            return done;
        }
    }
    const out = [];
    let inserted = false;
    const flush = () => {
        if (!inserted) {
            out.push({ start: from, end: to, notes: fresh, isTuplet: false, isRest: fresh[0].isRest });
            inserted = true;
        }
    };
    for (const cell of cells) {
        if (cell.end <= from + 1e-9) {
            out.push(cell);
            continue;
        }
        if (cell.start >= to - 1e-9) {
            flush();
            out.push(cell);
            continue;
        }
        if (cell.isTuplet) {
            if (cell.start >= from - 1e-9 && cell.end <= to + 1e-9)
                continue; // swallowed whole
            return null;
        }
        if (cell.start < from - 1e-9)
            out.push({ ...cell, end: from, notes: piecesFor(cell, cell.start, from) });
        flush();
        if (cell.end > to + 1e-9)
            out.push({ ...cell, start: to, notes: piecesFor(cell, to, cell.end) });
    }
    flush();
    return out;
}
function selectedCellIndices(cells, selStart, selEnd) {
    const idx = [];
    cells.forEach((cell, index) => {
        if (cell.start >= selStart - 1e-9 && cell.end <= selEnd + 1e-9)
            idx.push(index);
    });
    return idx;
}
// Overwrite: every selected note keeps its start. Time it gives up becomes rests; time it takes
// replaces what was there. Earlier notes win over later ones when they collide. Extending past
// the end grows the piece (the caller adds measures).
function overwriteEdit(cells, selStart, selEnd, total, keyFor) {
    const sel = selectedCellIndices(cells, selStart, selEnd);
    if (!sel.length || sel.some(index => cells[index].isTuplet))
        return null;
    let work = cells.map((cell, index) => sel.includes(index) ? { start: cell.start, end: cell.end, notes: fillDurationWithRests(round(cell.end - cell.start), cell.start), isTuplet: false, isRest: true } : cell);
    let newStart = Infinity;
    let newEnd = -Infinity;
    let newTotal = total; // grows when a note is extended past the current end
    for (const itemIndex of [...sel].reverse()) {
        const current = cells[itemIndex];
        const key = keyFor(current);
        if (!key)
            return null;
        const extendedEnd = round(current.start + keyLength(key));
        const freshNotes = notesForKey(current.notes[0], key);
        if (!freshNotes.length)
            return null;
        const painted = paint(work, current.start, extendedEnd, freshNotes, true);
        if (!painted)
            return null;
        work = painted;
        newStart = Math.min(newStart, current.start);
        newEnd = Math.max(newEnd, paintReach ?? extendedEnd);
        newTotal = Math.max(newTotal, extendedEnd);
    }
    return { notes: work.flatMap(cell => cell.notes), selection: { start: newStart, end: newEnd }, newTotal };
}
// Insert: the selected notes are laid end to end at their new lengths and everything after
// (rests included) moves with them. Longer = the track grows; shorter = rests pad the end.
function insertEdit(cells, selStart, selEnd, total, keyFor) {
    const sel = selectedCellIndices(cells, selStart, selEnd);
    if (!sel.length || sel.some(index => cells[index].isTuplet))
        return null;
    const first = sel[0];
    const last = sel[sel.length - 1];
    if (last - first + 1 !== sel.length)
        return null;
    const start = cells[first].start;
    let pos = start;
    let oldSpan = 0;
    const placed = [];
    for (const itemIndex of sel) {
        const cell = cells[itemIndex];
        const key = keyFor(cell);
        if (!key)
            return null;
        const made = notesForKey(cell.notes[0], key);
        if (!made.length)
            return null;
        placed.push(...made);
        pos = round(pos + keyLength(key));
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
// A pitch is identified by its spelling and octave, e.g. "Gb4" or "G#4"
function pitchKey(name, octave) {
    return `${name}${octave}`;
}
// Pitch indices of a note, highest sounding pitch first
function orderedPitchIdx(note) {
    return note.noteName
        .map((nm, index) => ({ i: index, m: soundingMidi(nm, note.octaves[index]) }))
        .sort((first, second) => second.m - first.m || first.i - second.i)
        .map(entry => entry.i);
}
// Keys of a note's pitches, highest first
function notePitchKeys(note) {
    return orderedPitchIdx(note).map(index => pitchKey(note.noteName[index], note.octaves[index]));
}
function dedupePitches(pitches) {
    const seen = new Set();
    const names = [];
    const octaves = [];
    pitches.names.forEach((nm, index) => {
        const key = pitchKey(nm, pitches.octaves[index]);
        if (seen.has(key))
            return;
        seen.add(key);
        names.push(nm);
        octaves.push(pitches.octaves[index]);
    });
    return { names, octaves };
}
// Changes one parameter of the pitches named in `targets` (null = every pitch). Nothing is
// restricted: any letter, accidental or octave is allowed. newKeys says where the edited pitches ended up.
function editNotePitches(note, targets, kind, value) {
    const names = [...note.noteName];
    const octaves = [...note.octaves];
    const newKeys = [];
    for (let index = 0; index < names.length; index++) {
        if (targets && !targets.includes(pitchKey(names[index], octaves[index])))
            continue;
        const parsed = parsePitchName(names[index]);
        let letter = parsed.letter;
        let acc = parsed.acc;
        let oct = octaves[index];
        if (kind === 'letter')
            letter = String(value);
        else if (kind === 'acc')
            acc = String(value);
        else
            oct = Math.max(0, Math.min(8, Number(value)));
        names[index] = letter + acc;
        octaves[index] = oct;
        newKeys.push(pitchKey(names[index], octaves[index]));
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
    note.noteName.forEach((nm, index) => {
        if (keys.includes(pitchKey(nm, note.octaves[index])))
            return;
        names.push(nm);
        octaves.push(note.octaves[index]);
    });
    return names.length ? { names, octaves } : null;
}
let insertMode = false; // Insert
let polyphonyMode = false; // Polyphony (reserved, nothing reads it yet). Neither = Overwrite
let editSession = null;
let editRefreshQueued = false;
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
const ACC_BUTTONS = ['bb', 'b', '', '#', '##'];
const OCTAVE_BUTTONS = [0, 1, 2, 3, 4, 5, 6, 7];
const DURATION_KEYS = { 1: 'w', 0.5: 'h', 0.25: 'q', 0.125: '8', 0.0625: '16', 0.03125: '32' };
function getEditContext(anyTab = false, onlyStaff) {
    if (!gridViewOn || (currentTab === 'create' && !anyTab))
        return null;
    const active = getActiveStaves();
    for (const name of staves) {
        if (onlyStaff !== undefined && name !== onlyStaff)
            continue;
        const sel = getSelection(name);
        if (!sel)
            continue;
        const staff = active[name];
        const groups = [];
        for (const store of selectionTargets(staff, sel)) {
            const entries = getUnprocessedTimeline(store.unprocessedNotes)
                .filter(entry => entry.start >= sel.start - 1e-9 && round(entry.start + entry.dur) <= sel.end + 1e-9);
            if (entries.length)
                groups.push({ store, entries, notes: entries.map(entry => store.unprocessedNotes[entry.index]) });
        }
        if (!groups.length)
            return null;
        return {
            part: staff, store: groups[0].store, sel,
            entries: groups.flatMap(group => group.entries), notes: groups.flatMap(group => group.notes),
            groups, multi: groups.length > 1,
        };
    }
    return null;
}
// Tied same-pitch pieces count as one note
function logicalNoteCount(notes) {
    let count = 0;
    let prev = null;
    for (const note of notes) {
        const continues = prev && prev.tiedToNext && !prev.isRest && !note.isRest && !note.tupletInfo && samePitches(prev, note);
        if (!continues)
            count++;
        prev = note;
    }
    return count;
}
function firstPitched(ctx) {
    return ctx.notes.find(note => !note.isRest) ?? null;
}
function isPitchAllowed(staff, name, octave) {
    const lo = parsePitchString(toPitchStr(staff.pitchRange[0]));
    const hi = parsePitchString(toPitchStr(staff.pitchRange[1]));
    const midi = soundingMidi(name, octave);
    if (midi < soundingMidi(lo.name, lo.octave) || midi > soundingMidi(hi.name, hi.octave))
        return false;
    const rootPc = noteMapping[staff.scale[0]];
    const scale = scalesMapping[staff.scale[1]];
    return scale.includes((((midi % 12) - rootPc) % 12 + 12) % 12);
}
function harmonyChordAt(staff, time) {
    const hv = harmonyStaves[staff.name];
    if (!hv)
        return null;
    const entry = getUnprocessedTimeline(hv.unprocessedNotes)
        .find(item => time >= item.start - 1e-9 && time < item.start + item.dur - 1e-9);
    const note = entry ? hv.unprocessedNotes[entry.index] : null;
    return note && !note.isRest ? note : null;
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
function ensureSession(ctx) {
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
    }
    else {
        const cur = editSession;
        if (!cur.selected || !keys.includes(cur.selected))
            cur.selected = keys[0] ?? null; // highest pitch
    }
    return editSession;
}
function targetFromKey(key) {
    const parsed = parsePitchString(key);
    const nameParts = parsePitchName(parsed.name);
    return { letter: nameParts.letter, acc: nameParts.acc, octave: parsed.octave };
}
function commonValue(vals) {
    return vals.length > 0 && vals.every(value => value === vals[0]) ? vals[0] : null;
}
function singleVoiceResult(result, id) {
    return result ? { changes: { [id]: result.notes }, selection: { ...result.selection, voice: id }, newTotal: result.newTotal } : null;
}
function midiPitches(note) {
    return note.noteName.map((nm, index) => soundingMidi(nm, note.octaves[index]));
}
function overlappingCells(cells, from, to) {
    return cells.filter(cell => cell.start < to - 1e-9 && cell.end > from + 1e-9);
}
// The cells of a voice that doesn't exist yet: rests all the way
function emptyVoiceCells(total) {
    return [{ start: 0, end: total, notes: fillDurationWithRests(round(total - 0), 0), isTuplet: false, isRest: true }];
}
// Turns [s, e) into rests
function clearCells(cells, start, end) {
    if (end - start < 1e-9)
        return cells;
    return paint(cells, start, end, fillDurationWithRests(round(end - start), start));
}
// Removes the given pitches from the notes inside [s, e). A note that loses every pitch becomes rests;
// a chord keeps its other pitches. Tuplets are never cut (the callers treat them as blockers).
function erasePitches(cells, from, to, remove) {
    const out = [];
    for (const cell of cells) {
        if (cell.isRest || cell.isTuplet || cell.end <= from + 1e-9 || cell.start >= to - 1e-9) {
            out.push(cell);
            continue;
        }
        const tpl = cell.notes[0];
        const keep = tpl.noteName.map((ignoredName, index) => index).filter(index => !remove.has(soundingMidi(tpl.noteName[index], tpl.octaves[index])));
        if (keep.length === tpl.noteName.length) {
            out.push(cell);
            continue;
        } // nothing shared
        const overlapStart = Math.max(cell.start, from);
        const overlapEnd = Math.min(cell.end, to);
        if (cell.start < overlapStart - 1e-9)
            out.push({ ...cell, end: overlapStart, notes: fillDurationAsUnprocessed(round(overlapStart - cell.start), tpl) });
        if (keep.length === 0) {
            out.push({ start: overlapStart, end: overlapEnd, notes: fillDurationWithRests(round(overlapEnd - overlapStart), overlapStart), isTuplet: false, isRest: true });
        }
        else {
            const reduced = new UnprocessedNote(keep.map(index => tpl.noteName[index]), keep.map(index => tpl.octaves[index]), tpl.duration, tpl.dotted, false);
            out.push({ ...cell, start: overlapStart, end: overlapEnd, notes: fillDurationAsUnprocessed(round(overlapEnd - overlapStart), reduced) });
        }
        if (cell.end > overlapEnd + 1e-9)
            out.push({ ...cell, start: overlapEnd, notes: fillDurationAsUnprocessed(round(cell.end - overlapEnd), tpl) });
    }
    return out;
}
// A note blocks another when some of its pitches would survive the other one passing over it
function blocksPitches(cell, mine) {
    if (cell.isRest)
        return false;
    if (cell.isTuplet)
        return true;
    return !midiPitches(cell.notes[0]).every(midi => mine.has(midi));
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
            const voice = getVoice(staff, id);
            work[id] = voice ? buildCells(voice.unprocessedNotes) : emptyVoiceCells(total);
        }
        return work[id];
    };
    const startCells = cellsOf(sourceId);
    const sel = selectedCellIndices(startCells, selStart, selEnd);
    if (!sel.length || sel.some(index => startCells[index].isTuplet))
        return null;
    const selected = sel.map(index => startCells[index]);
    const placed = [];
    let newTotal = total;
    for (const cell of selected) {
        const key = keyFor(cell);
        if (!key)
            return null;
        const e1 = round(cell.start + keyLength(key));
        newTotal = Math.max(newTotal, e1);
        const placedNotes = notesForKey(cell.notes[0], key);
        if (!placedNotes.length)
            return null;
        const sourceVoiceCells = cellsOf(sourceId);
        // an earlier selected note may already have overwritten this one
        const stillThere = sourceVoiceCells.some(other => !other.isTuplet && Math.abs(other.start - cell.start) < 1e-9 && Math.abs(other.end - cell.end) < 1e-9);
        if (!stillThere)
            continue;
        const overwriteHere = () => {
            const cleared = clearCells(sourceVoiceCells, cell.start, cell.end);
            const painted = cleared && paint(cleared, cell.start, e1, placedNotes);
            if (!painted)
                return false;
            work[sourceId] = painted;
            touched.add(sourceId);
            placed.push({ id: sourceId, start: cell.start, end: e1 });
            return true;
        };
        // rests, shortening and an equal length: plain overwrite
        if (cell.isRest || e1 <= cell.end + 1e-9) {
            if (!overwriteHere())
                return null;
            continue;
        }
        const mine = new Set(midiPitches(cell.notes[0]));
        const blockers = overlappingCells(sourceVoiceCells, cell.end, e1).filter(blocker => blocksPitches(blocker, mine));
        if (blockers.length === 0) {
            if (!overwriteHere())
                return null;
            continue;
        }
        // the extension would run over other notes: find a voice that is free for the whole new length
        const others = VOICE_DEFS.map(voiceDef => voiceDef.id).filter(id => id !== sourceId);
        let dest = null;
        let destCells = null;
        for (const id of others) {
            const destVoiceCells = cellsOf(id);
            if (overlappingCells(destVoiceCells, cell.start, e1).some(cell => blocksPitches(cell, mine)))
                continue;
            const painted = paint(destVoiceCells, cell.start, e1, placedNotes);
            if (painted) {
                dest = id;
                destCells = painted;
                break;
            }
        }
        if (!dest || !destCells)
            return null;
        const cleared = clearCells(sourceVoiceCells, cell.start, cell.end);
        if (!cleared)
            return null;
        work[sourceId] = erasePitches(cleared, cell.end, e1, mine); // same pitches under the extension go; others stay
        work[dest] = destCells;
        touched.add(sourceId);
        touched.add(dest);
        placed.push({ id: dest, start: cell.start, end: e1 });
    }
    if (!placed.length)
        return null;
    const mineVoice = placed.find(placement => placement.id === sourceId)?.id ?? placed[0].id;
    const group = placed.filter(placement => placement.id === mineVoice);
    const changes = {};
    for (const id of touched)
        changes[id] = work[id].flatMap(cell => cell.notes);
    return {
        changes,
        selection: { start: Math.min(...group.map(placement => placement.start)), end: Math.max(...group.map(placement => placement.end)), voice: mineVoice },
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
    const moved = idx.map(index => sourceCells[index]);
    if (moved.every(cell => cell.isRest))
        return null; // nothing to move
    const dest = getVoice(staff, destId);
    let destCells = dest ? buildCells(dest.unprocessedNotes) : emptyVoiceCells(total);
    const from = moved[0].start;
    const to = moved[moved.length - 1].end;
    if (overlappingCells(destCells, from, to).some(cell => !cell.isRest))
        return null; // not free
    let workingSource = sourceCells;
    for (const moving of moved) {
        const t2 = paint(destCells, moving.start, moving.end, moving.notes);
        const s2 = paint(workingSource, moving.start, moving.end, fillDurationWithRests(round(moving.end - moving.start), moving.start));
        if (!t2 || !s2)
            return null;
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
function shiftCellsAt(cells, position, duration) {
    const out = [];
    if (duration > 0) {
        let done = false;
        for (const cell of cells) {
            if (!done && cell.start < position - 1e-9 && cell.end > position + 1e-9) {
                if (cell.isTuplet)
                    return null;
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
        if (!done)
            out.push({ start: position, end: round(position + duration), notes: fillDurationWithRests(round(round(position + duration) - position), position), isTuplet: false, isRest: true });
        return out;
    }
    const endPos = round(position + duration);
    for (const existing of cells) {
        if (existing.end <= endPos + 1e-9 || existing.start >= position - 1e-9) {
            out.push(existing);
            continue;
        }
        const length = round(existing.end - existing.start);
        const cut = round(Math.min(existing.end, position) - Math.max(existing.start, endPos));
        if (cut >= length - 1e-9)
            continue; // entirely inside the removed time
        if (existing.isTuplet)
            return null;
        const end = round(existing.end - cut);
        out.push({ ...existing, end, notes: piecesFor(existing, existing.start, end) });
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
    const deltas = selectedCellIndices(cells, selStart, selEnd).map(index => {
        const cell = cells[index];
        return { at: cell.end, delta: round(keyLength(keyFor(cell)) - (cell.end - cell.start)) };
    }).filter(shift => Math.abs(shift.delta) > 1e-9);
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
        let notes = vc.flatMap(cell => cell.notes);
        const now = endOf(notes);
        if (now < had - 1e-9)
            notes = [...notes, ...fillDurationWithRests(round(had - now), now)]; // removed time: keep the voice's length
        changes[voice.id] = notes;
    }
    return { changes, selection: { ...own.selection, voice: sourceId }, newTotal: own.newTotal };
}
// Overwrite changes this voice only, Polyphony may also move the note into another voice, and Insert moves every voice
let blockedByBarline = false; // the last duration edit was refused because a tuplet note would have crossed a barline
function runDurationMode(ctx, cells, keyFor) {
    blockedByBarline = false;
    const store = ctx.store;
    const total = notesDuration(store.unprocessedNotes);
    const { start, end } = ctx.sel;
    const result = insertMode
        ? insertAcrossVoices(ctx.part, store.id, cells, start, end, total, keyFor)
        : polyphonyMode
            ? polyphonyEdit(ctx.part, store.id, start, end, total, keyFor)
            : singleVoiceResult(overwriteEdit(cells, start, end, total, keyFor), store.id);
    if (!result)
        return null;
    for (const id of Object.keys(result.changes)) {
        if (tupletCrossesBarline(result.changes[id], 0, Infinity)) {
            blockedByBarline = true;
            return null;
        }
    }
    return result;
}
const BARLINE_MESSAGE = 'That change would move a tuplet note across a barline. A tuplet can run over a barline only between its notes.';
// Dragging the right edge of the selected note to `newEnd`: the same as a duration edit, whatever the mode
function resizeNoteEnd(newEnd, staffName) {
    const ctx = getEditContext(true, staffName); // works in the Create tab too
    if (!ctx)
        return null;
    if (ctx.multi)
        return false;
    const cells = buildCells(ctx.store.unprocessedNotes);
    const picked = selectedCellIndices(cells, ctx.sel.start, ctx.sel.end);
    if (picked.length !== 1 || cells[picked[0]].isTuplet)
        return false;
    const length = round(newEnd - cells[picked[0]].start);
    if (length < 1e-9)
        return false;
    const result = runDurationMode(ctx, cells, () => 'len:' + length);
    if (!result) {
        if (blockedByBarline)
            alert(BARLINE_MESSAGE);
        return false;
    }
    const stays = (!ctx.sel.voice || ctx.sel.voice === 'all') && result.selection.voice === ctx.store.id;
    commitVoiceEdits(ctx.part, result.changes, {
        start: result.selection.start, end: result.selection.end,
        voice: stays ? 'all' : result.selection.voice,
        base: { start: result.selection.start, end: result.selection.end },
    }, result.newTotal);
    return true;
}
function computeDurationEdit(ctx, kind, value) {
    if (ctx.multi)
        return null; // several voices at once: pick one voice first
    const staff = ctx.part;
    const store = ctx.store;
    const total = notesDuration(store.unprocessedNotes);
    const cells = buildCells(store.unprocessedNotes);
    const { start, end } = ctx.sel;
    // Notes inside a tuplet change their written value in place; the tuplet's length and what follows move with it
    if (ctx.notes.length && ctx.notes.every(note => note.tupletInfo))
        return computeTupletMemberDuration(ctx, kind, value);
    // A tuplet touching the selection, even partly, blocks duration edits
    if (cells.some(cell => cell.isTuplet && cell.start < end - 1e-9 && cell.end > start + 1e-9))
        return null;
    const selCells = selectedCellIndices(cells, start, end).map(index => cells[index]);
    if (!selCells.length)
        return null;
    const run = (keyFor) => runDurationMode(ctx, cells, keyFor);
    if (kind === 'dot') {
        const wantDot = !selCells.every(cell => (cellKey(cell) ?? '').endsWith('d'));
        return run(cell => keyWithDot(cell, wantDot));
    }
    // Keep the dot when it fits, otherwise fall back to the plain value
    return run(cell => keyWithBase(cell, value)) ?? run(cell => keyWithBase(cell, value, false));
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
function applyDurationEdit(ctx, kind, value) {
    if (ctx.multi)
        return;
    const result = computeDurationEdit(ctx, kind, value);
    if (!result) {
        if (blockedByBarline)
            alert(BARLINE_MESSAGE);
        return;
    }
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
function rewriteNotes(ctx, fn) {
    const changes = {};
    for (const group of ctx.groups) {
        const notes = [...group.store.unprocessedNotes];
        let changed = false;
        for (const entry of group.entries) {
            const src = notes[entry.index];
            const result = fn(src);
            if (!result)
                continue;
            const replacement = result === 'rest'
                ? makeRest(src.duration, src.dotted)
                : new UnprocessedNote(result.names, result.octaves, src.duration, src.dotted, src.tiedToNext);
            copyTuplets(src, replacement);
            if (result !== 'rest')
                replacement.articulations = [...src.articulations];
            notes[entry.index] = replacement;
            changed = true;
        }
        if (changed)
            changes[group.store.id] = notes;
    }
    if (Object.keys(changes).length)
        commitVoiceEdits(ctx.part, changes, null, null);
}
// The pending pitch has its note and octave: write it into the note (or turn the rest into a note)
function writePending(ctx, session) {
    const pendingPitch = session.pending;
    const name = pendingPitch.letter + (pendingPitch.acc ?? '');
    const octave = pendingPitch.octave;
    session.pending = null;
    session.selected = pitchKey(name, octave);
    rewriteNotes(ctx, note => (note.isRest ? { names: [name], octaves: [octave] } : addPitchToNote(note, name, octave)));
}
// A click in the Note / Accidental / Octave rows
function handlePitchRowClick(kind, value) {
    const ctx = getEditContext();
    if (!ctx)
        return;
    if (!ctx.multi && logicalNoteCount(ctx.notes) === 1) {
        const session = ensureSession(ctx);
        // Building a new pitch: a rest has no pitch yet, so clicking a row starts one
        if (session.pending || !firstPitched(ctx)) {
            const pendingPitch = session.pending ?? (session.pending = { letter: null, acc: null, octave: null });
            if (kind === 'letter')
                pendingPitch.letter = value;
            else if (kind === 'acc')
                pendingPitch.acc = value;
            else
                pendingPitch.octave = Number(value);
            if (pendingPitch.letter !== null && pendingPitch.octave !== null)
                writePending(ctx, session); // accidental is optional (natural)
            else
                scheduleEditRefresh();
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
function handlePitchButton(key) {
    const ctx = getEditContext();
    if (!ctx)
        return;
    const session = ensureSession(ctx);
    session.pending = null;
    session.selected = key;
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
    const result = moveToVoiceEdit(ctx.part, ctx.store.id, destId, ctx.sel.start, ctx.sel.end, notesDuration(ctx.store.unprocessedNotes));
    if (!result)
        return;
    commitVoiceEdits(ctx.part, result.changes, {
        ...result.selection, base: { start: result.selection.start, end: result.selection.end },
    }, result.newTotal);
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
// Insert mode Delete: the selected notes (and rests) are taken out and what follows moves up to close the gap.
// The other voices of the staff lose the same time, and rests at the end keep the voice's length.
// Deleting inside a tuplet keeps the tuplet's length: a deleted note of it becomes a rest in its place.
// Only a tuplet with every note selected goes whole.
function tupletAwareDeletion(group) {
    const original = group.store.unprocessedNotes;
    const selected = new Set(group.entries.map(entry => entry.index));
    const membersOf = new Map();
    original.forEach((note, index) => {
        if (!note.tupletInfo)
            return;
        const list = membersOf.get(note.tupletInfo.id) ?? [];
        list.push(index);
        membersOf.set(note.tupletInfo.id, list);
    });
    let source = original;
    let replaced = false;
    const hit = new Set();
    for (const index of selected) {
        const note = original[index];
        if (!note.tupletInfo || membersOf.get(note.tupletInfo.id).every(member => selected.has(member))) {
            hit.add(index);
            continue;
        }
        if (note.isRest)
            continue;
        if (source === original)
            source = cloneNotes(original);
        const rest = makeRest(note.duration, note.dotted);
        copyTuplets(note, rest);
        source[index] = rest;
        replaced = true;
    }
    return { source, hit, replaced };
}
function deleteByInsert(ctx) {
    const changes = {};
    for (const group of ctx.groups) {
        const { source, hit, replaced } = tupletAwareDeletion(group);
        const kept = [];
        source.forEach((note, index) => {
            if (hit.has(index)) {
                if (kept.length)
                    kept[kept.length - 1] = withoutTie(kept[kept.length - 1]);
                return;
            }
            kept.push(note);
        });
        // the removed stretches of time
        const ranges = [];
        for (const entry of group.entries.filter(item => hit.has(item.index))) {
            const end = round(entry.start + entry.dur);
            const last = ranges[ranges.length - 1];
            if (last && Math.abs(last.end - entry.start) < 1e-9)
                last.end = end;
            else
                ranges.push({ start: entry.start, end });
        }
        const removed = round(ranges.reduce((sum, range) => sum + (range.end - range.start), 0));
        if (!hit.size && !replaced)
            continue;
        const had = notesDuration(source);
        const result = [...cloneNotes(kept), ...fillDurationWithRests(removed, round(had - removed))];
        reindexTuplets(result);
        if (tupletCrossesBarline(result, 0, Infinity))
            return;
        changes[group.store.id] = result;
        // with one voice selected, the other voices of the staff lose the same time so they stay in step
        if (!ctx.multi) {
            for (const voice of staffVoices(ctx.part)) {
                if (voice.id === group.store.id)
                    continue;
                let cells = buildCells(voice.unprocessedNotes);
                for (const range of [...ranges].reverse()) {
                    cells = cells && shiftCellsAt(cells, range.end, -(range.end - range.start));
                    if (!cells)
                        return;
                }
                changes[voice.id] = cells.flatMap(cell => cell.notes);
            }
        }
    }
    if (Object.keys(changes).length)
        commitVoiceEdits(ctx.part, changes, null, null);
}
function withoutTie(note) {
    if (!note.tiedToNext)
        return note;
    const copy = cloneNotes([note])[0];
    copy.tiedToNext = false;
    copy.articulations = [...note.articulations];
    return copy;
}
function deleteSelectedToRests(ctx) {
    if (insertMode) {
        deleteByInsert(ctx);
        return;
    }
    const changes = {};
    for (const group of ctx.groups) {
        const { source: src, hit, replaced } = tupletAwareDeletion(group);
        const out = [];
        const fresh = [];
        let pos = 0;
        let changed = replaced;
        for (let itemIndex = 0; itemIndex < src.length;) {
            const note = src[itemIndex];
            if (note.tupletInfo) {
                let runEnd = itemIndex;
                while (runEnd < src.length - 1 && src[runEnd].tupletInfo && src[runEnd].tupletInfo.index !== src[runEnd].tupletInfo.count)
                    runEnd++;
                let total = 0;
                for (let runIndex = itemIndex; runIndex <= runEnd; runIndex++)
                    total += getRealDuration(src[runIndex]);
                total = round(total);
                let any = false;
                for (let runIndex = itemIndex; runIndex <= runEnd; runIndex++)
                    if (hit.has(runIndex))
                        any = true;
                if (any) {
                    for (const rest of fillDurationWithRests(total, pos)) {
                        out.push(rest);
                        fresh.push(true);
                    }
                    changed = true;
                }
                else {
                    for (let sourceIndex = itemIndex; sourceIndex <= runEnd; sourceIndex++) {
                        out.push(src[sourceIndex]);
                        fresh.push(false);
                    }
                }
                pos = round(pos + total);
                itemIndex = runEnd + 1;
                continue;
            }
            if (hit.has(itemIndex) && !note.isRest) {
                out.push(makeRest(note.duration, note.dotted));
                fresh.push(true);
                changed = true;
            }
            else {
                out.push(note);
                fresh.push(false);
            }
            pos = round(pos + getNoteDuration(note));
            itemIndex++;
        }
        if (changed)
            changes[group.store.id] = coalesceRests(out, index => fresh[index]);
    }
    if (Object.keys(changes).length)
        commitVoiceEdits(ctx.part, changes, null, null);
}
function deleteAtSelection() {
    const ctx = getEditContext();
    if (!ctx)
        return;
    if (!ctx.multi && logicalNoteCount(ctx.notes) === 1) {
        const session = ensureSession(ctx);
        if (session.pending) {
            session.pending = null;
            scheduleEditRefresh();
            return;
        }
        const note = firstPitched(ctx);
        if (!note) {
            deleteSelectedToRests(ctx);
            return;
        } // a rest: Insert takes its time out, Overwrite leaves it
        const keys = notePitchKeys(note);
        if (keys.length <= 1 || !session.selected) {
            deleteSelectedToRests(ctx);
            return;
        }
        const removing = [session.selected];
        rewriteNotes(ctx, note => removePitchesFromNote(note, removing));
        session.selected = keys.filter(key => key !== removing[0])[0] ?? null;
        return;
    }
    deleteSelectedToRests(ctx);
}
// Kept so grid.ts's existing call still works; clicking a note again no longer cycles pitches
function buildEditMenu() {
    const host = document.getElementById('edit-menu');
    if (!host)
        return;
    host.innerHTML = '';
    const heading = (title) => {
        const heading = document.createElement('div');
        heading.className = 'buttonDescription';
        heading.textContent = title;
        host.appendChild(heading);
    };
    const addRow = (title, buttons) => {
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
    addRow('Note', LETTERS.map(letter => ({ label: letter, kind: 'letter', value: letter })));
    addRow('Accidental', ACC_BUTTONS.map(accidental => ({ label: ACC_GLYPH[accidental], kind: 'acc', value: accidental })));
    addRow('Octave', OCTAVE_BUTTONS.map(octave => ({ label: String(octave), kind: 'octave', value: String(octave) })));
    addRow('Duration', rhythmOptions.slice().reverse().map(option => ({
        label: option.symbol, kind: 'duration', value: DURATION_KEYS[option.id],
    })));
    addRow('Dot', [{ label: '\u00B7', kind: 'dot', value: 'dot' }]);
    buildTieMenu(host);
    buildSlurMenu(host);
    buildGraceMenu(host);
    buildTupletMenu(host);
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
        const button = document.createElement('button');
        button.className = 'voiceBtn';
        button.textContent = def.label;
        const here = !!ctx && !ctx.multi && ctx.store.id === def.id;
        const canMove = !!ctx && !ctx.multi && !here &&
            moveToVoiceEdit(ctx.part, ctx.store.id, def.id, ctx.sel.start, ctx.sel.end, notesDuration(ctx.store.unprocessedNotes)) !== null;
        button.classList.toggle('active', here);
        button.disabled = !ctx || (!here && !canMove);
        if (canMove)
            button.addEventListener('click', () => { handleVoiceMove(def.id); button.blur(); });
        voiceRow.appendChild(button);
    }
    refreshTupletMenu(ctx);
    if (!ctx) {
        buttons.forEach(button => { button.classList.remove('active'); button.disabled = true; });
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
        const session = ensureSession(ctx);
        canEditPitch = true;
        if (session.pending) {
            litLetter = session.pending.letter;
            litAcc = session.pending.acc;
            litOct = session.pending.octave;
        }
        else if (note) {
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
                if (session.selected === key && !session.pending)
                    pitchButton.classList.add('active');
                if (pitchIsOutOfKey(staff, parsed.name, parsed.octave, ctx.sel.start))
                    pitchButton.classList.add('bad');
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
    }
    else {
        const pitchTargets = [];
        for (const editNote of ctx.notes) {
            if (editNote.isRest)
                continue;
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
    let keys;
    if (ctx.notes.some(note => note.tupletInfo)) {
        keys = ctx.notes.map(note => getDurationKeyFromValue(getNoteDuration(note)));
    }
    else {
        const cells = buildCells(ctx.store.unprocessedNotes);
        keys = selectedCellIndices(cells, ctx.sel.start, ctx.sel.end).map(index => cellKey(cells[index]));
    }
    const known = !ctx.multi && keys.length > 0 && keys.every(key => key !== null);
    const litBase = known ? commonValue(keys.map(key => key.replace(/d$/, ''))) : null;
    const litDot = known ? commonValue(keys.map(key => key.endsWith('d'))) : null;
    buttons.forEach(button => {
        const kind = button.dataset.kind;
        const value = button.dataset.value;
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
        button.classList.toggle('active', on);
        button.disabled = !enabled;
    });
}
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Arrow keys: Left / Right move the selected notes in time by one grid step; Up / Down change their pitch
// (Shift = by scale degree, Alt = by octave). Edit tab only.
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
const LOWEST_PIANO_MIDI = 21; // A0
const HIGHEST_PIANO_MIDI = 108; // C8
// Cuts every cell that spans one of the points in two, so the points become cell boundaries. Null if a tuplet would be cut.
function splitCellsAt(cells, points) {
    let failed = false;
    const out = [];
    cells.forEach(cell => {
        const inside = points.filter(point => point > cell.start + 1e-9 && point < cell.end - 1e-9).sort((first, second) => first - second);
        if (!inside.length) {
            out.push(cell);
            return;
        }
        if (cell.isTuplet) {
            failed = true;
            return;
        }
        const edges = [cell.start, ...inside, cell.end];
        for (let index = 0; index < edges.length - 1; index++) {
            out.push({ ...cell, start: edges[index], end: edges[index + 1], notes: piecesFor(cell, edges[index], edges[index + 1]) });
        }
    });
    return failed ? null : out;
}
// The cells the selection covers in one voice, and where they begin and end. Null if there are none or a tuplet is among them.
function movableBlock(cells, selection) {
    const indexes = selectedCellIndices(cells, selection.start, selection.end);
    if (!indexes.length || indexes.some(index => cells[index].isTuplet))
        return null;
    return { indexes, blockStart: cells[indexes[0]].start, blockEnd: cells[indexes[indexes.length - 1]].end };
}
function fitsInVoice(blockStart, blockEnd, delta, total) {
    return round(blockStart + delta) >= -1e-9 && round(blockEnd + delta) <= total + 1e-9;
}
// Overwrite: the notes land on top of whatever is there, and the time they leave becomes rests
function moveByOverwrite(notes, selection, delta) {
    const cells = buildCells(notes);
    const block = movableBlock(cells, selection);
    if (!block || !fitsInVoice(block.blockStart, block.blockEnd, delta, notesDuration(notes)))
        return null;
    let work = clearCells(cells, block.blockStart, block.blockEnd);
    if (!work)
        return null;
    for (const index of block.indexes) {
        const cell = cells[index];
        if (cell.isRest)
            continue; // a moved rest does not wipe out the notes it lands on
        work = paint(work, round(cell.start + delta), round(cell.end + delta), cell.notes);
        if (!work)
            return null;
    }
    return work.flatMap(cell => cell.notes);
}
// Insert: the notes trade places with the stretch of music next to them, so nothing is lost or overwritten
function moveByInsert(notes, selection, delta) {
    const block = movableBlock(buildCells(notes), selection);
    if (!block || !fitsInVoice(block.blockStart, block.blockEnd, delta, notesDuration(notes)))
        return null;
    const { blockStart, blockEnd } = block;
    const hopFrom = delta > 0 ? blockEnd : round(blockStart + delta);
    const hopTo = delta > 0 ? round(blockEnd + delta) : blockStart;
    const cells = splitCellsAt(buildCells(notes), [hopFrom, hopTo]);
    if (!cells)
        return null;
    const before = cells.filter(cell => cell.end <= Math.min(hopFrom, blockStart) + 1e-9);
    const after = cells.filter(cell => cell.start >= Math.max(hopTo, blockEnd) - 1e-9);
    const blockCells = cells.filter(cell => cell.start >= blockStart - 1e-9 && cell.end <= blockEnd + 1e-9);
    const hopCells = cells.filter(cell => cell.start >= hopFrom - 1e-9 && cell.end <= hopTo + 1e-9);
    const ordered = delta > 0 ? [...before, ...hopCells, ...blockCells, ...after] : [...before, ...blockCells, ...hopCells, ...after];
    return ordered.flatMap(cell => cell.notes);
}
// Polyphony: like Overwrite, but a note that lands on notes of other pitches goes to the first voice that is free there
function moveByPolyphony(ctx, delta) {
    const work = {};
    const cellsOf = (id) => {
        if (!work[id]) {
            const voice = getVoice(ctx.part, id);
            work[id] = voice ? buildCells(voice.unprocessedNotes) : emptyVoiceCells(notesDuration(ctx.store.unprocessedNotes));
        }
        return work[id];
    };
    const moving = [];
    for (const group of ctx.groups) {
        const id = group.store.id;
        const cells = cellsOf(id);
        const block = movableBlock(cells, ctx.sel);
        if (!block || !fitsInVoice(block.blockStart, block.blockEnd, delta, notesDuration(group.store.unprocessedNotes)))
            return null;
        const cleared = clearCells(cells, block.blockStart, block.blockEnd);
        if (!cleared)
            return null;
        moving.push({ id, cells: block.indexes.map(index => cells[index]) });
        work[id] = cleared;
    }
    let spread = false;
    const touched = new Set(moving.map(entry => entry.id));
    for (const { id, cells } of moving) {
        for (const cell of cells) {
            if (cell.isRest)
                continue;
            const from = round(cell.start + delta);
            const to = round(cell.end + delta);
            const mine = new Set(midiPitches(cell.notes[0]));
            const candidates = [id, ...VOICE_DEFS.map(voiceDef => voiceDef.id).filter(other => other !== id)];
            const destination = candidates.find(candidate => !overlappingCells(cellsOf(candidate), from, to).some(other => blocksPitches(other, mine)));
            if (!destination)
                return null;
            const painted = paint(cellsOf(destination), from, to, cell.notes);
            if (!painted)
                return null;
            work[destination] = painted;
            touched.add(destination);
            if (destination !== id)
                spread = true;
        }
    }
    const changes = {};
    for (const id of touched)
        changes[id] = work[id].flatMap(cell => cell.notes);
    return { changes, spread };
}
// Moves the selected notes in time by `delta` whole notes (negative = earlier), following the Insert / Polyphony / Overwrite mode
function moveSelectedInTime(ctx, delta) {
    let changes = {};
    let spread = false;
    if (polyphonyMode && !insertMode) {
        const result = moveByPolyphony(ctx, delta);
        if (!result)
            return;
        changes = result.changes;
        spread = result.spread;
    }
    else {
        for (const group of ctx.groups) {
            const moved = insertMode
                ? moveByInsert(group.store.unprocessedNotes, ctx.sel, delta)
                : moveByOverwrite(group.store.unprocessedNotes, ctx.sel, delta);
            if (!moved)
                return; // if one voice can't move, none do
            changes[group.store.id] = moved;
        }
    }
    for (const id of Object.keys(changes)) {
        if (tupletCrossesBarline(changes[id], 0, Infinity))
            return;
    }
    const start = round(ctx.sel.start + delta);
    const end = round(ctx.sel.end + delta);
    commitVoiceEdits(ctx.part, changes, { start, end, voice: spread ? 'all' : ctx.sel.voice, base: { start, end } }, null);
}
// One pitch moved a step up (+1) or down (-1); null if it would leave the piano
function steppedPitch(name, octave, staff, step, direction) {
    const midi = soundingMidi(name, octave);
    let newMidi = midi + direction;
    if (step === 'octave') {
        newMidi = midi + 12 * direction;
    }
    else if (step === 'degree') {
        const rootIndex = noteMapping[staff.scale[0]];
        const scale = scalesMapping[staff.scale[1]];
        const inScale = (value) => scale.includes((((value - rootIndex) % 12) + 12) % 12);
        for (let tries = 0; tries < 12 && !inScale(newMidi); tries++)
            newMidi += direction;
    }
    if (newMidi < LOWEST_PIANO_MIDI || newMidi > HIGHEST_PIANO_MIDI)
        return null;
    if (step === 'octave')
        return { name, octave: octave + direction }; // keeps the spelling
    return spellMidi(newMidi, staff.scale);
}
function movePitchOfSelection(ctx, step, direction) {
    const moveNote = (note) => {
        const names = [];
        const octaves = [];
        for (let index = 0; index < note.noteName.length; index++) {
            const moved = steppedPitch(note.noteName[index], note.octaves[index], ctx.part, step, direction);
            if (!moved)
                return null;
            names.push(moved.name);
            octaves.push(moved.octave);
        }
        return dedupePitches({ names, octaves });
    };
    const pitched = ctx.notes.filter(note => !note.isRest);
    if (!pitched.length || pitched.some(note => !moveNote(note)))
        return; // nothing moves if one note would leave the piano
    rewriteNotes(ctx, note => (note.isRest ? null : moveNote(note)));
}
// The arrow keys, in the Edit tab. Returns true when the key was used.
function handleArrowKey(event) {
    if (event.ctrlKey || event.metaKey || currentTab !== 'edit')
        return false;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key))
        return false;
    const ctx = getEditContext();
    if (!ctx)
        return false;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        moveSelectedInTime(ctx, event.key === 'ArrowRight' ? gridDivision : -gridDivision);
    }
    else {
        const step = event.altKey ? 'octave' : event.shiftKey ? 'degree' : 'semitone';
        movePitchOfSelection(ctx, step, event.key === 'ArrowUp' ? 1 : -1);
    }
    return true;
}
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Tuplets by hand (Edit tab): make a tuplet of the selection, join or split the notes inside one, or turn one back
// into ordinary notes. A tuplet inside a tuplet is made by selecting notes inside the first one and making another.
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// this many notes in the time of that many
const TUPLET_CHOICES = [[3, 2], [2, 3], [4, 3], [3, 4], [5, 4], [6, 4], [7, 4], [9, 8], [7, 8]];
let newTupletIdCounter = 1000000; // a number no existing tuplet has; commit renumbers them all
// A note's value as the key durationMapping uses: "8d" is a dotted eighth
function noteKeyOf(note) {
    return note.dotted ? note.duration + 'd' : note.duration;
}
// A new note of value `key`: the pitches of `source` (a rest if it has none)
function noteOfKey(key, source) {
    const duration = key.replace(/d$/, '');
    const dotted = key.endsWith('d');
    if (!source || source.isRest)
        return makeRest(duration, dotted);
    const note = new UnprocessedNote([...source.noteName], [...source.octaves], duration, dotted);
    note.articulations = [...source.articulations];
    return note;
}
function levelIds(note) {
    return tupletLevels(note).map(level => level.id).join(',');
}
// Numbers each tuplet's notes 1..n again and sets how many it has, after notes were put in or taken out.
// A tuplet is a run of notes that carry the same id at the same depth.
function reindexTuplets(notes) {
    const open = [];
    const close = (fromDepth) => {
        while (open.length > fromDepth) {
            const group = open.pop();
            group.members.forEach((member, position) => { member.index = position + 1; member.count = group.members.length; });
        }
    };
    for (const note of notes) {
        const levels = tupletLevels(note);
        let depth = 0;
        while (depth < open.length && depth < levels.length && open[depth].id === levels[depth].id)
            depth++;
        close(depth);
        for (let level = depth; level < levels.length; level++)
            open.push({ id: levels[level].id, members: [] });
        levels.forEach((level, at) => open[at].members.push(level));
    }
    close(0);
    refreshTupletTotals(notes);
}
// The voice the selection is in, its notes, and where the selected run is (null if several voices or nothing)
function tupletRun(ctx) {
    if (ctx.multi || ctx.groups.length !== 1)
        return null;
    const indexes = ctx.groups[0].entries.map(entry => entry.index);
    if (!indexes.length)
        return null;
    return { notes: ctx.store.unprocessedNotes, first: Math.min(...indexes), last: Math.max(...indexes) };
}
function finishPlan(before, middle, after, start, end) {
    const notes = cloneNotes([...before, ...middle, ...after]); // copies, so checking a plan never disturbs the live notes
    reindexTuplets(notes);
    if (tupletCrossesBarline(notes, 0, Infinity))
        return null;
    return { notes, start, end };
}
// The selection becomes `count` notes in the time of `occupied`
function planMakeTuplet(ctx, count, occupied) {
    const run = tupletRun(ctx);
    if (!run)
        return null;
    const { notes, first, last } = run;
    const selected = notes.slice(first, last + 1);
    let slot; // what the new tuplet's notes take their pitches from
    let nominal; // the written length of the whole selection
    let before;
    let after;
    let levels; // the tuplets the selection is already in
    let sourceNote = null;
    if (selected.every(note => note.tupletInfo)) {
        // inside a tuplet: the new one nests in it, so all the notes must be in the same tuplets
        if (selected.some(note => levelIds(note) !== levelIds(selected[0])))
            return null;
        slot = selected;
        nominal = round(selected.reduce((sum, note) => sum + getNoteDuration(note), 0));
        before = notes.slice(0, first);
        after = notes.slice(last + 1);
        levels = tupletLevels(selected[0]);
        sourceNote = selected[0];
    }
    else if (selected.some(note => note.tupletInfo)) {
        return null;
    }
    else {
        const cells = buildCells(notes);
        const picked = selectedCellIndices(cells, ctx.sel.start, ctx.sel.end).map(index => cells[index]);
        if (!picked.length || picked.some(cell => cell.isTuplet))
            return null;
        const firstNote = picked[0].notes[0];
        const lastNote = picked[picked.length - 1].notes[picked[picked.length - 1].notes.length - 1];
        before = notes.slice(0, notes.indexOf(firstNote));
        after = notes.slice(notes.indexOf(lastNote) + 1);
        slot = picked.map(cell => cell.notes[0]);
        nominal = round(picked[picked.length - 1].end - picked[0].start);
        levels = [];
    }
    const key = getDurationKeyFromValue(round(nominal / occupied));
    if (!key)
        return null;
    const id = ++newTupletIdCounter;
    const middle = [];
    for (let position = 0; position < count; position++) {
        const note = noteOfKey(key, slot[position] ?? null);
        const fresh = { id, totalTupletDuration: 0, ratio: [count, occupied], count, index: position + 1 };
        if (levels.length) {
            const parent = selected[0];
            note.tupletInfo = { ...parent.tupletInfo, ratio: [...parent.tupletInfo.ratio] };
            note.innerTuplets = [...parent.innerTuplets.map(level => ({ ...level, ratio: [...level.ratio] })), fresh];
        }
        else {
            note.tupletInfo = fresh;
        }
        middle.push(note);
    }
    void sourceNote;
    const span = levels.length
        ? { start: ctx.sel.start, end: ctx.sel.end }
        : (() => { const cells = buildCells(notes); const picked = selectedCellIndices(cells, ctx.sel.start, ctx.sel.end).map(index => cells[index]); return { start: picked[0].start, end: picked[picked.length - 1].end }; })();
    return finishPlan(before, middle, after, span.start, span.end);
}
// The notes of the tuplet (at its deepest level) that `note` belongs to, as indexes into `notes`
function deepestGroupRange(notes, at) {
    const levels = tupletLevels(notes[at]);
    if (!levels.length)
        return null;
    const depth = levels.length - 1;
    const id = levels[depth].id;
    const belongs = (index) => tupletLevels(notes[index])[depth]?.id === id;
    let first = at;
    let last = at;
    while (first > 0 && belongs(first - 1))
        first--;
    while (last < notes.length - 1 && belongs(last + 1))
        last++;
    return { first, last, depth };
}
// Several notes of one tuplet become one note; all the notes of a tuplet become one ordinary note (the tuplet is gone)
function planJoin(ctx, wholeGroup) {
    const run = tupletRun(ctx);
    if (!run)
        return null;
    const { notes } = run;
    let { first, last } = run;
    if (wholeGroup) {
        const range = deepestGroupRange(notes, first);
        if (!range)
            return null;
        first = range.first;
        last = range.last;
    }
    else if (last <= first) {
        return null;
    }
    const members = notes.slice(first, last + 1);
    if (members.some(note => !note.tupletInfo) || members.some(note => levelIds(note) !== levelIds(members[0])))
        return null;
    const levels = tupletLevels(members[0]);
    const deepest = levels[levels.length - 1];
    const wholeDeepest = members.length === deepest.count;
    let nominal = round(members.reduce((sum, note) => sum + getNoteDuration(note), 0));
    if (wholeDeepest)
        nominal = round(nominal * deepest.ratio[1] / deepest.ratio[0]); // the group becomes a plain note of the time it took
    const key = getDurationKeyFromValue(nominal);
    if (!key)
        return null;
    const source = members.find(note => !note.isRest) ?? null;
    const joined = noteOfKey(key, source);
    copyTuplets(members[0], joined);
    if (wholeDeepest) {
        if (joined.innerTuplets.length)
            joined.innerTuplets.pop();
        else
            joined.tupletInfo = null;
    }
    const start = timelineStartOf(notes, first);
    const span = round(members.reduce((sum, note) => sum + getRealDuration(note), 0));
    return finishPlan(notes.slice(0, first), [joined], notes.slice(last + 1), start, round(start + span));
}
function timelineStartOf(notes, index) {
    return getUnprocessedTimeline(notes)[index].start;
}
function applyTupletPlan(ctx, plan) {
    if (!plan)
        return;
    commitVoiceEdits(ctx.part, { [ctx.store.id]: plan.notes }, {
        start: plan.start, end: plan.end, voice: ctx.sel.voice, base: { start: plan.start, end: plan.end },
    }, null);
}
function selectedTupletChoice() {
    const select = document.getElementById('tupletRatio');
    const [count, occupied] = (select?.value ?? '3:2').split(':').map(Number);
    return [count, occupied];
}
function buildTupletMenu(host) {
    const heading = document.createElement('div');
    heading.className = 'buttonDescription';
    heading.textContent = 'Tuplet';
    host.appendChild(heading);
    const choiceRow = document.createElement('div');
    choiceRow.className = 'row';
    const select = document.createElement('select');
    select.id = 'tupletRatio';
    for (const [count, occupied] of TUPLET_CHOICES) {
        const option = document.createElement('option');
        option.value = `${count}:${occupied}`;
        option.textContent = `${count}:${occupied}`;
        select.appendChild(option);
    }
    select.addEventListener('change', () => { select.blur(); scheduleEditRefresh(); });
    choiceRow.appendChild(select);
    host.appendChild(choiceRow);
    const addButtons = (buttons) => {
        const row = document.createElement('div');
        row.className = 'row';
        for (const button of buttons) {
            const el = document.createElement('button');
            el.className = 'tupletBtn';
            el.id = button.id;
            el.textContent = button.label;
            el.title = button.title;
            el.disabled = true;
            el.addEventListener('click', () => { const ctx = getEditContext(); if (ctx)
                button.run(ctx); el.blur(); });
            row.appendChild(el);
        }
        host.appendChild(row);
    };
    addButtons([
        { id: 'tupletMake', label: 'Tuplet', title: 'Make the selection a tuplet (inside a tuplet: one nested in it)', run: ctx => { const [count, occupied] = selectedTupletChoice(); applyTupletPlan(ctx, planMakeTuplet(ctx, count, occupied)); } },
        { id: 'tupletUndo', label: 'Untuplet', title: 'Turn the tuplet back into an ordinary note', run: ctx => applyTupletPlan(ctx, planJoin(ctx, true)) },
    ]);
}
function refreshTupletMenu(ctx) {
    refreshTieMenu(ctx);
    refreshSlurMenu(ctx);
    refreshGraceMenu(ctx);
    const set = (id, enabled) => {
        const button = document.getElementById(id);
        if (button)
            button.disabled = !enabled;
    };
    if (!ctx) {
        ['tupletMake', 'tupletUndo'].forEach(id => set(id, false));
        return;
    }
    const [count, occupied] = selectedTupletChoice();
    set('tupletMake', planMakeTuplet(ctx, count, occupied) !== null);
    set('tupletUndo', planJoin(ctx, true) !== null);
}
function computeTupletMemberDuration(ctx, kind, value) {
    const run = tupletRun(ctx);
    if (!run)
        return null;
    const notes = ctx.store.unprocessedNotes;
    const range = deepestGroupRange(notes, run.first);
    if (!range || run.last > range.last)
        return null;
    const depth = range.depth;
    const selected = notes.slice(run.first, run.last + 1);
    if (selected.some(note => tupletLevels(note).length !== depth + 1 || levelIds(note) !== levelIds(selected[0])))
        return null;
    const levelTemplate = selected[0];
    const levels = tupletLevels(levelTemplate);
    let scale = 1; // real time per unit of written value inside this group
    for (let level = 0; level <= depth; level++)
        scale *= levels[level].ratio[1] / levels[level].ratio[0];
    // the group as units: single notes, or whole nested tuplets
    const units = [];
    for (let at = range.first; at <= range.last;) {
        const note = notes[at];
        if (tupletLevels(note).length === depth + 1) {
            units.push({ notes: [note], length: getNoteDuration(note), plain: true });
            at++;
            continue;
        }
        const innerId = tupletLevels(note)[depth + 1].id;
        const inner = [];
        let sum = 0;
        while (at <= range.last && tupletLevels(notes[at])[depth + 1]?.id === innerId) {
            inner.push(notes[at]);
            sum += getRealDuration(notes[at]);
            at++;
        }
        units.push({ notes: inner, length: round(sum / scale), plain: false });
    }
    const groupLength = round(units.reduce((sum, unit) => sum + unit.length, 0));
    const oldPosition = [];
    let walk = 0;
    for (const unit of units) {
        oldPosition.push(walk);
        walk = round(walk + unit.length);
    }
    const firstUnit = units.findIndex(unit => unit.notes[0] === selected[0]);
    const lastUnit = firstUnit + selected.length - 1;
    if (firstUnit < 0 || lastUnit >= units.length)
        return null;
    for (let offset = 0; offset < selected.length; offset++) {
        if (!units[firstUnit + offset].plain || units[firstUnit + offset].notes[0] !== selected[offset])
            return null;
    }
    const wantDot = kind === 'dot' ? !selected.every(note => note.dotted) : false;
    const newKeys = [];
    for (const old of selected) {
        const base = old.duration.replace(/d$/, '');
        const key = kind === 'dot' ? base + (wantDot ? 'd' : '') : value + (old.dotted ? 'd' : '');
        if (durationMapping[key] !== undefined)
            newKeys.push(key);
        else if (kind === 'duration' && durationMapping[value] !== undefined)
            newKeys.push(value);
        else
            return null;
    }
    // a length of written value as notes of the group (tied if it has a pitch); null when it can't be written
    const piecesFor = (length, template, keepArticulations) => {
        const pieces = fillDurationAsUnprocessed(length, template);
        const written = round(pieces.reduce((sum, piece) => sum + getNoteDuration(piece), 0));
        if (!pieces.length || Math.abs(written - length) > 1e-9)
            return null;
        if (!keepArticulations)
            pieces.forEach(piece => { piece.articulations = []; });
        pieces.forEach(piece => copyTuplets(levelTemplate, piece));
        return pieces;
    };
    const restTemplate = makeRest('q');
    const items = [];
    const addUnit = (unit, position) => items.push({ position, length: unit.length, notes: unit.notes, plain: unit.plain, selected: false });
    for (let at = 0; at < firstUnit; at++)
        addUnit(units[at], oldPosition[at]);
    let cursor = oldPosition[firstUnit];
    selected.forEach((old, offset) => {
        const fresh = noteOfKey(newKeys[offset], old);
        copyTuplets(old, fresh);
        fresh.tiedToNext = old.tiedToNext && !old.isRest;
        const length = durationMapping[newKeys[offset]];
        items.push({ position: cursor, length, notes: [fresh], plain: true, selected: true });
        cursor = round(cursor + length);
    });
    const newEnd = cursor;
    for (let at = lastUnit + 1; at < units.length; at++) {
        const unit = units[at];
        const unitStart = oldPosition[at];
        const unitEnd = round(unitStart + unit.length);
        if (insertMode) { // pushed along
            addUnit(unit, cursor);
            cursor = round(cursor + unit.length);
            continue;
        }
        if (unitEnd <= newEnd + 1e-9)
            continue; // overwritten
        if (unitStart < newEnd - 1e-9) { // cut: what is left of it
            if (!unit.plain)
                return null;
            const rest = piecesFor(round(unitEnd - newEnd), unit.notes[0], false);
            if (!rest)
                return null;
            items.push({ position: newEnd, length: round(unitEnd - newEnd), notes: rest, plain: true, selected: false });
            cursor = unitEnd;
            continue;
        }
        if (unitStart > cursor + 1e-9) { // time the note gave up
            const gap = piecesFor(round(unitStart - cursor), restTemplate, false);
            if (!gap)
                return null;
            items.push({ position: cursor, length: round(unitStart - cursor), notes: gap, plain: true, selected: false });
        }
        addUnit(unit, unitStart);
        cursor = unitEnd;
    }
    // keep to the length of the tuplet; what runs past its end leaves it (an outermost tuplet only)
    const kept = [];
    const leaving = [];
    for (const item of items) {
        const end = round(item.position + item.length);
        if (end <= groupLength + 1e-9) {
            kept.push(item);
            continue;
        }
        if (item.position >= groupLength - 1e-9 || !item.plain) {
            leaving.push(item);
            continue;
        } // a nested tuplet moves out whole
        // a note across the end of the tuplet: the part inside stays, tied to the part outside
        const template = item.notes[0];
        const inside = piecesFor(round(groupLength - item.position), template, item.selected);
        if (!inside)
            return null;
        if (!template.isRest)
            inside[inside.length - 1].tiedToNext = true;
        kept.push({ ...item, length: round(groupLength - item.position), notes: inside });
        leaving.push({ position: groupLength, length: round(end - groupLength), notes: [template], plain: true, selected: false, tail: true });
    }
    const keptEnd = kept.length ? round(kept[kept.length - 1].position + kept[kept.length - 1].length) : 0;
    if (keptEnd < groupLength - 1e-9) {
        const pad = piecesFor(round(groupLength - keptEnd), restTemplate, false);
        if (!pad)
            return null;
        kept.push({ position: keptEnd, length: round(groupLength - keptEnd), notes: pad, plain: true, selected: false });
    }
    if (!kept.some(item => item.selected))
        return null;
    if (depth > 0)
        leaving.length = 0; // a nested tuplet can't run past its own group
    if (leaving.every(item => item.notes.every(note => note.isRest)))
        leaving.length = 0; // only silence would be pushed out: it just goes
    const groupNotes = kept.flatMap(item => item.notes);
    let finalNotes = cloneNotes([...notes.slice(0, range.first), ...groupNotes, ...notes.slice(range.last + 1)]);
    const selectedFirst = range.first + kept.filter(item => item.position < oldPosition[firstUnit] + 1e-9 && !item.selected).reduce((sum, item) => sum + item.notes.length, 0);
    const selectedCount = kept.filter(item => item.selected).reduce((sum, item) => sum + item.notes.length, 0);
    const lastGroupIndex = range.first + groupNotes.length - 1;
    const changes = {};
    if (leaving.length) {
        const realTotal = round(leaving.reduce((sum, item) => sum + item.length, 0) * scale);
        // Out of the tuplet as ordinary notes when every one can be written at its real length...
        let outside = [];
        for (const item of leaving) {
            if (!item.plain) {
                outside = null;
                break;
            }
            const real = round(item.length * scale);
            const source = item.notes[0];
            const pieces = fillDurationAsUnprocessed(real, source);
            const written = round(pieces.reduce((sum, piece) => sum + getNoteDuration(piece), 0));
            if (!pieces.length || Math.abs(written - real) > 1e-9) {
                outside = null;
                break;
            }
            if (item.tail)
                pieces.forEach(piece => { piece.articulations = []; });
            pieces[pieces.length - 1].tiedToNext = item.notes[item.notes.length - 1].tiedToNext && !source.isRest;
            outside.push(...pieces);
        }
        // ...otherwise they stay tuplet notes, in a second tuplet of the same ratio that follows (Insert mode only)
        if (!outside) {
            if (!insertMode)
                return null;
            const followingId = ++newTupletIdCounter;
            const carried = [];
            for (const item of leaving) {
                const pieces = item.tail ? piecesFor(item.length, item.notes[0], false) : item.notes;
                if (!pieces)
                    return null;
                carried.push(...pieces);
            }
            outside = cloneNotes(carried);
            outside.forEach(note => { note.tupletInfo = { ...note.tupletInfo, id: followingId }; });
        }
        if (insertMode) {
            finalNotes = [...finalNotes.slice(0, lastGroupIndex + 1), ...outside, ...finalNotes.slice(lastGroupIndex + 1)]; // everything after moves along
        }
        else {
            reindexTuplets(finalNotes);
            const timeline = getUnprocessedTimeline(finalNotes);
            const groupEnd = round(timeline[lastGroupIndex].start + timeline[lastGroupIndex].dur);
            const painted = paint(buildCells(finalNotes), groupEnd, round(groupEnd + realTotal), outside, true);
            if (!painted)
                return null;
            finalNotes = painted.flatMap(cell => cell.notes);
        }
        if (insertMode) {
            reindexTuplets(finalNotes);
            const timeline = getUnprocessedTimeline(finalNotes);
            const groupEnd = round(timeline[lastGroupIndex].start + timeline[lastGroupIndex].dur);
            for (const voice of staffVoices(ctx.part)) {
                if (voice.id === ctx.store.id)
                    continue;
                const shiftedVoice = shiftCellsAt(buildCells(voice.unprocessedNotes), groupEnd, realTotal);
                if (!shiftedVoice)
                    return null;
                changes[voice.id] = shiftedVoice.flatMap(cell => cell.notes);
            }
        }
    }
    reindexTuplets(finalNotes);
    if (tupletCrossesBarline(finalNotes, 0, Infinity))
        return null;
    const timeline = getUnprocessedTimeline(finalNotes);
    const start = timeline[selectedFirst].start;
    const last = timeline[selectedFirst + selectedCount - 1];
    const end = round(last.start + last.dur);
    changes[ctx.store.id] = finalNotes;
    return {
        changes,
        selection: { start, end, voice: ctx.sel.voice, base: { start, end } },
        newTotal: notesDuration(finalNotes),
    };
}
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Tie button: ties each selected note to the note after it when that is the same pitch (again to untie)
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Per voice, the indexes of selected notes whose next note has the same pitches
function tieCandidates(ctx) {
    const found = [];
    for (const group of ctx.groups) {
        const notes = group.store.unprocessedNotes;
        const indexes = group.entries.map(entry => entry.index).filter(index => {
            const note = notes[index];
            const next = notes[index + 1];
            return !!next && !note.isRest && !next.isRest && samePitches(note, next);
        });
        if (indexes.length)
            found.push({ store: group.store, indexes });
    }
    return found;
}
// Two same-pitch notes written as one note when a single note value does it and it sits properly in the bar;
// null when they have to stay two tied notes (a note across the barline or a beat group, a length with no single value)
function mergeTiedNotes(run, start) {
    const first = run[0];
    const second = run[run.length - 1];
    const sum = round(run.reduce((total, note) => total + getNoteDuration(note), 0));
    const key = getDurationKeyFromValue(sum);
    if (!key)
        return null;
    if (run.some(note => note.tupletInfo)) {
        if (run.some(note => !note.tupletInfo || levelIds(note) !== levelIds(first)))
            return null;
    }
    else {
        const bar = measureIndexAt(start);
        const into = round(start - measureStartOf(bar));
        const end = round(into + sum);
        if (end > measureLenOf(bar) + 1e-9)
            return null;
        const unit = key.endsWith('d') ? sum * 4 / 3 : sum;
        if (Math.abs(into / unit - Math.round(into / unit)) > 1e-6)
            return null;
        const cuts = groupCuts(bar);
        const atCut = (position) => cuts.some(cut => Math.abs(cut - position) < 1e-9);
        const wholeMeasure = into < 1e-9 && Math.abs(end - cuts[cuts.length - 1]) < 1e-9;
        const insideOneGroup = cuts.some((cut, at) => at < cuts.length - 1 && into >= cut - 1e-9 && end <= cuts[at + 1] + 1e-9);
        if (!(wholeMeasure || insideOneGroup || (atCut(into) && atCut(end))))
            return null;
    }
    const merged = noteOfKey(key, first);
    merged.articulations = [...first.articulations];
    copyTuplets(first, merged);
    merged.tiedToNext = second.tiedToNext;
    return merged;
}
function applyTie(ctx) {
    const found = tieCandidates(ctx);
    if (!found.length)
        return;
    const allTied = found.every(entry => entry.indexes.every(index => entry.store.unprocessedNotes[index].tiedToNext));
    const changes = {};
    for (const entry of found) {
        const original = entry.store.unprocessedNotes;
        if (allTied) { // untie
            const notes = cloneNotes(original);
            entry.indexes.forEach(index => { notes[index].tiedToNext = false; });
            changes[entry.store.id] = notes;
            continue;
        }
        // tie: write each pair as one note where that is how it would normally be written
        const chosen = new Set(entry.indexes);
        const timeline = getUnprocessedTimeline(original);
        const out = [];
        for (let at = 0; at < original.length;) {
            let links = 0; // tie links in a row starting at this note
            while (chosen.has(at + links))
                links++;
            let merged = null;
            let used = 0;
            for (let count = links; count >= 1 && !merged; count--) { // as many notes as will make one note, else fewer
                merged = mergeTiedNotes(original.slice(at, at + count + 1), timeline[at].start);
                used = count;
            }
            if (merged) {
                merged.tiedToNext = chosen.has(at + used) || original[at + used].tiedToNext;
                out.push(merged);
                at += used + 1;
                continue;
            }
            const note = cloneNotes([original[at]])[0];
            note.tiedToNext = chosen.has(at) || note.tiedToNext;
            out.push(note);
            at++;
        }
        reindexTuplets(out);
        changes[entry.store.id] = out;
    }
    commitVoiceEdits(ctx.part, changes, null, null);
}
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Slurs and grace notes
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// One slur per voice in the selection, over the voice's selected notes
function slurSpans(ctx) {
    const spans = [];
    for (const group of ctx.groups) {
        const pitched = group.entries.filter(entry => !group.store.unprocessedNotes[entry.index].isRest);
        if (pitched.length < 2)
            continue;
        spans.push({ voice: group.store.id, start: pitched[0].start, end: round(pitched[pitched.length - 1].start + pitched[pitched.length - 1].dur) });
    }
    return spans;
}
function sameSlur(mark, span) {
    return mark.voice === span.voice && Math.abs(mark.start - span.start) < 1e-6 && Math.abs(mark.end - span.end) < 1e-6;
}
function applySlur(ctx) {
    const spans = slurSpans(ctx);
    if (!spans.length)
        return;
    const staff = ctx.part;
    const allHave = spans.every(span => staff.slurs.some(mark => sameSlur(mark, span)));
    staff.slurs = staff.slurs.filter(mark => !spans.some(span => sameSlur(mark, span)));
    if (!allHave)
        for (const span of spans)
            staff.slurs.push({ ...span });
    staff.slurs.sort((first, second) => first.start - second.start);
    drawAllStaves();
    updateMemory();
}
function buildSlurMenu(host) {
    const heading = document.createElement('div');
    heading.className = 'buttonDescription';
    heading.textContent = 'Slur';
    host.appendChild(heading);
    const row = document.createElement('div');
    row.className = 'row';
    const button = document.createElement('button');
    button.className = 'tupletBtn';
    button.id = 'slurBtn';
    button.textContent = 'Slur';
    button.title = 'Slur over the selected notes (again to remove)';
    button.disabled = true;
    button.addEventListener('click', () => { const ctx = getEditContext(); if (ctx)
        applySlur(ctx); button.blur(); });
    row.appendChild(button);
    host.appendChild(row);
}
function refreshSlurMenu(ctx) {
    const button = document.getElementById('slurBtn');
    if (!button)
        return;
    const spans = ctx ? slurSpans(ctx) : [];
    button.disabled = spans.length === 0;
    button.classList.toggle('active', spans.length > 0 && spans.every(span => ctx.part.slurs.some(mark => sameSlur(mark, span))));
}
const GRACE_LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const MAX_GRACE_NOTES = 4;
// The notes of the selection that can take grace notes (pitched, and not the held part of a tied note)
function graceTargets(ctx) {
    const targets = [];
    for (const group of ctx.groups) {
        const notes = group.store.unprocessedNotes;
        for (const entry of group.entries) {
            const note = notes[entry.index];
            const previous = notes[entry.index - 1];
            const continuesTie = !!previous && previous.tiedToNext && !previous.isRest && !note.tupletInfo && samePitches(previous, note);
            if (!note.isRest && !continuesTie)
                targets.push({ group, index: entry.index, note });
        }
    }
    return targets;
}
function applyGrace(ctx, action) {
    const targets = graceTargets(ctx);
    if (!targets.length)
        return;
    const slash = document.getElementById('graceType')?.value !== 'appoggiatura';
    const duration = document.getElementById('graceValue')?.value ?? '8';
    const changes = {};
    for (const group of ctx.groups) {
        const notes = [...group.store.unprocessedNotes];
        const timeline = getUnprocessedTimeline(group.store.unprocessedNotes);
        let changed = false;
        for (const target of targets.filter(candidate => candidate.group === group)) {
            const copy = cloneNotes([target.note])[0];
            if (action === 'clear') {
                if (!copy.graceNotes.length)
                    continue;
                copy.graceNotes = [];
            }
            else {
                if (copy.graceNotes.length >= MAX_GRACE_NOTES)
                    continue;
                const letter = document.getElementById('graceLetter').value;
                const chosen = document.getElementById('graceAccidental').value;
                const accidental = chosen === 'n' ? '' : chosen;
                const octave = parseInt(document.getElementById('graceOctave').value, 10);
                copy.graceNotes.push({ noteName: [letter + accidental], octaves: [octave], duration, slash });
            }
            notes[target.index] = copy;
            changed = true;
        }
        if (changed)
            changes[group.store.id] = notes;
    }
    if (Object.keys(changes).length)
        commitVoiceEdits(ctx.part, changes, null, null);
}
function buildGraceMenu(host) {
    const heading = document.createElement('div');
    heading.className = 'buttonDescription';
    heading.textContent = 'Grace note';
    host.appendChild(heading);
    const choiceRow = document.createElement('div');
    choiceRow.className = 'row';
    const makeSelect = (id, options) => {
        const select = document.createElement('select');
        select.id = id;
        for (const [value, label] of options) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            select.appendChild(option);
        }
        select.addEventListener('change', () => select.blur());
        choiceRow.appendChild(select);
    };
    makeSelect('graceType', [['acciaccatura', 'Acciaccatura'], ['appoggiatura', 'Appoggiatura']]);
    makeSelect('graceValue', [['8', '\u266A'], ['16', '\u266C'], ['32', '32nd']]);
    host.appendChild(choiceRow);
    const pitchRow = document.createElement('div');
    pitchRow.className = 'row';
    const addPitchSelect = (id, options, selected) => {
        const select = document.createElement('select');
        select.id = id;
        for (const [value, label] of options) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            select.appendChild(option);
        }
        select.value = selected;
        select.addEventListener('change', () => select.blur());
        pitchRow.appendChild(select);
    };
    addPitchSelect('graceLetter', ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(letter => [letter, letter]), 'C');
    addPitchSelect('graceAccidental', [['##', '\uD834\uDD2A'], ['#', '\u266F'], ['n', '\u266E'], ['b', '\u266D'], ['bb', '\uD834\uDD2B']], 'n');
    addPitchSelect('graceOctave', [0, 1, 2, 3, 4, 5, 6, 7, 8].map(octave => [String(octave), String(octave)]), '5');
    host.appendChild(pitchRow);
    const row = document.createElement('div');
    row.className = 'row';
    const buttons = [
        { id: 'graceAdd', label: 'Add', title: 'Add this grace note before the selected notes', action: 'add' },
        { id: 'graceClear', label: 'Clear', title: 'Remove the grace notes of the selected notes', action: 'clear' },
    ];
    for (const definition of buttons) {
        const button = document.createElement('button');
        button.className = 'tupletBtn';
        button.id = definition.id;
        button.textContent = definition.label;
        button.title = definition.title;
        button.disabled = true;
        button.addEventListener('click', () => { const ctx = getEditContext(); if (ctx)
            applyGrace(ctx, definition.action); button.blur(); });
        row.appendChild(button);
    }
    host.appendChild(row);
}
let lastGraceDefault = '';
function refreshGraceMenu(ctx) {
    const targets = ctx ? graceTargets(ctx) : [];
    const add = document.getElementById('graceAdd');
    if (add)
        add.disabled = targets.length === 0;
    const clear = document.getElementById('graceClear');
    if (clear)
        clear.disabled = !targets.some(target => target.note.graceNotes.length > 0);
    // when a different note is selected, the pitch boxes start on that note's pitch
    if (targets.length) {
        const note = targets[0].note;
        const top = note.noteName.length - 1;
        const signature = `${targets[0].index}:${note.noteName[top]}${note.octaves[top]}`;
        if (signature !== lastGraceDefault) {
            lastGraceDefault = signature;
            const { letter, acc } = parsePitchName(note.noteName[top]);
            document.getElementById('graceLetter').value = letter;
            document.getElementById('graceAccidental').value = acc === '' ? 'n' : acc;
            document.getElementById('graceOctave').value = String(Math.max(0, Math.min(8, note.octaves[top])));
        }
    }
}
function buildTieMenu(host) {
    const heading = document.createElement('div');
    heading.className = 'buttonDescription';
    heading.textContent = 'Tie';
    host.appendChild(heading);
    const row = document.createElement('div');
    row.className = 'row';
    const button = document.createElement('button');
    button.className = 'tupletBtn';
    button.id = 'tieBtn';
    button.textContent = 'Tie';
    button.title = 'Tie the selected note to the next note if it is the same pitch';
    button.disabled = true;
    button.addEventListener('click', () => { const ctx = getEditContext(); if (ctx)
        applyTie(ctx); button.blur(); });
    row.appendChild(button);
    host.appendChild(row);
}
function refreshTieMenu(ctx) {
    const button = document.getElementById('tieBtn');
    if (!button)
        return;
    const found = ctx ? tieCandidates(ctx) : [];
    button.disabled = found.length === 0;
    button.classList.toggle('active', found.length > 0 && found.every(entry => entry.indexes.every(index => entry.store.unprocessedNotes[index].tiedToNext)));
}
