"use strict";
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Create tab: generate, accompany, modify, develop
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
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
        const duration = round(notesDuration(notes));
        const temp = new Staff(staff.name, staff.pitchRange, staff.rhythmRange, staff.scale);
        temp.harmonize = staff.harmonize;
        totalDuration = startOffset;
        generatePhrase(temp, duration, true, startOffset);
        return temp.unprocessedNotes.length > 0 ? temp.unprocessedNotes : notes;
    };
    const clear = clearedToRests;
    const jobs = targets.map(store => ({ store, transform: store === writer ? generate : clear }));
    if (!jobs.some(job => job.store === writer))
        jobs.push({ store: writer, transform: generate });
    return applyRangeJobs(sel, jobs);
}
// The ways a tuplet can be made: this many notes in the time of that many
const TUPLET_RATIOS = [[3, 2], [4, 3], [5, 4], [6, 4], [7, 4]];
// Splits `units` into parts of 1 to 4 units, at random
function randomParts(units, partUnits) {
    const parts = [];
    let left = units;
    while (left > 0) {
        const fitting = partUnits.filter(size => size <= left);
        if (!fitting.length)
            return [];
        const size = fitting[Math.floor(Math.random() * fitting.length)];
        parts.push(size);
        left -= size;
    }
    return parts;
}
// A tuplet of notes of different values (sometimes with a small tuplet inside it) that fills occupied x base units of time.
// It may run across a barline, but none of its notes may. Null if it cannot be made here.
function makeRandomTuplet(staff, baseKey, allowedDurations, startTime, remaining, firstId) {
    const base = durationMapping[baseKey];
    const [count, occupied] = TUPLET_RATIOS[Math.floor(Math.random() * TUPLET_RATIOS.length)];
    const total = round(occupied * base);
    if (total > remaining + 1e-9)
        return null;
    const keyFor = (units, unit) => {
        const key = getDurationKeyFromValue(round(units * unit));
        return key && allowedDurations.includes(key) ? key : null;
    };
    // the slots of the outer tuplet: a value each, some of which are replaced by a smaller tuplet
    const sizes = [1, 2, 3, 4].filter(size => keyFor(size, base));
    const parts = randomParts(count, sizes);
    if (parts.length < 2)
        return null;
    const slots = parts.map(size => ({ key: keyFor(size, base), inner: null }));
    if (Math.random() < 0.3) {
        const candidates = slots.filter(slot => !slot.key.includes('d') && durationMapping[slot.key] >= 1 / 16 && keyFor(1, durationMapping[slot.key] / 2));
        const chosen = candidates[Math.floor(Math.random() * candidates.length)];
        if (chosen) {
            const half = durationMapping[chosen.key] / 2;
            const innerParts = [[1, 1, 1], [1, 2], [2, 1]][Math.floor(Math.random() * 3)];
            const innerKeys = innerParts.map(size => keyFor(size, half));
            if (innerKeys.every(key => key))
                chosen.inner = innerKeys;
        }
    }
    const notes = [];
    let nextId = firstId + 1;
    const outerCount = slots.reduce((sum, slot) => sum + (slot.inner ? slot.inner.length : 1), 0);
    let position = 0;
    for (const slot of slots) {
        const keys = slot.inner ?? [slot.key];
        const innerId = slot.inner ? nextId++ : 0;
        keys.forEach((key, innerIndex) => {
            const [noteName, noteOctave] = randomPitchFromScale(staff, durationMapping[key]);
            const note = new UnprocessedNote(noteName, noteOctave, key.replace(/d$/, ''), key.endsWith('d'));
            position++;
            note.setTuplet(firstId, total, [count, occupied], outerCount, position);
            if (slot.inner)
                note.innerTuplets = [{ id: innerId, totalTupletDuration: 0, ratio: [3, 2], count: keys.length, index: innerIndex + 1 }];
            notes.push(note);
        });
    }
    refreshTupletTotals(notes);
    // no note of it may run across a barline
    const timeline = getUnprocessedTimeline(notes);
    for (const piece of timeline) {
        const from = round(startTime + piece.start);
        const to = round(startTime + piece.start + piece.dur);
        if (measureIndexAt(from) !== measureIndexAt(round(to - 1e-6)))
            return null;
    }
    return { notes, total, idsUsed: nextId - firstId };
}
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
    const minAllowed = Math.min(...allowedDurations.map(duration => durationMapping[duration]));
    if (round(duration % minAllowed) > 1e-9) {
        return;
    }
    while (currentDuration < duration) {
        const remaining = round(duration - currentDuration);
        const fittingDurations = allowedDurations.filter(duration => durationMapping[duration] <= remaining + 1e-9);
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
            const group = makeRandomTuplet(staff, durationStr, allowedDurations, round(startOffset + currentDuration), remaining, ++tupletId);
            if (!group) {
                --tupletId;
                continue;
            }
            tupletId += group.idsUsed - 1;
            notes.push(...group.notes);
            totalDuration += group.total;
            currentDuration = round(currentDuration + group.total);
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
            .filter(cut => cut > pos + 1e-9 && cut < end - 1e-9)
            .sort((first, second) => first - second);
        if (cuts.length === 0) {
            out.push(note);
        }
        else {
            const edges = [pos, ...cuts, end];
            for (let itemIndex = 0; itemIndex < edges.length - 1; itemIndex++) {
                const pieces = fillDurationAsUnprocessed(round(edges[itemIndex + 1] - edges[itemIndex]), note);
                pieces[pieces.length - 1].tiedToNext = itemIndex < edges.length - 2 ? true : note.tiedToNext;
                out.push(...pieces);
            }
        }
        pos = end;
    }
    return out;
}
function buildTimeline(pieces, startPos) {
    const timeline = [];
    const tupletSpans = [];
    let pos = startPos;
    let unitStart = pos;
    let unitEnd = pos;
    let offset = 0;
    for (const note of pieces) {
        if (note.tupletInfo) {
            const info = note.tupletInfo;
            if (info.index === 1) {
                unitStart = pos;
                unitEnd = round(pos + info.totalTupletDuration);
                tupletSpans.push({ start: unitStart, end: unitEnd });
                offset = 0;
            }
            const real = getRealDuration(note);
            timeline.push({
                note,
                start: round(unitStart + offset),
                end: round(unitStart + offset + real),
                unitStart,
                unitEnd,
            });
            offset += real;
            if (info.index === info.count)
                pos = unitEnd;
        }
        else {
            const end = round(pos + getNoteDuration(note));
            timeline.push({ note, start: pos, end, unitStart: pos, unitEnd: end });
            pos = end;
        }
    }
    return { timeline, tupletSpans };
}
// Each track's range clipped to the source's, never cutting through a source tuplet
function clipRanges(selectedNames, sourceName, source, tupletSpans) {
    const ranges = { [sourceName]: { start: source.start, end: source.end } };
    for (const name of selectedNames) {
        if (name === sourceName)
            continue;
        const range = getSelection(name);
        let start = Math.max(range.start, source.start);
        let end = Math.min(range.end, source.end);
        for (const span of tupletSpans) {
            if (start > span.start + 1e-9 && start < span.end - 1e-9)
                start = span.end;
            if (end > span.start + 1e-9 && end < span.end - 1e-9)
                end = span.start;
        }
        if (end - start > 1e-9)
            ranges[name] = { start, end };
    }
    return ranges;
}
// Give every piece to one track (a random one that can play it); the others get a rest of the same length
function distributePieces(timeline, targets, ranges, active, sourceName) {
    const out = {};
    for (const name of targets)
        out[name] = [];
    let chainTarget = null; // keeps a tied chain in one track while that stays possible
    for (const piece of timeline) {
        const note = piece.note;
        totalDuration = piece.start;
        const covering = targets.filter(staffName => ranges[staffName].start <= piece.unitStart + 1e-9 && ranges[staffName].end >= piece.unitEnd - 1e-9);
        const canon = note.isRest ? null : canonicalPitch(note.noteName[0], note.octaves[0]);
        const candidates = covering.filter(staffName => note.isRest || getAllowedPitches(active[staffName], getNoteDuration(note)).includes(canon.name + canon.octave));
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
            const range = ranges[name];
            if (piece.start < range.start - 1e-9 || piece.end > range.end + 1e-9)
                continue; // outside this track's range
            const newNote = (name === target && !note.isRest)
                ? new UnprocessedNote([...note.noteName], [...note.octaves], note.duration, note.dotted, note.tiedToNext)
                : makeRest(note.duration, note.dotted);
            copyTuplets(note, newNote);
            out[name].push(newNote);
        }
    }
    return out;
}
// Spread the selected notes of the top track over all the selected tracks
function separateStaff() {
    const active = getActiveStaves();
    const selectedNames = staves.filter(staffName => getSelection(staffName)); // `voices` is ordered top to bottom
    if (selectedNames.length < 2)
        return false;
    const sourceName = selectedNames[0]; // highest selected track
    const source = getSelection(sourceName);
    padStavesToLength();
    const sourceSlice = sliceRange(active[sourceName], source.start, source.end);
    if (!sourceSlice.ok) {
        alert(`Selection in ${sourceName} cuts through a tuplet — adjust it to cover the whole tuplet.`);
        return false;
    }
    // Cut the source's notes wherever another track's range begins or ends
    const breaks = [];
    for (const selectedName of selectedNames) {
        if (selectedName === sourceName)
            continue;
        const range = getSelection(selectedName);
        breaks.push(range.start, range.end);
    }
    const pieces = splitNotesAt(sourceSlice.selected, source.start, breaks);
    const { timeline, tupletSpans } = buildTimeline(pieces, source.start);
    const ranges = clipRanges(selectedNames, sourceName, source, tupletSpans);
    const targets = selectedNames.filter(staffName => ranges[staffName]);
    if (targets.length < 2)
        return false;
    // Every target must be sliceable before anything is written
    const slices = {};
    for (const name of targets) {
        const slice = sliceRange(active[name], ranges[name].start, ranges[name].end);
        if (!slice.ok) {
            alert(`Selection in ${name} cuts through a tuplet — adjust it to cover the whole tuplet.`);
            return false;
        }
        slices[name] = slice;
    }
    const out = distributePieces(timeline, targets, ranges, active, sourceName);
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
function reverseNotes(notes) {
    const reversed = [...notes].reverse();
    for (const note of reversed) {
        for (const level of tupletLevels(note))
            level.index = level.count - level.index + 1;
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
        copyTuplets(note, reflectedNote);
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
        const shifted = [makeRest(distance), ...voice.unprocessedNotes];
        if (tupletCrossesBarline(shifted, 0, Infinity)) {
            console.warn("Shift rejected: a tuplet note would cross a barline");
            return;
        }
        const totalDur = notesDuration(shifted);
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
            transposedNote.articulations = [...note.articulations];
        }
        copyTuplets(note, transposedNote);
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
    for (let index = rhythmGroups.length - 1; index > 0; index--) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [rhythmGroups[index], rhythmGroups[swapIndex]] = [rhythmGroups[swapIndex], rhythmGroups[index]];
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
            for (let itemIndex = 0; itemIndex < group.notes.length; itemIndex++) {
                const rhythmNote = group.notes[itemIndex];
                const pitch = pitches[pitchIdx++];
                const newNote = new UnprocessedNote(pitch.noteName, pitch.octave, rhythmNote.duration, rhythmNote.dotted);
                newNote.setTuplet(newTupletId, firstNoteInfo.totalTupletDuration, [...firstNoteInfo.ratio], firstNoteInfo.count, itemIndex + 1);
                newNote.innerTuplets = rhythmNote.innerTuplets.map(level => ({ ...level, ratio: [...level.ratio] }));
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
    for (let index = groups.length - 1; index > 0; index--) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [groups[index], groups[swapIndex]] = [groups[swapIndex], groups[index]];
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
            const hasInner = shuffled.some(note => note.innerTuplets.length > 0); // notes of a tuplet inside this one stay where they are
            for (let itemIndex = shuffled.length - 1; itemIndex > 0 && !hasInner; itemIndex--) {
                const swapWith = Math.floor(Math.random() * (itemIndex + 1));
                [shuffled[itemIndex], shuffled[swapWith]] = [shuffled[swapWith], shuffled[itemIndex]];
            }
            for (let noteIndex = 0; noteIndex < shuffled.length; noteIndex++) {
                const tupletNote = shuffled[noteIndex];
                const newNote = new UnprocessedNote(tupletNote.noteName, tupletNote.octave, tupletNote.duration, tupletNote.dotted);
                newNote.setTuplet(tupletId, firstNoteInfo.totalTupletDuration, [...firstNoteInfo.ratio], firstNoteInfo.count, noteIndex + 1);
                newNote.innerTuplets = tupletNote.innerTuplets.map(level => ({ ...level, ratio: [...level.ratio] }));
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
    for (let index = pitches.length - 1; index > 0; index--) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [pitches[index], pitches[swapIndex]] = [pitches[swapIndex], pitches[index]];
    }
    const newNotes = [];
    let pitchIdx = 0;
    for (const note of notes) {
        let newNote;
        if (note.isRest) {
            newNote = makeRest(note.duration, note.dotted);
        }
        else {
            const pitch = pitches[pitchIdx++];
            newNote = new UnprocessedNote(pitch.noteName, pitch.octave, note.duration, note.dotted);
        }
        copyTuplets(note, newNote);
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
        for (let itemIndex = 0; itemIndex < originalNotes.length - 1; itemIndex++) {
            const note = originalNotes[itemIndex];
            const remaining = round(targetDuration - currentDuration);
            const notesLeft = originalNotes.length - itemIndex - 1;
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
            newNote = makeRest(note.duration, note.dotted);
        }
        else {
            const [noteName, octave] = randomPitchFromScale(staff, getNoteDuration(note), false);
            newNote = new UnprocessedNote(noteName, octave, note.duration, note.dotted);
        }
        copyTuplets(note, newNote);
        totalDuration += getRealDuration(note);
        return newNote;
    });
    return newNotes;
}
function simplifyNotes(notes, startOffset) {
    const currentNotes = notes;
    const simplifiedNotes = [];
    let index = 0;
    let elapsed = 0;
    while (index < currentNotes.length) {
        const note = currentNotes[index];
        if (note.tupletInfo) {
            const id = note.tupletInfo.id;
            const tupletNotes = [];
            while (index < currentNotes.length && currentNotes[index].tupletInfo?.id === id) {
                tupletNotes.push(currentNotes[index]);
                index++;
            }
            const { totalTupletDuration, ratio } = tupletNotes[0].tupletInfo;
            const [, notesOccupied] = ratio;
            elapsed = round(elapsed + totalTupletDuration);
            // tuplets of mixed values, or with another tuplet inside, are left as they are
            const plain = tupletNotes.every(tupletNote => tupletNote.duration === tupletNotes[0].duration && tupletNote.dotted === tupletNotes[0].dotted && tupletNote.innerTuplets.length === 0);
            if (!plain) {
                tupletNotes.forEach(tupletNote => { const copy = new UnprocessedNote([...tupletNote.noteName], [...tupletNote.octaves], tupletNote.duration, tupletNote.dotted); copyTuplets(tupletNote, copy); simplifiedNotes.push(copy); });
                continue;
            }
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
            let nextIndex = index + 1;
            let merged = false;
            while (nextIndex < currentNotes.length) {
                if (currentNotes[nextIndex].tupletInfo)
                    break;
                combinedDuration = round(combinedDuration + getNoteDuration(currentNotes[nextIndex]));
                const durStr = getDurationKeyFromValue(combinedDuration);
                const from = round(startOffset + elapsed);
                const to = round(startOffset + elapsed + combinedDuration);
                const wouldCrossBarline = posInMeasureAt(to) > 1e-9 && measureIndexAt(from) !== measureIndexAt(to);
                if (!wouldCrossBarline && round(combinedDuration) !== round(measureLenOf(measureIndexAt(from))) && durStr && Math.random() < 0.5) {
                    simplifiedNotes.push(new UnprocessedNote(noteName, noteOctave, durStr));
                    elapsed = round(elapsed + combinedDuration);
                    index = nextIndex + 1;
                    merged = true;
                    break;
                }
                nextIndex++;
            }
            if (!merged) {
                simplifiedNotes.push(note);
                elapsed = round(elapsed + getNoteDuration(note));
                index++;
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
// Delete one stretch of time from a list of notes: Overwrite leaves rests there, Insert closes the gap (rests at the
// end keep the length). Null if the stretch cuts through a tuplet.
function deleteSpan(notes, from, to, closeGap) {
    const { before, after, ok } = sliceRange({ unprocessedNotes: notes }, from, to);
    if (!ok)
        return null;
    const head = cloneNotes(before);
    const tail = cloneNotes(after);
    if (head.length)
        head[head.length - 1].tiedToNext = false;
    const gap = round(to - from);
    if (closeGap)
        return [...head, ...tail, ...fillDurationWithRests(gap, notesDuration([...head, ...tail]))];
    return coalesceRests([...head, ...fillDurationWithRests(gap, from), ...tail], (_index, start, end) => start < to - 1e-9 && end > from + 1e-9);
}
// Create tab Delete, following the Insert / Overwrite / Polyphony mode. A tuplet the range only partly covers keeps its
// length: the notes of it inside the range become rests in place. A tuplet inside the range goes whole.
function deleteNotesInRanges() {
    const active = getActiveStaves();
    const jobs = [];
    for (const name of staves) {
        const sel = getSelection(name);
        if (!sel)
            continue;
        for (const store of selectionTargets(active[name], sel)) {
            let notes = cloneNotes(store.unprocessedNotes);
            const timeline = getUnprocessedTimeline(notes);
            // outermost tuplets that the range covers only in part
            const groups = new Map();
            timeline.forEach((entry, index) => {
                const id = notes[index].tupletInfo?.id;
                if (id === undefined)
                    return;
                const group = groups.get(id) ?? { start: entry.start, end: entry.start, members: [] };
                group.end = round(entry.start + entry.dur);
                group.members.push(index);
                groups.set(id, group);
            });
            const kept = [];
            let changedMembers = false;
            for (const group of groups.values()) {
                const overlaps = group.start < sel.end - 1e-9 && group.end > sel.start + 1e-9;
                const inside = group.start >= sel.start - 1e-9 && group.end <= sel.end + 1e-9;
                if (!overlaps || inside)
                    continue;
                kept.push({ start: group.start, end: group.end });
                for (const member of group.members) {
                    const entry = timeline[member];
                    if (entry.start < sel.end - 1e-9 && entry.start + entry.dur > sel.start + 1e-9 && !notes[member].isRest) {
                        const rest = makeRest(notes[member].duration, notes[member].dotted);
                        copyTuplets(notes[member], rest);
                        notes[member] = rest;
                        changedMembers = true;
                    }
                }
            }
            // the rest of the range, without those tuplets, latest stretch first so earlier positions stay put
            const stretches = [];
            let cursor = sel.start;
            for (const hole of kept.sort((first, second) => first.start - second.start)) {
                if (hole.start > cursor + 1e-9)
                    stretches.push({ start: cursor, end: Math.min(hole.start, sel.end) });
                cursor = Math.max(cursor, hole.end);
            }
            if (cursor < sel.end - 1e-9)
                stretches.push({ start: cursor, end: sel.end });
            for (const stretch of stretches.reverse()) {
                const next = deleteSpan(notes, stretch.start, stretch.end, insertMode);
                if (!next) {
                    alert(`Selection in ${store.name} cuts through a tuplet — adjust it to cover the whole tuplet.`);
                    return;
                }
                notes = next;
            }
            renumberTuplets(notes);
            if (tupletCrossesBarline(notes, 0, Infinity)) {
                alert(`That change would put a tuplet note across a barline in ${store.name}.`);
                return;
            }
            if (stretches.length || changedMembers)
                jobs.push({ store, notes });
        }
    }
    if (!jobs.length)
        return;
    for (const job of jobs) {
        resetVoice(job.store);
        processNotes(job.store, job.notes);
    }
    drawAllStaves();
    updateMemory();
}
