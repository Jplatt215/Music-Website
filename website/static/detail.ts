////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Detail tab: articulations, dynamics, playing techniques, clefs and key signatures
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

interface ArticulationDef {
  code: string;        // VexFlow's code for it
  label: string;
  symbol: string;      // shown on the button
  excludes: string[];  // codes that cannot be on the same note
}

const ARTICULATIONS: ArticulationDef[] = [
  { code: 'a.',  label: 'Staccato',      symbol: '•',  excludes: ['av'] },
  { code: 'a>',  label: 'Accent',        symbol: '>',  excludes: ['a^'] },
  { code: 'a-',  label: 'Tenuto',        symbol: '–',  excludes: [] },
  { code: 'av',  label: 'Staccatissimo', symbol: '▾',  excludes: ['a.'] },
  { code: 'a^',  label: 'Marcato',       symbol: '^',  excludes: ['a>'] },
  { code: 'a@a', label: 'Fermata',       symbol: '𝄐', excludes: [] },
];

let detailRefreshQueued = false;

interface NoteTarget {
  group: EditGroup;
  index: number;          // into the voice's notes
  note: UnprocessedNote;
}

// A copy of a note that can be changed without touching the original
function cloneNote(note: UnprocessedNote): UnprocessedNote {
  const copy = new UnprocessedNote([...note.noteName], [...note.octaves], note.duration, note.dotted, note.tiedToNext);
  copyTuplets(note, copy);
  copy.articulations = [...note.articulations];
  copy.graceNotes = copyGraceNotes(note.graceNotes);
  return copy;
}

// The notes of the selection that can carry an articulation: not rests, and only the first piece of a tied note
function articulationTargets(ctx: EditCtx): NoteTarget[] {
  const targets: NoteTarget[] = [];
  for (const group of ctx.groups) {
    const notes = group.store.unprocessedNotes;
    for (const entry of group.entries) {
      const note = notes[entry.index];
      const previous = notes[entry.index - 1];
      const continuesTie = !!previous && previous.tiedToNext && !previous.isRest && !note.tupletInfo && samePitches(previous, note);
      if (!note.isRest && !continuesTie) targets.push({ group, index: entry.index, note });
    }
  }
  return targets;
}

// Puts the articulation on every selected note, or takes it off when they all have it already
function toggleArticulation(code: string): void {
  const ctx = getEditContext();
  if (!ctx) return;
  const targets = articulationTargets(ctx);
  if (!targets.length) return;

  const definition = ARTICULATIONS.find(candidate => candidate.code === code)!;
  const remove = targets.every(target => target.note.articulations.includes(code));

  const changes: Partial<Record<VoiceId, UnprocessedNote[]>> = {};
  for (const group of ctx.groups) {
    const notes = [...group.store.unprocessedNotes];
    let changed = false;
    for (const target of targets.filter(candidate => candidate.group === group)) {
      const copy = cloneNote(target.note);
      copy.articulations = copy.articulations.filter(existing => existing !== code && !definition.excludes.includes(existing));
      if (!remove) copy.articulations.push(code);
      notes[target.index] = copy;
      changed = true;
    }
    if (changed) changes[group.store.id] = notes;
  }
  if (Object.keys(changes).length) commitVoiceEdits(ctx.part, changes, null, null);
}

