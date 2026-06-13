////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Types
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/// <reference path="declarations.d.ts" />
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
  duration: string;
  dotted: boolean;
  tupletInfo: TupletInfo | null;
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Voice Container Setup
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

const { Renderer, Stave, StaveNote, StaveTie, Dot, Voice, Accidental, Formatter, Tuplet } = Vex.Flow;

const containers: Record<string, HTMLElement> = {};
let renderers: Record<string, any> = {};
let contexts: Record<string, any> = {};

const voices: string[] = ["upperVoice", "middleVoice", "lowerVoice", "voice4"];
const output = document.getElementById("output") as HTMLElement;
const template = document.getElementById("voiceTemplate") as HTMLTemplateElement;

const createVoiceContainers = (voiceNames: string[], activeVoice: string = "upperVoice"): void => {
  voiceNames.forEach(name => {
    const clone = template.content.cloneNode(true) as DocumentFragment;
    const settings = clone.querySelector(".voiceSettings") as HTMLElement;
    const container = clone.querySelector(".voiceContainer") as HTMLElement;

    settings.dataset.voice = name;
    container.dataset.name = name;
    container.id = `${name}Container`;
    if (name === activeVoice) container.classList.add("active");

    output.appendChild(clone);
    containers[name] = container;
  });
};

createVoiceContainers(["upperVoice", "middleVoice", "lowerVoice", "voice4"]);

containers["harmonyVoice"] = document.getElementById("harmonyVoiceContainer") as HTMLElement;

Object.entries(containers).forEach(([name, container]) => {
  renderers[name] = new Renderer(container, Renderer.Backends.SVG);
  contexts[name] = renderers[name].getContext();
});


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Variable definitions
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

const voiceContainers = document.querySelectorAll('.voiceContainer');
const generatePhraseButton  = document.querySelector('.generatePhraseButton')  as HTMLButtonElement;
const separateVoiceButton   = document.querySelector('.separateVoiceButton')   as HTMLButtonElement;
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
const copyPartButton        = document.querySelector('.copyPartButton')         as HTMLButtonElement;
const pastePartButton       = document.querySelector('.pastePartButton')        as HTMLButtonElement;
const previousButton        = document.querySelector('.previousButton')         as HTMLButtonElement;
const nextButton            = document.querySelector('.nextButton')             as HTMLButtonElement;
const topSelect             = document.getElementById('timeSignatureTop')       as HTMLSelectElement;
const bottomSelect          = document.getElementById('timeSignatureBottom')    as HTMLSelectElement;
const numMeasuresSelect     = document.getElementById('numMeasuresSelect')      as HTMLSelectElement;
const modeSelect            = document.getElementById("modeSelect")             as HTMLSelectElement;
const randomHarmonyButton   = document.querySelector('.randomHarmonyButton')   as HTMLButtonElement;
const chordPlayButton       = document.querySelector(".chordPlayButton")        as HTMLButtonElement;

let timeSignature: [number, number] = [4, 4];
let measureLength: number = timeSignature[0] * (1 / timeSignature[1]);
let numMeasures: number = 1;
let mode: string = "Standard";

class Part {
  name: string;
  pitchRange: string[];
  rhythmRange: number[];
  scale: string[];
  unprocessedNotes: UnprocessedNote[];
  notes: any[][];
  ties: any[][];
  tuplets: TupletObj[];
  toneNotes: [string[] | null, number][];
  memory: MemorySnapshot[][];
  currentMemoryIndex: number;
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
    this.unprocessedNotes = [];
    this.notes = [];
    this.ties = [];
    this.tuplets = [];
    this.toneNotes = [];
    this.memory = [];
    this.currentMemoryIndex = -1;
    this.muted = false;
    this.duration = 0;
    this.requiredWidth = 0;
  }
}

class UnprocessedNote {
  noteName: string[];
  octave: number;
  duration: string;
  dotted: boolean;
  isRest: boolean;
  tupletInfo: TupletInfo | null;

  constructor(noteName: string | string[], octave: number, duration: string, dotted: boolean = false) {
    this.noteName = Array.isArray(noteName) ? noteName : [noteName];
    this.octave = octave;
    this.duration = duration;
    this.dotted = dotted;
    this.isRest = this.noteName[0] === "Rest";
    this.tupletInfo = null;
  }

  toStaveNote(): any {
    return createNote(this.noteName, this.octave, this.dotted ? this.duration + "d" : this.duration);
  }

  setTuplet(id: number, totalTupletDuration: number, ratio: [number, number], count: number, index: number): void {
    this.tupletInfo = { id, totalTupletDuration, ratio, count, index };
  }
}

const upperVoice  = new Part("upperVoice",  ["C4", "C6"]);
const middleVoice = new Part("middleVoice", ["A3", "F5"]);
const lowerVoice  = new Part("lowerVoice",  ["E2", "C4"]);
const voice4      = new Part("voice4",      ["D3", "B5"]);
const harmonyVoice = new Part("harmonyVoice");
const voicesMap: Record<string, Part> = { upperVoice, middleVoice, lowerVoice, voice4, harmonyVoice };

let clipboard: Record<string, MemorySnapshot[]> = {};
let totalDuration: number = 0;
let sampler: any | null = null;
let selectedVoices: Part[] = [upperVoice];


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Mapping
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

bpmSlider.addEventListener("input", () => {
  bpmValueDisplay.textContent = bpmSlider.value;
});

const pianoKeys: string[] = (() => {
  const noteNames = ["A", "Bb", "B", "C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab"];
  const keys: string[] = [];
  let octave = 0;
  for (let i = 0; i < 88; i++) {
    const note = noteNames[i % 12];
    if (note === "C" && i > 0) octave++;
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

const typeMapping: Record<number, string> = {
  1: "whole", 0.5: "half", 0.25: "quarter",
  0.125: "8th", 0.0625: "16th", 0.03125: "32nd",
};

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

const chordMapping: Record<string, number[]> = {
  'Major Triad':       [0, 4, 7],
  'Minor Triad':       [0, 3, 7],
  'Augmented Triad':   [0, 4, 8],
  'Diminished Triad':  [0, 3, 6],
  'Major 7':           [0, 4, 7, 11],
  'Minor 7':           [0, 3, 7, 10],
  'Dominant 7':        [0, 4, 7, 10],
  'Diminished 7':      [0, 3, 6, 9],
  'Half Diminished 7': [0, 3, 6, 10],
};


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Dropdowns
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(content => content.classList.add('hidden'));
    const target = document.getElementById((btn as HTMLElement).dataset.target!);
    target?.classList.remove('hidden');
  });
});

// Voice Settings //////////////////////////////////////////////////////////////////////

const allPitches: string[] = (() => {
  const list: string[] = [];
  ["A", "Bb", "B"].forEach(n => list.push(n + "0"));
  for (let oct = 1; oct <= 7; oct++) {
    ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"].forEach(n => list.push(n + oct));
  }
  list.push("C8");
  return list;
})();

const pitchIndex = (p: string): number => allPitches.indexOf(p);
const toPitchStr = (v: string | string[]): string => Array.isArray(v) ? `${v[0]}${v[1]}` : v;

function populateScaleSelect(select: HTMLSelectElement): void {
  select.innerHTML = "";
  Object.keys(scalesMapping).forEach(name => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  });
}

function populateMinFor(maxPitch: string, minSelect: HTMLSelectElement, selectedMin: string): void {
  minSelect.innerHTML = "";
  const maxIdx = pitchIndex(maxPitch);
  allPitches.forEach((p, i) => {
    if (i <= maxIdx) {
      const opt = document.createElement("option");
      opt.value = p;
      opt.textContent = p;
      minSelect.appendChild(opt);
    }
  });
  if (selectedMin && pitchIndex(selectedMin) <= maxIdx) minSelect.value = selectedMin;
}

