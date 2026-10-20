////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Notation: drawing, spacing, layout capture, measure bar
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// VexFlow decides sideways shifts from stem collisions, so notes more than a second apart can still move.
// We keep its handling of rests (moving them up/down, hiding identical rests in two voices) but replace the
// shifting of notes: a note moves aside ONLY if another note starting at the same moment is a second or less away.

function customStaveNoteFormat(notes: any[], state: any): boolean {
  const before = state.right_shift;
  const result = STAVENOTE_FORMAT_VEXFLOW(notes, state);   // rests: vertical moves, hiding identical rests
  state.right_shift = before;                              // we decide the extra width ourselves

  const pitched = notes.filter((vfNote: any) => !vfNote.isRest());
  pitched.forEach((vfNote: any) => {
    vfNote.setXShift(0);                                                                    // undo VexFlow's note shifts
    if (vfNote._stems && vfNote.getStemDirection() !== vfNote._stems) vfNote.setStemDirection(vfNote._stems);   // and its stem flips
  });

  // Three or more voices at one moment: VexFlow assumes the voices are listed top to bottom, which ours are not,
  // so its rest placement can land on the note heads. Put each rest on its own voice's side of the staff instead,
  // moving it away from any head it would touch.
  if (notes.length >= 3) {
    const obstacles: number[] = pitched.flatMap((vfNote: any) => vfNote.getKeyProps().map((keyProp: any) => keyProp.line));
    notes.filter((vfNote: any) => vfNote.isRest() && vfNote._stems && vfNote.render_options.draw !== false).forEach((restNote: any) => {
      const up = restNote._stems === 1;
      const above = restNote.glyph && restNote.glyph.line_above != null ? restNote.glyph.line_above : 1.5;
      const below = restNote.glyph && restNote.glyph.line_below != null ? restNote.glyph.line_below : 1.5;
      let line = up ? 4 : 2;
      for (let index = 0; index < 8; index++) {
        if (!obstacles.some(obstacle => obstacle > line - below - 0.5 && obstacle < line + above + 0.5)) break;
        line += up ? 1 : -1;
      }
      restNote.setKeyLine(0, line);
      obstacles.push(line);
    });
  }

  if (pitched.length < 2) return result;

  const lines = (vfNote: any): number[] => vfNote.getKeyProps().map((keyProp: any) => keyProp.line);
  const conflict = (noteA: any, noteB: any): boolean => {
    let min = Infinity;
    for (const la of lines(noteA)) for (const lb of lines(noteB)) min = Math.min(min, Math.abs(la - lb));
    return min < 1;                                        // a second apart or closer, unisons included: side by side
  };

  // columns: the first voice stays put; a later voice moves right until it clears every note it conflicts with
  const col = new Map<any, number>();
  const width = Math.max(...pitched.map((vfNote: any) => vfNote.getVoiceShiftWidth())) + 2;
  let maxCol = 0;
  pitched.forEach((note: any) => {
    let cell = 0;
    while (pitched.some((otherNote: any) => otherNote !== note && col.get(otherNote) === cell && conflict(note, otherNote))) cell++;
    col.set(note, cell);
    maxCol = Math.max(maxCol, cell);
    note.setXShift(cell * width);
  });
  state.right_shift = before + maxCol * width;
  return result;
}

function ensureSvgSize(partName: string, requiredWidth: number): void {
  const container = containers[partName];
  const height = container.clientHeight || 300;

  renderers[partName].resize(requiredWidth, height);

  const svg = container.querySelector('svg');
  if (svg) {
    svg.setAttribute('width', String(requiredWidth));
    svg.setAttribute('height', String(height));
    svg.setAttribute('viewBox', `0 0 ${requiredWidth} ${height}`);
    svg.style.width   = `${requiredWidth}px`;
    svg.style.height  = `${height}px`;
    svg.style.overflow = 'visible';
  }

  const outputDiv = document.getElementById('output');
  if (outputDiv) outputDiv.style.width = `${requiredWidth + 200}px`;

  contexts[partName] = renderers[partName].getContext();
}