function buildDetailMenu(): void {
  const host = document.getElementById('detail-menu');
  if (!host) return;
  host.innerHTML = '';

  const heading = document.createElement('div');
  heading.className = 'buttonDescription';
  heading.textContent = 'Articulations';
  host.appendChild(heading);

  const ROW_SIZE = 3;
  for (let start = 0; start < ARTICULATIONS.length; start += ROW_SIZE) {
    const row = document.createElement('div');
    row.className = 'row';
    for (const definition of ARTICULATIONS.slice(start, start + ROW_SIZE)) {
      const button = document.createElement('button');
      button.className = 'editBtn articulationBtn';
      button.textContent = definition.symbol;
      button.title = definition.label;
      button.dataset.code = definition.code;
      button.disabled = true;
      button.addEventListener('click', () => { toggleArticulation(definition.code); button.blur(); });
      row.appendChild(button);
    }
    host.appendChild(row);
  }

  buildDynamicsMenu(host);
  buildGlissandoMenu(host);
  buildTechniquesMenu(host);
  buildClefKeyMenu(host);
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Glissando: a wavy line from a note to the next one. One selected note glides to the note after it; several selected
// notes glide from each to the next. Stored on the staff, drawn between the notes and played as a quick run.
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// The (from, to) start times of the glissandos the selection asks for, per voice
function glissandoPairs(ctx: EditCtx): GlissMark[] {
  const pairs: GlissMark[] = [];
  for (const group of ctx.groups) {
    const notes = group.store.unprocessedNotes;
    const timeline = getUnprocessedTimeline(notes);
    const isHead = (index: number): boolean => {
      const previous = notes[index - 1];
      return !notes[index].isRest && !(previous && previous.tiedToNext && !previous.isRest && !notes[index].tupletInfo && samePitches(previous, notes[index]));
    };
    const picked = group.entries.map(entry => entry.index).filter(isHead);
    if (!picked.length) continue;
    if (picked.length === 1) {
      let next = picked[0] + 1;
      while (next < notes.length && !isHead(next)) next++;
      if (next < notes.length) pairs.push({ start: timeline[picked[0]].start, end: timeline[next].start, voice: group.store.id });
      continue;
    }
    for (let at = 0; at + 1 < picked.length; at++) pairs.push({ start: timeline[picked[at]].start, end: timeline[picked[at + 1]].start, voice: group.store.id });
  }
  return pairs;
}

function sameGlissando(first: GlissMark, second: GlissMark): boolean {
  return first.voice === second.voice && Math.abs(first.start - second.start) < SAME_TIME && Math.abs(first.end - second.end) < SAME_TIME;
}

function toggleGlissando(): void {
  const ctx = getEditContext();
  if (!ctx) return;
  const pairs = glissandoPairs(ctx);
  if (!pairs.length) return;
  const staff = ctx.part;
  const allHave = pairs.every(pair => staff.glissandos.some(mark => sameGlissando(mark, pair)));
  staff.glissandos = staff.glissandos.filter(mark => !pairs.some(pair => sameGlissando(mark, pair)));
  if (!allHave) staff.glissandos.push(...pairs);
  staff.glissandos.sort((first, second) => first.start - second.start);
  drawAllStaves();
  updateMemory();
}

function buildGlissandoMenu(host: HTMLElement): void {
  const heading = document.createElement('div');
  heading.className = 'buttonDescription';
  heading.textContent = 'Glissando';
  host.appendChild(heading);
  const row = document.createElement('div');
  row.className = 'row';
  const button = document.createElement('button');
  button.className = 'editBtn glissandoBtn';
  button.id = 'glissandoBtn';
  button.textContent = 'Gliss.';
  button.title = 'Glissando from the selected note to the next (several notes: from each to the next)';
  button.disabled = true;
  button.addEventListener('click', () => { toggleGlissando(); button.blur(); });
  row.appendChild(button);
  host.appendChild(row);
}

function refreshGlissandoMenu(): void {
  const button = document.getElementById('glissandoBtn') as HTMLButtonElement | null;
  if (!button) return;
  const ctx = currentTab === 'detail' ? getEditContext() : null;
  const pairs = ctx ? glissandoPairs(ctx) : [];
  button.disabled = pairs.length === 0;
  button.classList.toggle('active', pairs.length > 0 && pairs.every(pair => ctx!.part.glissandos.some(mark => sameGlissando(mark, pair))));
}

function scheduleDetailRefresh(): void {
  if (detailRefreshQueued) return;
  detailRefreshQueued = true;
  requestAnimationFrame(refreshDetailMenu);
}

function refreshDetailMenu(): void {
  detailRefreshQueued = false;
  const ctx = currentTab === 'detail' ? getEditContext() : null;
  const targets = ctx ? articulationTargets(ctx) : [];

  document.querySelectorAll<HTMLButtonElement>('#detail-menu .articulationBtn').forEach(button => {
    button.disabled = targets.length === 0;
    button.classList.toggle('active', targets.length > 0 && targets.every(target => target.note.articulations.includes(button.dataset.code!)));
  });
  refreshGlissandoMenu();
  refreshDynamicsMenu();
  refreshTechniquesMenu();
  refreshClefKeyMenu();
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Dynamics: levels (pp, f, ...) placed at the start of the selection, and crescendo / diminuendo hairpins over it.
// Stored on the staff (so the main and harmony layers each have their own) and drawn under the staff. Not played yet.
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

const DYNAMIC_LEVELS = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff'];
const LEVELS_PER_ROW = 4;

const DYNAMIC_HAIRPINS: { kind: 'crescendo' | 'diminuendo'; symbol: string; label: string }[] = [
  { kind: 'crescendo',  symbol: '<', label: 'Crescendo' },
  { kind: 'diminuendo', symbol: '>', label: 'Diminuendo' },
];

const SAME_TIME = 1e-6;

function addDynamicButton(row: HTMLElement, text: string, title: string, kind: string, level: string, onClick: () => void): void {
  const button = document.createElement('button');
  button.className = 'editBtn articulationBtn dynamicBtn';
  button.textContent = text;
  button.title = title;
  button.dataset.kind = kind;
  button.dataset.level = level;
  button.disabled = true;
  button.addEventListener('click', () => { onClick(); button.blur(); });
  row.appendChild(button);
}

function buildDynamicsMenu(host: HTMLElement): void {
  const heading = document.createElement('div');
  heading.className = 'buttonDescription';
  heading.textContent = 'Dynamics';
  host.appendChild(heading);

  for (let start = 0; start < DYNAMIC_LEVELS.length; start += LEVELS_PER_ROW) {
    const row = document.createElement('div');
    row.className = 'row';
    for (const level of DYNAMIC_LEVELS.slice(start, start + LEVELS_PER_ROW)) {
      addDynamicButton(row, level, level, 'level', level, () => applyDynamicLevel(level));
    }
    host.appendChild(row);
  }

  const hairpinRow = document.createElement('div');
  hairpinRow.className = 'row';
  for (const hairpin of DYNAMIC_HAIRPINS) {
    addDynamicButton(hairpinRow, hairpin.symbol, hairpin.label, hairpin.kind, '', () => applyDynamicHairpin(hairpin.kind));
  }
  host.appendChild(hairpinRow);
}

// The tracks that have a selection, with the selected span
function selectedSpans(): { staff: Staff; start: number; end: number }[] {
  if (currentTab !== 'detail') return [];
  return getSelectedStaves().map(staff => {
    const sel = getSelection(staff.name)!;
    return { staff, start: sel.start, end: sel.end };
  });
}

function sortDynamics(staff: Staff): void {
  staff.dynamics.sort((first, second) => first.start - second.start);
}

function changeDynamics(change: () => void): void {
  change();
  renderGridOverlays(Object.values(getActiveStaves()));
  updateMemory();
}

// Puts the level at the start of the selection, or takes it off if it is already there
function applyDynamicLevel(level: string): void {
  const spans = selectedSpans();
  if (!spans.length) return;
  changeDynamics(() => {
    const allHave = spans.every(span => span.staff.dynamics.some(mark => mark.kind === 'level' && mark.level === level && Math.abs(mark.start - span.start) < SAME_TIME));
    for (const span of spans) {
      span.staff.dynamics = span.staff.dynamics.filter(mark => !(mark.kind === 'level' && Math.abs(mark.start - span.start) < SAME_TIME));
      if (!allHave) span.staff.dynamics.push({ kind: 'level', level, start: span.start, end: span.start });
      sortDynamics(span.staff);
    }
  });
}

function isHairpin(mark: DynamicMark): boolean {
  return mark.kind === 'crescendo' || mark.kind === 'diminuendo';
}

// Puts a hairpin over the selection (replacing any it overlaps), or takes it off if it is already there
function applyDynamicHairpin(kind: 'crescendo' | 'diminuendo'): void {
  const spans = selectedSpans().filter(span => span.end - span.start > SAME_TIME);
  if (!spans.length) return;
  changeDynamics(() => {
    const allHave = spans.every(span => span.staff.dynamics.some(mark =>
      mark.kind === kind && Math.abs(mark.start - span.start) < SAME_TIME && Math.abs(mark.end - span.end) < SAME_TIME));
    for (const span of spans) {
      span.staff.dynamics = span.staff.dynamics.filter(mark => !(isHairpin(mark) && mark.start < span.end - SAME_TIME && mark.end > span.start + SAME_TIME));
      if (!allHave) span.staff.dynamics.push({ kind, start: span.start, end: span.end });
      sortDynamics(span.staff);
    }
  });
}

function refreshDynamicsMenu(): void {
  const spans = selectedSpans();
  document.querySelectorAll<HTMLButtonElement>('#detail-menu .dynamicBtn').forEach(button => {
    const kind = button.dataset.kind!;
    const hairpinNeedsRange = kind === 'crescendo' || kind === 'diminuendo';
    button.disabled = hairpinNeedsRange ? !spans.some(span => span.end - span.start > SAME_TIME) : spans.length === 0;

    const active = spans.length > 0 && spans.every(span => span.staff.dynamics.some(mark => {
      if (kind === 'level') return mark.kind === 'level' && mark.level === button.dataset.level && Math.abs(mark.start - span.start) < SAME_TIME;
      return mark.kind === kind && Math.abs(mark.start - span.start) < SAME_TIME && Math.abs(mark.end - span.end) < SAME_TIME;
    }));
    button.classList.toggle('active', active);
  });
}

// x where the notes at this time start (the barline is used when nothing starts there)
function dynamicsX(partName: string, time: number): number {
  const layout = gridLayout[partName];
  if (layout) {
    for (const measure of layout.measures) {
      if (time < measure.startTime - SAME_TIME || time > measure.endTime + SAME_TIME) continue;
      const line = measure.lines.find(candidate => candidate.kind !== 'bar' && candidate.kind !== 'sub' && Math.abs(candidate.t - time) < SAME_TIME);
      if (line) return line.x;
    }
  }
  return timeToX(partName, time);
}

const DYNAMICS_TEXT_DROP = 34;      // text baseline under the bottom staff line
const DYNAMICS_HAIRPIN_DROP = 28;   // hairpin centre under the bottom staff line
const HAIRPIN_OPENING = 5;          // half the height of the open end
const HAIRPIN_MIN_LENGTH = 14;
const LEVEL_CHARACTER_WIDTH = 9;    // room a level's text takes, so a hairpin can start after it

// Draws the staff's dynamics under it. Called from renderGridOverlays for every track.
function drawDynamics(staff: Staff, svg: Element): void {
  svg.querySelector('.dynamicsOverlay')?.remove();
  const layout = gridLayout[staff.name];
  if (!layout || !layout.measures.length || !staff.dynamics.length) return;

  const group = document.createElementNS(SVG_NS, 'g');
  group.setAttribute('class', 'dynamicsOverlay');
  group.setAttribute('pointer-events', 'none');
  const lastTime = layout.measures[layout.measures.length - 1].endTime;

  for (const mark of staff.dynamics) {
    if (mark.start > lastTime - SAME_TIME) continue;
    const measure = layout.measures.find(candidate => mark.start >= candidate.startTime - SAME_TIME && mark.start < candidate.endTime - SAME_TIME) ?? layout.measures[0];
    const staffBottom = measure.staffBottom;
    const xStart = dynamicsX(staff.name, mark.start);

    if (mark.kind === 'level') {
      const text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('class', 'dynamicMark');
      text.setAttribute('x', String(xStart - 2));
      text.setAttribute('y', String(staffBottom + DYNAMICS_TEXT_DROP));
      text.setAttribute('font-family', 'Times New Roman, serif');
      text.setAttribute('font-style', 'italic');
      text.setAttribute('font-weight', 'bold');
      text.setAttribute('font-size', '17');
      text.setAttribute('fill', '#222');
      text.textContent = mark.level!;
      group.appendChild(text);
      continue;
    }

    // a hairpin that starts where a level is written begins after that level
    const levelHere = staff.dynamics.find(other => other.kind === 'level' && Math.abs(other.start - mark.start) < SAME_TIME);
    const hairpinStart = levelHere ? xStart + levelHere.level!.length * LEVEL_CHARACTER_WIDTH + 4 : xStart;
    const xEnd = Math.max(hairpinStart + HAIRPIN_MIN_LENGTH, timeToX(staff.name, Math.min(mark.end, lastTime)) - 4);
    const centre = staffBottom + DYNAMICS_HAIRPIN_DROP;
    const openAtEnd = mark.kind === 'crescendo';
    const closedX = openAtEnd ? hairpinStart : xEnd;
    const openX = openAtEnd ? xEnd : hairpinStart;
    for (const side of [-1, 1]) {
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('class', 'dynamicHairpin');
      line.setAttribute('x1', String(closedX));
      line.setAttribute('y1', String(centre));
      line.setAttribute('x2', String(openX));
      line.setAttribute('y2', String(centre + side * HAIRPIN_OPENING));
      line.setAttribute('stroke', '#222');
      line.setAttribute('stroke-width', '1.4');
      group.appendChild(line);
    }
  }
  svg.appendChild(group);
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Playing techniques: text above the staff (pizz., con sord. ...) at the start of the selection. A selection longer than
// the text gets a dashed line to its end. Stored on the staff like dynamics; drawn only, not played yet.
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

interface TechniqueDef {
  text: string;
  label: string;
  group: string;       // techniques of one group cannot start at the same time
}

const TECHNIQUES: TechniqueDef[] = [
  { text: 'pizz.',      label: 'Pizzicato',          group: 'bowing' },
  { text: 'arco',       label: 'Arco',               group: 'bowing' },
  { text: 'col legno',  label: 'Col legno',          group: 'bowing' },
  { text: 'sul pont.',  label: 'Sul ponticello',     group: 'bowing' },
  { text: 'sul tasto',  label: 'Sul tasto',          group: 'bowing' },
  { text: 'con sord.',  label: 'Con sordino',        group: 'mute' },
  { text: 'senza sord.', label: 'Senza sordino',     group: 'mute' },
  { text: 'trem.',      label: 'Tremolo',            group: 'tremolo' },
  { text: 'harm.',      label: 'Harmonics',          group: 'harmonics' },
  { text: 'flutter',    label: 'Flutter-tongue',     group: 'flutter' },
];
const TECHNIQUES_PER_ROW = 2;

function buildTechniquesMenu(host: HTMLElement): void {
  const heading = document.createElement('div');
  heading.className = 'buttonDescription';
  heading.textContent = 'Playing Techniques';
  host.appendChild(heading);

  for (let start = 0; start < TECHNIQUES.length; start += TECHNIQUES_PER_ROW) {
    const row = document.createElement('div');
    row.className = 'row';
    for (const technique of TECHNIQUES.slice(start, start + TECHNIQUES_PER_ROW)) {
      const button = document.createElement('button');
      button.className = 'editBtn techniqueBtn';
      button.textContent = technique.text;
      button.title = technique.label;
      button.dataset.text = technique.text;
      button.disabled = true;
      button.addEventListener('click', () => { applyTechnique(technique); button.blur(); });
      row.appendChild(button);
    }
    host.appendChild(row);
  }
}

function sameTechnique(mark: TechniqueMark, text: string, start: number, end: number): boolean {
  return mark.text === text && Math.abs(mark.start - start) < SAME_TIME && Math.abs(mark.end - end) < SAME_TIME;
}

// Writes the technique at the start of the selection (replacing one of its group there), or takes it off if it is already there
function applyTechnique(technique: TechniqueDef): void {
  const spans = selectedSpans();
  if (!spans.length) return;
  changeDynamics(() => {
    const allHave = spans.every(span => span.staff.techniques.some(mark => sameTechnique(mark, technique.text, span.start, span.end)));
    for (const span of spans) {
      span.staff.techniques = span.staff.techniques.filter(mark => {
        if (Math.abs(mark.start - span.start) >= SAME_TIME) return true;
        const markGroup = TECHNIQUES.find(other => other.text === mark.text)?.group;
        return mark.text !== technique.text && markGroup !== technique.group;
      });
      if (!allHave) span.staff.techniques.push({ text: technique.text, start: span.start, end: span.end });
      span.staff.techniques.sort((first, second) => first.start - second.start);
    }
  });
}

function refreshTechniquesMenu(): void {
  const spans = selectedSpans();
  document.querySelectorAll<HTMLButtonElement>('#detail-menu .techniqueBtn').forEach(button => {
    button.disabled = spans.length === 0;
    button.classList.toggle('active', spans.length > 0 && spans.every(span =>
      span.staff.techniques.some(mark => sameTechnique(mark, button.dataset.text!, span.start, span.end))));
  });
}

const TECHNIQUE_TEXT_RISE = 20;     // text baseline above the top staff line
const TECHNIQUE_LINE_HEIGHT = 16;   // stacked techniques at the same time
const TECHNIQUE_CHARACTER_WIDTH = 7;
const TECHNIQUE_LINE_GAP = 4;

// Draws the staff's playing techniques above it. Called from renderGridOverlays for every track.
function drawTechniques(staff: Staff, svg: Element): void {
  svg.querySelector('.techniquesOverlay')?.remove();
  const layout = gridLayout[staff.name];
  if (!layout || !layout.measures.length || !staff.techniques.length) return;

  const group = document.createElementNS(SVG_NS, 'g');
  group.setAttribute('class', 'techniquesOverlay');
  group.setAttribute('pointer-events', 'none');
  const lastTime = layout.measures[layout.measures.length - 1].endTime;
  const stackAt: Record<string, number> = {};

  for (const mark of staff.techniques) {
    if (mark.start > lastTime - SAME_TIME) continue;
    const measure = layout.measures.find(candidate => mark.start >= candidate.startTime - SAME_TIME && mark.start < candidate.endTime - SAME_TIME) ?? layout.measures[0];
    const stackKey = String(Math.round(mark.start * 1e6));
    const level = stackAt[stackKey] ?? 0;
    stackAt[stackKey] = level + 1;

    const xStart = dynamicsX(staff.name, mark.start);
    const baseline = measure.staffTop - TECHNIQUE_TEXT_RISE - level * TECHNIQUE_LINE_HEIGHT;

    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('class', 'techniqueMark');
    text.setAttribute('x', String(xStart - 2));
    text.setAttribute('y', String(baseline));
    text.setAttribute('font-family', 'Times New Roman, serif');
    text.setAttribute('font-style', 'italic');
    text.setAttribute('font-size', '14');
    text.setAttribute('fill', '#222');
    text.textContent = mark.text;
    group.appendChild(text);

    const lineStart = xStart - 2 + mark.text.length * TECHNIQUE_CHARACTER_WIDTH + TECHNIQUE_LINE_GAP;
    const lineEnd = timeToX(staff.name, Math.min(mark.end, lastTime)) - 4;
    if (mark.end - mark.start > SAME_TIME && lineEnd - lineStart > 6) {
      const lineY = baseline - 4;
      const dashes = document.createElementNS(SVG_NS, 'line');
      dashes.setAttribute('class', 'techniqueLine');
      dashes.setAttribute('x1', String(lineStart));
      dashes.setAttribute('x2', String(lineEnd));
      dashes.setAttribute('y1', String(lineY));
      dashes.setAttribute('y2', String(lineY));
      dashes.setAttribute('stroke', '#222');
      dashes.setAttribute('stroke-width', '1');
      dashes.setAttribute('stroke-dasharray', '4 3');
      group.appendChild(dashes);

      const hook = document.createElementNS(SVG_NS, 'line');
      hook.setAttribute('class', 'techniqueLine');
      hook.setAttribute('x1', String(lineEnd));
      hook.setAttribute('x2', String(lineEnd));
      hook.setAttribute('y1', String(lineY));
      hook.setAttribute('y2', String(lineY + 6));
      hook.setAttribute('stroke', '#222');
      hook.setAttribute('stroke-width', '1');
      group.appendChild(hook);
    }
  }
  svg.appendChild(group);
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Clefs and key signatures: set for the track from the measure the selection starts in, until the track's next change.
// The notes keep their pitches; only where they sit on the staff (and which accidentals are drawn) changes.
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

const CLEF_OPTIONS: { value: ClefName; label: string }[] = [
  { value: 'treble', label: 'Treble' },
  { value: 'bass',   label: 'Bass' },
  { value: 'alto',   label: 'Alto' },
  { value: 'tenor',  label: 'Tenor' },
];

// Sharpest key at the top, C in the middle, flattest at the bottom
const KEY_OPTIONS: { key: string; minor: string }[] = [
  { key: 'C#', minor: 'A#' }, { key: 'F#', minor: 'D#' }, { key: 'B', minor: 'G#' },  { key: 'E', minor: 'C#' },
  { key: 'A', minor: 'F#' },  { key: 'D', minor: 'B' },   { key: 'G', minor: 'E' },   { key: 'C', minor: 'A' },
  { key: 'F', minor: 'D' },   { key: 'Bb', minor: 'G' },  { key: 'Eb', minor: 'C' },  { key: 'Ab', minor: 'F' },
  { key: 'Db', minor: 'Bb' }, { key: 'Gb', minor: 'Eb' }, { key: 'Cb', minor: 'Ab' },
];

function showAccidentals(name: string): string {
  return name.replace('#', '♯').replace(/b$/, '♭');
}

function addHeading(parent: HTMLElement, text: string): void {
  const heading = document.createElement('div');
  heading.className = 'buttonDescription';
  heading.textContent = text;
  parent.appendChild(heading);
}

function makeTrackChangeSelect(className: string, options: { value: string; label: string }[], records: () => Record<string, TrackChange[]>, fallback: string): HTMLSelectElement {
  const select = document.createElement('select');
  select.className = className;
  select.disabled = true;
  for (const option of options) {
    const element = document.createElement('option');
    element.value = option.value;
    element.textContent = option.label;
    select.appendChild(element);
  }
  select.addEventListener('change', () => { applyTrackChange(records(), fallback, select.value); select.blur(); });
  return select;
}

function buildClefKeyMenu(host: HTMLElement): void {
  const headings = document.createElement('div');
  headings.className = 'row';
  addHeading(headings, 'Clef');
  addHeading(headings, 'Key');
  host.appendChild(headings);

  const row = document.createElement('div');
  row.className = 'row';
  row.appendChild(makeTrackChangeSelect('clefSelect', CLEF_OPTIONS, () => trackClefs, 'treble'));
  row.appendChild(makeTrackChangeSelect('keySelect',
    KEY_OPTIONS.map(entry => ({ value: entry.key, label: `${showAccidentals(entry.key)} major / ${showAccidentals(entry.minor)} minor` })),
    () => trackKeys, 'C'));
  host.appendChild(row);
}

// Makes `value` hold from the measure on; a change that only repeats what already holds is not kept
function setTrackChange(records: Record<string, TrackChange[]>, track: string, measure: number, value: string, fallback: string): void {
  const changes = (records[track] ?? []).filter(change => change.measure !== measure);
  changes.push({ measure, value });
  changes.sort((first, second) => first.measure - second.measure);

  const kept: TrackChange[] = [];
  let current = fallback;
  for (const change of changes) {
    if (change.value === current) continue;
    kept.push(change);
    current = change.value;
  }
  records[track] = kept;
}

function applyTrackChange(records: Record<string, TrackChange[]>, fallback: string, value: string): void {
  const spans = selectedSpans();
  if (!spans.length) return;
  for (const span of spans) setTrackChange(records, span.staff.name, measureIndexAt(span.start), value, fallback);
  drawAllStaves();
  updateMemory();
}

function refreshClefKeyMenu(): void {
  const spans = selectedSpans();
  const clefSelect = document.querySelector<HTMLSelectElement>('#detail-menu .clefSelect');
  const keySelect = document.querySelector<HTMLSelectElement>('#detail-menu .keySelect');
  if (!clefSelect || !keySelect) return;

  clefSelect.disabled = keySelect.disabled = spans.length === 0;
  if (!spans.length) return;
  const measure = measureIndexAt(spans[0].start);
  clefSelect.value = clefAt(spans[0].staff.name, measure);
  keySelect.value = keyAt(spans[0].staff.name, measure);
}
