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

class part {
  constructor(name, pitchRange = ["E3", "E6"], rhythmRange = [0.03125, 1], scale = ["C", "Chromatic"]) {
    Object.assign(this, { name, pitchRange, rhythmRange, scale, unprocessedNotes: [], notes: [], ties: [], tuplets: [], toneNotes: [], memory: [], currentMemoryIndex: -1, muted: false, duration: 0 });
  }
}

// Example: different pitch ranges per voice
const upperVoice = new part("upperVoice", ["C4", "C6"]);
const middleVoice = new part("middleVoice", ["A3", "F5"]);
const lowerVoice = new part("lowerVoice", ["E2", "C4"]);
const voice4 = new part("voice4", ["D3", "B5"]);
const harmonyVoice = new part("harmonyVoice"); // uses default
const voicesMap = { upperVoice, middleVoice, lowerVoice, voice4, harmonyVoice };

let clipboard = { unprocessedNotes: [], notes: [], ties: [], tuplets: [], toneNotes: [] };
let totalDuration = 0; //used for comparing current voice duration to harmony chord durations without interacting with voice.duration
let sampler = null;
let voiceDistance = null;
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
    if (val === value) return key;
  }
  throw new Error(`No duration key found for value ${value}`);
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
    updateMemory();
  };

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
      selectedVoices = selectedVoices.filter(v => v.name !== voiceName);
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
  for (const note of generatePhrase(part, numMeasures * measureLength)) {
    addNote(part, note);
  }
  drawNotes(part);
});

bindVoiceAction(separateVoiceButton, separateVoice);
bindVoiceAction(reverseButton, reverseVoice);
bindVoiceAction(copyPartButton, copyPart);
bindVoiceAction(pastePartButton, pastePart);
bindVoiceAction(changeRhythmButton, changeRhythm);
bindVoiceAction(shuffleRhythmButton, shuffleRhythm);
bindVoiceAction(shuffleNotesButton, shuffleNotes);
bindVoiceAction(shufflePitchButton, shufflePitch);
bindVoiceAction(changePitchButton, changePitch);
bindVoiceAction(complicateButton, complicateVoice);
bindVoiceAction(simplifyButton, simplifyVoice);

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
  let dur = note.getDuration();
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

  return null; // not found
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
  const scalePitches = allowedPitches.filter(p => {
    const note = p.slice(0, -1); // remove octave
    const pitchClass = noteMapping[note];
    return pitchClass !== undefined &&
      scale.includes((pitchClass - rootIndex + 12) % 12);
  });

  if (mode == "Harmony"){
    let durationSearched = 0;
    let currentChord = null;
    for (let i = 0; i < harmonyVoice.unprocessedNotes.length; ++i){
      currentChord = harmonyVoice.unprocessedNotes[i];
      durationSearched += getNoteDuration(currentChord);
      if (durationSearched <= totalDuration && i + 1 < harmonyVoice.unprocessedNotes.length){
        continue;
      }
      let currentChordEnd = durationSearched;
      let currentOverlap = currentChordEnd - totalDuration;
      let nextOverlap = noteDuration - currentOverlap;
      if (nextOverlap > currentOverlap && i + 1 < harmonyVoice.unprocessedNotes.length){
        currentChord = harmonyVoice.unprocessedNotes[i+1]
      }
      const chordNotes = currentChord.keys.map(k => k.split("/")[0]);

      // Keep only pitches that match the chord notes
      const harmonyPitches = scalePitches.filter(p => {
        const note = p.slice(0, -1); // drop octave
        return chordNotes.includes(note);
      });

      return harmonyPitches;
    }
  }
  return scalePitches;
}

function getNoteDurationInSeconds(voice, note) { // Approximate seconds per note based on BPM and note duration
    const bpm = 120; 
    const quarterNoteSeconds = 60 / bpm;
    let duration = getNoteDuration(note) * 4;
    let foundTuplet = findTuplet(note, voice);
    if (foundTuplet){
      duration = duration * foundTuplet.tupletInfo[1] / foundTuplet.tupletInfo[0];
    }

    return duration * quarterNoteSeconds;
}

function checkNoteInScale(note, voice) {
    if (note.isRest()) return true;

    const scaleRoot = voice.scale[0];    
    const scaleIntervals = scalesMapping[voice.scale[1]];  

    const scaleNotes = scaleIntervals.map(interval => {
        const semitone = (noteMapping[scaleRoot] + interval) % 12;
        return Object.keys(noteMapping).find(key => noteMapping[key] === semitone);
    });

    const [noteName] = note.getKeys()[0].split("/");

    return scaleNotes.includes(noteName);
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

function createTuplet(tupletObj){
  const tuplet = new Vex.Flow.Tuplet(tupletObj.tupletNotes, {
    num_notes: tupletObj.tupletInfo[0],
    notes_occupied: tupletObj.tupletInfo[1],
    ratioed: true,
  });
  return tuplet;
}

function fillDuration(fillNoteDuration, note) {
  let noteName = null;
  let noteOctave = null;
  let octaveStr = null;
  let isDotted = false;

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
        isDotted = false;
        break; 
      }
    }
  }
  return fillNotes;
}