function getGlobalMeasureWidths(staffList: Staff[]): number[] {
  const globalWidths: number[] = [];
  staffList.forEach(staff => {
    staffVoices(staff).forEach(voice => {
      voice.notes.forEach((measureNotes, index) => {
        if (!voiceShownInBar(voice, index)) return;
        const width = 200 + measureNotes.length * 40 + (sigShownAt(index) && index > 0 ? 25 : 0);
        globalWidths[index] = Math.max(globalWidths[index] || 0, width);
      });
    });
  });
  for (let itemIndex = globalWidths.length; itemIndex < numMeasures; itemIndex++) {
    globalWidths[itemIndex] = 400 + (sigShownAt(itemIndex) && itemIndex > 0 ? 25 : 0);
  }
  return globalWidths;
}

function getTupletsForMeasure(staff: NoteStore, measureIndex: number): any[] {
  const measureNoteSet = new Set(staff.notes[measureIndex]);
  return staff.tuplets
    .filter(tuplet => tuplet.tupletNotes.some(note => measureNoteSet.has(note)))
    .map(tuplet => tuplet.vfTuplet);
}

function padStavesToLength(): void {
  const allStaves = [...staves.map(staffName => mainStaves[staffName]), ...staves.map(staffName => harmonyStaves[staffName])];
  allStaves.forEach(pruneEmptyVoices);

  const stores: NoteStore[] = allStaves.flatMap(staff => staffVoices(staff));
  const target = round(Math.max(totalLength(), ...stores.map(staff => notesDuration(staff.unprocessedNotes))));
  const targetMeasures = measuresCovering(target);

  for (const store of stores) {
    const have = notesDuration(store.unprocessedNotes);
    const short = have < target - 1e-9;
    const stale = store.notes.length !== targetMeasures;
    if (!short && !stale) continue;

    let notes = [...store.unprocessedNotes];
    if (short) notes = [...notes, ...fillDurationWithRests(round(target - have), have)];
    resetVoice(store);
    processNotes(store, notes);
  }
}

function clampSelections(): void {
  const total = totalLength();
  for (const layer of ['main', 'harmony'] as const) {
    const store = selections[layer];
    for (const name of Object.keys(store)) {
      const range = store[name];
      if (!range) continue;
      if (range.start >= total - 1e-9) store[name] = null;
      else if (range.end > total) store[name] = { ...range, end: total, base: range.base && range.base.end > total ? { ...range.base, end: total } : range.base };
    }
  }
}

