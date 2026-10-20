////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Grid: selection, mouse interaction, range slicing
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

function remapAllSelections(map: (range: SelectionRange) => SelectionRange | null): void {
  for (const layer of ['main', 'harmony'] as const) {
    const store = selections[layer];
    for (const name of Object.keys(store)) {
      const selection = store[name];
      if (!selection) continue;
      const mapped = map(selection);
      const mappedBase = selection.base ? map({ start: selection.base.start, end: selection.base.end }) : null;
      store[name] = mapped ? { ...mapped, voice: selection.voice, base: mappedBase ? { start: mappedBase.start, end: mappedBase.end } : undefined } : null;
    }
  }
}

let currentTab: 'create' | 'edit' = 'create';
let gridViewOn = true;

const selections: Record<'main' | 'harmony', Record<string, SelectionRange | null>> = {
  main: {},
  harmony: {},
};

// Most recently selected track per layer (decides which track survives entering Edit)
const lastSelectedStaff: Record<'main' | 'harmony', string | null> = { main: null, harmony: null };

function getSelection(staffName: string): SelectionRange | null {
  if (!gridViewOn) return null;
  return selections[currentLayer][staffName] ?? null;
}

function setSelection(staffName: string, range: SelectionRange | null): void {
  if (!gridViewOn) return;
  if (currentTab === 'edit' && range) {
    for (const name of staves) {
      if (name !== staffName) selections[currentLayer][name] = null;
    }
  }
  selections[currentLayer][staffName] = range;
  if (range) lastSelectedStaff[currentLayer] = staffName;
  renderGridOverlays(Object.values(getActiveStaves()));
}

function clearSelection(staffName: string): void {
  setSelection(staffName, null);
}

// The voice a selection is in (Up 1 when it doesn't name one, or when that voice no longer exists)
// The first voice a selection acts on (the only one, unless several are selected)
function selectionStore(staff: Staff, sel: SelectionRange | null | undefined): VoiceLike {
  return selectionTargets(staff, sel)[0];
}

// The voices of a staff that are drawn somewhere in [s, e). Up 1 always counts.
function drawnVoicesIn(staff: Staff, start: number, end: number): VoiceLike[] {
  return staffVoices(staff).filter(voice => voice.id === 'up1' || voiceActiveIn(voice, start, end));
}

// The voices a selection acts on: the chosen voice, or every voice drawn in its range
function selectionTargets(staff: Staff, sel: SelectionRange | null | undefined): VoiceLike[] {
  if (!sel) return [staff];
  if (sel.voice && sel.voice !== 'all') return [getVoice(staff, sel.voice) ?? staff];
  return drawnVoicesIn(staff, sel.start, sel.end);
}

// What a click inside a selection steps through: all voices, then each voice drawn in the range
function selectionCycle(staff: Staff, sel: SelectionRange): VoiceState[] {
  const base = sel.base ?? sel;
  const drawn = drawnVoicesIn(staff, base.start, base.end);
  return drawn.length >= 2 ? ['all', ...drawn.map(voice => voice.id)] : [];
}

// A selection of a range for a voice state. In the Edit tab it grows to whole notes of the voice(s) it covers.
function makeSelection(staff: Staff, base: { start: number; end: number }, state: VoiceState): SelectionRange {
  let start = base.start;
  let end = base.end;
  if (currentTab === 'edit') {
    const voices = state === 'all' ? drawnVoicesIn(staff, base.start, base.end) : [getVoice(staff, state) ?? staff];
    for (const drawnVoice of voices) {
      const first = noteSpanAt(drawnVoice, base.start + 1e-6);
      const last = noteSpanAt(drawnVoice, base.end - 1e-6);
      if (first) start = Math.min(start, first.start);
      if (last) end = Math.max(end, last.end);
    }
  }
  return { start, end, voice: state, base: { start: base.start, end: base.end } };
}

// A click inside a selection: the same range, in the next voice (all, then each voice drawn there)
function cycleSelection(staffName: string): void {
  const staff = getActiveStaves()[staffName];
  const sel = selections[currentLayer][staffName];
  if (!staff || !sel) return;
  const cycle = selectionCycle(staff, sel);
  if (!cycle.length) return;
  const at = cycle.indexOf(sel.voice ?? 'all');
  const next = cycle[(at + 1) % cycle.length];
  setSelection(staffName, makeSelection(staff, sel.base ?? sel, next));
}