function addNote(part, note) { 
  part.unprocessedNotes.push(note);  
  let tupletObj = findTuplet(note, part);
  if (tupletObj != null){
    if (tupletObj.tupletNotes[tupletObj.tupletNotes.length - 1] == note){
      part.duration += tupletObj.realDuration;
    }
    part.notes.push(note);
    part.toneNotes.push([staveNoteToToneJSNote(note), getNoteDuration(note) * tupletObj.tupletInfo[1] / tupletObj.tupletInfo[0]]);
    return;
  }
 
  if (((part.duration % measureLength) + getNoteDuration(note)) > measureLength){
    let notesToTie = [];
    let fillNoteDuration = measureLength - (part.duration % measureLength);
    let overflowDuration = getNoteDuration(note) - (measureLength - (part.duration % measureLength)); //overflow into next measure
    let fillNotes = fillDuration(fillNoteDuration, note);

    for (const fillNote of fillNotes) {
      part.notes.push(fillNote);
    }
    notesToTie.push(...fillNotes);
    
    while (overflowDuration > measureLength){
      fillNoteDuration = measureLength;
      overflowDuration = overflowDuration - measureLength;
      let fillNotes = fillDuration(fillNoteDuration, note);
      for (const fillNote of fillNotes) {
        part.notes.push(fillNote);
      }
      notesToTie.push(...fillNotes);
    }
    let overFlowNotes = fillDuration(overflowDuration, note);

    for (const overFlowNote of overFlowNotes) {
      part.notes.push(overFlowNote);
    }
    notesToTie.push(...overFlowNotes);
    
    if(!note.isRest()){
      part.ties.push(notesToTie);
    }
  }

  else{
    part.notes.push(note);  
  }
  part.duration += getNoteDuration(note);
  part.toneNotes.push([staveNoteToToneJSNote(note), getNoteDuration(note)]);
}

function resetPart(part){
  part.unprocessedNotes = [];
  part.notes = [];
  part.ties = [];
  part.tuplets = [];  
  part.toneNotes = [];
  part.duration = 0;
}

function rebuildVoice(voice, notes, tuplets = []) {
  resetPart(voice);
  tuplets.forEach(t => voice.tuplets.push(t));
  notes.forEach(n => addNote(voice, n));
  drawNotes(voice);
}


//  Memory /////////////////////////

function updateMemory(){
  for (let voice of selectedVoices) {
    let newVoiceMemory = [voice.unprocessedNotes, voice.tuplets];
    voice.memory.splice(voice.currentMemoryIndex + 1, 0, newVoiceMemory);
voice.currentMemoryIndex += 1;
  }
}

function accessMemory(indexDifference){
  for (let voice of selectedVoices){
    if (voice.currentMemoryIndex + indexDifference < 0 || voice.currentMemoryIndex + indexDifference > voice.memory.length - 1 || voice.memory.length === 0) {
      continue;
    } 
    voice.currentMemoryIndex += indexDifference;
    let voiceMemory = voice.memory[voice.currentMemoryIndex];
    resetPart(voice);
    let notes = voiceMemory[0];
    voice.tuplets = voiceMemory[1];
    for (let note of notes){
      addNote(voice, note);
    }
    drawNotes(voice);
  }
}

//  Draw /////////////////////////

function createRendererAndContext(partName) {
  const container = document.getElementById(partName + "Container");
  if (!container) return; // <-- prevents errors
  const width = container.clientWidth || 500;
  const height = container.clientHeight || 300;

  renderers[partName] = new Renderer(container, Renderer.Backends.SVG);
  renderers[partName].resize(width, height);
  contexts[partName] = renderers[partName].getContext();
}

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

function estimateStaffLength(part) {// Estimate total width needed for all measures before drawing

  const notes = [...part.notes];
  let total = 0;
  let measureDuration = 0;
  let measureNotesCount = 0;

  while (notes.length > 0) {
    const n = notes.shift();
    const tupletObj = findTuplet(n, part);
    if (tupletObj) {
      // count the whole tuplet at once only when finishing the tuplet
      if (tupletObj.tupletNotes[tupletObj.tupletNotes.length - 1] === n) {
        measureDuration += tupletObj.realDuration;
        measureNotesCount += tupletObj.tupletNotes.length;
      } else {
        measureNotesCount += 1;
      }
    } else {
      measureDuration += getNoteDuration(n);
      measureNotesCount += 1;
    }

    if (measureDuration >= measureLength) {
      const staveWidth = 200 + measureNotesCount * 40;
      total += staveWidth;
      measureDuration = 0;
      measureNotesCount = 0;
    }
  }

  if (measureNotesCount > 0) {
    const staveWidth = 200 + measureNotesCount * 40;
    total += staveWidth;
  }

  // Add a small margin at the end
  return Math.max(total, 800) + 100;
}