function drawAllStaves(includeHarmony: boolean = false): void {
  if (playStartMeasure >= numMeasures) playStartMeasure = Math.max(0, numMeasures - 1);
  clampSelections();
  padStavesToLength();
  const staffList = Object.values(getActiveStaves());

  const globalMeasureWidths = getGlobalMeasureWidths(staffList);
  const requiredWidth = globalMeasureWidths.reduce((total, width) => total + width, 0) + 100;

  staffList.forEach(staff => {
    eraseDrawing(staff);
    ensureSvgSize(staff.name, requiredWidth);
    gridLayout[staff.name] = { measures: [] };
  });

  const measureCount = Math.max(...staffList.map(staff => staff.notes.length), numMeasures);
  let staffLength = 0;

  for (let measureIndex = 0; measureIndex < measureCount; measureIndex++) {
    const staveWidth = globalMeasureWidths[measureIndex] || 400;
    const vfStaves: Record<string, any> = {};
    const items: { vf: any; staff: Staff; notes: any[]; beams: any[]; tuplets: any[] }[] = [];
    const drawnNotes: Record<string, any[]> = {};     // every note drawn on a staff in this bar (all its voices)

    staffList.forEach(staff => {
      const stave = new Stave(staffLength, 60, staveWidth);
      if (measureIndex === 0) stave.addClef("treble");
      if (sigShownAt(measureIndex)) stave.addTimeSignature(`${sigOf(measureIndex).num}/${sigOf(measureIndex).den}`);
      stave.setContext(contexts[staff.name]).draw();
      vfStaves[staff.name] = stave;

      const shown = staffVoices(staff).filter(voice => voiceShownInBar(voice, measureIndex));
      const several = shown.length > 1;   // one voice: stems stay as they are. Several: each voice's stems are fixed
      drawnNotes[staff.name] = [];

      shown.forEach(voice => {
        const notes = voice.notes[measureIndex] || [];
        notes.forEach((note: any) => {
          note.setStave(stave);                                   // attach every note to its own staff: collisions are then decided per staff
          note._stems = several ? voice.stems : undefined;
          if (several && !note.isRest() && note.getStemDirection() !== voice.stems) note.setStemDirection(voice.stems);
          if (note.render_options) note.render_options.draw = true;  // start from "visible"; formatting may hide a duplicate rest
        });

        const vf = new VFVoice({ num_beats: sigOf(measureIndex).num, beat_value: sigOf(measureIndex).den }).setStrict(false);
        vf.addTickables(notes);

        items.push({
          vf,
          staff,
          notes,
          beams: Vex.Flow.Beam.generateBeams(notes, { maintain_stem_directions: several, groups: beamGroups(measureIndex) }),   // before drawing, so beamed notes get no tails
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
      } catch (err) {
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
      } catch (err) {
        console.error('draw failed', staff.name, 'm' + (measureIndex + 1), err);
      }
    });

    staffList.forEach(staff => {
      try {
        captureMeasureLayout(staff, measureIndex, vfStaves[staff.name], drawnNotes[staff.name]);
      } catch (err) {
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
    (wrapper as HTMLElement).style.minWidth = `${requiredWidth + 200}px`;
  });
  // Set measureBarWrapper width to match notation so sticky works
  const measureBarWrapper = document.getElementById('measureBarWrapper');
  if (measureBarWrapper) measureBarWrapper.style.minWidth = `${requiredWidth + 200}px`;

  // Draw measure bar
  const barWidths = globalMeasureWidths.length > 0
    ? globalMeasureWidths
    : Array(numMeasures).fill(400);
  drawMeasureBar(barWidths);
}

function drawTies(tieGroups: any[][], context: any): void {
  for (const notesToTie of tieGroups) {
    for (let index = 0; index < notesToTie.length - 1; ++index) {
      new StaveTie({
        first_note: notesToTie[index],
        last_note: notesToTie[index + 1],
        first_indices: [0],
        last_indices: [0],
      }).setContext(context).draw();
    }
  }
}

function eraseDrawing(staff: Staff): void {
  const partName = staff.name;
  if (!partName || !containers[partName]) {
    console.warn("No container found for part:", partName);
    return;
  }
  containers[partName].innerHTML = "";
  renderers[partName] = new Renderer(containers[partName], Renderer.Backends.SVG);
  contexts[partName] = renderers[partName].getContext();
}

let selectedMeasureIndex: number | null = null;

// Gives measure `index` a new time signature. The measures after it that had the same signature follow it. Notes
// keep their place in time and are re-barred; rests are rewritten to fit the new bars.
function changeMeasureSig(index: number, num: number, den: number): boolean {
  padStavesToLength();
  normalizeSigs();
  const old = sigOf(index);
  if (old.num === num && old.den === den) return true;

  let end = index + 1;
  while (end < numMeasures && sigOf(end).num === old.num && sigOf(end).den === old.den) end++;

  const saved = measureSigs;
  measureSigs = measureSigs.map(sig => ({ ...sig, groups: [...sig.groups] }));
  for (let measure = index; measure < end; measure++) measureSigs[measure] = makeSig(num, den);

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
        while (notes.length && notes[notes.length - 1].isRest && !notes[notes.length - 1].tupletInfo) notes.pop();   // padding is added again below
        resetVoice(voice);
        processNotes(voice, coalesceRests(notes, (_k, _s, end) => end > from + 1e-9));
        contentEnd = Math.max(contentEnd, notesDuration(voice.unprocessedNotes));
      }
    }
  }

  numMeasures = Math.max(numMeasures, measuresCovering(contentEnd));
  normalizeSigs();
  for (const layer of [mainStaves, harmonyStaves]) {
    for (const staffName of staves) {
      for (const voice of staffVoices(layer[staffName])) {
        const have = notesDuration(voice.unprocessedNotes);
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

function drawMeasureBar(measureWidths: number[]): void {
  const bar = document.getElementById('measureBar') as HTMLElement;
  if (!bar) return;
  bar.innerHTML = '';

  const spacer = document.createElement('div');
  spacer.className = 'measure-bar-spacer';
  bar.appendChild(spacer);

  measureWidths.forEach((width, index) => {
    const cell = document.createElement('div');
    cell.className = 'measure-bar-cell';
    const extraWidth = index === 0 ? 30.5 : 0;
    cell.style.width = `${width + extraWidth}px`;
    cell.style.minWidth = `${width + extraWidth}px`;
    cell.style.flexShrink = '0';

    if (index === selectedMeasureIndex) cell.classList.add('selected');
    if (index === playStartMeasure) cell.classList.add('play-start');

    // Delete button (hidden until selected)
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'measure-action-btn measure-delete-btn';
    deleteBtn.textContent = '×';
    deleteBtn.title = 'Delete measure';
    deleteBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      deleteMeasure(index);
    });

    // Measure number (always visible)
    const label = document.createElement('span');
    label.className = 'measure-number';
    label.textContent = String(index + 1);

    // Time signature display (hidden until selected)
    const timeSigDisplay = document.createElement('span');
    timeSigDisplay.className = 'measure-timesig';
    timeSigDisplay.textContent = `${sigOf(index).num}/${sigOf(index).den}`;
    timeSigDisplay.title = `Beats grouped ${sigOf(index).groups.join('+')}`;
    timeSigDisplay.addEventListener('click', (event) => {
      event.stopPropagation();
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
      if (num === sigOf(index).num) opt.selected = true;
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
      if (parseInt(val) === sigOf(index).den) opt.selected = true;
      bottomSel.appendChild(opt);
    }

  function applyTimeSignatureChange() {
      const ok = changeMeasureSig(index, parseInt(topSel.value), parseInt(bottomSel.value));
      if (!ok) {
        topSel.value = String(sigOf(index).num);
        bottomSel.value = String(sigOf(index).den);
      }
    }

    topSel.addEventListener('change', (event) => { event.stopPropagation(); applyTimeSignatureChange(); });
    bottomSel.addEventListener('change', (event) => { event.stopPropagation(); applyTimeSignatureChange(); });

    timeSigEditor.appendChild(topSel);
    timeSigEditor.appendChild(slash);
    timeSigEditor.appendChild(bottomSel);

    // Add button (hidden until selected)
    const addBtn = document.createElement('button');
    addBtn.className = 'measure-action-btn measure-add-btn';
    addBtn.textContent = '+';
    addBtn.title = 'Insert measure after';
    addBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      insertMeasureAfter(index);
    });

    cell.appendChild(deleteBtn);
    cell.appendChild(label);
    cell.appendChild(timeSigDisplay);
    cell.appendChild(timeSigEditor);
    cell.appendChild(addBtn);

    cell.addEventListener('click', () => {
      bar.querySelectorAll('.measure-bar-cell').forEach(cellElement => cellElement.classList.remove('selected', 'play-start'));
      cell.classList.add('selected', 'play-start');
      selectedMeasureIndex = index;
      playStartMeasure = index;
    });

    bar.appendChild(cell);
  });
}

// Adds an empty measure after insertAtDur in one voice's notes
function insertMeasureInNotes(notes: UnprocessedNote[], insertAtDur: number): UnprocessedNote[] {
  const newNotes: UnprocessedNote[] = [];
  const len = measureLenOf(measureIndexAt(insertAtDur));   // the new measure's length
  let pos = 0;
  let inserted = false;

  for (let itemIndex = 0; itemIndex < notes.length; itemIndex++) {
    const note = notes[itemIndex];
    const noteDur = note.tupletInfo
      ? (note.tupletInfo.index === note.tupletInfo.count ? note.tupletInfo.totalTupletDuration : 0)
      : getNoteDuration(note);

    const noteStart = pos;
    const noteEnd = round(pos + noteDur);
    if (noteDur > 0) pos = noteEnd;

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
      } else if (noteStart < insertAtDur && noteEnd > insertAtDur) {
        const beforeDur = round(insertAtDur - noteStart);
        const afterDur = round(noteEnd - insertAtDur);
        newNotes.push(...fillDurationAsUnprocessed(beforeDur, note));
        newNotes.push(...fillDurationWithRests(len, insertAtDur));
        newNotes.push(...fillDurationAsUnprocessed(afterDur, note));
        inserted = true;
      } else {
        newNotes.push(note);
      }
    } else {
      newNotes.push(note);
    }
  }

  if (!inserted) {
    newNotes.push(...fillDurationWithRests(len, pos));
  }
  return newNotes;
}

function insertMeasureAfter(measureIndex: number): void {
  padStavesToLength();
  normalizeSigs();
  const insertAtDur = measureStartOf(measureIndex + 1);
  const copy = sigOf(measureIndex);
  measureSigs.splice(measureIndex + 1, 0, { num: copy.num, den: copy.den, groups: [...copy.groups] });   // the new measure has its neighbour's signature
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

  remapAllSelections(range => {
    if (range.start >= insertAtDur - 1e-9) {
      return { start: round(range.start + len), end: round(range.end + len) };
    }
    if (range.end > insertAtDur + 1e-9) {
      return { start: range.start, end: round(range.end + len) };
    }
    return range;
  });

  numMeasures++;
  selectedMeasureIndex = measureIndex + 1;
  drawAllStaves();
  updateMemory();
}

// Removes the bar [startDur, endDur) from one voice's notes
function deleteMeasureFromNotes(notes: UnprocessedNote[], startDur: number, endDur: number): UnprocessedNote[] {
  // Pass 1: split any note that crosses a barline into tied pieces
  const split: UnprocessedNote[] = [];
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
    } else {
      let remaining = noteDur;
      let currentPos = noteStart;
      while (remaining > 1e-9) {
        const boundary = barlineAfter(currentPos);
        const spaceInMeasure = round(Math.min(boundary - currentPos, remaining));
        const pieces = fillDurationAsUnprocessed(spaceInMeasure, note);
        const hasMore = remaining - spaceInMeasure > 1e-9;
        pieces.forEach((piece, index) => {
          piece.tiedToNext = (index < pieces.length - 1) || hasMore;
        });
        split.push(...pieces);
        remaining = round(remaining - spaceInMeasure);
        currentPos = round(currentPos + spaceInMeasure);
      }
    }
  }

  // Pass 2: drop everything inside [startDur, endDur)
  const newNotes: UnprocessedNote[] = [];
  let position = 0;

  for (const note of split) {
    const noteDur = note.tupletInfo
      ? (note.tupletInfo.index === note.tupletInfo.count ? note.tupletInfo.totalTupletDuration : 0)
      : getNoteDuration(note);
    const noteStart = position;
    const noteEnd = round(position + noteDur);
    if (noteDur > 0) position = noteEnd;

    if (note.tupletInfo && note.tupletInfo.index !== note.tupletInfo.count) {
      if (noteStart < startDur - 1e-9 || noteStart >= endDur - 1e-9) newNotes.push(note);
      continue;
    }

    if (noteEnd <= startDur + 1e-9) {
      if (round(noteEnd) === round(startDur) && note.tiedToNext) {
        const cleared = new UnprocessedNote([...note.noteName], note.octaves, note.duration, note.dotted, false);
        if (note.tupletInfo) cleared.tupletInfo = { ...note.tupletInfo };
        newNotes.push(cleared);
      } else {
        newNotes.push(note);
      }
    } else if (noteStart >= endDur - 1e-9) {
      newNotes.push(note);
    }
  }

  // Clear a dangling tie at the very end
  for (let itemIndex = newNotes.length - 1; itemIndex >= 0; itemIndex--) {
    if (!newNotes[itemIndex].tiedToNext) break;
    const nextNote = newNotes[itemIndex + 1];
    if (!nextNote || !samePitches(nextNote, newNotes[itemIndex])) {
      newNotes[itemIndex].tiedToNext = false;
    }
  }
  return newNotes;
}

