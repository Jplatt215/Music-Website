////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Voice Container Setup
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
const { Renderer, Stave, StaveNote, StaveTie, Dot, Voice, Accidental, Formatter, Tuplet } = Vex.Flow;

const containers = {};
let renderers = {};
let contexts = {};

const voices = ["upperVoice", "middleVoice", "lowerVoice", "voice4"];
const output = document.getElementById("output");
const template = document.getElementById("voiceTemplate");

// Clone template and append voices to output
const createVoiceContainers = (voiceNames, activeVoice = "upperVoice") => {
  voiceNames.forEach(name => {
    const clone = template.content.cloneNode(true);
    const settings = clone.querySelector(".voiceSettings");
    const container = clone.querySelector(".voiceContainer");

    settings.dataset.voice = name;
    container.dataset.name = name;
    container.id = `${name}Container`;
    if (name === activeVoice) container.classList.add("active");

    output.appendChild(clone);
    containers[name] = container;
  });
};

createVoiceContainers(["upperVoice", "middleVoice", "lowerVoice", "voice4",]);

containers["harmonyVoice"] = document.getElementById("harmonyVoiceContainer");

Object.entries(containers).forEach(([name, container]) => {
  renderers[name] = new Renderer(container, Renderer.Backends.SVG);
  contexts[name] = renderers[name].getContext();
});


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Variable definitions
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////


const voiceContainers = document.querySelectorAll('.voiceContainer');
/////   Generate  ////////////////////////
const generatePhraseButton = document.querySelector('.generatePhraseButton');
/////   Accompany  ////////////////////////
const separateVoiceButton = document.querySelector('.separateVoiceButton');
/////   Modify  ////////////////////////
const reverseButton = document.querySelector('.reverseButton');
const reflectButton = document.querySelector('.reflectButton');
const shiftButton = document.querySelector('.shiftButton');
const transposeButton = document.querySelector('.transposeButton');
const shuffleRhythmButton = document.querySelector('.shuffleRhythmButton');
const shuffleNotesButton = document.querySelector('.shuffleNotesButton');
const changeRhythmButton = document.querySelector('.changeRhythmButton');
const shufflePitchButton = document.querySelector('.shufflePitchButton');
const changePitchButton = document.querySelector('.changePitchButton');
/////   Develop  ////////////////////////
const simplifyButton = document.querySelector('.simplifyButton');
const complicateButton = document.querySelector('.complicateButton');
/////   Play  ////////////////////////
const bpmSlider = document.getElementById("bpmSlider");
const bpmValueDisplay = document.getElementById("bpmValue");
const playButton = document.querySelector('.playButton');
/////   Copy  ////////////////////////
const copyPartButton = document.querySelector('.copyPartButton');
const pastePartButton = document.querySelector('.pastePartButton');
/////   Select  ////////////////////////
const previousButton = document.querySelector('.previousButton');
const nextButton = document.querySelector('.nextButton');
/////   Settings  ////////////////////////
const topSelect = document.getElementById('timeSignatureTop');
const bottomSelect = document.getElementById('timeSignatureBottom');
const numMeasuresSelect = document.getElementById('numMeasuresSelect');
const modeSelect = document.getElementById("modeSelect");
const randomHarmonyButton = document.querySelector('.randomHarmonyButton');
const chordPlayButton = document.querySelector(".chordPlayButton");
/////////////////////////////
let timeSignature = [4,4];  //default time signature 4/4
let measureLength = timeSignature[0] * (1 / timeSignature[1]);
let numMeasures = 1;
let mode = "Standard";

class Part {
  constructor(name, pitchRange = ["E3", "E6"], rhythmRange = [0.03125, 1], scale = ["C", "Chromatic"]) {
    Object.assign(this, { name, pitchRange, rhythmRange, scale, unprocessedNotes: [], notes: [], ties: [], tuplets: [], toneNotes: [], memory: [], currentMemoryIndex: -1, muted: false, duration: 0, requiredWidth: 0});
  }
}

class UnprocessedNote {
  constructor(noteName, octave, duration, dotted = false) {
    this.noteName = Array.isArray(noteName) ? noteName : [noteName];
    this.octave = octave;
    this.duration = duration;
    this.dotted = dotted;
    this.isRest = this.noteName[0] === "Rest"; 
    this.tupletInfo = null;
  }

  toStaveNote() {
    return createNote(this.noteName, this.octave, this.dotted ? this.duration + "d" : this.duration);
  }

  setTuplet(id, totalTupletDuration, ratio, count, index) {
    this.tupletInfo = {
      id: id,
      totalTupletDuration: totalTupletDuration,
      ratio: ratio,
      count: count,
      index: index
    };
  }
}

const upperVoice = new Part("upperVoice", ["C4", "C6"]);
const middleVoice = new Part("middleVoice", ["A3", "F5"]);
const lowerVoice = new Part("lowerVoice", ["E2", "C4"]);
const voice4 = new Part("voice4", ["D3", "B5"]);
const harmonyVoice = new Part("harmonyVoice");
const voicesMap = { upperVoice, middleVoice, lowerVoice, voice4, harmonyVoice };

let clipboard = { unprocessedNotes: [], notes: [], ties: [], tuplets: [], toneNotes: [] };
let totalDuration = 0; 
let sampler = null;
let selectedVoices = [upperVoice];


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Mapping
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////


bpmSlider.addEventListener("input", () => {
  bpmValueDisplay.textContent = bpmSlider.value;
});

const pianoKeys = (() => {
  const noteNames = ["A", "Bb", "B", "C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab"];
  const keys = [];
  let octave = 0;

  for (let i = 0; i < 88; i++) {
    const note = noteNames[i % 12];
    if (note === "C" && i > 0) octave++;
    keys.push(note + octave);
  }

  return keys;
})();

const noteMapping = {
  "C": 0,
  "Db": 1,
  "D": 2,
  "Eb": 3,
  "E": 4,
  "F": 5,
  "Gb": 6,
  "G": 7,
  "Ab": 8,
  "A": 9,
  "Bb": 10,
  "B": 11,
  "Rest": 12
};

const durationMapping = {
  // Regular durations
  "w": 1,
  "h": 0.5,
  "q": 0.25,
  "8": 0.125,
  "16": 0.0625,
  "32": 0.03125,

  // Dotted durations 
  "wd": 1 + 0.5,
  "hd": 0.5 + 0.25,
  "qd": 0.25 + 0.125,
  "8d": 0.125 + 0.0625,
  "16d": 0.0625 + 0.03125,
};

const typeMapping = {
  // Regular durations
  1: "whole",
  0.5: "half",
  0.25: "quarter",
 0.125: "8th",
  0.0625: "16th",
  0.03125: "32nd",
};

function getDurationKeyFromValue(value) {
  for (const [key, val] of Object.entries(durationMapping)) {
    if (Math.abs(val - value) < 1e-9) return key;
  }
  return null;
}