// Per layer and staff: the selection a blank click last cleared
const clearedSelections: Record<string, SelectionRange | null> = {};

// A click on the notation outside the selection's vertical range clears that track's selection;
// clicking there again brings back the one that was cleared
function blankClick(staffName: string): void {
  const key = `${currentLayer}:${staffName}`;
  const now = selections[currentLayer][staffName];
  if (now) {
    clearedSelections[key] = now;
    setSelection(staffName, null);
    return;
  }
  const back = clearedSelections[key];
  clearedSelections[key] = null;
  if (back && back.start < totalLength() - 1e-9) setSelection(staffName, back);
}

function noteSpanAt(staff: NoteStore, time: number): SelectionRange | null {
  const hit = findNoteAtTime(staff, time);
  if (!hit) return null;
  return expandToTieGroup(staff, hit.note, hit.start, hit.start + hit.dur);
}

// Create -> Edit: grow every selection to whole notes, and keep a single track
// Create -> Edit: every selection grows to whole notes, and one track is kept
function collapseSelectionsForEdit(): void {
  for (const layer of ['main', 'harmony'] as const) {
    const parts = layer === 'main' ? mainStaves : harmonyStaves;
    const store = selections[layer];

    for (const name of staves) {
      const range = store[name];
      if (!range) continue;
      store[name] = makeSelection(parts[name], range.base ?? range, range.voice ?? 'all');
    }

    const preferred = lastSelectedStaff[layer];
    const keep = preferred && store[preferred] ? preferred : staves.find(staffName => store[staffName]);
    for (const name of staves) if (name !== keep) store[name] = null;
  }
}

function setCurrentTab(tab: 'create' | 'edit'): void {
  const previous = currentTab;
  currentTab = tab;
  if (tab === 'edit' && previous !== 'edit') collapseSelectionsForEdit();
  renderGridOverlays(Object.values(getActiveStaves()));
}

function findMeasureAtX(partName: string, xPos: number): MeasureLayout | null {
  const layout = gridLayout[partName];
  if (!layout || !layout.measures.length) return null;
  for (const measure of layout.measures) {
    if (xPos >= measure.xStart && xPos <= measure.xEnd) return measure;
  }
  return xPos < layout.measures[0].xStart ? layout.measures[0] : layout.measures[layout.measures.length - 1];
}

// Continuous (unsnapped) time estimate under a given x, for picking a raw anchor point.
function rawTimeFromX(partName: string, xPos: number): number {
  const measure = findMeasureAtX(partName, xPos);
  if (!measure) return 0;
  const sorted = [...measure.lines].sort((first, second) => first.x - second.x);
  if (xPos <= sorted[0].x) return sorted[0].t;
  if (xPos >= sorted[sorted.length - 1].x) return sorted[sorted.length - 1].t;
  for (let index = 0; index < sorted.length - 1; index++) {
    if (xPos >= sorted[index].x && xPos <= sorted[index + 1].x) {
      const span = sorted[index + 1].x - sorted[index].x;
      const frac = span > 1e-9 ? (xPos - sorted[index].x) / span : 0;
      return sorted[index].t + frac * (sorted[index + 1].t - sorted[index].t);
    }
  }
  return sorted[sorted.length - 1].t;
}

// Nearest grid line of any kind (used for exact-mode snapping).
function nearestLine(partName: string, xPos: number): GridLine | null {
  const measure = findMeasureAtX(partName, xPos);
  if (!measure || !measure.lines.length) return null;
  let best = measure.lines[0];
  let bestDist = Math.abs(best.x - xPos);
  for (const line of measure.lines) {
    const distance = Math.abs(line.x - xPos);
    if (distance < bestDist) { best = line; bestDist = distance; }
  }
  return best;
}

// Finds the note (or rest) whose [start, start+dur) covers time t.
function findNoteAtTime(staff: NoteStore, time: number): (NoteTiming & { note: any }) | null {
  for (const measureNotes of staff.notes) {
    for (const timedNote of measureNotes) {
      const info = noteTiming.get(timedNote);
      if (!info) continue;
      if (time >= info.start - 1e-9 && time < info.start + info.dur - 1e-9) {
        return { ...info, note: timedNote };
      }
    }
  }
  return null;
}