function drawNotes(part) {
  eraseDrawing(part);

  const requiredWidth = estimateStaffLength(part);

  ensureSvgSize(part.name, requiredWidth);

  let context = contexts[part.name];
  const notes = [...part.notes];
  const ties = [...part.ties];

  let staffLength = 0;
  let measureNotes = [];
  let measureDuration = 0;
  let measureIndex = 0; 
  let tupletsToDraw = [];

  function drawMeasure(notesToDraw) {
    const staveWidth = 200 + notesToDraw.length * 40;
    const stave = new Stave(staffLength, 60, staveWidth);

    if (measureIndex === 0) {
      stave.addClef("treble").addTimeSignature(`${timeSignature[0]}/${timeSignature[1]}`);
    }
    stave.setContext(context).draw();

    const voice = new Voice({
      num_beats: timeSignature[0],
      beat_value: timeSignature[1],
    }).setStrict(false);

    voice.addTickables(notesToDraw);
    const beams = Vex.Flow.Beam.generateBeams(notesToDraw);
    new Formatter().joinVoices([voice]).format([voice], staveWidth - 80);

    for (let note of notesToDraw) {
      note.setStave(stave).setContext(context).draw();
    }
    for (const beam of beams) {
      beam.setContext(context).draw();
    }
    for (const tupletObj of tupletsToDraw) {
      const tuplet = createTuplet(tupletObj);
      tuplet.setContext(context).draw();
    }
    tupletsToDraw = [];

    staffLength += staveWidth;
    measureIndex++;
  }

  while (notes.length > 0) {
    const note = notes.shift();
    measureNotes.push(note);

    const originalTuplet = findTuplet(note, part);
    if (originalTuplet != null) {
      if (originalTuplet.tupletNotes[originalTuplet.tupletNotes.length - 1] == note){
        measureDuration += originalTuplet.realDuration;
        tupletsToDraw.push(originalTuplet);
      }
    } else {
      measureDuration += getNoteDuration(note);
    }

    if (measureDuration >= measureLength) {
      drawMeasure(measureNotes);
      measureNotes = [];
      measureDuration = 0;
    }
  }

  if (measureNotes.length > 0) {
    const remaining = measureLength - (part.duration % measureLength);
    if (remaining > 0) {
      measureNotes.push(...fillDuration(remaining, "rest"));
    }
    drawMeasure(measureNotes);
  }

  drawTies(ties, context);
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
  for (let durationKey of durationKeys){
    if (durationMapping[durationKey] >= part.rhythmRange[0] && durationMapping[durationKey] <= part.rhythmRange[1]){
      allowedDurations.push(durationKey);
    }
  }

  while (currentDuration < duration) {
    if (duration - currentDuration < part.rhythmRange[0]){
      currentDuration = 0;
      notes = [];
      tupletNotes = [];
      totalDuration = totalDurationOriginal;
    }

    let durationStr = allowedDurations[Math.floor(Math.random() * allowedDurations.length)];

    if (currentDuration + durationMapping[durationStr] > duration) {
      continue; 
    }

    if (allowTuplets && !durationStr.includes("d") && durationMapping[durationStr] < 1 && ((Math.random() < 0.5) && durationMapping[durationStr] >= 1 / timeSignature[1] && duration - currentDuration >= 2 * durationMapping[durationStr])){
      let notesOccupied = 2;
      let possibleTupletSizes = [3, 5, 7];

      let numTupletNotes = possibleTupletSizes[Math.floor(Math.random() * possibleTupletSizes.length)];
      let realDuration = 2 * (durationMapping[durationStr]);

      while(tupletNotes.length < numTupletNotes){
        let [noteName, noteOctave] = randomPitchFromScale(part, durationMapping[durationStr]);
        let note = createNote([noteName], noteOctave, getDurationKeyFromValue(durationMapping[durationStr]));
        tupletNotes.push(note);
        totalDuration += durationMapping[durationStr] * 2 / numTupletNotes;
      }

      notes.push(...tupletNotes);

      part.tuplets.push({
        tupletNotes: tupletNotes,
        tupletInfo: [numTupletNotes, notesOccupied],
        realDuration: realDuration
      });
      tupletNotes = [];
      currentDuration += 2 * durationMapping[durationStr];
    }
    
    else{
      let [noteName, noteOctave] = randomPitchFromScale(part, durationMapping[durationStr]);
      let note = createNote([noteName], noteOctave, durationStr);
      notes.push(note);
      currentDuration += durationMapping[durationStr];
      totalDuration += durationMapping[durationStr];
    }
  }
  return notes;
}

function generateMelody(part, duration){

}

//  Accompany   /////////////////////////

function separateVoice() {
  // Use the first selected voice as the source
  let voiceToSeparate = selectedVoices[0]; 
  if (!voiceToSeparate || !voiceToSeparate.unprocessedNotes?.length) {
    return;
  }

  // Buckets for notes and tuplets
  let newNotesPerVoice = voices.map(() => []);
  let newTupletsPerVoice = voices.map(() => []);
  let newTupletNotesPerVoice = voices.map(() => []);

  // Build allowed pitches 
  let allowedPitchesMap = new Map();
  for (let vName of voices) {
    const voiceObj = voicesMap[vName];
    allowedPitchesMap.set(vName, getAllowedPitches(voiceObj));
  }

  // Distribute notes
  for (let noteObj of voiceToSeparate.unprocessedNotes) {
    let rawName = noteObj.keys[0];
    let noteName = rawName.replace("/", ""); 

    // Find candidate voices by name
    let candidateVoices = voices.filter(vName => {
      const selVoice = selectedVoices.find(sel => sel.name === vName);
      return selVoice && allowedPitchesMap.get(vName).includes(noteName);
    });

    // Pick a target voice randomly, or fallback to source
    let targetVoiceName = candidateVoices.length > 0
      ? candidateVoices[Math.floor(Math.random() * candidateVoices.length)]
      : voiceToSeparate.name;

    let targetIdx = voices.indexOf(targetVoiceName);

    let originalTuplet = findTuplet(noteObj, voiceToSeparate);

    voices.forEach((vName, i) => {
      let noteToAdd = i === targetIdx ? noteObj : createNote(["Rest"], 4, getDurationString(noteObj));

      newNotesPerVoice[i].push(noteToAdd);

      if (originalTuplet) {
        newTupletNotesPerVoice[i].push(noteToAdd);

        if (newTupletNotesPerVoice[i].length === originalTuplet.tupletInfo[0]) {
          newTupletsPerVoice[i].push({
            tupletNotes: newTupletNotesPerVoice[i],
            tupletInfo: [...originalTuplet.tupletInfo],
            realDuration: originalTuplet.realDuration
          });
          newTupletNotesPerVoice[i] = [];
        }
      }
    });
  }

  // Reset & redraw only selected voices
  voices.forEach((vName, i) => {
    const selVoice = selectedVoices.find(sel => sel.name === vName);
    if (!selVoice) return; 

    resetPart(selVoice);

    for (let tuplet of newTupletsPerVoice[i]) {
      selVoice.tuplets.push(tuplet);
    }

    for (let note of newNotesPerVoice[i]) {
      addNote(selVoice, note);
    }

    drawNotes(selVoice);
  });
}