function populateMaxFor(minPitch: string, maxSelect: HTMLSelectElement, selectedMax: string): void {
  maxSelect.innerHTML = "";
  const minIdx = pitchIndex(minPitch);
  allPitches.forEach((p, i) => {
    if (i >= minIdx) {
      const opt = document.createElement("option");
      opt.value = p;
      opt.textContent = p;
      maxSelect.appendChild(opt);
    }
  });
  if (selectedMax && pitchIndex(selectedMax) >= minIdx) maxSelect.value = selectedMax;
}

const rhythmOptions: { id: number; symbol: string }[] = [
  { id: 1,       symbol: "𝅝"  },
  { id: 0.5,     symbol: "𝅗𝅥"  },
  { id: 0.25,    symbol: "𝅘𝅥"  },
  { id: 0.125,   symbol: "𝅘𝅥𝅮"  },
  { id: 0.0625,  symbol: "𝅘𝅥𝅯"  },
  { id: 0.03125, symbol: "𝅘𝅥𝅰" },
];

function populateMinRhythm(maxId: number, selectEl: HTMLSelectElement, selectedId: number): void {
  const maxIndex = rhythmOptions.findIndex(r => r.id === maxId);
  selectEl.innerHTML = "";
  rhythmOptions.forEach((opt, i) => {
    if (i >= maxIndex) {
      const o = document.createElement("option");
      o.value = String(opt.id);
      o.textContent = opt.symbol;
      if (opt.id === selectedId) o.selected = true;
      selectEl.appendChild(o);
    }
  });
}

function populateMaxRhythm(minId: number, selectEl: HTMLSelectElement, selectedId: number): void {
  const minIndex = rhythmOptions.findIndex(r => r.id === minId);
  selectEl.innerHTML = "";
  rhythmOptions.forEach((opt, i) => {
    if (i <= minIndex) {
      const o = document.createElement("option");
      o.value = String(opt.id);
      o.textContent = opt.symbol;
      if (opt.id === selectedId) o.selected = true;
      selectEl.appendChild(o);
    }
  });
}

document.querySelectorAll(".voiceSettings").forEach(settings => {
  const voiceName = (settings as HTMLElement).dataset.voice!;
  const voice = voicesMap[voiceName];
  const rootSelects = settings.querySelectorAll('.rootSelect');
  const rootSelect  = rootSelects[0] as HTMLSelectElement;
  const scaleSelect = settings.querySelector('.scaleSelect')  as HTMLSelectElement;
  const minSelect   = settings.querySelector('.minPitch')     as HTMLSelectElement;
  const maxSelect   = settings.querySelector('.maxPitch')     as HTMLSelectElement;
  const minRhythm   = settings.querySelector('.minRhythm')    as HTMLSelectElement;
  const maxRhythm   = settings.querySelector('.maxRhythm')    as HTMLSelectElement;
  const muteButton  = settings.querySelector('.muteButton')   as HTMLButtonElement;
  const midiButton  = settings.querySelector('.midiButton')   as HTMLButtonElement;
  const musicXMLButton = settings.querySelector('.musicXMLButton') as HTMLButtonElement;

  populateScaleSelect(scaleSelect);
  if (voice.scale && voice.scale[1]) {
    scaleSelect.value = voice.scale[1];
  } else {
    scaleSelect.value = "Chromatic";
    voice.scale = [(voice.scale && voice.scale[0]) || "C", "Chromatic"];
  }

  const initialMin = toPitchStr(voice.pitchRange?.[0] || "E3");
  const initialMax = toPitchStr(voice.pitchRange?.[1] || "E6");
  populateMaxFor(initialMin, maxSelect, initialMax);
  populateMinFor(initialMax, minSelect, initialMin);
  minSelect.value = initialMin;
  maxSelect.value = initialMax;

  const initialMinRhythm = voice.rhythmRange?.[0] ?? 0.03125;
  const initialMaxRhythm = voice.rhythmRange?.[1] ?? 1;
  populateMaxRhythm(initialMinRhythm, maxRhythm, initialMaxRhythm);
  populateMinRhythm(initialMaxRhythm, minRhythm, initialMinRhythm);
  minRhythm.value = String(initialMinRhythm);
  maxRhythm.value = String(initialMaxRhythm);

  rootSelect?.addEventListener('change', () => { voice.scale[0] = rootSelect.value; });
  scaleSelect.addEventListener('change', () => { voice.scale[1] = scaleSelect.value; });

  minSelect.addEventListener("change", () => {
    populateMaxFor(minSelect.value, maxSelect, maxSelect.value);
    voice.pitchRange[0] = minSelect.value;
  });
  maxSelect.addEventListener("change", () => {
    populateMinFor(maxSelect.value, minSelect, minSelect.value);
    voice.pitchRange[1] = maxSelect.value;
  });
  minRhythm.addEventListener("change", () => {
    voice.rhythmRange[0] = parseFloat(minRhythm.value);
    populateMaxRhythm(voice.rhythmRange[0], maxRhythm, voice.rhythmRange[1]);
  });
  maxRhythm.addEventListener("change", () => {
    voice.rhythmRange[1] = parseFloat(maxRhythm.value);
    populateMinRhythm(voice.rhythmRange[1], minRhythm, voice.rhythmRange[0]);
  });
  muteButton.addEventListener("click", () => {
    muteButton.classList.toggle("active");
    voice.muted = muteButton.classList.contains("active");
  });
  midiButton.addEventListener("click",      () => exportVoiceToMidi(voice));
  musicXMLButton.addEventListener("click",  () => exportVoiceToMusicXML(voice));
});

////////////////////////////////////////////////////////////////////////////////////

const transposeDropdown = document.getElementById("transposeDropdown") as HTMLSelectElement;

transposeButton.addEventListener("click", () => {
  const MAX_INTERVAL = 12;
  transposeDropdown.innerHTML = "";

  const blankOption = document.createElement("option");
  blankOption.value = "";
  blankOption.textContent = "";
  transposeDropdown.appendChild(blankOption);

  for (let i = MAX_INTERVAL; i >= 1; i--) {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = `+${i}`;
    transposeDropdown.appendChild(opt);
  }
  for (let i = 1; i <= MAX_INTERVAL; i++) {
    const opt = document.createElement("option");
    opt.value = String(-i);
    opt.textContent = `-${i}`;
    transposeDropdown.appendChild(opt);
  }

  transposeDropdown.style.display = "block";
  transposeDropdown.selectedIndex = 0;
  transposeDropdown.focus();
});

transposeDropdown.addEventListener("click", () => {
  if (transposeDropdown.value === "") return;
  const interval = parseInt(transposeDropdown.value, 10);
  for (const part of selectedVoices) {
    transposeVoice(part, interval);
  }
  updateMemory();
  transposeDropdown.style.display = "none";
});

transposeDropdown.addEventListener("blur", () => {
  transposeDropdown.style.display = "none";
});

const shiftSelect = document.querySelector("#shiftSelect") as HTMLSelectElement;

shiftButton.addEventListener("click", (e: Event) => {
  e.stopPropagation();
  shiftSelect.style.display = shiftSelect.style.display === "block" ? "none" : "block";
});

shiftSelect.addEventListener("click", () => {
  const selectedValue = shiftSelect.value;
  for (const part of selectedVoices) {
    shiftVoice(part, selectedValue);
  }
  updateMemory();
  shiftSelect.style.display = "none";
});

document.addEventListener("click", (event: Event) => {
  if (!shiftSelect.contains(event.target as Node) && !shiftButton.contains(event.target as Node)) {
    shiftSelect.style.display = "none";
  }
});

const reflectSelect = document.querySelector("#reflectSelect") as HTMLSelectElement;

reflectButton.addEventListener("click", (e: Event) => {
  e.stopPropagation();
  reflectSelect.style.display = reflectSelect.style.display === "block" ? "none" : "block";
});

reflectSelect.addEventListener("click", () => {
  const selectedValue = reflectSelect.value;
  for (const part of selectedVoices) {
    reflectVoice(part, selectedValue);
  }
  updateMemory();
  reflectSelect.style.display = "none";
});

document.addEventListener("click", (event: Event) => {
  if (!reflectButton.contains(event.target as Node) && !reflectSelect.contains(event.target as Node)) {
    reflectSelect.style.display = "none";
  }
});

