// Libraries loaded from <script> tags in composer.html
declare const Vex: any;
declare const Tone: any;
declare const Midi: any;

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Types, classes, shared variables, mappings
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

interface TupletInfo {
  id: number;
  totalTupletDuration: number;
  ratio: [number, number];
  count: number;
  index: number;
}

interface TupletObj {
  tupletNotes: any[];
  vfTuplet: any;
  realDuration: number;
}

interface PitchInfo {
  noteName: string[];
  octave: number;
  isRest: boolean;
}

interface RhythmGroup {
  type: 'note' | 'tuplet';
  note?: UnprocessedNote;
  notes?: UnprocessedNote[];
}

interface MemorySnapshot {
  noteName: string[];
  octave: number;
  octaves: number[];
  duration: string;
  dotted: boolean;
  tupletInfo: TupletInfo | null;
  tiedToNext: boolean;
}

// One staff's notes in a snapshot: Up 1 always, plus any other voices the staff has (keyed by voice id)
type StaffSnapshot = Record<string, MemorySnapshot[]>;

interface GlobalSnapshot {
  numMeasures: number;
  timeSignature: [number, number];   // the first measure's, kept for older code
  measureSigs: MeasureSig[];
  main: Record<string, StaffSnapshot>;
  harmony: Record<string, StaffSnapshot>;
}

const globalMemory: GlobalSnapshot[] = [];
let globalMemoryIndex: number = -1;

const { Renderer, Stave, StaveNote, StaveTie, Dot, Voice: VFVoice, Accidental, Formatter, Tuplet } = Vex.Flow;
// Notes carry their own stave when drawn, so VexFlow decides collisions per staff (see customStaveNoteFormat)
const STAVENOTE_FORMAT_VEXFLOW = (StaveNote as any).format;
const containers: Record<string, HTMLElement> = {};
let renderers: Record<string, any> = {};
let contexts: Record<string, any> = {};

const staves: string[] = ["staff1", "staff2", "staff3", "staff4"];
const output = document.getElementById("output") as HTMLElement;
const template = document.getElementById("staffTemplate") as HTMLTemplateElement;

const createStaffContainers = (staffNames: string[], activeStaff: string = "staff1"): void => {
  staffNames.forEach(name => {
    const clone = template.content.cloneNode(true) as DocumentFragment;
    const settings = clone.querySelector(".staffSettings") as HTMLElement;
    const container = clone.querySelector(".staffContainer") as HTMLElement;

    settings.dataset.staff = name;
    container.dataset.name = name;
    container.id = `${name}Container`;

    output.appendChild(clone);
    containers[name] = container;
  });
};
const generatePhraseButton  = document.querySelector('.generatePhraseButton')  as HTMLButtonElement;
const separateStaffButton   = document.querySelector('.separateStaffButton')   as HTMLButtonElement;
const reverseButton         = document.querySelector('.reverseButton')          as HTMLButtonElement;
const reflectButton         = document.querySelector('.reflectButton')          as HTMLButtonElement;
const shiftButton           = document.querySelector('.shiftButton')            as HTMLButtonElement;
const transposeButton       = document.querySelector('.transposeButton')        as HTMLButtonElement;
const shuffleRhythmButton   = document.querySelector('.shuffleRhythmButton')   as HTMLButtonElement;
const shuffleNotesButton    = document.querySelector('.shuffleNotesButton')     as HTMLButtonElement;
const changeRhythmButton    = document.querySelector('.changeRhythmButton')    as HTMLButtonElement;
const shufflePitchButton    = document.querySelector('.shufflePitchButton')    as HTMLButtonElement;
const changePitchButton     = document.querySelector('.changePitchButton')     as HTMLButtonElement;
const simplifyButton        = document.querySelector('.simplifyButton')         as HTMLButtonElement;
const complicateButton      = document.querySelector('.complicateButton')       as HTMLButtonElement;
const bpmSlider             = document.getElementById("bpmSlider")             as HTMLInputElement;
const bpmValueDisplay       = document.getElementById("bpmValue")              as HTMLElement;
const playButton            = document.querySelector('.playButton')             as HTMLButtonElement;