//  Modify   /////////////////////////
function reverseVoice(voice) {
  let reversedNotes = [...voice.unprocessedNotes].reverse();
  let reversedTuplets = [];
  let seenTuplets = new Set();

  for (let note of reversedNotes) {
    let originalTuplet = findTuplet(note, voice);

    if (originalTuplet && !seenTuplets.has(originalTuplet)) {
      let tupletNotes = reversedNotes.filter(n => originalTuplet.tupletNotes.includes(n));

      reversedTuplets.push({
        tupletNotes: tupletNotes,
        tupletInfo: [...originalTuplet.tupletInfo],
        realDuration: originalTuplet.realDuration
      });

      seenTuplets.add(originalTuplet);
    }
  }

  resetPart(voice);

  for (let tuplet of reversedTuplets) {
    voice.tuplets.push(tuplet);
  }

  for (let note of reversedNotes) {
    addNote(voice, note);
  }

  drawNotes(voice);
}

function reflectVoice(voice, axisPitch) {
  let axisOctave = 4;     
  let reflectedNotes = [];
  let reflectedTuplets = [];
  let tupletNotes = [];
  let reflectedPitch = null;
  let reflectedNote = null;
  let reflectedScalarIndex = [];

  let scale = scalesMapping[voice.scale[1]];

  let axisDistanceFromRoot = Math.abs(noteMapping[voice.scale[0]] - noteMapping[axisPitch]);
  let axisScalarIndex = scale.indexOf(axisDistanceFromRoot); 

  for (let note of voice.unprocessedNotes) {
    let [noteName, noteOctave] = note.getKeys()[0].split("/");
    if (note.isRest()) {
      reflectedNote = note;
    }
    else{
      let noteInscale = true;
      if (!checkNoteInScale(note, voice)){
        noteInscale = false;
        scale = scalesMapping["Chromatic"];
      }
      let noteDistanceFromRoot = Math.abs(noteMapping[voice.scale[0]] - noteMapping[noteName]);
      let noteScalarIndex = scale.indexOf(noteDistanceFromRoot);  

      if (axisScalarIndex == -1 && noteInscale){
        let i = axisDistanceFromRoot;
        while (scale.indexOf(i % 12) == -1){
          ++i;
        }
        let foundScaleInterval = scale.indexOf(i % 12);
        let distanceFromFoundScaleInterval = Math.abs((noteScalarIndex - foundScaleInterval + scale.length) % scale.length);
        reflectedScalarIndex = (foundScaleInterval - distanceFromFoundScaleInterval - 1 + scale.length) % scale.length;
      }

      else{
        reflectedScalarIndex = ((axisScalarIndex - noteScalarIndex) + axisScalarIndex + scale.length) % scale.length;
      }
      let reflectedPitchIndex = noteMapping[voice.scale[0]] + scale[reflectedScalarIndex];
      reflectedPitch = Object.keys(noteMapping).find(key => noteMapping[key] === reflectedPitchIndex);

      let noteAbs = noteOctave * 12 + noteDistanceFromRoot;
      let axisAbs = axisOctave * 12 + axisDistanceFromRoot;

      // Reflect: new = 2*axis - note
      let reflectedAbs = 2 * axisAbs - noteAbs;

      // Convert back to note name + octave
      noteOctave = Math.floor(reflectedAbs / 12);

      let noteIdx = pitchIndex(reflectedPitch + noteOctave);
      const minIdx = pitchIndex(voice.pitchRange[0]);
      const maxIdx = pitchIndex(voice.pitchRange[1]);
      if (noteIdx < minIdx) {
        noteOctave += Math.ceil((minIdx - noteIdx) / 12);
      }
      else if (noteIdx > maxIdx) {
        noteOctave -= Math.ceil((noteIdx - maxIdx) / 12);
      }

      reflectedNote = createNote([reflectedPitch], noteOctave, getDurationString(note));
    }
    reflectedNotes.push(reflectedNote);

    
    let originalTuplet = findTuplet(note, voice);
    if (originalTuplet){
      tupletNotes.push(reflectedNote);
      if (tupletNotes.length == originalTuplet.tupletInfo[0]) {
        reflectedTuplets.push({
          tupletNotes: tupletNotes,
          tupletInfo: [...originalTuplet.tupletInfo],
          realDuration: originalTuplet.realDuration
        });
        tupletNotes = [];
      }
    }
  }

  resetPart(voice);

  for (let tuplet of reflectedTuplets) {
    voice.tuplets.push(tuplet);
  }

  for (let note of reflectedNotes) {
    addNote(voice, note);
  }

  drawNotes(voice);
}