function bindVoiceAction(button: HTMLButtonElement | null, action: (part: Part) => void, update: boolean = true): void {
  if (!button) return;
  button.addEventListener("click", () => {
    for (const part of selectedVoices) action(part);
    if (update) updateMemory();
  });
}

voiceContainers.forEach(container => {
  if ((container as HTMLElement).dataset.name === "harmonyVoice") return;
  container.addEventListener("click", () => {
    const voiceName = (container as HTMLElement).dataset.name!;
    const voiceObj = voicesMap[voiceName];
    container.classList.toggle("active");
    if (container.classList.contains("active")) {
      selectedVoices.push(voiceObj);
    } else {
      selectedVoices = selectedVoices.filter(voice => voice.name !== voiceName);
    }
  });
});

topSelect.addEventListener('change', () => {
  timeSignature[0] = parseInt(topSelect.value, 10);
  measureLength = timeSignature[0] / timeSignature[1];
});
bottomSelect.addEventListener('change', () => {
  timeSignature[1] = parseInt(bottomSelect.value, 10);
  measureLength = timeSignature[0] / timeSignature[1];
});
numMeasuresSelect.addEventListener('change', () => {
  numMeasures = parseInt(numMeasuresSelect.value, 10);
});
bpmSlider.addEventListener("input", () => {
  bpmValueDisplay.textContent = bpmSlider.value;
});
modeSelect.addEventListener("change", () => {
  mode = modeSelect.value;
});

function setupPlayButton(button: HTMLButtonElement | null, parts: Part[]): void {
  if (!button) return;
  button.addEventListener("click", () => {
    button.disabled = true;
    button.classList.add("active");
    setupSampler().then(() => playAllParts(parts, button));
  });
}

setupPlayButton(playButton,      [upperVoice, middleVoice, lowerVoice, voice4]);
setupPlayButton(chordPlayButton, [harmonyVoice]);

bindVoiceAction(generatePhraseButton, part => {
  resetPart(part);
  totalDuration = 0;
  generatePhrase(part, numMeasures * measureLength);
});

separateVoiceButton?.addEventListener("click", () => { separateVoice(); updateMemory(); });
bindVoiceAction(reverseButton,       reverseVoice);
bindVoiceAction(changeRhythmButton,  changeRhythm);
bindVoiceAction(shuffleRhythmButton, shuffleRhythm);
bindVoiceAction(shuffleNotesButton,  shuffleNotes);
bindVoiceAction(shufflePitchButton,  shufflePitch);
bindVoiceAction(changePitchButton,   changePitch);
bindVoiceAction(complicateButton,    complicateVoice);
bindVoiceAction(simplifyButton,      simplifyVoice);

copyPartButton?.addEventListener("click",  () => copyPart());
pastePartButton?.addEventListener("click", () => { pastePart(); updateMemory(); });
previousButton?.addEventListener("click",  () => accessMemory(-1));
nextButton?.addEventListener("click",      () => accessMemory(1));
randomHarmonyButton?.addEventListener("click", generateHarmony);


/////////////////////////////////////////////////////////////////////////////////////
// Main Functions
/////////////////////////////////////////////////////////////////////////////////////

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

function getAllowedPitches(voice: Part, noteDuration: number): string[] {
  const minIdx = pitchIndex(voice.pitchRange[0]);
  const maxIdx = pitchIndex(voice.pitchRange[1]);
  const allowedPitches = allPitches.slice(minIdx, maxIdx + 1);

  const rootIndex = noteMapping[voice.scale[0]];
  const scale = scalesMapping[voice.scale[1]];

  const scalePitches = allowedPitches.filter(pitch => {
    const noteName = pitch.slice(0, -1);
    const pitchClass = noteMapping[noteName];
    return pitchClass !== undefined && scale.includes((pitchClass - rootIndex + 12) % 12);
  });

  if (mode === "Harmony") {
    let durationSearched = 0;
    let currentChord: UnprocessedNote | null = null;
    for (let i = 0; i < harmonyVoice.unprocessedNotes.length; ++i) {
      currentChord = harmonyVoice.unprocessedNotes[i];
      durationSearched += durationMapping[currentChord.duration];
      if (durationSearched <= totalDuration && i + 1 < harmonyVoice.unprocessedNotes.length) continue;
      const currentOverlap = durationSearched - totalDuration;
      const nextOverlap = noteDuration - currentOverlap;
      if (nextOverlap > currentOverlap && i + 1 < harmonyVoice.unprocessedNotes.length) {
        currentChord = harmonyVoice.unprocessedNotes[i + 1];
      }
      const chordNotes = currentChord.noteName;
      return scalePitches.filter(pitch => chordNotes.includes(pitch.slice(0, -1)));
    }
  }
  return scalePitches;
}

function getNoteDurationInSeconds(voice: Part, note: UnprocessedNote): number {
  const bpm = parseFloat(bpmSlider.value) || 120;
  const quarterNoteSeconds = 60 / bpm;
  let durationInWholeNotes = getNoteDuration(note);
  if (note.tupletInfo) {
    const { ratio } = note.tupletInfo;
    durationInWholeNotes = durationInWholeNotes * ratio[1] / ratio[0];
  }
  return durationInWholeNotes * 4 * quarterNoteSeconds;
}

function checkNoteInScale(note: UnprocessedNote, voice: Part): boolean {
  if (note.isRest) return true;
  const scaleRoot = voice.scale[0];
  const scaleIntervals = scalesMapping[voice.scale[1]];
  const scaleNotes = scaleIntervals.map(interval => {
    const semitone = (noteMapping[scaleRoot] + interval) % 12;
    return Object.keys(noteMapping).find(key => noteMapping[key] === semitone);
  });
  return scaleNotes.includes(note.noteName[0]);
}

function randomPitchFromScale(voice: Part, noteDuration: number, allowRest: boolean = true): [string, number] {
  const scalePitches = getAllowedPitches(voice, noteDuration);
  if (allowRest && (!scalePitches.length || Math.random() < 0.2)) return ["Rest", 4];
  const pick = scalePitches[Math.floor(Math.random() * scalePitches.length)];
  return [pick.slice(0, -1), parseInt(pick.slice(-1), 10)];
}

function findTuplet(note: any, part: Part): TupletObj | null {
  for (const tupletObj of part.tuplets) {
    if (tupletObj.tupletNotes.includes(note)) return tupletObj;
  }
  return null;
}

function createNote(noteNames: string[], noteOctave: number, noteDuration: string): any {
  const noteInfo: string[] = [];
  const accidentalIndices: number[] = [];
  let durationInfo = noteDuration;

  if (noteNames[0] === "Rest") {
    noteInfo.push("B/4");
    durationInfo = noteDuration + "r";
  } else {
    for (let i = 0; i < noteNames.length; i++) {
      if (noteNames[i].includes("b")) accidentalIndices.push(i);
      noteInfo.push(`${noteNames[i]}/${noteOctave}`);
    }
  }

  const note = new StaveNote({ keys: noteInfo, duration: durationInfo });
  accidentalIndices.forEach(i => note.addModifier(new Accidental("b"), i));

  if (noteDuration.includes("d")) {
    note.dotted = true;
    Dot.buildAndAttach([note], { all: true });
  }

  return note;
}

function fillDuration(fillNoteDuration: number, note: any | "rest"): any[] {
  let noteName: string;
  let noteOctave: number;

  if (note === "rest" || (note as any).isRest()) {
    noteName = "Rest";
    noteOctave = 4;
  } else {
    const staveNote = note as any;
    const [name, octaveStr] = staveNote.getKeys()[0].split("/");
    noteName = name;
    noteOctave = parseInt(octaveStr);
  }

  const fillNotes: any[] = [];
  const durationsLargestFirst = Object.entries(durationMapping).sort((a, b) => b[1] - a[1]);
  let remaining = fillNoteDuration;

  while (remaining > 0) {
    for (const [durStr, durValue] of durationsLargestFirst) {
      if (durValue <= remaining) {
        fillNotes.push(createNote([noteName], noteOctave, durStr));
        remaining -= durValue;
        break;
      }
    }
  }
  return fillNotes;
}