// Expands a single note's range to cover its whole tie group, if it has one.
function expandToTieGroup(staff: NoteStore, note: any, start: number, end: number): SelectionRange {
  for (const group of staff.ties) {
    if (group.includes(note)) {
      let gStart = start, gEnd = end;
      for (const timedNote of group) {
        const info = noteTiming.get(timedNote);
        if (!info) continue;
        gStart = Math.min(gStart, info.start);
        gEnd = Math.max(gEnd, info.start + info.dur);
      }
      return { start: gStart, end: gEnd };
    }
  }
  return { start, end };
}

function pickEdge(partName: string, xPos: number): number {
  const line = nearestLine(partName, xPos);
  return line ? line.t : rawTimeFromX(partName, xPos);
}

function gridPosition(time: number, measureStart: number): string {
  const value = (time - measureStart) / gridDivision + 1;
  const truncated = Math.floor(value * 10 + 1e-6) / 10;
  return String(truncated);
}

function timeToX(partName: string, time: number): number {
  const layout = gridLayout[partName];
  if (!layout) return 0;
  for (const measure of layout.measures) {
    if (time >= measure.startTime - 1e-9 && time <= measure.endTime + 1e-9) {
      const sorted = [...measure.lines].sort((first, second) => first.t - second.t);
      if (time <= sorted[0].t) return sorted[0].x;
      if (time >= sorted[sorted.length - 1].t) return sorted[sorted.length - 1].x;
      for (let index = 0; index < sorted.length - 1; index++) {
        if (time >= sorted[index].t && time <= sorted[index + 1].t) {
          const span = sorted[index + 1].t - sorted[index].t;
          const frac = span > 1e-9 ? (time - sorted[index].t) / span : 0;
          return sorted[index].x + frac * (sorted[index + 1].x - sorted[index].x);
        }
      }
    }
  }
  return 0;
}

// Called from drawAllVoices() after everything is drawn. Also re-renders on its own
// whenever selection state changes (setSelection), without touching the notation.
// Is this voice drawn anywhere in [s, e)? A note counts, and so does a rest that is actually shown.
function voiceActiveIn(voice: VoiceLike, windowStart: number, end: number): boolean {
  const first = measureIndexAt(windowStart);
  const last = measureIndexAt(round(end - 1e-6));
  for (let bar = first; bar <= last; bar++) {
    if (!voiceShownInBar(voice, bar)) continue;
    for (const note of voice.notes[bar] || []) {
      const info = noteTiming.get(note);
      if (!info || info.start >= end - 1e-9 || info.start + info.dur <= windowStart + 1e-9) continue;
      if (note.render_options && note.render_options.draw === false) continue;   // a hidden duplicate rest
      return true;
    }
  }
  return false;
}