function shiftVoice(voice, distance) {
  let notes = voice.unprocessedNotes;
  let tuplets = [];
  let tupletNotes = [];
  let seenTuplets = new Set();

  for (let note of voice.unprocessedNotes){
    let originalTuplet = findTuplet(note, voice);
    if (originalTuplet){
      tupletNotes.push(note);
      if (tupletNotes.length == originalTuplet.tupletInfo[0]) {
        tuplets.push({
          tupletNotes: tupletNotes,
          tupletInfo: [...originalTuplet.tupletInfo],
          realDuration: originalTuplet.realDuration
        });
        tupletNotes = [];
      }
    }
  }

  resetPart(voice);

  for (let tuplet of tuplets) {
    voice.tuplets.push(tuplet);
  }

  addNote(voice, createNote(['Rest'], 4, distance));
  
  for (let note of notes){
    addNote(voice, note);
  }
  drawNotes(voice);
}

function transposeVoice(voice, scaleDegreeDifference) {
  let transposedNotes = [];
  let tupletNotes = [];
  let tuplets = [];
  let transposedNote = null;

  const rootNote = voice.scale?.[0];
  const scaleName = voice.scale?.[1];
  const rootIndex = noteMapping[rootNote];
  const scale = scalesMapping[scaleName];

  let direction = "up"
  if (scaleDegreeDifference < 0){
    direction = "down"
  }
  

  for (let note of voice.unprocessedNotes){
    if (note.isRest()) {
      transposedNote = note;
    }
    else{
      const [noteName, noteOctave] = note.getKeys()[0].split("/");
      const noteIndex = noteMapping[noteName];
      let originalInterval = (noteIndex + 12 - rootIndex) % 12;
      let originalScaleDegree = scale.indexOf(originalInterval);
      let newScaleDegree = (originalScaleDegree + scaleDegreeDifference + scale.length) % scale.length;
      let newInterval = scale[newScaleDegree];

      // Transpose down by interval
      let transposedIndex = (rootIndex + newInterval) % 12;
      // Find pitch name
      let transposedPitch = Object.keys(noteMapping).find(key => noteMapping[key] === transposedIndex);
      // Adjust octave if the transposition crosses a boundary
      const originalPitchIndex = noteMapping[noteName] + 12*noteOctave;
      const transposedPitchIndex = noteMapping[transposedPitch] + 12*noteOctave;
      let newOctave = parseInt(noteOctave);
      if (originalPitchIndex <= transposedPitchIndex && direction == "down") {
        newOctave -= 1;
      }

      else if (originalPitchIndex >= transposedPitchIndex && direction == "up") {
        newOctave += 1;
      }

      let noteIdx = pitchIndex(noteName + noteOctave);
      const minIdx = pitchIndex(voice.pitchRange[0]);
      const maxIdx = pitchIndex(voice.pitchRange[1]);
      if (noteIdx < minIdx) {
        newOctave += Math.ceil((minIdx - noteIdx) / 12);
      }
      else if (noteIdx > maxIdx) {
        newOctave -= Math.ceil((noteIdx - maxIdx) / 12);
      }

      transposedNote = createNote([transposedPitch], newOctave, getDurationString(note));
    }

    transposedNotes.push(transposedNote);

    let originalTuplet = findTuplet(note, voice);
    if (originalTuplet){
      tupletNotes.push(transposedNote);
      if (tupletNotes.length == originalTuplet.tupletInfo[0]) {
        tuplets.push({
          tupletNotes: tupletNotes,
          tupletInfo: [...originalTuplet.tupletInfo],
          realDuration: originalTuplet.realDuration
        });
        tupletNotes = [];
      }
    }
  }

  resetPart(voice);

  for (let tuplet of tuplets) {
    voice.tuplets.push(tuplet);
  }
  
  for (let note of transposedNotes){
    addNote(voice, note);
  }
  drawNotes(voice);
}