function round(val: number): number {
  return Math.round(val * 1e9) / 1e9;
}

function processNotes(part: Part, unprocessedNotes: UnprocessedNote[], drawHarmony: boolean = false): void {
  let tupletNotes: any[] = [];
  let measureNotes: any[] = [];
  let posInMeasure = 0;

  for (const unprocessedNote of unprocessedNotes) {
    part.unprocessedNotes.push(unprocessedNote);
    const note = unprocessedNote.toStaveNote();

    if (unprocessedNote.tupletInfo) {
      const { totalTupletDuration, ratio, count, index } = unprocessedNote.tupletInfo;

      tupletNotes.push(note);
      measureNotes.push(note);
      part.toneNotes.push([staveNoteToToneJSNote(note), getNoteDuration(unprocessedNote) * ratio[1] / ratio[0]]);

      if (index === count) {
        const vfTuplet = new Tuplet(tupletNotes, {
          num_notes: ratio[0],
          notes_occupied: ratio[1],
          ratioed: true,
        });
        part.tuplets.push({ tupletNotes: [...tupletNotes], vfTuplet, realDuration: totalTupletDuration });
        posInMeasure = round(posInMeasure + totalTupletDuration);
        tupletNotes = [];

        if (posInMeasure >= measureLength) {
          part.notes.push([...measureNotes]);
          measureNotes = [];
          posInMeasure = 0;
        }
      }

    } else {
      const noteDur = getNoteDuration(unprocessedNote);

      if (round(posInMeasure + noteDur) > measureLength) {
        const fillDur = round(measureLength - posInMeasure);
        let overflowDur = round(noteDur - fillDur);
        const notesToTie: any[] = [];

        const fillNotes = fillDuration(fillDur, note);
        measureNotes.push(...fillNotes);
        notesToTie.push(...fillNotes);
        part.notes.push([...measureNotes]);
        measureNotes = [];
        posInMeasure = 0;

        while (overflowDur > measureLength) {
          const chunk = fillDuration(measureLength, note);
          notesToTie.push(...chunk);
          part.notes.push([...chunk]);
          overflowDur = round(overflowDur - measureLength);
        }

        if (overflowDur > 1e-9) {
          const tail = fillDuration(overflowDur, note);
          measureNotes.push(...tail);
          notesToTie.push(...tail);
          posInMeasure = overflowDur;
        }

        if (!note.isRest()) part.ties.push(notesToTie);

      } else {
        measureNotes.push(note);
        posInMeasure = round(posInMeasure + noteDur);
        if (posInMeasure >= measureLength) {
          part.notes.push([...measureNotes]);
          measureNotes = [];
          posInMeasure = 0;
        }
      }

      part.toneNotes.push([staveNoteToToneJSNote(note), noteDur]);
    }
  }

  if (measureNotes.length > 0) part.notes.push([...measureNotes]);

  drawAllVoices(drawHarmony);
}

function resetPart(part: Part): void {
  part.unprocessedNotes = [];
  part.notes = [];
  part.ties = [];
  part.tuplets = [];
  part.toneNotes = [];
  part.duration = 0;
}


/////////////////////////////////////////////////////////////////////////////////////
// Memory
/////////////////////////////////////////////////////////////////////////////////////

function updateMemory(): void {
  for (const voice of selectedVoices) {
    voice.memory.splice(voice.currentMemoryIndex + 1);
    const snapshot: MemorySnapshot[] = voice.unprocessedNotes.map(note => ({
      noteName: [...note.noteName],
      octave: note.octave,
      duration: note.duration,
      dotted: note.dotted,
      tupletInfo: note.tupletInfo ? { ...note.tupletInfo } : null,
    }));
    voice.memory.push(snapshot);
    voice.currentMemoryIndex = voice.memory.length - 1;
  }
  // Autosave on every state change
  if (typeof saveToLocalStorage === 'function') saveToLocalStorage();
}

function accessMemory(indexDifference: number): void {
  for (const voice of selectedVoices) {
    const newIdx = voice.currentMemoryIndex + indexDifference;
    if (newIdx < 0 || newIdx >= voice.memory.length) continue;
    voice.currentMemoryIndex = newIdx;
    const snapshot = voice.memory[newIdx];
    resetPart(voice);
    const notes = snapshot.map(s => {
      const note = new UnprocessedNote([...s.noteName], s.octave, s.duration, s.dotted);
      if (s.tupletInfo) note.tupletInfo = { ...s.tupletInfo };
      return note;
    });
    processNotes(voice, notes);
  }
}

function copyPart(): void {
  clipboard = {};
  for (const voice of selectedVoices) {
    clipboard[voice.name] = voice.unprocessedNotes.map(note => ({
      noteName: [...note.noteName],
      octave: note.octave,
      duration: note.duration,
      dotted: note.dotted,
      tupletInfo: note.tupletInfo ? { ...note.tupletInfo } : null,
    }));
  }
}

function pastePart(): void {
  const copiedVoiceNames = Object.keys(clipboard);
  if (!copiedVoiceNames.length) return;

  selectedVoices.forEach((voice, i) => {
    const sourceVoiceName = copiedVoiceNames[i % copiedVoiceNames.length];
    const sourceNotes = clipboard[sourceVoiceName];
    const notes = sourceNotes.map(s => {
      const note = new UnprocessedNote([...s.noteName], s.octave, s.duration, s.dotted);
      if (s.tupletInfo) note.tupletInfo = { ...s.tupletInfo };
      return note;
    });
    resetPart(voice);
    processNotes(voice, notes);
  });
}


/////////////////////////////////////////////////////////////////////////////////////
// Draw
/////////////////////////////////////////////////////////////////////////////////////

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

function getGlobalMeasureWidths(parts: Part[]): number[] {
  const globalWidths: number[] = [];
  parts.forEach(part => {
    if (!part.notes.length) return;
    part.notes.forEach((measureNotes, i) => {
      const width = 200 + measureNotes.length * 40;
      globalWidths[i] = Math.max(globalWidths[i] || 0, width);
    });
  });
  return globalWidths;
}

function getTupletsForMeasure(part: Part, measureIndex: number): any[] {
  const measureNoteSet = new Set(part.notes[measureIndex]);
  return part.tuplets
    .filter(tuplet => tuplet.tupletNotes.some(note => measureNoteSet.has(note)))
    .map(tuplet => tuplet.vfTuplet);
}

function drawAllVoices(includeHarmony: boolean = false): void {
  const parts = includeHarmony
    ? [harmonyVoice]
    : Object.values(voicesMap).filter(voiceObj => voiceObj !== harmonyVoice);

  const globalMeasureWidths = getGlobalMeasureWidths(parts);
  const requiredWidth = globalMeasureWidths.reduce((a, b) => a + b, 0) + 100;

  parts.forEach(part => {
    eraseDrawing(part);
    ensureSvgSize(part.name, requiredWidth);
  });

  const measureCount = Math.max(...parts.map(part => part.notes.length), 0);
  let staffLength = 0;

  for (let measureIndex = 0; measureIndex < measureCount; measureIndex++) {
    const staveWidth = globalMeasureWidths[measureIndex] || 400;
    const staves: Record<string, any> = {};
    const voiceObjs: { voice: any; part: Part; beams: any[]; tuplets: any[] }[] = [];

    parts.forEach(part => {
      const stave = new Stave(staffLength, 60, staveWidth);
      if (measureIndex === 0) stave.addClef("treble").addTimeSignature(`${timeSignature[0]}/${timeSignature[1]}`);
      stave.setContext(contexts[part.name]).draw();
      staves[part.name] = stave;

      const notes = part.notes[measureIndex] || [];
      const voice = new Voice({ num_beats: timeSignature[0], beat_value: timeSignature[1] }).setStrict(false);
      voice.addTickables(notes);

      voiceObjs.push({
        voice,
        part,
        beams: Vex.Flow.Beam.generateBeams(notes),
        tuplets: getTupletsForMeasure(part, measureIndex),
      });
    });

    const formatter = new Formatter();
    formatter.joinVoices(voiceObjs.map(voiceObj => voiceObj.voice));
    formatter.formatToStave(voiceObjs.map(voiceObj => voiceObj.voice), Object.values(staves)[0]);

    voiceObjs.forEach(({ voice, part, beams, tuplets }) => {
      voice.draw(contexts[part.name], staves[part.name]);
      beams.forEach(beam => beam.setContext(contexts[part.name]).draw());
      tuplets.forEach(tuplet => tuplet.setContext(contexts[part.name]).draw());
    });

    staffLength += staveWidth;
  }

  parts.forEach(part => drawTies(part.ties, contexts[part.name]));
}