let measureSigs: MeasureSig[] = [{ num: 4, den: 4, groups: [1, 1, 1, 1] }];
let numMeasures: number = 1;
let currentLayer: 'main' | 'harmony' = 'main';

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Voices: a staff holds up to four, as in Dorico (Up 1, Down 1, Up 2, Down 2).
// Up 1 is the staff itself; the others are Voice objects in staff.extraVoices.
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

type VoiceId = 'up1' | 'down1' | 'up2' | 'down2';

const VOICE_DEFS: { id: VoiceId; stems: 1 | -1; label: string }[] = [
  { id: 'up1',   stems:  1, label: 'Up 1'   },
  { id: 'down1', stems: -1, label: 'Down 1' },
  { id: 'up2',   stems:  1, label: 'Up 2'   },
  { id: 'down2', stems: -1, label: 'Down 2' },
];

// Where processNotes() writes its output: a Voice, or a staff (which is its own Up 1 voice)
interface NoteStore {
  name: string;
  unprocessedNotes: UnprocessedNote[];
  notes: any[][];
  ties: any[][];
  tuplets: TupletObj[];
  toneNotes: [string[] | null, number][];
}

interface VoiceLike extends NoteStore {
  id: VoiceId;
  stems: 1 | -1;
}

class Voice implements VoiceLike {
  name: string;                       // the staff this voice belongs to
  id: VoiceId;
  stems: 1 | -1;
  unprocessedNotes: UnprocessedNote[] = [];
  notes: any[][] = [];
  ties: any[][] = [];
  tuplets: TupletObj[] = [];
  toneNotes: [string[] | null, number][] = [];

  constructor(staffName: string, id: VoiceId) {
    this.name = staffName;
    this.id = id;
    this.stems = VOICE_DEFS.find(voiceDef => voiceDef.id === id)!.stems;
  }
}

// Every voice of a staff, Up 1 first
function staffVoices(staff: Staff): VoiceLike[] {
  return [staff, ...staff.extraVoices];
}

function getVoice(staff: Staff, id: VoiceId): VoiceLike | null {
  return id === 'up1' ? staff : (staff.extraVoices.find(voice => voice.id === id) ?? null);
}

function getOrCreateVoice(staff: Staff, id: VoiceId): VoiceLike {
  const have = getVoice(staff, id);
  if (have) return have;
  const voice = new Voice(staff.name, id);
  staff.extraVoices.push(voice);
  const order = (voice: Voice) => VOICE_DEFS.findIndex(voiceDef => voiceDef.id === voice.id);
  staff.extraVoices.sort((first, second) => order(first) - order(second));
  return voice;
}

function resetVoice(store: NoteStore): void {
  store.unprocessedNotes = [];
  store.notes = [];
  store.ties = [];
  store.tuplets = [];
  store.toneNotes = [];
}

// A voice with no pitched notes disappears (Up 1 always stays)
function pruneEmptyVoices(staff: Staff): void {
  staff.extraVoices = staff.extraVoices.filter(voice => voice.unprocessedNotes.some(note => !note.isRest));
}

// Up 1 is always drawn. Another voice is only drawn in the bars where it has a note (as in Dorico).
function voiceShownInBar(voice: VoiceLike, measureIndex: number): boolean {
  if (voice.id === 'up1') return true;
  return (voice.notes[measureIndex] || []).some((note: any) => !note.isRest());
}

class Staff implements VoiceLike {
  name: string;
  id: VoiceId = 'up1';                // a staff is its own Up 1 voice
  stems: 1 | -1 = 1;
  extraVoices: Voice[] = [];          // Down 1, Up 2, Down 2 (only the ones that have notes, in that order)
  pitchRange: string[];
  rhythmRange: number[];
  scale: string[];
  harmonize: boolean;
  unprocessedNotes: UnprocessedNote[];
  notes: any[][];
  ties: any[][];
  tuplets: TupletObj[];
  toneNotes: [string[] | null, number][];
  muted: boolean;
  duration: number;
  requiredWidth: number;