function renderGridOverlays(staffList: Staff[]): void {
  for (const staff of staffList) {
    const layout = gridLayout[staff.name];
    const svg = containers[staff.name]?.querySelector('svg');
    if (!layout || !svg) continue;

    svg.querySelector('.gridOverlay')?.remove();

    const group = document.createElementNS(SVG_NS, 'g');
    group.setAttribute('class', 'gridOverlay');
    group.setAttribute('pointer-events', 'none');

    const seen = new Set<string>();
    for (const measure of layout.measures) {
      for (const line of measure.lines) {
        const key = `${line.kind}:${Math.round(line.x)}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const el = document.createElementNS(SVG_NS, 'line');
        el.setAttribute('class', `gridLine gridLine-${line.kind}`);
        el.setAttribute('x1', String(line.x));
        el.setAttribute('x2', String(line.x));
        el.setAttribute('y1', String(measure.yTop));
        el.setAttribute('y2', String(measure.yBottom));
        group.appendChild(el);

        if (line.kind === 'onset' || line.kind === 'tuplet') {
          const label = document.createElementNS(SVG_NS, 'text');
          label.setAttribute('class', 'gridLabel');
          label.setAttribute('x', String(line.x + 2));
          label.setAttribute('y', String(measure.yTop - 3));
          label.textContent = gridPosition(line.t, measure.startTime);
          group.appendChild(label);
        }
      }
    }
    if (typeof scheduleEditRefresh === 'function') scheduleEditRefresh();

    // Selection highlight (or the live preview while a handle is being dragged)
    const preview = handlePreview && handlePreview.partName === staff.name ? handlePreview : null;
    const realSel = selections[currentLayer][staff.name];
    const sel = preview ?? realSel;
    const band = staffBand(staff.name);
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
      group.appendChild(rect);

      // Outline every selected note of the selected voice (nothing is outlined while all voices are selected)
      if (!preview && realSel && realSel.voice && realSel.voice !== 'all') {
        for (const voice of selectionTargets(staff, realSel)) {
          for (const bar of voice.notes) {
            for (const note of bar) {
              const info = noteTiming.get(note);
              if (!info || info.start < sel.start - 1e-6 || info.start + info.dur > sel.end + 1e-6) continue;
              if (note.render_options && note.render_options.draw === false) continue;
              try {
                const ys: number[] = note.getYs();
                const left = note.getNoteHeadBeginX();
                const right = typeof note.getNoteHeadEndX === 'function' ? note.getNoteHeadEndX() : left + 14;
                const box = document.createElementNS(SVG_NS, 'rect');
                box.setAttribute('class', 'noteOutline');
                box.setAttribute('x', String(left - 3));
                box.setAttribute('y', String(Math.min(...ys) - 8));
                box.setAttribute('width', String(Math.max(10, right - left) + 6));
                box.setAttribute('height', String(Math.max(...ys) - Math.min(...ys) + 16));
                box.setAttribute('rx', '4');
                group.appendChild(box);
              } catch (error) {
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
          const handleRect = document.createElementNS(SVG_NS, 'rect');
          handleRect.setAttribute('class', 'selectionHandle');
          handleRect.setAttribute('x', String(hx - HANDLE_W / 2));
          handleRect.setAttribute('y', String(yTop));
          handleRect.setAttribute('width', String(HANDLE_W));
          handleRect.setAttribute('height', String(yBottom - yTop));
          group.appendChild(handleRect);
        }
      }
    }

    svg.appendChild(group);
  }
}

const HANDLE_W = 3;
const HANDLE_HIT = 8;
const DRAG_THRESHOLD = 4;

interface SelectDrag {
  kind: 'select';
  partName: string;
  anchorT: number;
  anchorRange: SelectionRange | null;                // what a plain click here would select (all voices)
  anchorBase: { start: number; end: number } | null; // the span of the note pressed
  inside: boolean;                                   // the press was inside the current selection
  before: Record<string, SelectionRange | null>;     // selections as they were at mousedown
  startClientX: number;
  startClientY: number;
  moved: boolean;
}

interface HandleDrag {
  kind: 'handle';
  partName: string;
  side: 'left' | 'right';
  origStart: number;
  origEnd: number;
  invalid: SelectionRange[];   // tuplet spans: an edge may not land strictly inside one
}

let drag: SelectDrag | HandleDrag | null = null;
let handlePreview: { partName: string; start: number; end: number } | null = null;

function localPoint(partName: string, event: MouseEvent): { x: number; y: number } | null {
  const svg = containers[partName]?.querySelector('svg');
  if (!svg) return null;
  const bounds = svg.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

// The vertical extent of a staff's drawing: the stave, plus any notes that reach beyond it
function staffBand(partName: string): { yTop: number; yBottom: number } | null {
  const layout = gridLayout[partName];
  if (!layout || !layout.measures.length) return null;
  return {
    yTop: Math.min(...layout.measures.map(measure => measure.yTop)),
    yBottom: Math.max(...layout.measures.map(measure => measure.yBottom)),
  };
}

function inStaffBand(partName: string, yPos: number): boolean {
  const band = staffBand(partName);
  return !!band && yPos >= band.yTop && yPos <= band.yBottom;
}

// Range of the selection if it is exactly one non-tuplet note (tie groups count as one note)
// Range of the selection if it is exactly one non-tuplet note of the selected voice (tie groups count as one note)
// Range of the selection if it is exactly one non-tuplet note of one voice (tie groups count as one note)
function getSingleNoteSelection(staff: Staff): SelectionRange | null {
  const sel = getSelection(staff.name);
  if (!sel) return null;
  const targets = selectionTargets(staff, sel);
  if (targets.length !== 1) return null;
  const store = targets[0];
  const hit = findNoteAtTime(store, sel.start + 1e-6);
  if (!hit || hit.tupletId !== null) return null;
  const span = expandToTieGroup(store, hit.note, hit.start, hit.start + hit.dur);
  const same = Math.abs(span.start - sel.start) < 1e-6 && Math.abs(span.end - sel.end) < 1e-6;
  return same ? { ...span, voice: sel.voice, base: sel.base } : null;
}

function handleHit(partName: string, xPos: number): { side: 'left' | 'right'; range: SelectionRange } | null {
  const staff = getActiveStaves()[partName];
  const range = staff ? getSingleNoteSelection(staff) : null;
  if (!range) return null;
  const dl = Math.abs(xPos - timeToX(partName, range.start));
  const dr = Math.abs(xPos - timeToX(partName, range.end));
  if (Math.min(dl, dr) > HANDLE_HIT) return null;
  return { side: dl <= dr ? 'left' : 'right', range };
}

function tupletSpans(staff: NoteStore): SelectionRange[] {
  return getNoteUnits(staff).filter(unit => unit.isTuplet).map(unit => ({ start: unit.start, end: unit.end }));
}

function insideTuplet(spans: SelectionRange[], time: number): boolean {
  return spans.some(range => time > range.start + 1e-9 && time < range.end - 1e-9);
}

// Nearest grid line to x that is a legal edge for this handle
function pickHandleTime(partName: string, xPos: number, drag: HandleDrag): number {
  const fallback = drag.side === 'left' ? drag.origStart : drag.origEnd;
  const measure = findMeasureAtX(partName, xPos);
  if (!measure) return fallback;

  let best: GridLine | null = null;
  let bestDist = Infinity;
  for (const line of measure.lines) {
    if (insideTuplet(drag.invalid, line.t)) continue;
    if (drag.side === 'left' && line.t >= drag.origEnd - 1e-9) continue;
    if (drag.side === 'right' && line.t <= drag.origStart + 1e-9) continue;
    const dist = Math.abs(line.x - xPos);
    if (dist < bestDist) { best = line; bestDist = dist; }
  }
  return best ? best.t : fallback;
}

// Overwrite-style resize: whatever the new span covers is replaced; time the note gives up becomes a rest.
// Overwrite-style resize of a note in one voice: whatever the new span covers is replaced; time the note gives up becomes a rest.
function resizeNote(store: NoteStore, oldStart: number, oldEnd: number, newStart: number, newEnd: number): boolean {
  const total = totalLength();
  newStart = Math.max(0, newStart);
  newEnd = Math.min(total, newEnd);
  if (newEnd - newStart < 1e-9) return false;

  const orig = sliceRange(store, oldStart, oldEnd);
  if (!orig.ok || orig.selected.length === 0 || orig.selected[0].tupletInfo) return false;
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

  if (before.length) before[before.length - 1].tiedToNext = false;

  const newNotes = [...before, ...lead, ...note, ...trail, ...after];
  renumberTuplets(newNotes);
  resetVoice(store);
  processNotes(store, newNotes);
  return true;
}

// Tracks from the one the drag started on to the one under the cursor (inclusive)
function tracksSpanned(anchorName: string, clientY: number): string[] {
  const anchorIdx = staves.indexOf(anchorName);
  let curIdx = anchorIdx;
  let best = Infinity;
  staves.forEach((name, index) => {
    const bounds = containers[name].getBoundingClientRect();
    const dist = clientY < bounds.top ? bounds.top - clientY : clientY > bounds.bottom ? clientY - bounds.bottom : 0;
    if (dist < best) { best = dist; curIdx = index; }
  });
  return staves.slice(Math.min(anchorIdx, curIdx), Math.max(anchorIdx, curIdx) + 1);
}

function setSelectionsBulk(next: Record<string, SelectionRange | null>, lastName: string): void {
  if (!gridViewOn) return;
  for (const name of staves) selections[currentLayer][name] = next[name] ?? null;
  if (next[lastName]) lastSelectedStaff[currentLayer] = lastName;
  renderGridOverlays(Object.values(getActiveStaves()));
}

function updateSelectDrag(drag: SelectDrag, event: MouseEvent): void {
  const staff = getActiveStaves()[drag.partName];
  const pt = localPoint(drag.partName, event);
  if (!staff || !pt) return;

  if (!drag.moved) {
    if (Math.hypot(event.clientX - drag.startClientX, event.clientY - drag.startClientY) < DRAG_THRESHOLD) return;
    drag.moved = true;
  }

  if (currentTab === 'create') {
    const anchorEdge = pickEdge(drag.partName, timeToX(drag.partName, drag.anchorT));
    const pointerEdge = pickEdge(drag.partName, pt.x);
    const start = Math.min(anchorEdge, pointerEdge);
    const end = Math.max(anchorEdge, pointerEdge);
    const empty = end - start < 1e-9;

    const span = tracksSpanned(drag.partName, event.clientY);
    const next: Record<string, SelectionRange | null> = {};
    for (const name of staves) {
      if (empty) {
        next[name] = name === drag.partName && drag.anchorRange ? drag.anchorRange : (drag.before[name] ?? null);
      } else {
        next[name] = span.includes(name) ? { start, end, voice: 'all', base: { start, end } } : (drag.before[name] ?? null);
      }
    }
    setSelectionsBulk(next, drag.partName);
    return;
  }

  // Edit: from the note pressed to the note under the cursor, whole notes of every voice
  if (!drag.anchorBase) return;
  const total = totalLength();
  const time = Math.min(Math.max(rawTimeFromX(drag.partName, pt.x), 0), total - 1e-6);
  const base = { start: Math.min(drag.anchorBase.start, time), end: Math.max(drag.anchorBase.end, time + 1e-6) };
  setSelection(drag.partName, makeSelection(staff, base, 'all'));
}

function updateHandleDrag(drag: HandleDrag, event: MouseEvent): void {
  const pt = localPoint(drag.partName, event);
  if (!pt) return;
  const time = pickHandleTime(drag.partName, pt.x, drag);
  handlePreview = drag.side === 'left'
    ? { partName: drag.partName, start: time, end: drag.origEnd }
    : { partName: drag.partName, start: drag.origStart, end: time };
  renderGridOverlays(Object.values(getActiveStaves()));
}

interface UnprocessedTimingEntry {
  start: number;
  dur: number;
  tupletId: number | null;
  index: number;
}

interface NoteUnit {
  notes: UnprocessedNote[];
  start: number;
  end: number;
  isTuplet: boolean;
}

function getNoteUnits(staff: NoteStore): NoteUnit[] {
  const atoms: NoteUnit[] = [];
  const notes = staff.unprocessedNotes;
  let time = 0;
  let itemIndex = 0;

  while (itemIndex < notes.length) {
    const note = notes[itemIndex];
    if (note.tupletInfo) {
      const group: UnprocessedNote[] = [];
      const start = time;
      let total = 0;
      while (itemIndex < notes.length) {
        const info = notes[itemIndex].tupletInfo!;
        group.push(notes[itemIndex]);
        total = info.totalTupletDuration;
        itemIndex++;
        if (info.index === info.count) break;
      }
      time = round(start + total);
      atoms.push({ notes: group, start, end: time, isTuplet: true });
    } else {
      const dur = getNoteDuration(note);
      atoms.push({ notes: [note], start: time, end: round(time + dur), isTuplet: false });
      time = round(time + dur);
      itemIndex++;
    }
  }
  return atoms;
}

interface SliceResult {
  before: UnprocessedNote[];
  selected: UnprocessedNote[];
  after: UnprocessedNote[];
  ok: boolean;
}

function sliceRange(staff: NoteStore, start: number, end: number): SliceResult {
  const atoms = getNoteUnits(staff);
  const before: UnprocessedNote[] = [];
  const selected: UnprocessedNote[] = [];
  const after: UnprocessedNote[] = [];

  for (const atom of atoms) {
    if (atom.end <= start + 1e-9) {
      before.push(...atom.notes);
    } else if (atom.start >= end - 1e-9) {
      after.push(...atom.notes);
    } else if (atom.start >= start - 1e-9 && atom.end <= end + 1e-9) {
      selected.push(...atom.notes);
    } else if (atom.isTuplet) {
      return { before: [], selected: [], after: [], ok: false };
    } else {
      const note = atom.notes[0];
      if (atom.start < start) {
        const beforeDur = round(start - atom.start);
        before.push(...fillDurationAsUnprocessed(beforeDur, note));

        const remainingDur = round(atom.end - start);
        if (remainingDur > 1e-9) {
          if (round(start + remainingDur) <= end + 1e-9) {
            selected.push(...fillDurationAsUnprocessed(remainingDur, note));
          } else {
            const selDur = round(end - start);
            const afterDur = round(remainingDur - selDur);
            selected.push(...fillDurationAsUnprocessed(selDur, note));
            after.push(...fillDurationAsUnprocessed(afterDur, note));
          }
        }
      } else {
        const selDur = round(end - atom.start);
        const afterDur = round(atom.end - end);
        selected.push(...fillDurationAsUnprocessed(selDur, note));
        after.push(...fillDurationAsUnprocessed(afterDur, note));
      }
    }
  }

  return { before, selected, after, ok: true };
}

// Runs transform(selectedNotes, selectionStartOffset) on exactly the part of `part`
// covered by its current selection, splices the result back in. Returns false (no-op)
// if nothing is selected on this track or the selection cuts through a tuplet.
type RangeTransform = (notes: UnprocessedNote[], startOffset: number) => UnprocessedNote[];

function computeRangeEdit(store: NoteStore, sel: SelectionRange, transform: RangeTransform): UnprocessedNote[] | null {
  // Pad the voice with rests up to the end of the piece
  const neededLength = totalLength();
  const haveLength = notesDuration(store.unprocessedNotes);
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

  let transformed: UnprocessedNote[] = [];
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
  if (beforeLen > 0 && beforeLen - 1 < newNotes.length) newNotes[beforeLen - 1].tiedToNext = false;
  if (beforeLen + selLen > 0 && beforeLen + selLen - 1 < newNotes.length) newNotes[beforeLen + selLen - 1].tiedToNext = false;

  // Rests in or beside the selection are merged, so several rests in a row read the way they would be written
  const merged = coalesceRests(newNotes, (_k, noteStart, noteEnd) => noteStart < sel.end - 1e-9 && noteEnd > sel.start + 1e-9);
  renumberTuplets(merged);
  return merged;
}

// Runs a transform on each listed voice's part of a selection. Nothing changes unless every one of them can be done.
function applyRangeJobs(sel: SelectionRange, jobs: { store: NoteStore; transform: RangeTransform }[]): boolean {
  const results: { store: NoteStore; notes: UnprocessedNote[] }[] = [];
  for (const job of jobs) {
    const notes = computeRangeEdit(job.store, sel, job.transform);
    if (!notes) return false;
    results.push({ store: job.store, notes });
  }
  for (const jobResult of results) {
    resetVoice(jobResult.store);
    processNotes(jobResult.store, jobResult.notes);
  }
  return results.length > 0;
}

// Runs transform(selectedNotes, selectionStartOffset) on the part of the staff covered by its selection: in the
// selected voice, or in every voice drawn there when all are selected. Returns false (no-op) if nothing is selected
// on this track or the selection cuts through a tuplet.
function applyToRange(staff: Staff, transform: RangeTransform): boolean {
  if (!gridViewOn) return false;
  const sel = getSelection(staff.name);
  if (!sel) return false;
  return applyRangeJobs(sel, selectionTargets(staff, sel).map(store => ({ store, transform })));
}

// A note or rest under the mouse in the Edit tab
interface NoteCandidate {
  voice: VoiceLike;
  note: any;          // the drawn VexFlow note
  start: number;
  dur: number;
  top: number;        // staff position of its highest head (rests: lowest priority)
  dist: number;       // vertical distance from the click to the nearest head
}

// Every note and rest sounding at time t in the voices that are drawn there
function candidatesAt(staff: Staff, time: number, yPos: number): NoteCandidate[] {
  const bar = measureIndexAt(time);
  const out: NoteCandidate[] = [];
  for (const voice of staffVoices(staff)) {
    if (!voiceShownInBar(voice, bar)) continue;
    const hit = findNoteAtTime(voice, time);
    if (!hit) continue;
    const ys: number[] = hit.note.getYs();
    const lines: number[] = hit.note.isRest() ? [] : hit.note.getKeyProps().map((keyProp: any) => keyProp.line);
    out.push({
      voice,
      note: hit.note,
      start: hit.start,
      dur: hit.dur,
      top: lines.length ? Math.max(...lines) : -Infinity,
      dist: Math.min(...ys.map(lineY => Math.abs(lineY - yPos))),
    });
  }
  return out;
}

// The note nearest the click; clicking the same spot again goes on to the next note there
// (earliest start first, then highest pitch), and after the last one back to the first.
// The note nearest the press, in whichever voice it is
function pickCandidate(cands: NoteCandidate[], staffName: string, xPos: number, yPos: number): NoteCandidate | null {
  if (!cands.length) return null;
  const ordered = [...cands].sort((first, second) => first.start - second.start || second.top - first.top);
  let best = ordered[0];
  for (const cell of ordered) if (cell.dist < best.dist - 1e-6) best = cell;
  return best;
}

function setupGridInteraction(): void {
  for (const partName of Object.keys(containers)) {
    const el = containers[partName];

    el.addEventListener('mousedown', (event: MouseEvent) => {
      if (!gridViewOn || event.button !== 0) return;

      const staff = getActiveStaves()[partName];
      const pt = localPoint(partName, event);
      if (!staff || !pt) return;

      event.preventDefault();

      // A click on the notation outside the staff's vertical range clears this track's selection;
      // clicking there again brings the cleared selection back
      if (!inStaffBand(partName, pt.y)) { blankClick(partName); return; }

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
      const time = rawTimeFromX(partName, pt.x);
      const pick = pickCandidate(candidatesAt(staff, Math.min(time, total - 1e-6), pt.y), partName, pt.x, pt.y);
      let anchorBase: { start: number; end: number } | null = null;
      let anchorRange: SelectionRange | null = null;
      if (pick) {
        const span = expandToTieGroup(pick.voice, pick.note, pick.start, pick.start + pick.dur);
        anchorBase = { start: span.start, end: span.end };
        anchorRange = makeSelection(staff, anchorBase, 'all');
      }

      drag = {
        kind: 'select', partName, anchorT: time, anchorRange, anchorBase, inside,
        before: { ...selections[currentLayer] },
        startClientX: event.clientX, startClientY: event.clientY, moved: false,
      };
    });

    // Resize cursor when hovering a handle
    el.addEventListener('mousemove', (event: MouseEvent) => {
      if (drag || !gridViewOn) return;
      const pt = localPoint(partName, event);
      el.style.cursor = pt && inStaffBand(partName, pt.y) && handleHit(partName, pt.x) ? 'ew-resize' : '';
    });
  }

  document.addEventListener('mousemove', (event: MouseEvent) => {
    const currentDrag = drag;
    if (!currentDrag) return;
    if (currentDrag.kind === 'handle') updateHandleDrag(currentDrag, event);
    else updateSelectDrag(currentDrag, event);
  });

  document.addEventListener('mouseup', (event: MouseEvent) => {
    const currentDrag = drag;
    if (!currentDrag) return;
    drag = null;
    document.body.style.cursor = '';

    if (currentDrag.kind === 'select') {
      updateSelectDrag(currentDrag, event);   // the release position is authoritative for drags
      if (!currentDrag.moved) {
        if (currentDrag.inside) cycleSelection(currentDrag.partName);
        else if (currentDrag.anchorRange) setSelection(currentDrag.partName, currentDrag.anchorRange);
      }
      return;
    }

    updateHandleDrag(currentDrag, event);
    const prev = handlePreview;
    handlePreview = null;

    const staff = getActiveStaves()[currentDrag.partName];
    const changed = !!prev && (Math.abs(prev.start - currentDrag.origStart) > 1e-9 || Math.abs(prev.end - currentDrag.origEnd) > 1e-9);

    // Notes are only rebuilt now, on release
    const sel = selections[currentLayer][currentDrag.partName];
    const targets = staff ? selectionTargets(staff, sel) : [];
    const store = targets.length === 1 ? targets[0] : null;
    if (store && prev && changed && resizeNote(store, currentDrag.origStart, currentDrag.origEnd, prev.start, prev.end)) {
      selections[currentLayer][currentDrag.partName] = {
        start: prev.start, end: prev.end, voice: sel ? sel.voice : undefined, base: { start: prev.start, end: prev.end },
      };
      drawAllStaves();
      updateMemory();
    } else {
      renderGridOverlays(Object.values(getActiveStaves()));
    }
  });
}

function setGridView(on: boolean): void {
  gridViewOn = on;
  drag = null;
  handlePreview = null;
  document.body.style.cursor = '';
  document.body.classList.toggle('gridView', on);
  renderGridOverlays(Object.values(getActiveStaves()));
}

const gridSlider = document.getElementById('gridSlider') as HTMLInputElement;
const gridSliderValue = document.getElementById('gridSliderValue') as HTMLElement;