function drawTies(tieGroups: any[][], context: any): void {
  for (const notesToTie of tieGroups) {
    for (let i = 0; i < notesToTie.length - 1; ++i) {
      new StaveTie({
        first_note: notesToTie[i],
        last_note: notesToTie[i + 1],
        first_indices: [0],
        last_indices: [0],
      }).setContext(context).draw();
    }
  }
}

function eraseDrawing(part: Part): void {
  const partName = part.name;
  if (!partName || !containers[partName]) {
    console.warn("No container found for part:", partName);
    return;
  }
  containers[partName].innerHTML = "";
  renderers[partName] = new Renderer(containers[partName], Renderer.Backends.SVG);
  const container = containers[partName];
  renderers[partName].resize(container.clientWidth, container.clientHeight);
  contexts[partName] = renderers[partName].getContext();
}


/////////////////////////////////////////////////////////////////////////////////////
// Generate
/////////////////////////////////////////////////////////////////////////////////////

function generatePhrase(part: Part, duration: number, allowTuplets: boolean = true): void {
  const totalDurationOriginal = totalDuration;
  let notes: UnprocessedNote[] = [];
  let currentDuration = 0;
  const durationKeys = Object.keys(durationMapping);
  const allowedDurations: string[] = [];
  let tupletId = 0;

  for (const durationKey of durationKeys) {
    if (durationMapping[durationKey] >= part.rhythmRange[0] && durationMapping[durationKey] <= part.rhythmRange[1]) {
      allowedDurations.push(durationKey);
    }
  }

  while (currentDuration < duration) {
    if (duration - currentDuration < part.rhythmRange[0]) {
      currentDuration = 0;
      notes = [];
      totalDuration = totalDurationOriginal;
    }

    const durationStr = allowedDurations[Math.floor(Math.random() * allowedDurations.length)];
    if (currentDuration + durationMapping[durationStr] > duration) continue;

    const shouldTryTuplet = (
      allowTuplets &&
      !durationStr.includes("d") &&
      durationMapping[durationStr] < 1 &&
      Math.random() < 0.5 &&
      durationMapping[durationStr] >= 1 / timeSignature[1]
    );

    if (shouldTryTuplet) {
      const notesOccupied = 2;
      const possibleTupletSizes = [3, 5, 7];
      const numTupletNotes = possibleTupletSizes[Math.floor(Math.random() * possibleTupletSizes.length)];
      const realDuration = 2 * durationMapping[durationStr];
      const measureRemaining = measureLength - (currentDuration % measureLength);
      if (realDuration > measureRemaining) continue;

      ++tupletId;
      for (let i = 1; i <= numTupletNotes; i++) {
        const [noteName, noteOctave] = randomPitchFromScale(part, durationMapping[durationStr]);
        const tupletNote = new UnprocessedNote(noteName, noteOctave, durationStr);
        tupletNote.setTuplet(tupletId, realDuration, [numTupletNotes, notesOccupied], numTupletNotes, i);
        notes.push(tupletNote);
        totalDuration += durationMapping[durationStr] * 2 / numTupletNotes;
      }
      currentDuration = round(currentDuration + realDuration);

    } else {
      const [noteName, noteOctave] = randomPitchFromScale(part, durationMapping[durationStr]);
      notes.push(new UnprocessedNote(noteName, noteOctave, durationStr));
      currentDuration = round(currentDuration + durationMapping[durationStr]);
      totalDuration = round(totalDuration + durationMapping[durationStr]);
    }
  }

  processNotes(part, notes);
}


/////////////////////////////////////////////////////////////////////////////////////
// Accompany
/////////////////////////////////////////////////////////////////////////////////////

function separateVoice(): void {
  const voiceToSeparate = selectedVoices[0];
  if (!voiceToSeparate || !voiceToSeparate.unprocessedNotes.length) return;

  const newNotesPerVoice: Record<string, UnprocessedNote[]> = {};
  for (const voiceName of voices) newNotesPerVoice[voiceName] = [];
  totalDuration = 0;

  for (const note of voiceToSeparate.unprocessedNotes) {
    const candidateVoices: string[] = [];
    for (const voiceName of voices) {
      const voice = selectedVoices.find(selected => selected.name === voiceName);
      if (!voice) continue;
      if (note.isRest) { candidateVoices.push(voiceName); continue; }
      const allowedPitches = getAllowedPitches(voicesMap[voiceName], durationMapping[note.duration]);
      if (allowedPitches.includes(note.noteName[0] + note.octave)) candidateVoices.push(voiceName);
    }

    const targetVoiceName = candidateVoices.length > 0
      ? candidateVoices[Math.floor(Math.random() * candidateVoices.length)]
      : voiceToSeparate.name;

    for (const voiceName of voices) {
      const isTargetVoice = voiceName === targetVoiceName;
      const newNote = (isTargetVoice && !note.isRest)
        ? new UnprocessedNote(note.noteName, note.octave, note.duration, note.dotted)
        : new UnprocessedNote(["Rest"], 4, note.duration, note.dotted);
      if (note.tupletInfo) newNote.tupletInfo = { ...note.tupletInfo };
      newNotesPerVoice[voiceName].push(newNote);
    }

    totalDuration += durationMapping[note.duration] || 0;
  }

  for (const voiceName of voices) {
    const voice = selectedVoices.find(selected => selected.name === voiceName);
    if (!voice) continue;
    resetPart(voice);
    processNotes(voice, newNotesPerVoice[voiceName]);
  }
}


/////////////////////////////////////////////////////////////////////////////////////
// Modify
/////////////////////////////////////////////////////////////////////////////////////

function reverseVoice(voice: Part): void {
  const reversedNotes = [...voice.unprocessedNotes].reverse();
  for (const note of reversedNotes) {
    if (note.tupletInfo) {
      const { id, totalTupletDuration, ratio, count, index } = note.tupletInfo;
      note.tupletInfo = { id, totalTupletDuration, ratio, count, index: count - index + 1 };
    }
  }
  resetPart(voice);
  processNotes(voice, reversedNotes);
}