  constructor(
    name: string,
    pitchRange: string[] = ["E3", "E6"],
    rhythmRange: number[] = [0.03125, 1],
    scale: string[] = ["C", "Chromatic"]
  ) {
    this.name = name;
    this.pitchRange = pitchRange;
    this.rhythmRange = rhythmRange;
    this.scale = scale;
    this.harmonize = false;
    this.unprocessedNotes = [];
    this.notes = [];
    this.ties = [];
    this.tuplets = [];
    this.toneNotes = [];
    this.muted = false;
    this.duration = 0;
    this.requiredWidth = 0;
  }
}

const defaultPitchRanges: Record<string, string[]> = {
  staff1: ["C4", "C6"],
  staff2: ["A3", "F5"],
  staff3: ["E2", "C4"],
  staff4: ["D3", "B5"],
};

function resetStaffToDefaults(staff: Staff, rhythmRange: number[]): void {
  staff.pitchRange  = [...defaultPitchRanges[staff.name]];
  staff.rhythmRange = [...rhythmRange];
  staff.scale       = ["C", "Chromatic"];
  staff.harmonize   = false;
  staff.muted       = false;
  staff.extraVoices = [];
  resetStaff(staff);
}

class UnprocessedNote {
  noteName: string[];
  octaves: number[];            // one octave per pitch
  duration: string;
  dotted: boolean;
  isRest: boolean;
  tupletInfo: TupletInfo | null;
  tiedToNext: boolean;

  constructor(noteName: string | string[], octave: number | number[], duration: string, dotted: boolean = false, tiedToNext: boolean = false) {
    this.noteName = Array.isArray(noteName) ? noteName : [noteName];
    const fallback = Array.isArray(octave) ? (octave[0] ?? 4) : octave;
    this.octaves = this.noteName.map((ignoredName, index) => Array.isArray(octave) ? (octave[index] ?? fallback) : octave);
    this.duration = duration;
    this.dotted = dotted;
    this.isRest = this.noteName[0] === "Rest";
    this.tupletInfo = null;
    this.tiedToNext = tiedToNext;
  }

  get octave(): number { return this.octaves[0]; }

  toStaveNote(): any {
    return createNote(this.noteName, this.octaves, this.dotted ? this.duration + "d" : this.duration);
  }

  setTuplet(id: number, totalTupletDuration: number, ratio: [number, number], count: number, index: number): void {
    this.tupletInfo = { id, totalTupletDuration, ratio, count, index };
  }
}

const staff1 = new Staff("staff1", ["C4", "C6"]);
const staff2 = new Staff("staff2", ["A3", "F5"]);
const staff3 = new Staff("staff3", ["E2", "C4"]);
const staff4 = new Staff("staff4", ["D3", "B5"]);

const mainStaves: Record<string, Staff> = { staff1, staff2, staff3, staff4 };

const harmonyStaves: Record<string, Staff> = {
  staff1:  new Staff("staff1", ["C4", "C6"], [0.25, 1]),
  staff2: new Staff("staff2", ["A3", "F5"], [0.25, 1]),
  staff3:  new Staff("staff3", ["E2", "C4"], [0.25, 1]),
  staff4:      new Staff("staff4", ["D3", "B5"], [0.25, 1]),
};

function getActiveStaves(): Record<string, Staff> {
  return currentLayer === 'main' ? mainStaves : harmonyStaves;
}

function getSelectedStaves(): Staff[] {
  const active = getActiveStaves();
  return staves
    .map(name => active[name])
    .filter(staff => getSelection(staff.name) !== null);
}

let clipboard: Record<string, ClipTrack> = {};
let totalDuration: number = 0;
let sampler: any | null = null;