// Is this measure only rests, in every voice of every track, on both layers?
function measureIsBlank(measureIndex: number): boolean {
  const start = measureStartOf(measureIndex);
  const end = measureStartOf(measureIndex + 1);
  for (const layer of [mainStaves, harmonyStaves]) {
    for (const name of staves) {
      for (const voice of staffVoices(layer[name])) {
        let pos = 0;
        for (const note of voice.unprocessedNotes) {
          const duration = note.tupletInfo ? note.tupletInfo.totalTupletDuration / note.tupletInfo.count : getNoteDuration(note);
          if (!note.isRest && pos < end - 1e-9 && pos + duration > start + 1e-9) return false;
          pos = round(pos + duration);
        }
      }
    }
  }
  return true;
}

// Removes one measure from every voice, optionally leaving the redraw to the caller
function deleteMeasureStep(measureIndex: number, redraw: boolean): void {
  padStavesToLength();
  normalizeSigs();

  const allStaves = [...staves.map(staffName => mainStaves[staffName]), ...staves.map(staffName => harmonyStaves[staffName])];
  const totalMeasures = Math.max(numMeasures, ...allStaves.map(staff => staff.notes.length));

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
    if (redraw) { drawAllStaves(); updateMemory(); }
    return;
  }

  const startDur = measureStartOf(measureIndex);
  const endDur = measureStartOf(measureIndex + 1);
  const len = round(endDur - startDur);

  // worked out with the measures as they are, then the measure (and its signature) goes
  const jobs: { voice: VoiceLike; notes: UnprocessedNote[] }[] = [];
  for (const layer of [mainStaves, harmonyStaves]) {
    for (const staffName of staves) {
      for (const voice of staffVoices(layer[staffName])) {
        jobs.push({ voice, notes: deleteMeasureFromNotes(voice.unprocessedNotes, startDur, endDur) });
      }
    }
  }
  measureSigs.splice(measureIndex, 1);
  if (measureSigs.length === 0) measureSigs = [makeSig(4, 4)];
  for (const job of jobs) {
    resetVoice(job.voice);
    processNotes(job.voice, job.notes);
  }

  remapAllSelections(range => {
    const shift = (time: number) => time >= endDur - 1e-9 ? round(time - len) : (time > startDur ? startDur : time);
    const ns = shift(range.start);
    const ne = shift(range.end);
    return ne - ns < 1e-9 ? null : { start: ns, end: ne };
  });

  numMeasures = Math.max(1, numMeasures - 1);
  selectedMeasureIndex = null;
  if (redraw) { drawAllStaves(); updateMemory(); }
}