function reflectVoice(voice: Part, axisPitch: string): void {
  const axisOctave = 4;
  const scale = scalesMapping[voice.scale[1]];
  const axisDistanceFromRoot = Math.abs(noteMapping[voice.scale[0]] - noteMapping[axisPitch]);
  const axisScalarIndex = scale.indexOf(axisDistanceFromRoot);
  const reflectedNotes: UnprocessedNote[] = [];

  for (const note of voice.unprocessedNotes) {
    let reflectedNote: UnprocessedNote;

    if (note.isRest) {
      reflectedNote = new UnprocessedNote(note.noteName, note.octave, getDurationString(note)!);
    } else {
      const noteNameStr = note.noteName[0];
      let workScale = scale;
      const noteIsInScale = checkNoteInScale(note, voice);
      if (!noteIsInScale) workScale = scalesMapping["Chromatic"];

      const noteDistanceFromRoot = Math.abs(noteMapping[voice.scale[0]] - noteMapping[noteNameStr]);
      const noteScalarIndex = workScale.indexOf(noteDistanceFromRoot);

      let reflectedScalarIndex: number;
      if (axisScalarIndex === -1 && noteIsInScale) {
        let searchInterval = axisDistanceFromRoot;
        while (workScale.indexOf(searchInterval % 12) === -1) searchInterval++;
        const nearestScaleDegree = workScale.indexOf(searchInterval % 12);
        const distanceFromNearest = Math.abs((noteScalarIndex - nearestScaleDegree + workScale.length) % workScale.length);
        reflectedScalarIndex = (nearestScaleDegree - distanceFromNearest - 1 + workScale.length) % workScale.length;
      } else {
        reflectedScalarIndex = ((axisScalarIndex - noteScalarIndex) + axisScalarIndex + workScale.length) % workScale.length;
      }

      const reflectedPitchIndex = (noteMapping[voice.scale[0]] + workScale[reflectedScalarIndex]) % 12;
      const reflectedPitch = Object.keys(noteMapping).find(key => noteMapping[key] === reflectedPitchIndex)!;

      const noteAbs = note.octave * 12 + noteDistanceFromRoot;
      const axisAbs = axisOctave  * 12 + axisDistanceFromRoot;
      let newOctave = Math.floor((2 * axisAbs - noteAbs) / 12);

      const noteIdx = pitchIndex(reflectedPitch + newOctave);
      const minIdx  = pitchIndex(voice.pitchRange[0]);
      const maxIdx  = pitchIndex(voice.pitchRange[1]);
      if (noteIdx < minIdx) newOctave += Math.ceil((minIdx - noteIdx) / 12);
      else if (noteIdx > maxIdx) newOctave -= Math.ceil((noteIdx - maxIdx) / 12);

      reflectedNote = new UnprocessedNote([reflectedPitch], newOctave, getDurationString(note)!);
    }

    if (note.tupletInfo) reflectedNote.tupletInfo = { ...note.tupletInfo };
    reflectedNotes.push(reflectedNote);
  }

  resetPart(voice);
  processNotes(voice, reflectedNotes);
}

function shiftVoice(voice: Part, distance: string): void {
  const shiftDur = durationMapping[distance];

  // Check tuplets won't cross barlines after shift
  let currentPos = shiftDur;
  for (const note of voice.unprocessedNotes) {
    if (note.tupletInfo) {
      const { index, count, totalTupletDuration } = note.tupletInfo;
      if (index === 1) {
        const measureEnd = (Math.floor(currentPos / measureLength) + 1) * measureLength;
        if (currentPos + totalTupletDuration > measureEnd) {
          console.warn("Shift rejected: tuplet would cross measure boundary");
          return;
        }
      }
      if (index === count) currentPos += totalTupletDuration;
    } else {
      currentPos += getNoteDuration(note);
    }
  }

  const shiftedNotes: UnprocessedNote[] = [new UnprocessedNote(["Rest"], 4, distance), ...voice.unprocessedNotes];

  let totalDur = 0;
  for (const note of shiftedNotes) {
    if (note.tupletInfo) {
      if (note.tupletInfo.index === note.tupletInfo.count) totalDur += note.tupletInfo.totalTupletDuration;
    } else {
      totalDur += getNoteDuration(note);
    }
  }
  totalDur = round(totalDur);

  const remainder = round(measureLength - (totalDur % measureLength));
  const lastMeasureIsIncomplete = remainder > 0 && remainder < measureLength;

  if (lastMeasureIsIncomplete) {
    const durationsLargestFirst = Object.entries(durationMapping).sort((a, b) => b[1] - a[1]);
    let remaining = remainder;
    while (remaining > 1e-9) {
      for (const [durStr, durVal] of durationsLargestFirst) {
        if (durVal <= remaining + 1e-9) {
          shiftedNotes.push(new UnprocessedNote(["Rest"], 4, durStr));
          remaining = round(remaining - durVal);
          break;
        }
      }
    }
  }

  resetPart(voice);
  processNotes(voice, shiftedNotes);
}

function transposeVoice(voice: Part, scaleDegreeDifference: number): void {
  const rootIndex = noteMapping[voice.scale[0]];
  const scale = scalesMapping[voice.scale[1]];
  const direction = scaleDegreeDifference < 0 ? "down" : "up";
  const transposedNotes: UnprocessedNote[] = [];

  for (const note of voice.unprocessedNotes) {
    let transposedNote: UnprocessedNote;

    if (note.isRest) {
      transposedNote = new UnprocessedNote("Rest", note.octave, getDurationString(note)!);
    } else {
      const noteOctave = note.octave;
      const noteIndex = noteMapping[note.noteName[0]];
      const originalInterval = (noteIndex + 12 - rootIndex) % 12;
      const originalScaleDegree = scale.indexOf(originalInterval);
      const newScaleDegree = (originalScaleDegree + scaleDegreeDifference + scale.length) % scale.length;
      const transposedIndex = (rootIndex + scale[newScaleDegree]) % 12;
      const transposedPitch = Object.keys(noteMapping).find(key => noteMapping[key] === transposedIndex)!;

      const originalAbs = noteIndex + 12 * noteOctave;
      let newOctave = noteOctave;
      const transposedAbs = noteMapping[transposedPitch] + 12 * newOctave;

      if (originalAbs <= transposedAbs && direction === "down") newOctave--;
      else if (originalAbs >= transposedAbs && direction === "up") newOctave++;

      const newIdx = pitchIndex(transposedPitch + newOctave);
      const minIdx = pitchIndex(voice.pitchRange[0]);
      const maxIdx = pitchIndex(voice.pitchRange[1]);
      if (newIdx < minIdx) newOctave += Math.ceil((minIdx - newIdx) / 12);
      else if (newIdx > maxIdx) newOctave -= Math.ceil((newIdx - maxIdx) / 12);

      transposedNote = new UnprocessedNote(transposedPitch, newOctave, getDurationString(note)!);
    }

    if (note.tupletInfo) transposedNote.tupletInfo = { ...note.tupletInfo };
    transposedNotes.push(transposedNote);
  }

  resetPart(voice);
  processNotes(voice, transposedNotes);
}

function shuffleRhythm(voice: Part): void {
  const pitches: PitchInfo[] = voice.unprocessedNotes.map(note => ({
    noteName: note.noteName,
    octave: note.octave,
    isRest: note.isRest,
  }));

  const rhythmGroups: RhythmGroup[] = [];
  const seenTupletIds = new Set<number>();

  for (const note of voice.unprocessedNotes) {
    if (note.tupletInfo) {
      const tupletId = note.tupletInfo.id;
      if (!seenTupletIds.has(tupletId)) {
        seenTupletIds.add(tupletId);
        const tupletNotes: UnprocessedNote[] = [];
        for (const candidate of voice.unprocessedNotes) {
          if (candidate.tupletInfo?.id === tupletId) tupletNotes.push(candidate);
        }
        rhythmGroups.push({ type: 'tuplet', notes: tupletNotes });
      }
    } else {
      rhythmGroups.push({ type: 'note', note });
    }
  }

  for (let i = rhythmGroups.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rhythmGroups[i], rhythmGroups[j]] = [rhythmGroups[j], rhythmGroups[i]];
  }

  const newNotes: UnprocessedNote[] = [];
  let pitchIdx = 0;
  let newTupletId = 0;

  for (const group of rhythmGroups) {
    if (group.type === 'note' && group.note) {
      const pitch = pitches[pitchIdx++];
      newNotes.push(new UnprocessedNote(pitch.noteName, pitch.octave, getDurationString(group.note)!));
    } else if (group.type === 'tuplet' && group.notes) {
      ++newTupletId;
      const firstNoteInfo = group.notes[0].tupletInfo!;
      for (let i = 0; i < group.notes.length; i++) {
        const rhythmNote = group.notes[i];
        const pitch = pitches[pitchIdx++];
        const newNote = new UnprocessedNote(pitch.noteName, pitch.octave, rhythmNote.duration, rhythmNote.dotted);
        newNote.setTuplet(newTupletId, firstNoteInfo.totalTupletDuration, [...firstNoteInfo.ratio], firstNoteInfo.count, i + 1);
        newNotes.push(newNote);
      }
    }
  }

  resetPart(voice);
  processNotes(voice, newNotes);
}