function shuffleRhythm(voice) {
  let rhythmNotes = [...voice.unprocessedNotes]; 
  let pitchNotes = [...voice.unprocessedNotes];
  let newNotes = [];
  let tuplets = [];
  let currentTupletNotes = [];

  let i = 0;
  let j = 0;

  while (newNotes.length < voice.unprocessedNotes.length){
    let pitchNote = pitchNotes[i];
    if (pitchNote.isRest()){
      noteName = "Rest";
      noteOctave = 4;
    }
    else{
      [noteName, noteOctave] = pitchNote.getKeys()[0].split("/");
    }

    j = Math.floor(Math.random() * rhythmNotes.length);
    let rhythmNote = rhythmNotes[j];
  
    let currentTuplet = null;
    currentTuplet = findTuplet(rhythmNote, voice);

    if (currentTuplet){
      let newNote = createNote([noteName], noteOctave, getDurationString(rhythmNote));
      newNotes.push(newNote);
      currentTupletNotes.push(newNote);
      rhythmNotes.splice(j, 1);

      while(currentTupletNotes.length < currentTuplet.tupletInfo[0]){
        j = Math.floor(Math.random() * rhythmNotes.length);
        let rhythmNote = rhythmNotes[j];
        let foundTuplet = null;
        foundTuplet = findTuplet(rhythmNote, voice);

        if (foundTuplet == currentTuplet){
          ++i;
          let pitchNote = pitchNotes[i];
          if (pitchNote.isRest()){
            noteName = "Rest";
            noteOctave = 4;
          }
          else{
            [noteName, noteOctave] = pitchNote.getKeys()[0].split("/");
          }
          let newNote = createNote([noteName], noteOctave, getDurationString(rhythmNote));
          newNotes.push(newNote);
          currentTupletNotes.push(newNote);
          rhythmNotes.splice(j, 1);
        }
      }
      tuplets.push({
        tupletNotes: currentTupletNotes,
        tupletInfo: [...currentTuplet.tupletInfo],
        realDuration: currentTuplet.realDuration
        });
      currentTupletNotes = [];
    }
    else{
      let newNote = createNote([noteName], noteOctave, getDurationString(rhythmNote));
      newNotes.push(newNote);
      rhythmNotes.splice(j, 1);
      }
      ++i;
    }

  resetPart(voice);

  for (let tuplet of tuplets) {
    voice.tuplets.push(tuplet);
  }

  for (let note of newNotes){
    addNote(voice, note);
  }
  drawNotes(voice);
}

function shuffleNotes(voice) {
  let originalNotes = voice.unprocessedNotes;
  let newNotes = [];
  let tuplets = [];
  let currentTupletNotes = [];

  while (originalNotes.length != 0){
    i = Math.floor(Math.random() * originalNotes.length);
    let note = originalNotes[i];
    let currentTuplet = null;
    currentTuplet = findTuplet(note, voice);

    if (currentTuplet){
      newNotes.push(note);
      currentTupletNotes.push(note);
      originalNotes.splice(i, 1);

      while(currentTupletNotes.length < currentTuplet.tupletInfo[0]){
        i = Math.floor(Math.random() * originalNotes.length);
        let note = originalNotes[i];
        let foundTuplet = null;
        foundTuplet = findTuplet(note, voice);

        if (foundTuplet == currentTuplet){
          newNotes.push(note);
          currentTupletNotes.push(note);
          originalNotes.splice(i, 1);
        }
      }
     
      tuplets.push({
        tupletNotes: currentTupletNotes,
        tupletInfo: [...currentTuplet.tupletInfo],
        realDuration: currentTuplet.realDuration
        });
      currentTupletNotes = [];
    }
    else{
      newNotes.push(note);
      originalNotes.splice(i, 1);
      }
    }

    resetPart(voice);

    for (let tuplet of tuplets) {
    voice.tuplets.push(tuplet);
  }

    for (let note of newNotes){
      addNote(voice, note);
    }
    drawNotes(voice);
}

function shufflePitch(voice) {
  let rhythmNotes = [...voice.unprocessedNotes]; 
  let pitchNotes = [...voice.unprocessedNotes];

  // Extract just the pitches (ignore rests here)
  pitchNotes = pitchNotes.filter(n => !n.isRest());

  // Shuffle pitches
  for (let i = pitchNotes.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pitchNotes[i], pitchNotes[j]] = [pitchNotes[j], pitchNotes[i]];
  }

  let newNotes = [];
  let tuplets = [];
  let tupletNotes = [];
  let pitchIndex = 0;

  for (let rhythmNote of rhythmNotes) {
    let noteName, noteOctave;

    if (rhythmNote.isRest()) {
      // Keep it a rest, don't advance pitchIndex
      noteName = "Rest";
      noteOctave = 4;
    } else {
      // Take the next available pitch
      let pitchNote = pitchNotes[pitchIndex++];
      [noteName, noteOctave] = pitchNote.getKeys()[0].split("/");
    }

    let newNote = createNote([noteName], noteOctave, getDurationString(rhythmNote));
    newNotes.push(newNote);

    let originalTuplet = findTuplet(rhythmNote, voice);
    if (originalTuplet) {
      tupletNotes.push(newNote);
      if (tupletNotes.length == originalTuplet.tupletInfo[0]) {
        tuplets.push({
          tupletNotes: tupletNotes,
          tupletInfo: [...originalTuplet.tupletInfo],
          realDuration: originalTuplet.realDuration
        });
        tupletNotes = [];
      }
    }
  }

  resetPart(voice);

  for (let tuplet of tuplets) {
    voice.tuplets.push(tuplet);
  }

  for (let note of newNotes) {
    addNote(voice, note);
  }

  drawNotes(voice);
}

function changeRhythm(voice) {
  let originalNotes = voice.unprocessedNotes;
  let newNotes = [];
  let currentDuration = 0;
  const durationKeys = Object.keys(durationMapping);

  while (originalNotes.length != 0){
    let note = originalNotes.shift()
    const [noteName, noteOctave] = note.getKeys()[0].split("/");
    let durationStr = durationKeys[Math.floor(Math.random() * durationKeys.length)];

    currentDuration += durationMapping[durationStr];
    newNotes.push(createNote([noteName], noteOctave, durationStr));
    }

    resetPart(voice);

    for (let note of newNotes){
      addNote(voice, note);
    }
    drawNotes(voice);
}