// Deletes a measure. If it is blank in every track, the blank measures right after it go too.
function deleteMeasure(measureIndex: number): void {
  padStavesToLength();
  const allStaves = [...staves.map(staffName => mainStaves[staffName]), ...staves.map(staffName => harmonyStaves[staffName])];
  const total = Math.max(numMeasures, ...allStaves.map(staff => staff.notes.length));

  let count = 1;
  if (measureIsBlank(measureIndex)) {
    while (measureIndex + count < total && measureIsBlank(measureIndex + count)) count++;
  }
  for (let otherIndex = 0; otherIndex < count; otherIndex++) deleteMeasureStep(measureIndex, false);
  drawAllStaves();
  updateMemory();
}

// Called from drawAllVoices() after a measure's voices are formatted and drawn.
function captureMeasureLayout(staff: Staff, measureIndex: number, stave: any, notes: any[]): void {
  const layout = gridLayout[staff.name];
  if (!layout) return;

  const startTime = measureStartOf(measureIndex);
  const endTime   = measureStartOf(measureIndex + 1);
  const xStart    = stave.getX();
  const xEnd      = stave.getX() + stave.getWidth();
  let yTop        = stave.getYForLine(0) - 45;
  let yBottom     = stave.getYForLine(4) + 45;

  // notes with many ledger lines reach beyond the stave: the band (and the grid) grows to include them
  for (const note of notes) {
    try {
      for (const yPos of note.getYs()) { yTop = Math.min(yTop, yPos - 20); yBottom = Math.max(yBottom, yPos + 20); }
    } catch (error) {
      // not formatted
    }
  }

  const lines: GridLine[] = [
    { t: startTime, x: xStart, kind: 'bar' },
    { t: endTime,   x: xEnd,   kind: 'bar' },
  ];

  // One onset per start time, even when several voices start together: the leftmost note head sets the x
  const byTime = new Map<number, { t: number; x: number; tuplet: boolean }>();
  for (const vfNote of notes) {
    const info = noteTiming.get(vfNote);
    if (!info) continue;
    let xPos: number;
    try {
      xPos = typeof vfNote.getNoteHeadBeginX === 'function' ? vfNote.getNoteHeadBeginX() : vfNote.getAbsoluteX();
    } catch (layoutError) {
      continue;   // note wasn't formatted (shouldn't happen after draw)
    }
    const key = Math.round(info.start * 1e6);
    const isTuplet = info.tupletId !== null;
    const cur = byTime.get(key);
    if (!cur) byTime.set(key, { t: info.start, x: xPos, tuplet: isTuplet });
    else { cur.x = Math.min(cur.x, xPos); cur.tuplet = cur.tuplet && isTuplet; }
  }
  const onsets = [...byTime.values()].sort((first, second) => first.t - second.t);

  if (onsets.length === 0) {
    const x0 = stave.getNoteStartX();
    for (let gridStep = Math.floor(startTime / gridDivision + 1e-9) + 1; ; gridStep++) {
      const time = round(gridStep * gridDivision);
      if (time >= endTime - 1e-9) break;
      lines.push({ t: time, x: x0 + ((time - startTime) / (endTime - startTime)) * (xEnd - x0), kind: 'sub' });
    }
  } else {
    onsets.forEach((onset, index) => {
      if (onset.tuplet) {
        lines.push({ t: onset.t, x: onset.x, kind: 'tuplet' });
        return;
      }
      lines.push({ t: onset.t, x: onset.x, kind: 'onset' });

      const next = onsets[index + 1] ?? { t: endTime, x: xEnd };
      if (next.t - onset.t < 1e-9) return;

      for (let gridStep = Math.floor(onset.t / gridDivision + 1e-9) + 1; ; gridStep++) {
        const time = round(gridStep * gridDivision);
        if (time >= next.t - 1e-9) break;
        lines.push({ t: time, x: onset.x + ((time - onset.t) / (next.t - onset.t)) * (next.x - onset.x), kind: 'sub' });
      }
    });
  }

  layout.measures.push({ index: measureIndex, startTime, endTime, xStart, xEnd, yTop, yBottom, lines });
}