function shuffleNotes(voice: Part): void {
  const groups: RhythmGroup[] = [];
  const seenIds = new Set<number>();

  for (const note of voice.unprocessedNotes) {
    if (note.tupletInfo) {
      const { id } = note.tupletInfo;
      if (!seenIds.has(id)) {
        seenIds.add(id);
        const tupletNotes: UnprocessedNote[] = [];
        for (const candidate of voice.unprocessedNotes) {
          if (candidate.tupletInfo?.id === id) tupletNotes.push(candidate);
        }
        groups.push({ type: 'tuplet', notes: tupletNotes });
      }
    } else {
      groups.push({ type: 'note', note });
    }
  }

  for (let i = groups.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [groups[i], groups[j]] = [groups[j], groups[i]];
  }

  const newNotes: UnprocessedNote[] = [];
  let tupletId = 0;

  for (const group of groups) {
    if (group.type === 'note' && group.note) {
      newNotes.push(group.note);
    } else if (group.type === 'tuplet' && group.notes) {
      ++tupletId;
      const firstNoteInfo = group.notes[0].tupletInfo!;
      const shuffled = [...group.notes];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      for (let i = 0; i < shuffled.length; i++) {
        const tupletNote = shuffled[i];
        const newNote = new UnprocessedNote(tupletNote.noteName, tupletNote.octave, tupletNote.duration, tupletNote.dotted);
        newNote.setTuplet(tupletId, firstNoteInfo.totalTupletDuration, [...firstNoteInfo.ratio], firstNoteInfo.count, i + 1);
        newNotes.push(newNote);
      }
    }
  }

  resetPart(voice);
  processNotes(voice, newNotes);
}

function shufflePitch(voice: Part): void {
  const pitches: { noteName: string[]; octave: number }[] = [];
  for (const note of voice.unprocessedNotes) {
    if (!note.isRest) pitches.push({ noteName: note.noteName, octave: note.octave });
  }

  for (let i = pitches.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pitches[i], pitches[j]] = [pitches[j], pitches[i]];
  }

  const newNotes: UnprocessedNote[] = [];
  let pitchIdx = 0;

  for (const note of voice.unprocessedNotes) {
    let newNote: UnprocessedNote;
    if (note.isRest) {
      newNote = new UnprocessedNote(["Rest"], 4, note.duration, note.dotted);
    } else {
      const pitch = pitches[pitchIdx++];
      newNote = new UnprocessedNote(pitch.noteName, pitch.octave, note.duration, note.dotted);
    }
    if (note.tupletInfo) newNote.tupletInfo = { ...note.tupletInfo };
    newNotes.push(newNote);
  }

  resetPart(voice);
  processNotes(voice, newNotes);
}

function changeRhythm(voice: Part): void {
  const originalNotes = [...voice.unprocessedNotes];
  if (!originalNotes.length) return;

  const durationKeys = Object.keys(durationMapping);

  let targetDuration = 0;
  for (const note of originalNotes) {
    if (note.tupletInfo) {
      if (note.tupletInfo.index === note.tupletInfo.count) targetDuration += note.tupletInfo.totalTupletDuration;
    } else {
      targetDuration += getNoteDuration(note);
    }
  }
  targetDuration = round(targetDuration);

  let newNotes: UnprocessedNote[] = [];
  let success = false;

  while (!success) {
    newNotes = [];
    let currentDuration = 0;
    success = true;

    for (let i = 0; i < originalNotes.length - 1; i++) {
      const note = originalNotes[i];
      const remaining = round(targetDuration - currentDuration);
      const notesLeft = originalNotes.length - i - 1;
      const minReserve = round(voice.rhythmRange[0] * notesLeft);
      const posInMeasure = round(currentDuration % measureLength);
      const spaceInMeasure = round(measureLength - posInMeasure);

      const fittingDurations = durationKeys.filter(key => {
        const val = durationMapping[key];
        const leftover = round(remaining - val);
        return (
          val < remaining - 1e-9 &&
          leftover >= minReserve - 1e-9 &&
          round(val) <= round(spaceInMeasure)
        );
      });

      if (fittingDurations.length === 0) { success = false; break; }

      const randomDur = fittingDurations[Math.floor(Math.random() * fittingDurations.length)];
      newNotes.push(new UnprocessedNote(note.noteName, note.octave, randomDur));
      currentDuration = round(currentDuration + durationMapping[randomDur]);
    }

    if (!success) continue;

    const lastNote = originalNotes[originalNotes.length - 1];
    const lastRemaining = round(targetDuration - currentDuration);
    const posInMeasure = round(currentDuration % measureLength);
    const spaceInMeasure = round(measureLength - posInMeasure);
    const lastDurStr = getDurationKeyFromValue(lastRemaining);

    if (!lastDurStr || round(lastRemaining) > round(spaceInMeasure)) { success = false; continue; }

    newNotes.push(new UnprocessedNote(lastNote.noteName, lastNote.octave, lastDurStr));
  }

  resetPart(voice);
  processNotes(voice, newNotes);
}

function changePitch(voice: Part): void {
  totalDuration = 0;

  const newNotes = voice.unprocessedNotes.map(note => {
    let newNote: UnprocessedNote;
    if (note.isRest) {
      newNote = new UnprocessedNote(["Rest"], 4, note.duration, note.dotted);
    } else {
      const [noteName, octave] = randomPitchFromScale(voice, getNoteDuration(note), false);
      newNote = new UnprocessedNote(noteName, octave, note.duration, note.dotted);
    }
    if (note.tupletInfo) newNote.tupletInfo = { ...note.tupletInfo };
    totalDuration += note.tupletInfo
      ? note.tupletInfo.totalTupletDuration / note.tupletInfo.count
      : getNoteDuration(note);
    return newNote;
  });

  resetPart(voice);
  processNotes(voice, newNotes);
}


/////////////////////////////////////////////////////////////////////////////////////
// Develop
/////////////////////////////////////////////////////////////////////////////////////

function simplifyVoice(voice: Part): void {
  const currentNotes = [...voice.unprocessedNotes];
  const simplifiedNotes: UnprocessedNote[] = [];
  let i = 0;

  while (i < currentNotes.length) {
    const note = currentNotes[i];

    if (note.tupletInfo) {
      const id = note.tupletInfo.id;
      const tupletNotes: UnprocessedNote[] = [];
      while (i < currentNotes.length && currentNotes[i].tupletInfo?.id === id) {
        tupletNotes.push(currentNotes[i]);
        i++;
      }

      const { totalTupletDuration, ratio } = tupletNotes[0].tupletInfo!;
      const [, notesOccupied] = ratio;

      let kept = [...tupletNotes];
      const target = Math.max(3, 2 + Math.floor(Math.random() * (kept.length - 2)));
      while (kept.length > target) kept.splice(Math.floor(Math.random() * kept.length), 1);

      if (kept.length % 2 === 1) {
        for (let idx = 0; idx < kept.length; idx++) {
          const keptNote = kept[idx];
          const newNote = new UnprocessedNote(keptNote.noteName, keptNote.octave, keptNote.duration, keptNote.dotted);
          newNote.setTuplet(id, totalTupletDuration, [kept.length, notesOccupied], kept.length, idx + 1);
          simplifiedNotes.push(newNote);
        }
      } else {
        const perNote = totalTupletDuration / kept.length;
        const durStr = getDurationKeyFromValue(perNote) ?? "q";
        for (const keptNote of kept) {
          simplifiedNotes.push(new UnprocessedNote(keptNote.noteName, keptNote.octave, durStr));
        }
      }

    } else {
      const noteName = note.noteName;
      const noteOctave = note.octave;
      let combinedDuration = round(getNoteDuration(note));
      let j = i + 1;
      let merged = false;

      while (j < currentNotes.length) {
        if (currentNotes[j].tupletInfo) break;
        combinedDuration = round(combinedDuration + getNoteDuration(currentNotes[j]));
        const durStr = getDurationKeyFromValue(combinedDuration);
        if (round(combinedDuration) !== round(measureLength) && durStr && Math.random() < 0.5) {
          simplifiedNotes.push(new UnprocessedNote(noteName, noteOctave, durStr));
          i = j + 1;
          merged = true;
          break;
        }
        j++;
      }

      if (!merged) { simplifiedNotes.push(note); i++; }
    }
  }

  resetPart(voice);
  processNotes(voice, simplifiedNotes);
}