function changePitch(voice) {
  let rhythmNotes = [...voice.unprocessedNotes]; 
  let newNotes = [];
  let tuplets = [];
  let tupletNotes = [];
  let newNote = null;
  totalDuration = 0;

  for (let rhythmNote of rhythmNotes){
    if(rhythmNote.isRest()){
      newNote = createNote(["Rest"], 4, getDurationString(rhythmNote));;
    }

    else{
      let [noteName, noteOctave] = randomPitchFromScale(voice, getNoteDuration(rhythmNote), false);
      newNote = createNote([noteName], noteOctave, getDurationString(rhythmNote));
    }

    newNotes.push(newNote);
    totalDuration += getNoteDuration(rhythmNote);

    let originalTuplet = findTuplet(rhythmNote, voice);
    if (originalTuplet){
      tupletNotes.push(newNote);
      totalDuration +=  (getNoteDuration(rhythmNote) * 2 / originalTuplet.tupletInfo[0]) - getNoteDuration(rhythmNote);
      if (tupletNotes.length == originalTuplet.tupletInfo[0]) {
        tuplets.push({
          tupletNotes: tupletNotes,
          tupletInfo: [...originalTuplet.tupletInfo],
          realDuration: originalTuplet.realDuration
        });
        tupletNotes = [];
      }
    }
  }

    resetPart(voice);

    for (let tuplet of tuplets) {
    voice.tuplets.push(tuplet);
  }

    for (let note of newNotes){
      addNote(voice, note);
    }
    drawNotes(voice);
}

//  Develop   /////////////////////////

function simplifyVoice(voice) {
  let currentNotes = [...voice.unprocessedNotes]; 
  let currentTupletNotes = [];
  let tuplets = [];
  let simplifiedNotes = [];

  for (let i = 0; i < currentNotes.length; ++i) {
    let beginningNote = currentNotes[i];

    let originalTuplet = findTuplet(beginningNote, voice);

    if (originalTuplet){
      currentTupletNotes.push(beginningNote);   

      if (currentTupletNotes.length == originalTuplet.tupletInfo[0]){
        let newTupletLength = Math.min(5, 2 + Math.floor(Math.random() * (originalTuplet.tupletInfo[0] - 2)));

        while (currentTupletNotes.length > newTupletLength){
          let idx = Math.floor(Math.random() * currentTupletNotes.length);
          currentTupletNotes.splice(idx, 1);
        }
    
        if (currentTupletNotes.length % 2 === 1){
          simplifiedNotes.push(...currentTupletNotes);

          tuplets.push({
            tupletNotes: currentTupletNotes,
            tupletInfo: [currentTupletNotes.length, originalTuplet.tupletInfo[1]],
            realDuration: originalTuplet.realDuration
          });
        }

        else{
          let newDuration = Object.keys(durationMapping).find(k => Math.abs(durationMapping[k] - (originalTuplet.realDuration / currentTupletNotes.length)) < 1e-6);
          for (note of currentTupletNotes){
            let [noteName, noteOctave] = note.getKeys()[0].split("/");
            let newNote = createNote([noteName], noteOctave, newDuration);
            simplifiedNotes.push(newNote);
          }
        }
        currentTupletNotes = [];
      }
    }

    else{
      let [noteName, noteOctave] = beginningNote.getKeys()[0].split("/");
      let combinedDuration = getNoteDuration(beginningNote);
      let j = i + 1;

      while (j < currentNotes.length) {
         let originalTuplet = findTuplet(currentNotes[j], voice);

        if (originalTuplet){
          simplifiedNotes.push(beginningNote);
          break;
        }
        combinedDuration += getNoteDuration(currentNotes[j]);

        if (combinedDuration != measureLength && Object.values(durationMapping).includes(combinedDuration) && Math.random() < 0.5) {
          let durationStr = Object.keys(durationMapping).find(
            k => durationMapping[k] === combinedDuration
          );

          let combinedNote = createNote([noteName], noteOctave, durationStr);
          simplifiedNotes.push(combinedNote);
          i = j; 
          break;
        }

        j++;
      }

      if (j >= currentNotes.length) {
        simplifiedNotes.push(beginningNote);
      }
    }
  }

  resetPart(voice);

  for (let tuplet of tuplets) {
    voice.tuplets.push(tuplet);
  }

  for (let note of simplifiedNotes) {
    addNote(voice, note);
  }

  drawNotes(voice);
}

function complicateVoice(voice){
  let notes = [];
  let seenTuplets = new Set();

  for (let note of voice.unprocessedNotes){
    let complicatedNotes = null;
    let originalTuplet = findTuplet(note, voice);
    if (originalTuplet){
      if(!seenTuplets.has(originalTuplet)){
        complicatedNotes = generatePhrase(voice, originalTuplet.realDuration, false);
        seenTuplets.add(originalTuplet);
      }
      else{
        continue;
      }
    }
    
    else if (getDurationString(note) != "32" && Math.random() < 0.5){
      complicatedNotes = generatePhrase(voice, getNoteDuration(note), false);
    }
    else{
      notes.push(note);
    }

    if (complicatedNotes != null){
      for (let newNote of complicatedNotes){
        if (newNote == complicatedNotes[0] || Math.random() < .3){
          let [noteName, noteOctave] = note.getKeys()[0].split("/");
          newNote = createNote([noteName], noteOctave, getDurationString(newNote));
        }
        notes.push(newNote);
      }
    }
  }

  resetPart(voice);
  
  for (let note of notes){
    addNote(voice, note);
  }
  drawNotes(voice);
}