const scalesMapping = {
    'Chromatic': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    'Major': [0, 2, 4, 5, 7, 9, 11],
    'Minor': [0, 2, 3, 5, 7, 8, 10],
    'Pentatonic Major' : [0, 2, 4, 7, 9],
    'Pentatonic Minor' : [0, 3, 5, 7, 10],
    'MOLT 1': [0, 2, 4, 6, 8, 10],           /*(Whole tone)*/
    'MOLT 2': [0, 1, 3, 4, 6, 7, 9, 10],    /*(Octatonic, Diminished, Whole-Half, Half-Whole)*/
    'MOLT 3': [0, 2, 3, 4, 6, 7, 8, 10,11],
    'MOLT 4': [0, 1, 2, 5, 6, 7, 8, 11], 
    'MOLT 5': [0, 1, 5, 6, 7, 11],
    'MOLT 6': [0, 2, 4, 5, 6, 8, 10, 11],
    'MOLT 7': [0, 1, 2, 3, 5, 6, 7, 8, 9, 11],
    'Overtone (Theoretical)': [0, 2, 4, 6, 7, 9, 10, 11],
    'Overtone (Audible)': [0, 2, 4, 7, 11]
};

const chordMapping = {
    'Major Triad': [0, 4, 7],
    'Minor Triad': [0, 3, 7],
    'Augmented Triad': [0, 4, 8],
    'Diminished Triad': [0, 3, 6],
    'Major 7': [0, 4, 7, 11],
    'Minor 7': [0, 3, 7, 10],
    'Dominant 7': [0, 4, 7, 10],
    'Diminished 7': [0, 3, 6, 9],
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

    const target = document.getElementById(btn.dataset.target);
    target.classList.remove('hidden');
  });
});

// Voice Settings //////////////////////////////////////////////////////////////////////

const allPitches = (() => {
  const order = ["A","Bb","B","C","Db","D","Eb","E","F","Gb","G","Ab"];
  const list = [];
  // A0, Bb0, B0
  ["A","Bb","B"].forEach(n => list.push(n + "0"));
  // C1..B7
  for (let oct = 1; oct <= 7; oct++) {
    ["C","Db","D","Eb","E","F","Gb","G","Ab","A","Bb","B"].forEach(n => list.push(n + oct));
  }
  // C8
  list.push("C8");
  return list;
})();
const pitchIndex = (p) => allPitches.indexOf(p);
const toPitchStr = (v) => Array.isArray(v) ? `${v[0]}${v[1]}` : v; // handle both ["E",3] and "E3"

function populateScaleSelect(select) {
  select.innerHTML = "";
  Object.keys(scalesMapping).forEach(name => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  });
}

function populateMinFor(maxPitch, minSelect, selectedMin) {
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
  if (selectedMin && pitchIndex(selectedMin) <= maxIdx) {
    minSelect.value = selectedMin;
  }
}

function populateMaxFor(minPitch, maxSelect, selectedMax) {
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
  if (selectedMax && pitchIndex(selectedMax) >= minIdx) {
    maxSelect.value = selectedMax;
  }
}

const rhythmOptions = [
  { id: 1,   symbol: "𝅝" },   
  { id: 0.5,   symbol: "𝅗𝅥" },   
  { id: 0.25,   symbol: "𝅘𝅥" },  
  { id: 0.125,   symbol: "𝅘𝅥𝅮" },  
  { id: 0.0625,  symbol: "𝅘𝅥𝅯" },  
  { id: 0.03125,  symbol: "𝅘𝅥𝅰" }  
];

function populateMinRhythm(maxId, selectEl, selectedId) {
  const maxIndex = rhythmOptions.findIndex(r => r.id === maxId);
  selectEl.innerHTML = "";
  rhythmOptions.forEach((opt, i) => {
    if (i >= maxIndex) {           
      const o = document.createElement("option");
      o.value = opt.id;
      o.textContent = opt.symbol;
      if (opt.id === selectedId) o.selected = true;
      selectEl.appendChild(o);
    }
  });
}

function populateMaxRhythm(minId, selectEl, selectedId) {
  const minIndex = rhythmOptions.findIndex(r => r.id === minId);
  selectEl.innerHTML = "";
  rhythmOptions.forEach((opt, i) => {
    if (i <= minIndex) {            
      const o = document.createElement("option");
      o.value = opt.id;
      o.textContent = opt.symbol;
      if (opt.id === selectedId) o.selected = true;
      selectEl.appendChild(o);
    }
  });
}

document.querySelectorAll(".voiceSettings").forEach(settings => {
  const voiceName = settings.dataset.voice;               
  const voice = voicesMap[voiceName];
  const rootSelects = settings.querySelectorAll('#rootSelect');
  const rootSelect = rootSelects[0];                   
  const scaleSelect = settings.querySelector('.scaleSelect');
  const minSelect   = settings.querySelector('.minPitch');
  const maxSelect   = settings.querySelector('.maxPitch');
  const minRhythm   = settings.querySelector('.minRhythm');  
  const maxRhythm   = settings.querySelector('.maxRhythm');
  const muteButton  = settings.querySelector('.muteButton');
  const midiButton  = settings.querySelector('.midiButton');
  const musicXMLButton  = settings.querySelector('.musicXMLButton');

  populateScaleSelect(scaleSelect);
  if (voice.scale && voice.scale[1]) {
    scaleSelect.value = voice.scale[1];
  } else {
    scaleSelect.value = "Chromatic";
    voice.scale = [ (voice.scale && voice.scale[0]) || "C", "Chromatic" ];
  }

  // --- Pitch Range ---
  const initialMin = toPitchStr(voice.pitchRange?.[0] || "E3");
  const initialMax = toPitchStr(voice.pitchRange?.[1] || "E6");

  populateMaxFor(initialMin, maxSelect, initialMax);
  populateMinFor(initialMax, minSelect, initialMin);

  minSelect.value = initialMin;
  maxSelect.value = initialMax;

    // --- Rhythm Range ---
  const initialMinRhythm = voice.rhythmRange?.[0] ?? 0.03125; // 32nd
  const initialMaxRhythm = voice.rhythmRange?.[1] ?? 1;       // whole

  populateMaxRhythm(initialMinRhythm, maxRhythm, initialMaxRhythm);
  populateMinRhythm(initialMaxRhythm, minRhythm, initialMinRhythm);

  minRhythm.value = initialMinRhythm;
  maxRhythm.value = initialMaxRhythm;
  if (rootSelect) {
    rootSelect.addEventListener('change', () => {
      voice.scale[0] = rootSelect.value;
    });
  }

  scaleSelect.addEventListener('change', () => {
    voice.scale[1] = scaleSelect.value;
  });

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

  midiButton.addEventListener("click", () => {
    exportVoiceToMidi(voice);
  });

  musicXMLButton.addEventListener("click", () => {
    exportVoiceToMusicXML(voice);
  });

});

////////////////////////////////////////////////////////////////////////////////////

const transposeDropdown = document.getElementById("transposeDropdown");