function complicateVoice(voice: Part): void {
  const originalNotes = [...voice.unprocessedNotes];
  const newNotes: UnprocessedNote[] = [];
  const seenIds = new Set<number>();

  for (const note of originalNotes) {
    if (note.tupletInfo) {
      const { id, totalTupletDuration } = note.tupletInfo;
      if (seenIds.has(id)) continue;
      seenIds.add(id);

      const savedNotes = [...voice.unprocessedNotes];
      const savedTuplets = [...voice.tuplets];
      resetPart(voice);
      generatePhrase(voice, totalTupletDuration, false);
      const subNotes = [...voice.unprocessedNotes];
      voice.unprocessedNotes = savedNotes;
      voice.tuplets = savedTuplets;

      subNotes.forEach((subNote, idx) => {
        if (idx === 0 || Math.random() < 0.3) {
          const newNote = new UnprocessedNote(note.noteName, note.octave, subNote.duration, subNote.dotted);
          if (subNote.tupletInfo) newNote.tupletInfo = { ...subNote.tupletInfo };
          newNotes.push(newNote);
        } else {
          newNotes.push(subNote);
        }
      });

    } else if (note.duration !== "32" && Math.random() < 0.5) {
      const savedNotes = [...voice.unprocessedNotes];
      const savedTuplets = [...voice.tuplets];
      resetPart(voice);
      generatePhrase(voice, getNoteDuration(note), false);
      const subNotes = [...voice.unprocessedNotes];
      voice.unprocessedNotes = savedNotes;
      voice.tuplets = savedTuplets;

      subNotes.forEach((subNote, idx) => {
        if (idx === 0 || Math.random() < 0.3) {
          const newNote = new UnprocessedNote(note.noteName, note.octave, subNote.duration, subNote.dotted);
          if (subNote.tupletInfo) newNote.tupletInfo = { ...subNote.tupletInfo };
          newNotes.push(newNote);
        } else {
          newNotes.push(subNote);
        }
      });

    } else {
      newNotes.push(note);
    }
  }

  resetPart(voice);
  processNotes(voice, newNotes);
}


/////////////////////////////////////////////////////////////////////////////////////
// Audio
/////////////////////////////////////////////////////////////////////////////////////

async function playAllParts(parts: Part[], button: HTMLButtonElement): Promise<void> {
  await Tone.start();
  const now = Tone.now();
  let longestDuration = 0;
  const bpm = parseFloat(bpmSlider.value) || 120;
  const secondsPerBeat = 60 / bpm;

  parts.forEach(part => {
    if (part.muted) return;
    let currentTime = now;

    part.toneNotes.forEach(([pitch, duration]) => {
      if (pitch == null) {
        currentTime += duration * secondsPerBeat * 4;
        return;
      }
      for (const p of pitch) {
        sampler!.triggerAttackRelease(p, duration * secondsPerBeat * 4, currentTime);
      }
      currentTime += duration * secondsPerBeat * 4;
    });

    const partDuration = currentTime - now;
    if (partDuration > longestDuration) longestDuration = partDuration;
  });

  button.disabled = true;
  button.classList.add("active");
  setTimeout(() => {
    button.disabled = false;
    button.classList.remove("active");
  }, longestDuration * 1000);
}

function staveNoteToToneJSNote(staveNote: any): string[] | null {
  if (staveNote.isRest()) return null;
  return staveNote.getKeys().map(k => k.replace("/", ""));
}

async function setupSampler(): Promise<void> {
  if (sampler) return;
  const sampleMap: Record<string, string> = {};
  pianoKeys.forEach(key => { sampleMap[key] = `${key}.mp3`; });
  await new Promise<void>(resolve => {
    sampler = new Tone.Sampler({
      urls: sampleMap,
      baseUrl: "/static/notes/",
      onload: resolve,
    }).toDestination();
  });
  await Tone.start();
}


/////////////////////////////////////////////////////////////////////////////////////
// Settings
/////////////////////////////////////////////////////////////////////////////////////

function generateHarmony(): void {
  resetPart(harmonyVoice);
  const durationValues = Object.values(durationMapping);
  const noteValues = Object.values(noteMapping).filter(value => value < 12);
  const chords = Object.values(chordMapping);
  const allNotes: UnprocessedNote[] = [];
  let currentDuration = 0;

  const allowedDurations = durationValues.filter(duration => round(duration % (1 / timeSignature[1])) === 0);

  while (currentDuration < numMeasures * measureLength) {
    const duration = allowedDurations[Math.floor(Math.random() * allowedDurations.length)];
    if (round((currentDuration % measureLength) + duration) > measureLength) continue;

    const rootNote = noteValues[Math.floor(Math.random() * noteValues.length)];
    const chord = chords[Math.floor(Math.random() * chords.length)];
    const chordNotes = chord.map(interval =>
      Object.keys(noteMapping).find(key => noteMapping[key] === ((rootNote + interval) % 12))!
    );

    let durationStr = Object.keys(durationMapping).find(key => durationMapping[key] === duration)!;
    let isDotted = false;
    if (durationStr.includes("d")) { durationStr = durationStr.replace("d", ""); isDotted = true; }

    allNotes.push(new UnprocessedNote(chordNotes, 4, durationStr, isDotted));
    currentDuration = round(currentDuration + duration);
  }

  processNotes(harmonyVoice, allNotes, true);
}


/////////////////////////////////////////////////////////////////////////////////////
// Export
/////////////////////////////////////////////////////////////////////////////////////

function exportVoiceToMidi(voice: Part): void {
  const midi = new Midi();
  const track = midi.addTrack();
  const filename = `${voice.name}.mid`;
  let currentTime = 0;

  for (const note of voice.unprocessedNotes) {
    const noteDurationInSeconds = getNoteDurationInSeconds(voice, note);
    if (note.isRest) { currentTime += noteDurationInSeconds; continue; }
    for (const noteName of note.noteName) {
      track.addNote({ name: noteName + note.octave, time: currentTime, duration: noteDurationInSeconds });
    }
    currentTime += noteDurationInSeconds;
  }

  const blob = new Blob([midi.toArray()], { type: 'audio/midi' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportVoiceToMusicXML(voice: Part): void {
  const DIVS_PER_QUARTER = 32;
  const DIVS_PER_WHOLE = DIVS_PER_QUARTER * 4;

  let xml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1">
      <part-name>${voice.name || "Voice"}</part-name>
    </score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>${DIVS_PER_QUARTER}</divisions>
        <time>
          <beats>${timeSignature[0]}</beats>
          <beat-type>${timeSignature[1]}</beat-type>
        </time>
        <clef>
          <sign>G</sign>
          <line>2</line>
        </clef>
      </attributes>\n`;

  for (const note of voice.unprocessedNotes) {
    const durationDivs = Math.round(getNoteDuration(note) * DIVS_PER_WHOLE);
    xml += `<note>\n`;
    if (note.isRest) {
      xml += `  <rest/>\n`;
    } else {
      for (const noteName of note.noteName) {
        const step = noteName[0].toUpperCase();
        xml += `  <pitch>\n`;
        xml += `    <step>${step}</step>\n`;
        if (noteName.includes("b")) xml += `    <alter>-1</alter>\n`;
        if (noteName.includes("#")) xml += `    <alter>1</alter>\n`;
        xml += `    <octave>${note.octave}</octave>\n`;
        xml += `  </pitch>\n`;
      }
    }
    xml += `  <duration>${durationDivs}</duration>\n`;
    xml += `</note>\n`;
  }

  xml += `    </measure>\n  </part>\n</score-partwise>`;

  const blob = new Blob([xml], { type: "application/vnd.recordare.musicxml+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${voice.name || "voice"}.musicxml`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