//  Play /////////////////////////

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

// Audio /////////////////////////

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

//  Copy /////////////////////////

function copyPart(part) {
  clipboard.unprocessedNotes = [...part.unprocessedNotes];
  clipboard.notes = [...part.notes];
  clipboard.ties = [...part.ties];
  clipboard.tuplets = [...part.tuplets];
  clipboard.toneNotes = [...part.toneNotes];
}

function pastePart(part) {
  part.unprocessedNotes = [...clipboard.unprocessedNotes];
  part.notes = [...clipboard.notes];
  part.ties = [...clipboard.ties];
  part.tuplets = [...clipboard.tuplets];
  part.toneNotes = [...clipboard.toneNotes];
  drawNotes(part);
}

// Settings Functions ////////////////////////////////

function generateHarmony(){
  resetPart(harmonyVoice);
  const durationValues = Object.values(durationMapping);
  let allowedDurations = [];
  const noteValues = Object.values(noteMapping);
  const chords = Object.values(chordMapping);
  let chordNotes = [];
  let currentDuration = 0;

  for (let durationValue of durationValues){
    if (durationValue % (1 / timeSignature[1]) == 0){
      allowedDurations.push(durationValue);
    }
  }
  
  while (currentDuration < numMeasures * measureLength){
    let duration = allowedDurations[Math.floor(Math.random() * allowedDurations.length)];

    if ((duration + currentDuration % measureLength) > measureLength){
      continue;
    }
    currentDuration += duration;
    let rootNote = noteValues[Math.floor(Math.random() * noteValues.length)];

    let chord = chords[Math.floor(Math.random() * chords.length)];

    for (interval of chord){
      let noteName = Object.keys(noteMapping).find(key => noteMapping[key] === ((rootNote + interval) % 12));
      chordNotes.push(noteName);
    }
    let durationStr = Object.keys(durationMapping).find(key => durationMapping[key] === duration);
    let isDotted = false;
    if (durationStr.includes("d")) {
          durationStr = durationStr.replace("d", "");
          isDotted = true;
        }

    addNote(harmonyVoice, createNote(chordNotes, 4, durationStr, isDotted));
    chordNotes = [];
  }

  drawNotes(harmonyVoice);
}

// Helper Functions   //////////////////

function compressOctave(notename, noteOctave){
  let noteIdx = pitchIndex(notename + noteOctave);
  const minIdx = pitchIndex(voice.pitchRange[0]);
  const maxIdx = pitchIndex(voice.pitchRange[1]);
  if (noteIdx < minIdx) {
    noteOctave += Math.ceil((minIdx - noteIdx) / 12);
  }
  else if (noteIdx > maxIdx) {
    noteOctave -= Math.ceil((noteIdx - maxIdx) / 12);
  }
  return noteOctave;
}

// Export  //////////////////

function exportVoiceToMidi(voice) {
    const midi = new Midi();
    const track = midi.addTrack();
    filename = 'voice.mid'

    let currentTime = 0; 

    for (let note of voice.unprocessedNotes) {
        if (note.isRest && note.isRest()) {
            currentTime += getNoteDurationInSeconds(voice, note); 
            continue;
        }

        const [name, octave] = note.getKeys()[0].split('/');
        track.addNote({
            name: name + octave,
            time: currentTime,
            duration: getNoteDurationInSeconds(voice, note)
        });

        currentTime += getNoteDurationInSeconds(voice, note);
    }

    const midiData = midi.toArray();
    const blob = new Blob([midiData], { type: 'audio/midi' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
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
          <beats>4</beats>
          <beat-type>4</beat-type>
        </time>
        <clef>
          <sign>G</sign>
          <line>2</line>
        </clef>
      </attributes>
`;

  let currentTupletID = 1;

  for (const note of voice.unprocessedNotes) {
    let fracWhole = getNoteDuration(note);
    let isDotted = note.dotted || false;
    let baseFrac = isDotted ? fracWhole / 1.5 : fracWhole;

    let durationDivs = Math.round(fracWhole * DIVS_PER_WHOLE);

    xml += `<note>\n`;

    if (note.isRest()) {
      xml += `  <rest/>\n`;
    } else {
      const [pitch, octave] = note.getKeys()[0].split("/");
      let step = pitch[0].toUpperCase();
      let alter = pitch.includes("#") ? 1 : pitch.includes("b") ? -1 : null;

      xml += `  <pitch>
    <step>${step}</step>
`;
      if (alter !== null) xml += `    <alter>${alter}</alter>\n`;
      xml += `    <octave>${octave}</octave>
  </pitch>\n`;
    }

    xml += `  <duration>${durationDivs}</duration>\n`;
    xml += `</note>\n`;
  }

  xml += `    </measure>
  </part>
</score-partwise>`;

  const blob = new Blob([xml], {
    type: "application/vnd.recordare.musicxml+xml"
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${voice.name || "voice"}.musicxml`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}