transposeButton.addEventListener("click", () => {
  const MAX_INTERVAL = 12;

  // Clear previous
  transposeDropdown.innerHTML = "";

  // Blank option first
  const blankOption = document.createElement("option");
  blankOption.value = "";
  blankOption.textContent = "";
  transposeDropdown.appendChild(blankOption);

  // Positive numbers
  for (let i = MAX_INTERVAL; i >= 1; i--) {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = `+${i}`;
    transposeDropdown.appendChild(opt);
  }

  // Negative numbers
  for (let i = 1; i <= MAX_INTERVAL; i++) {
    const opt = document.createElement("option");
    opt.value = -i;
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
  for (const part of selectedVoices){
    transposeVoice(part, interval);
  };
  updateMemory();
  transposeDropdown.style.display = "none";
});

transposeDropdown.addEventListener("blur", () => {
  transposeDropdown.style.display = "none";
});

const shiftSelect = document.querySelector("#shiftSelect");

shiftButton.addEventListener("click", (e) => {
    e.stopPropagation(); // Prevent click from triggering document listener
    shiftSelect.style.display = shiftSelect.style.display === "block" ? "none" : "block";
});

shiftSelect.addEventListener("click", (e) => {
    const selectedValue = shiftSelect.value; 
    for (const part of selectedVoices) {
        shiftVoice(part, selectedValue); 
    }
    updateMemory();
    shiftSelect.style.display = "none"; // hide after selection
});

document.addEventListener("click", (event) => {
    if (!shiftSelect.contains(event.target) && !shiftSelect.contains(event.target)) {
        shiftSelect.style.display = "none";
    }
});

const reflectSelect = document.querySelector("#reflectSelect");

reflectButton.addEventListener("click", (e) => {
    e.stopPropagation(); // Prevent click from triggering document listener
    reflectSelect.style.display = reflectSelect.style.display === "block" ? "none" : "block";
});

reflectSelect.addEventListener("click", (e) => {
    const selectedValue = reflectSelect.value; 
    for (const part of selectedVoices) {
        reflectVoice(part, selectedValue); 
    }
    updateMemory();
    reflectSelect.style.display = "none"; // hide after selection
});

document.addEventListener("click", (event) => {
    if (!reflectButton.contains(event.target) && !reflectSelect.contains(event.target)) {
        reflectSelect.style.display = "none";
    }
});

function bindVoiceAction(button, action, update = true) {
  if (!button) return;
  button.addEventListener("click", () => {
    for (const part of selectedVoices) action(part);
    if (update) updateMemory();
  });
}
voiceContainers.forEach(container => {
  if (container.dataset.name === "harmonyVoice") return;
  container.addEventListener("click", () => {
    const voiceName = container.dataset.name;
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

function setupPlayButton(button, parts) {
  if (!button) return;
  button.addEventListener("click", () => {
    button.disabled = true;
    button.classList.add("active");
    setupSampler().then(() => playAllParts(parts, button));
  });
}

setupPlayButton(playButton, [upperVoice, middleVoice, lowerVoice, voice4]);
setupPlayButton(chordPlayButton, [harmonyVoice]);

bindVoiceAction(generatePhraseButton, part => {
  resetPart(part);
  totalDuration = 0;
  generatePhrase(part, numMeasures * measureLength);
});

separateVoiceButton?.addEventListener("click", () => {
  separateVoice();
  updateMemory();
});
bindVoiceAction(reverseButton, reverseVoice);
bindVoiceAction(changeRhythmButton, changeRhythm);
bindVoiceAction(shuffleRhythmButton, shuffleRhythm);
bindVoiceAction(shuffleNotesButton, shuffleNotes);
bindVoiceAction(shufflePitchButton, shufflePitch);
bindVoiceAction(changePitchButton, changePitch);
bindVoiceAction(complicateButton, complicateVoice);
bindVoiceAction(simplifyButton, simplifyVoice);

copyPartButton?.addEventListener("click", () => {
  copyPart();
});

pastePartButton?.addEventListener("click", () => {
  pastePart();
  updateMemory();
});

previousButton?.addEventListener("click", () => accessMemory(-1));
nextButton?.addEventListener("click", () => accessMemory(1));

randomHarmonyButton?.addEventListener("click", generateHarmony);


/////////////////////////////////////////////////////////////////////////////////////

/////////////////////////////////////////////////////////////////////////////////////

// Main Functions

/////////////////////////////////////////////////////////////////////////////////////

/////////////////////////////////////////////////////////////////////////////////////


//  Get functions /////////////////////////

function getNoteDuration(note) {
  let dur = note.duration;
  if (note.dotted){
    dur = dur + "d";
  }
  return durationMapping[dur];
}

function getDurationString(note) {
  const frac = getNoteDuration(note);

  // Find matching entry in durationMapping
  for (const [durStr, value] of Object.entries(durationMapping)) {
    if (Math.abs(value - frac) < 1e-6) {
      return durStr;
    }
  }

  return null; 
}

function getAllowedPitches(voice, noteDuration) {
  const minPitch = voice.pitchRange[0];
  const maxPitch = voice.pitchRange[1];

  const minIdx = pitchIndex(minPitch);
  const maxIdx = pitchIndex(maxPitch);

  const allowedPitches = allPitches.slice(minIdx, maxIdx + 1);

  const rootNote = voice.scale?.[0];
  const scaleName = voice.scale?.[1];
  const rootIndex = noteMapping[rootNote];
  const scale = scalesMapping[scaleName];

  // Filter allowed pitches by scale
  const scalePitches = allowedPitches.filter(pitch => {
    const note = pitch.slice(0, -1); // remove octave
    const pitchClass = noteMapping[note];
    return pitchClass !== undefined &&
      scale.includes((pitchClass - rootIndex + 12) % 12);
  });

  if (mode === "Harmony"){
    let durationSearched = 0;
    let currentChord = null;
    for (let i = 0; i < harmonyVoice.unprocessedNotes.length; ++i){
      currentChord = harmonyVoice.unprocessedNotes[i];
      durationSearched += currentChord.duration;
      if (durationSearched <= totalDuration && i + 1 < harmonyVoice.unprocessedNotes.length){
        continue;
      }
      let currentChordEnd = durationSearched;
      let currentOverlap = currentChordEnd - totalDuration;
      let nextOverlap = noteDuration - currentOverlap;
      if (nextOverlap > currentOverlap && i + 1 < harmonyVoice.unprocessedNotes.length){
        currentChord = harmonyVoice.unprocessedNotes[i+1]
      }
      const chordNotes = currentChord.noteName;

      // Keep only pitches that match the chord notes
      const harmonyPitches = scalePitches.filter(pitch => {
        const note = pitch.slice(0, -1); // drop octave
        return chordNotes.includes(note);
      });

      return harmonyPitches;
    }
  }
  return scalePitches;
}

function getNoteDurationInSeconds(voice, note) {
  const bpm = parseFloat(bpmSlider.value) || 120;
  const quarterNoteSeconds = 60 / bpm;
  let durationInWholeNotes = getNoteDuration(note);

  // Adjust duration if this note belongs to a tuplet
  if (note.tupletInfo) {
    const { ratio } = note.tupletInfo;
    durationInWholeNotes = durationInWholeNotes * ratio[1] / ratio[0];
  }

  // Multiply by 4 to convert from whole notes to quarter notes
  return durationInWholeNotes * 4 * quarterNoteSeconds;
}

function checkNoteInScale(note, voice) {
  if (note.isRest) return true;

  const scaleRoot = voice.scale[0];
  const scaleIntervals = scalesMapping[voice.scale[1]];

  const scaleNotes = scaleIntervals.map(interval => {
    const semitone = (noteMapping[scaleRoot] + interval) % 12;
    return Object.keys(noteMapping).find(key => noteMapping[key] === semitone);
  });

  return scaleNotes.includes(note.noteName[0]);
}

function randomPitchFromScale(voice, noteDuration, allowRest = true) {

  let scalePitches = getAllowedPitches(voice, noteDuration);

  if (allowRest && (!scalePitches.length || Math.random() < .2)) {
    return ["Rest", 4];
  }

  const pick = scalePitches[Math.floor(Math.random() * scalePitches.length)];

  const noteName = pick.slice(0, -1);
  const octave = parseInt(pick.slice(-1), 10);

  return [noteName, octave];
}

function findTuplet(note, part) {
  for (const tupletObj  of part.tuplets) {
    if (tupletObj.tupletNotes.includes(note)) {
      return tupletObj;  
    }
  }
  return null;  
}

 //  Core Functions /////////////////////////

function createNote(noteNames, noteOctave, noteDuration) {
  let noteInfo = [];
  let durationInfo = noteDuration;
  let accidentalIndices = []

  if (noteNames[0] === "Rest") {
    noteInfo.push("B/4"); 
    durationInfo = noteDuration + "r"; 
  } 
  
  else {
    for (let i = 0; i < noteNames.length; i++){
      if (noteNames[i].includes("b")) {
        accidentalIndices.push(i);
      }
      noteInfo.push(`${noteNames[i]}/${noteOctave}`);
    }
  }

  let note = new StaveNote({
    keys: noteInfo,
    duration: durationInfo
  });

  for (let accidentalIndex of accidentalIndices){
    note.addModifier(new Vex.Flow.Accidental("b"), accidentalIndex);

  }

  if (noteDuration.includes("d")) {
     noteDuration = noteDuration.replace("d", "");
     note.dotted = true;
     Dot.buildAndAttach([note], { all: true });
    }

  return note;
}

function fillDuration(fillNoteDuration, note) {
  let noteName = null;
  let noteOctave = null;
  let octaveStr = null;

  if ((note == "rest") || note.isRest()){
    noteName = "Rest";
    noteOctave = "4";
  }
  else {
    let key = note.getKeys()[0]; 
    [noteName, octaveStr] = key.split("/");
    noteOctave = parseInt(octaveStr);
  }

  let fillNotes = [];
  const durations = Object.entries(durationMapping).sort((a, b) => b[1] - a[1]); 

  while (fillNoteDuration > 0) {
    for (let [durStr, durValue] of durations) {
      if (durValue <= fillNoteDuration) {
        fillNoteDuration -= durValue;
        let newNote = createNote([noteName], noteOctave, durStr);
        fillNotes.push(newNote);
        break; 
      }
    }
  }
  return fillNotes;
}

function round(val) {
  return Math.round(val * 1e9) / 1e9;
}
function processNotes(part, unprocessedNotes, drawHarmony = false) {
  let tupletNotes = [];
  let measureNotes = [];
  let posInMeasure = 0;  // tracks position within current measure, resets to 0 on flush

  for (let unprocessedNote of unprocessedNotes) {
    part.unprocessedNotes.push(unprocessedNote);
    let note = unprocessedNote.toStaveNote();

    if (unprocessedNote.tupletInfo) {
      const { totalTupletDuration, ratio, count, index } = unprocessedNote.tupletInfo;

      tupletNotes.push(note);
      measureNotes.push(note);
      part.toneNotes.push([staveNoteToToneJSNote(note), getNoteDuration(note) * ratio[1] / ratio[0]]);

      if (index === count) {
        const vfTuplet = new Tuplet(tupletNotes, {
          num_notes: ratio[0],
          notes_occupied: ratio[1],
          ratioed: true
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
      const noteDur = getNoteDuration(note);

      if (round(posInMeasure + noteDur) > measureLength) {
        const fillDur    = round(measureLength - posInMeasure);
        let overflowDur  = round(noteDur - fillDur);
        const notesToTie = [];

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

  if (measureNotes.length > 0) {
    part.notes.push([...measureNotes]);
  }

  drawAllVoices(drawHarmony);
}

function resetPart(part){
  part.unprocessedNotes = [];
  part.notes = [];
  part.ties = [];
  part.tuplets = [];  
  part.toneNotes = [];
  part.duration = 0;
}

//  Memory /////////////////////////
function updateMemory() {
  for (const voice of selectedVoices) {
    voice.memory.splice(voice.currentMemoryIndex + 1);
    const snapshot = voice.unprocessedNotes.map(note => {
      const copy = new UnprocessedNote([...note.noteName], note.octave, note.duration, note.dotted);
      if (note.tupletInfo) copy.tupletInfo = { ...note.tupletInfo };
      return copy;
    });
    voice.memory.push(snapshot);
    voice.currentMemoryIndex = voice.memory.length - 1;
  }
}

function accessMemory(indexDifference) {
  for (const voice of selectedVoices) {
    const newIdx = voice.currentMemoryIndex + indexDifference;
    if (newIdx < 0 || newIdx >= voice.memory.length) continue;
    voice.currentMemoryIndex = newIdx;
    const snapshot = voice.memory[newIdx];
    resetPart(voice);
    processNotes(voice, snapshot);
  }
}

function copyPart() {
  clipboard = {};
  for (const voice of selectedVoices) {
    clipboard[voice.name] = voice.unprocessedNotes.map(note => {
      const copy = new UnprocessedNote([...note.noteName], note.octave, note.duration, note.dotted);
      if (note.tupletInfo) copy.tupletInfo = { ...note.tupletInfo };
      return copy;
    });
  }
}

function pastePart() {
  const copiedVoiceNames = Object.keys(clipboard);
  if (!copiedVoiceNames.length) return;

  selectedVoices.forEach((voice, i) => {
    // Loop through copied voices if there are fewer copied than selected
    const sourceVoiceName = copiedVoiceNames[i % copiedVoiceNames.length];
    const sourceNotes = clipboard[sourceVoiceName];

    const notes = sourceNotes.map(note => {
      const copy = new UnprocessedNote([...note.noteName], note.octave, note.duration, note.dotted);
      if (note.tupletInfo) copy.tupletInfo = { ...note.tupletInfo };
      return copy;
    });

    resetPart(voice);
    processNotes(voice, notes);
  });
}

//  Draw /////////////////////////

function ensureSvgSize(partName, requiredWidth) {
  const container = containers[partName];
  const height = container.clientHeight || 300;

  // Resize VexFlow renderer
  renderers[partName].resize(requiredWidth, height);

  // The DOM <svg> element inserted by VexFlow:
  const svg = container.querySelector('svg');
  if (svg) {
    svg.setAttribute('width', requiredWidth);
    svg.setAttribute('height', height);
    svg.setAttribute('viewBox', `0 0 ${requiredWidth} ${height}`);
    svg.style.width = `${requiredWidth}px`;
    svg.style.height = `${height}px`;
    svg.style.overflow = 'visible';
  }

  contexts[partName] = renderers[partName].getContext();
}

function getGlobalMeasureWidths(parts) {
  const globalWidths = [];
  parts.forEach(part => {
    if (!part.notes.length) return;
    part.notes.forEach((measureNotes, i) => {
      const width = 200 + measureNotes.length * 40;
      globalWidths[i] = Math.max(globalWidths[i] || 0, width);
    });
  });
  return globalWidths;
}

function getTupletsForMeasure(part, measureIndex) {
  const measureNoteSet = new Set(part.notes[measureIndex]);
  return part.tuplets
    .filter(tuplet => tuplet.tupletNotes.some(note => measureNoteSet.has(note)))
    .map(tuplet => tuplet.vfTuplet);
}

function drawAllVoices(includeHarmony = false) {
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
    const staves = {};
    const voiceObjs = [];

    parts.forEach(part => {
      const stave = new Stave(staffLength, 60, staveWidth);
      if (measureIndex === 0) {
        stave.addClef("treble").addTimeSignature(`${timeSignature[0]}/${timeSignature[1]}`);
      }
      stave.setContext(contexts[part.name]).draw();
      staves[part.name] = stave;

      const notes = part.notes[measureIndex] || [];
      const voice = new Voice({
        num_beats: timeSignature[0],
        beat_value: timeSignature[1],
      }).setStrict(false);
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

function drawTies(tieGroups, context) {
  for (let notesToTie of tieGroups) {
    for (let i = 0; i < notesToTie.length - 1; ++i) {
      let tie = new StaveTie({
        first_note: notesToTie[i],
        last_note: notesToTie[i + 1],
        first_indices: [0],
        last_indices: [0],
      });
      tie.setContext(context).draw();
    }
  }
}

function eraseDrawing(part) {
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


// Generate    /////////////////////////
          
function generatePhrase(part, duration, allowTuplets = true){
  let totalDurationOriginal = totalDuration;
  let notes = [];
  let currentDuration = 0;
  let tupletNotes = [];
  const durationKeys = Object.keys(durationMapping);
  const allowedDurations = [];
  let tupletId = 0;

  //only use rhythms within rhythm-range of voice
  for (let durationKey of durationKeys){
    if (durationMapping[durationKey] >= part.rhythmRange[0] && durationMapping[durationKey] <= part.rhythmRange[1]){
      allowedDurations.push(durationKey);
    }
  }

  while (currentDuration < duration) {
    //reset phrase if unable to finish
    if (duration - currentDuration < part.rhythmRange[0]){
      currentDuration = 0;
      notes = [];
      tupletNotes = [];
      totalDuration = totalDurationOriginal;
    }

    //random duration
    let durationStr = allowedDurations[Math.floor(Math.random() * allowedDurations.length)];

    //skip if duration overflows
    if (currentDuration + durationMapping[durationStr] > duration) {
      continue; 
    }

    //tuplet creation
    if (allowTuplets && !durationStr.includes("d") && durationMapping[durationStr] < 1 && Math.random() < 0.5 
    && durationMapping[durationStr] >= 1 / timeSignature[1]) {
      let notesOccupied = 2;
      let possibleTupletSizes = [3, 5, 7];

      let numTupletNotes = possibleTupletSizes[Math.floor(Math.random() * possibleTupletSizes.length)];

      let realDuration = 2 * durationMapping[durationStr];

      const measureRemaining = measureLength - (currentDuration % measureLength);

      if (realDuration > measureRemaining) {
        continue;
      }

      ++tupletId;

      for (let i = 1; i <= numTupletNotes; i++) {
        let [noteName, noteOctave] = randomPitchFromScale(part, durationMapping[durationStr]);

        let tupletNote = new UnprocessedNote(noteName, noteOctave, durationStr);

        tupletNote.setTuplet(
          tupletId,
          realDuration,
          [numTupletNotes, notesOccupied],
          numTupletNotes,
          i
        );

        notes.push(tupletNote);

        totalDuration += durationMapping[durationStr] * 2 / numTupletNotes;
      }

      currentDuration += realDuration;
      currentDuration = Math.round(currentDuration * 1e9) / 1e9;
    }
    
    else{
      let [noteName, noteOctave] = randomPitchFromScale(part, durationMapping[durationStr]);
      notes.push(new UnprocessedNote(noteName, noteOctave, durationStr));
      currentDuration += durationMapping[durationStr];
      currentDuration = Math.round(currentDuration * 1e9) / 1e9;
      totalDuration += durationMapping[durationStr];
      totalDuration = Math.round(currentDuration * 1e9) / 1e9;
    }
  }
  processNotes(part, notes);
}

//  Accompany   /////////////////////////

function separateVoice() {
  const voiceToSeparate = selectedVoices[0];
  if (!voiceToSeparate || !voiceToSeparate.unprocessedNotes.length) return;

  // Each voice gets its own bucket of new notes
  const newNotesPerVoice = {};
  for (const voiceName of voices) {
    newNotesPerVoice[voiceName] = [];
  }

  totalDuration = 0;

  for (const note of voiceToSeparate.unprocessedNotes) {
    // Find which selected voices can play this pitch in their range
    const candidateVoices = [];
    for (const voiceName of voices) {
      const voice = selectedVoices.find(selected => selected.name === voiceName);
      if (!voice) continue;

      if (note.isRest) {
        candidateVoices.push(voiceName);
        continue;
      }

      const allowedPitches = getAllowedPitches(voicesMap[voiceName], durationMapping[note.duration]);
      const pitchIsInRange = allowedPitches.includes(note.noteName[0] + note.octave);
      if (pitchIsInRange) candidateVoices.push(voiceName);
    }

    // Pick a random candidate, or fall back to the original voice
    const hasCandidate = candidateVoices.length > 0;
    const targetVoiceName = hasCandidate
      ? candidateVoices[Math.floor(Math.random() * candidateVoices.length)]
      : voiceToSeparate.name;

    // Distribute the note — target voice gets the pitch, all others get a rest
    for (const voiceName of voices) {
      const isTargetVoice = voiceName === targetVoiceName;
      let newNote;

      if (isTargetVoice && !note.isRest) {
        newNote = new UnprocessedNote(note.noteName, note.octave, note.duration, note.dotted);
      } else {
        newNote = new UnprocessedNote(["Rest"], 4, note.duration, note.dotted);
      }

      if (note.tupletInfo) newNote.tupletInfo = { ...note.tupletInfo };
      newNotesPerVoice[voiceName].push(newNote);
    }

    totalDuration += durationMapping[note.duration] || 0;
  }

  // Rebuild each selected voice with its new notes
  for (const voiceName of voices) {
    const voice = selectedVoices.find(selected => selected.name === voiceName);
    if (!voice) continue;
    resetPart(voice);
    processNotes(voice, newNotesPerVoice[voiceName]);
  }
}

//  Modify   /////////////////////////
function reverseVoice(voice) {
  let reversedNotes = [...voice.unprocessedNotes].reverse();

  for (let note of reversedNotes) {
    if (note.tupletInfo){
      let { id, totalTupletDuration, ratio, count, index } = note.tupletInfo;
      index = count - index + 1;
      note.tupletInfo = {id, totalTupletDuration, ratio, count, index };
    }
  }

  resetPart(voice);
  processNotes(voice, reversedNotes);
}

function reflectVoice(voice, axisPitch) {
  const axisOctave = 4;
  let scale = scalesMapping[voice.scale[1]];

  const axisDistanceFromRoot = Math.abs(noteMapping[voice.scale[0]] - noteMapping[axisPitch]);
  const axisScalarIndex = scale.indexOf(axisDistanceFromRoot);

  const reflectedNotes = [];

  for (const note of voice.unprocessedNotes) {
    let reflectedNote;

    if (note.isRest) {
      reflectedNote = new UnprocessedNote(note.noteName, note.octave, getDurationString(note));
    } else {
      const noteNameStr = note.noteName[0];
      let workScale = scale;

      const noteIsInScale = checkNoteInScale(note, voice);
      if (!noteIsInScale) {
        workScale = scalesMapping["Chromatic"];
      }

      const noteDistanceFromRoot = Math.abs(noteMapping[voice.scale[0]] - noteMapping[noteNameStr]);
      const noteScalarIndex = workScale.indexOf(noteDistanceFromRoot);

      let reflectedScalarIndex;

      if (axisScalarIndex === -1 && noteIsInScale) {
        // Axis pitch is not in the scale — find nearest scale degree above it
        let searchInterval = axisDistanceFromRoot;
        while (workScale.indexOf(searchInterval % 12) === -1) {
          searchInterval++;
        }
        const nearestScaleDegree = workScale.indexOf(searchInterval % 12);
        const distanceFromNearest = Math.abs((noteScalarIndex - nearestScaleDegree + workScale.length) % workScale.length);
        reflectedScalarIndex = (nearestScaleDegree - distanceFromNearest - 1 + workScale.length) % workScale.length;
      } else {
        reflectedScalarIndex = ((axisScalarIndex - noteScalarIndex) + axisScalarIndex + workScale.length) % workScale.length;
      }

      const reflectedPitchIndex = (noteMapping[voice.scale[0]] + workScale[reflectedScalarIndex]) % 12;
      const reflectedPitch = Object.keys(noteMapping).find(key => noteMapping[key] === reflectedPitchIndex);

      // Calculate reflected octave using absolute pitch positions
      const noteAbs      = note.octave * 12 + noteDistanceFromRoot;
      const axisAbs      = axisOctave  * 12 + axisDistanceFromRoot;
      let   reflectedAbs = 2 * axisAbs - noteAbs;
      let   newOctave    = Math.floor(reflectedAbs / 12);

      // Clamp to voice pitch range
      const noteIdx = pitchIndex(reflectedPitch + newOctave);
      const minIdx  = pitchIndex(voice.pitchRange[0]);
      const maxIdx  = pitchIndex(voice.pitchRange[1]);
      if (noteIdx < minIdx) {
        newOctave += Math.ceil((minIdx - noteIdx) / 12);
      } else if (noteIdx > maxIdx) {
        newOctave -= Math.ceil((noteIdx - maxIdx) / 12);
      }

      reflectedNote = new UnprocessedNote([reflectedPitch], newOctave, getDurationString(note));
    }

    if (note.tupletInfo) reflectedNote.tupletInfo = { ...note.tupletInfo };
    reflectedNotes.push(reflectedNote);
  }

  resetPart(voice);
  processNotes(voice, reflectedNotes);
}

function shiftVoice(voice, distance) {
  const shiftDur = durationMapping[distance];

  // Check tuplets won't cross barlines after shift
  let currentPos = shiftDur;
  for (const note of voice.unprocessedNotes) {
    if (note.tupletInfo) {
      const { index, count, totalTupletDuration } = note.tupletInfo;

      if (index === 1) {
        const measureEnd = (Math.floor(currentPos / measureLength) + 1) * measureLength;
        const tupletWouldCrossBarline = currentPos + totalTupletDuration > measureEnd;
        if (tupletWouldCrossBarline) {
          console.warn("Shift rejected: tuplet would cross measure boundary");
          return;
        }
      }

      const isLastInTuplet = index === count;
      if (isLastInTuplet) currentPos += totalTupletDuration;

    } else {
      currentPos += getNoteDuration(note);
    }
  }

  // Prepend a rest of the shift duration
  const shiftedNotes = [new UnprocessedNote(["Rest"], 4, distance), ...voice.unprocessedNotes];

  // Calculate total duration of shifted notes
  let totalDur = 0;
  for (const note of shiftedNotes) {
    if (note.tupletInfo) {
      const isLastInTuplet = note.tupletInfo.index === note.tupletInfo.count;
      if (isLastInTuplet) totalDur += note.tupletInfo.totalTupletDuration;
    } else {
      totalDur += getNoteDuration(note);
    }
  }
  totalDur = round(totalDur);

  // Fill any remaining space in the last measure with rests
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

function transposeVoice(voice, scaleDegreeDifference) {
  const transposedNotes = [];

  const rootNote = voice.scale?.[0];
  const scaleName = voice.scale?.[1];
  const rootIndex = noteMapping[rootNote];
  const scale = scalesMapping[scaleName];

  const direction = scaleDegreeDifference < 0 ? "down" : "up";

  for (let note of voice.unprocessedNotes) {
    let transposedNote;

    if (note.isRest) {
      transposedNote = new UnprocessedNote("Rest", note.octave, getDurationString(note));
    } 
    else {
      const noteOctave = note.octave;
      const noteIndex = noteMapping[note.noteName[0]];

      const originalInterval = (noteIndex + 12 - rootIndex) % 12;
      const originalScaleDegree = scale.indexOf(originalInterval);

      const newScaleDegree =
        (originalScaleDegree + scaleDegreeDifference + scale.length) % scale.length;

      const newInterval = scale[newScaleDegree];
      const transposedIndex = (rootIndex + newInterval) % 12;

      const transposedPitch = Object.keys(noteMapping)
        .find(key => noteMapping[key] === transposedIndex);

      const originalAbs = noteIndex + 12 * noteOctave;
      let newOctave = noteOctave;
      let transposedAbs = noteMapping[transposedPitch] + 12 * newOctave;

      if (originalAbs <= transposedAbs && direction === "down") {
        newOctave -= 1;
      }
      else if (originalAbs >= transposedAbs && direction === "up") {
        newOctave += 1;
      }

      let newIdx = pitchIndex(transposedPitch + newOctave);
      const minIdx = pitchIndex(voice.pitchRange[0]);
      const maxIdx = pitchIndex(voice.pitchRange[1]);

      if (newIdx < minIdx) {
        newOctave += Math.ceil((minIdx - newIdx) / 12);
      } 
      else if (newIdx > maxIdx) {
        newOctave -= Math.ceil((newIdx - maxIdx) / 12);
      }

      transposedNote = new UnprocessedNote(
        transposedPitch,
        newOctave,
        getDurationString(note)
      );
    }

    if (note.tupletInfo) transposedNote.tupletInfo = { ...note.tupletInfo };

    transposedNotes.push(transposedNote);
  }

  resetPart(voice);
  processNotes(voice, transposedNotes);
}

function shuffleRhythm(voice) {
  const pitches = [];
  for (const note of voice.unprocessedNotes) {
    pitches.push({ noteName: note.noteName, octave: note.octave, isRest: note.isRest });
  }

  // Collect rhythm groups — tuplets stay together as a single unit
  const rhythmGroups = [];
  const seenTupletIds = new Set();

  for (const note of voice.unprocessedNotes) {
    if (note.tupletInfo) {
      const tupletId = note.tupletInfo.id;
      if (!seenTupletIds.has(tupletId)) {
        seenTupletIds.add(tupletId);
        const tupletNotes = [];
        for (const candidate of voice.unprocessedNotes) {
          if (candidate.tupletInfo?.id === tupletId) {
            tupletNotes.push(candidate);
          }
        }
        rhythmGroups.push({ type: 'tuplet', notes: tupletNotes });
      }
    } else {
      rhythmGroups.push({ type: 'note', note });
    }
  }

  // Shuffle rhythm groups
  for (let i = rhythmGroups.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rhythmGroups[i], rhythmGroups[j]] = [rhythmGroups[j], rhythmGroups[i]];
  }

  // Assign pitches in original order to the shuffled rhythms
  const newNotes = [];
  let pitchIdx = 0;
  let newTupletId = 0;

  for (const group of rhythmGroups) {
    if (group.type === 'note') {
      const pitch = pitches[pitchIdx++];
      newNotes.push(new UnprocessedNote(pitch.noteName, pitch.octave, getDurationString(group.note)));

    } else {
      ++newTupletId;
      const firstNoteInfo = group.notes[0].tupletInfo;

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

function shuffleNotes(voice) {
  const groups = [];
  const seenIds = new Set();

  for (const note of voice.unprocessedNotes) {
    if (note.tupletInfo) {
      const { id } = note.tupletInfo;
      if (!seenIds.has(id)) {
        seenIds.add(id);
        const tupletNotes = [];
        for (const candidate of voice.unprocessedNotes) {
          if (candidate.tupletInfo?.id === id) {
            tupletNotes.push(candidate);
          }
        }
        groups.push({ type: 'tuplet', notes: tupletNotes });
      }
    } else {
      groups.push({ type: 'note', note });
    }
  }

  // Shuffle groups
  for (let i = groups.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [groups[i], groups[j]] = [groups[j], groups[i]];
  }

  const newNotes = [];
  let tupletId = 0;

  for (const group of groups) {
    if (group.type === 'note') {
      newNotes.push(group.note);
    } else {
      ++tupletId;
      const firstNoteInfo = group.notes[0].tupletInfo;

      // Shuffle notes within the tuplet
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

function shufflePitch(voice) {
  // Extract pitches from non-rest notes, keeping rests in place
  const pitches = [];
  for (const note of voice.unprocessedNotes) {
    if (!note.isRest) {
      pitches.push({ noteName: note.noteName, octave: note.octave });
    }
  }

  for (let i = pitches.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pitches[i], pitches[j]] = [pitches[j], pitches[i]];
  }

  // Assign shuffled pitches back to notes, keeping rhythm and tuplet info intact
  const newNotes = [];
  let pitchIdx = 0;

  for (const note of voice.unprocessedNotes) {
    let newNote;

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

function changeRhythm(voice) {
  const originalNotes = [...voice.unprocessedNotes];
  if (!originalNotes.length) return;

  const durationKeys = Object.keys(durationMapping);

  // Calculate the total duration to fill
  let targetDuration = 0;
  for (const note of originalNotes) {
    if (note.tupletInfo) {
      const isLastInTuplet = note.tupletInfo.index === note.tupletInfo.count;
      if (isLastInTuplet) targetDuration += note.tupletInfo.totalTupletDuration;
    } else {
      targetDuration += getNoteDuration(note);
    }
  }
  targetDuration = round(targetDuration);

  let newNotes = [];
  let success = false;

  // Keep retrying until a valid rhythm that fits within measure boundaries is found
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
        const shorterThanRemaining = val < remaining - 1e-9;
        const leavesRoomForRemainingNotes = leftover >= minReserve - 1e-9;
        const fitsBeforeBarline = round(val) <= round(spaceInMeasure);
        return shorterThanRemaining && leavesRoomForRemainingNotes && fitsBeforeBarline;
      });

      if (fittingDurations.length === 0) {
        // No valid duration exists for this position — restart entirely
        success = false;
        break;
      }

      const randomDur = fittingDurations[Math.floor(Math.random() * fittingDurations.length)];
      newNotes.push(new UnprocessedNote(note.noteName, note.octave, randomDur));
      currentDuration = round(currentDuration + durationMapping[randomDur]);
    }

    if (!success) continue;

    // Last note fills exactly whatever duration remains
    const lastNote = originalNotes[originalNotes.length - 1];
    const lastRemaining = round(targetDuration - currentDuration);
    const posInMeasure = round(currentDuration % measureLength);
    const spaceInMeasure = round(measureLength - posInMeasure);

    // Last note must also fit before the barline
    const lastDurStr = getDurationKeyFromValue(lastRemaining);
    if (!lastDurStr || round(lastRemaining) > round(spaceInMeasure)) {
      success = false;
      continue;
    }

    newNotes.push(new UnprocessedNote(lastNote.noteName, lastNote.octave, lastDurStr));
  }

  resetPart(voice);
  processNotes(voice, newNotes);
}

function changePitch(voice) {
  totalDuration = 0;

  const newNotes = voice.unprocessedNotes.map(note => {
    let newNote;
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

//  Develop   /////////////////////////

function simplifyVoice(voice) {
  const currentNotes = [...voice.unprocessedNotes];
  const simplifiedNotes = [];
  let i = 0;

  while (i < currentNotes.length) {
    const note = currentNotes[i];

    if (note.tupletInfo) {
      // Collect all notes belonging to this tuplet
      const id = note.tupletInfo.id;
      const tupletNotes = [];
      while (i < currentNotes.length && currentNotes[i].tupletInfo?.id === id) {
        tupletNotes.push(currentNotes[i]);
        i++;
      }

      const { totalTupletDuration, ratio } = tupletNotes[0].tupletInfo;
      const [count, notesOccupied] = ratio;

      // Reduce tuplet size randomly
      let kept = [...tupletNotes];
      const target = Math.max(3, 2 + Math.floor(Math.random() * (kept.length - 2)));
      while (kept.length > target) {
        kept.splice(Math.floor(Math.random() * kept.length), 1);
      }

      if (kept.length % 2 === 1) {
        // Keep as tuplet with new count
        for (let idx = 0; idx < kept.length; idx++) {
          const keptNote = kept[idx];
          const newNote = new UnprocessedNote(keptNote.noteName, keptNote.octave, keptNote.duration, keptNote.dotted);
          newNote.setTuplet(id, totalTupletDuration, [kept.length, notesOccupied], kept.length, idx + 1);
          simplifiedNotes.push(newNote);
        }
      } else {
        // Dissolve into regular notes
        const perNote = totalTupletDuration / kept.length;
        const durStr = getDurationKeyFromValue(perNote) ?? "q";
        for (const keptNote of kept) {
          simplifiedNotes.push(new UnprocessedNote(keptNote.noteName, keptNote.octave, durStr));
        }
      }

    } else {
      // Try combining with subsequent non-tuplet notes
      const noteName = note.noteName;
      const noteOctave = note.octave;
      let combinedDuration = round(getNoteDuration(note));
      let j = i + 1;
      let merged = false;

      while (j < currentNotes.length) {
        if (currentNotes[j].tupletInfo) break;

        combinedDuration = round(combinedDuration + getNoteDuration(currentNotes[j]));

        if (round(combinedDuration) !== round(measureLength) && getDurationKeyFromValue(combinedDuration) && Math.random() < 0.5) {
          simplifiedNotes.push(new UnprocessedNote(noteName, noteOctave, getDurationKeyFromValue(combinedDuration)));
          i = j + 1;
          merged = true;
          break;
        }
        j++;
      }

      if (!merged) {
        simplifiedNotes.push(note);
        i++;
      }
    }
  }

  resetPart(voice);
  processNotes(voice, simplifiedNotes);
}

function complicateVoice(voice) {
  const originalNotes = [...voice.unprocessedNotes];
  const newNotes = [];
  const seenIds = new Set();

  for (const note of originalNotes) {
    if (note.tupletInfo) {
      const { id, totalTupletDuration } = note.tupletInfo;
      if (seenIds.has(id)) continue;
      seenIds.add(id);

      // Generate sub-phrase for the tuplet's real duration
      const savedNotes = [...voice.unprocessedNotes];
      const savedTuplets = [...voice.tuplets];
      resetPart(voice);
      generatePhrase(voice, totalTupletDuration, false);
      const subNotes = [...voice.unprocessedNotes];

      // Restore voice — complicateVoice will resetPart at the end
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

// Audio /////////////////////////

async function playAllParts(parts, button) {
  await Tone.start();
  const now = Tone.now();
  let longestDuration = 0;
  const bpm = parseFloat(bpmSlider.value) || 120;
  const secondsPerBeat = 60 / bpm;

  parts.forEach(part => {
    if (part.muted) return;
    let currentTime = now;

    part.toneNotes.forEach(([pitch, duration], index) => {
      if (pitch == null) {
        // Rest — advance
        currentTime += duration * secondsPerBeat * 4;
        return;
      }

      for (let i = 0; i < pitch.length; i++) {
      sampler.triggerAttackRelease(
        pitch[i],
        duration * secondsPerBeat * 4,
        currentTime
      );
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

function staveNoteToToneJSNote(staveNote) {
  if (staveNote.isRest()) return null;
  return staveNote.getKeys().map(k => k.replace("/", "")); 
}

async function setupSampler() {
  if (sampler) return;

  const sampleMap = {};
  pianoKeys.forEach(key => {
    sampleMap[key] = `${key}.mp3`;
  });

  await new Promise(resolve => {
    sampler = new Tone.Sampler({
      urls: sampleMap,
      baseUrl: "/static/notes/",
      onload: () => {
        resolve(); 
      }
    }).toDestination();
  });

  await Tone.start(); 
}

// Settings Functions ////////////////////////////////

function generateHarmony() {
  resetPart(harmonyVoice);
  const durationValues = Object.values(durationMapping);
  const noteValues = Object.values(noteMapping).filter(value => value < 12); // exclude Rest
  const chords = Object.values(chordMapping);
  const allNotes = [];
  let currentDuration = 0;

  const allowedDurations = durationValues.filter(duration => round(duration % (1 / timeSignature[1])) === 0);

  while (currentDuration < numMeasures * measureLength) {
    const duration = allowedDurations[Math.floor(Math.random() * allowedDurations.length)];

    if (round((currentDuration % measureLength) + duration) > measureLength) continue;

    const rootNote = noteValues[Math.floor(Math.random() * noteValues.length)];
    const chord = chords[Math.floor(Math.random() * chords.length)];

    const chordNotes = chord.map(interval =>
      Object.keys(noteMapping).find(key => noteMapping[key] === ((rootNote + interval) % 12))
    );

    let durationStr = Object.keys(durationMapping).find(key => durationMapping[key] === duration);
    let isDotted = false;
    if (durationStr.includes("d")) {
      durationStr = durationStr.replace("d", "");
      isDotted = true;
    }

    allNotes.push(new UnprocessedNote(chordNotes, 4, durationStr, isDotted));
    currentDuration = round(currentDuration + duration);
  }

  processNotes(harmonyVoice, allNotes, true);
}

// Export  //////////////////

function exportVoiceToMidi(voice) {
  const midi = new Midi();
  const track = midi.addTrack();
  const filename = `${voice.name}.mid`;
  let currentTime = 0;

  for (const note of voice.unprocessedNotes) {
    const noteDurationInSeconds = getNoteDurationInSeconds(voice, note);

    if (note.isRest) {
      currentTime += noteDurationInSeconds;
      continue;
    }

    for (const noteName of note.noteName) {
      track.addNote({
        name: noteName + note.octave,
        time: currentTime,
        duration: noteDurationInSeconds
      });
    }

    currentTime += noteDurationInSeconds;
  }

  const midiData = midi.toArray();
  const blob = new Blob([midiData], { type: 'audio/midi' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportVoiceToMusicXML(voice) {
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
        const hasFlat  = noteName.includes("b");
        const hasSharp = noteName.includes("#");

        xml += `  <pitch>\n`;
        xml += `    <step>${step}</step>\n`;
        if (hasFlat)  xml += `    <alter>-1</alter>\n`;
        if (hasSharp) xml += `    <alter>1</alter>\n`;
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