const pianoKeys: string[] = (() => {
  const noteNames = ["A", "Bb", "B", "C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab"];
  const keys: string[] = [];
  let octave = 0;
  for (let index = 0; index < 88; index++) {
    const note = noteNames[index % 12];
    if (note === "C" && index > 0) octave++;
    keys.push(note + octave);
  }
  return keys;
})();

const noteMapping: Record<string, number> = {
  "C": 0, "Db": 1, "D": 2, "Eb": 3, "E": 4,
  "F": 5, "Gb": 6, "G": 7, "Ab": 8, "A": 9,
  "Bb": 10, "B": 11, "Rest": 12,
};

const durationMapping: Record<string, number> = {
  "w":   1,
  "h":   0.5,
  "q":   0.25,
  "8":   0.125,
  "16":  0.0625,
  "32":  0.03125,
  "wd":  1 + 0.5,
  "hd":  0.5 + 0.25,
  "qd":  0.25 + 0.125,
  "8d":  0.125 + 0.0625,
  "16d": 0.0625 + 0.03125,
};

const durationsLargestFirst = Object.entries(durationMapping).sort((durA, durB) => durB[1] - durA[1]);

function getDurationKeyFromValue(value: number): string | null {
  for (const [key, val] of Object.entries(durationMapping)) {
    if (Math.abs(val - value) < 1e-9) return key;
  }
  return null;
}

const scalesMapping: Record<string, number[]> = {
  'Chromatic':              [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  'Major':                  [0, 2, 4, 5, 7, 9, 11],
  'Minor':                  [0, 2, 3, 5, 7, 8, 10],
  'Pentatonic Major':       [0, 2, 4, 7, 9],
  'Pentatonic Minor':       [0, 3, 5, 7, 10],
  'MOLT 1':                 [0, 2, 4, 6, 8, 10],
  'MOLT 2':                 [0, 1, 3, 4, 6, 7, 9, 10],
  'MOLT 3':                 [0, 2, 3, 4, 6, 7, 8, 10, 11],
  'MOLT 4':                 [0, 1, 2, 5, 6, 7, 8, 11],
  'MOLT 5':                 [0, 1, 5, 6, 7, 11],
  'MOLT 6':                 [0, 2, 4, 5, 6, 8, 10, 11],
  'MOLT 7':                 [0, 1, 2, 3, 5, 6, 7, 8, 9, 11],
  'Overtone (Theoretical)': [0, 2, 4, 6, 7, 9, 10, 11],
  'Overtone (Audible)':     [0, 2, 4, 7, 11],
};

interface NoteTiming {
  start: number;              // absolute start in whole notes
  dur: number;                // real duration in whole notes (tuplet-scaled)
  tupletId: number | null;
}

type GridLineKind = 'bar' | 'onset' | 'sub' | 'tuplet';

interface GridLine {
  t: number;                  // time in whole notes
  x: number;                  // x in the track's SVG coordinate system
  kind: GridLineKind;
}

interface MeasureLayout {
  index: number;
  startTime: number;
  endTime: number;
  xStart: number;
  xEnd: number;
  yTop: number;
  yBottom: number;
  lines: GridLine[];
}

interface PartLayout {
  measures: MeasureLayout[];
}

// A selection acts on one voice, or on all of them
type VoiceState = VoiceId | 'all';

interface SelectionRange {
  start: number;
  end: number;
  voice?: VoiceState;                         // which voice(s); missing or 'all' = every voice drawn in the range
  base?: { start: number; end: number };      // the range as first pressed or dragged; clicking inside re-derives from it
}

// Filled by processNotes, keyed by the VexFlow StaveNote object.
const noteTiming = new WeakMap<object, NoteTiming>();

// Rebuilt on every drawAllVoices(); only the active layer is ever drawn.
const gridLayout: Record<string, PartLayout> = {};

let gridDivision = 1 / 16;
const GRID_DIVISIONS = [1/32, 1/16, 1/8, 1/4, 1/2, 1];
const GRID_LABELS = ['1/32', '1/16', '1/8', '1/4', '1/2', '1'];
const SVG_NS = 'http://www.w3.org/2000/svg';
