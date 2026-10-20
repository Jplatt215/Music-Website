////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// App: settings wiring and everything that runs when the page loads
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

(StaveNote as any).format = customStaveNoteFormat;

createStaffContainers(["staff1", "staff2", "staff3", "staff4"]);

Object.entries(containers).forEach(([name, container]) => {
  renderers[name] = new Renderer(container, Renderer.Backends.SVG);
  contexts[name] = renderers[name].getContext();
});

document.getElementById('layerToggle')?.addEventListener('click', () => {
  currentLayer = currentLayer === 'main' ? 'harmony' : 'main';
  const btn = document.getElementById('layerToggle') as HTMLButtonElement;
  btn.textContent = currentLayer === 'main' ? 'Main' : 'Harmony';

  document.querySelectorAll('.harmonizeButton').forEach(btn => {
    (btn as HTMLElement).style.display = currentLayer === 'main' ? '' : 'none';
  });

  document.querySelectorAll(".staffSettings").forEach(settings => {
    const staffName = (settings as HTMLElement).dataset.staff!;
    populateStaffSettings(settings, staffName);
  });

  renderGridOverlays(Object.values(getActiveStaves()));
  drawAllStaves();
});

bpmSlider.addEventListener("input", () => {
  bpmValueDisplay.textContent = bpmSlider.value;
});

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(button => button.classList.remove('active'));
    document.getElementById('projectTitleBtn')?.classList.remove('active');
    btn.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(content => content.classList.add('hidden'));
    const target = document.getElementById((btn as HTMLElement).dataset.target!);
    target?.classList.remove('hidden');

    const dest = (btn as HTMLElement).dataset.target;
    if (dest === 'input-menu') setCurrentTab('create');
    else if (dest === 'edit-menu') setCurrentTab('edit');
    else renderGridOverlays(Object.values(getActiveStaves()));
  });
});

// Voice Settings //////////////////////////////////////////////////////////////////////

const allPitches: string[] = (() => {
  const list: string[] = [];
  ["A", "Bb", "B"].forEach(noteName => list.push(noteName + "0"));
  for (let oct = 1; oct <= 7; oct++) {
    ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"].forEach(noteName => list.push(noteName + oct));
  }
  list.push("C8");
  return list;
})();

const pitchIndex = (pitch: string): number => allPitches.indexOf(pitch);
const toPitchStr = (value: string | string[]): string => Array.isArray(value) ? `${value[0]}${value[1]}` : value;

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
  allPitches.forEach((pitch, index) => {
    if (index <= maxIdx) {
      const opt = document.createElement("option");
      opt.value = pitch;
      opt.textContent = pitch;
      minSelect.appendChild(opt);
    }
  });
  if (selectedMin && pitchIndex(selectedMin) <= maxIdx) minSelect.value = selectedMin;
}

function populateMaxFor(minPitch: string, maxSelect: HTMLSelectElement, selectedMax: string): void {
  maxSelect.innerHTML = "";
  const minIdx = pitchIndex(minPitch);
  allPitches.forEach((pitch, index) => {
    if (index >= minIdx) {
      const opt = document.createElement("option");
      opt.value = pitch;
      opt.textContent = pitch;
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
  const maxIndex = rhythmOptions.findIndex(option => option.id === maxId);
  selectEl.innerHTML = "";
  rhythmOptions.forEach((opt, index) => {
    if (index >= maxIndex) {
      const option = document.createElement("option");
      option.value = String(opt.id);
      option.textContent = opt.symbol;
      if (opt.id === selectedId) option.selected = true;
      selectEl.appendChild(option);
    }
  });
}

function populateMaxRhythm(minId: number, selectEl: HTMLSelectElement, selectedId: number): void {
  const minIndex = rhythmOptions.findIndex(option => option.id === minId);
  selectEl.innerHTML = "";
  rhythmOptions.forEach((opt, index) => {
    if (index <= minIndex) {
      const option = document.createElement("option");
      option.value = String(opt.id);
      option.textContent = opt.symbol;
      if (opt.id === selectedId) option.selected = true;
      selectEl.appendChild(option);
    }
  });
}

function populateStaffSettings(settings: Element, staffName: string): void {
  const staff = getActiveStaves()[staffName];
  const rootSelect  = settings.querySelectorAll('.rootSelect')[0] as HTMLSelectElement;
  const scaleSelect = settings.querySelector('.scaleSelect')      as HTMLSelectElement;
  const minSelect   = settings.querySelector('.minPitch')         as HTMLSelectElement;
  const maxSelect   = settings.querySelector('.maxPitch')         as HTMLSelectElement;
  const minRhythm   = settings.querySelector('.minRhythm')        as HTMLSelectElement;
  const maxRhythm   = settings.querySelector('.maxRhythm')        as HTMLSelectElement;
  const harmonizeButton = settings.querySelector('.harmonizeButton') as HTMLButtonElement;
  const muteButton      = settings.querySelector('.muteButton')      as HTMLButtonElement;

  populateScaleSelect(scaleSelect);
  if (staff.scale && staff.scale[1]) {
    scaleSelect.value = staff.scale[1];
  } else {
    scaleSelect.value = "Chromatic";
    staff.scale = [(staff.scale && staff.scale[0]) || "C", "Chromatic"];
  }
  rootSelect.value = staff.scale[0];

  const initialMin = toPitchStr(staff.pitchRange?.[0] || "E3");
  const initialMax = toPitchStr(staff.pitchRange?.[1] || "E6");
  populateMaxFor(initialMin, maxSelect, initialMax);
  populateMinFor(initialMax, minSelect, initialMin);
  minSelect.value = initialMin;
  maxSelect.value = initialMax;

  const initialMinRhythm = staff.rhythmRange?.[0] ?? 0.03125;
  const initialMaxRhythm = staff.rhythmRange?.[1] ?? 1;
  populateMaxRhythm(initialMinRhythm, maxRhythm, initialMaxRhythm);
  populateMinRhythm(initialMaxRhythm, minRhythm, initialMinRhythm);
  minRhythm.value = String(initialMinRhythm);
  maxRhythm.value = String(initialMaxRhythm);

  if (harmonizeButton) harmonizeButton.classList.toggle('active', staff.harmonize);
  if (muteButton) muteButton.classList.toggle('active', staff.muted);
}

document.querySelectorAll(".staffSettings").forEach(settings => {
  const staffName = (settings as HTMLElement).dataset.staff!;
  const muteButton     = settings.querySelector('.muteButton')     as HTMLButtonElement;
  const rootSelect     = settings.querySelectorAll('.rootSelect')[0] as HTMLSelectElement;
  const scaleSelect    = settings.querySelector('.scaleSelect')    as HTMLSelectElement;
  const minSelect      = settings.querySelector('.minPitch')       as HTMLSelectElement;
  const maxSelect      = settings.querySelector('.maxPitch')       as HTMLSelectElement;
  const minRhythm      = settings.querySelector('.minRhythm')      as HTMLSelectElement;
  const maxRhythm      = settings.querySelector('.maxRhythm')      as HTMLSelectElement;
  const harmonizeButton = settings.querySelector('.harmonizeButton') as HTMLButtonElement;

  // Initialize with main layer values
  populateStaffSettings(settings, staffName);

  // Event listeners read active layer's voice at fire time
  rootSelect?.addEventListener('change', () => {
    getActiveStaves()[staffName].scale[0] = rootSelect.value;
    saveToLocalStorage();
  });
  scaleSelect.addEventListener('change', () => {
    getActiveStaves()[staffName].scale[1] = scaleSelect.value;
    saveToLocalStorage();
  });
  minSelect.addEventListener("change", () => {
    const staff = getActiveStaves()[staffName];
    populateMaxFor(minSelect.value, maxSelect, maxSelect.value);
    staff.pitchRange[0] = minSelect.value;
    saveToLocalStorage();
  });
  maxSelect.addEventListener("change", () => {
    const staff = getActiveStaves()[staffName];
    populateMinFor(maxSelect.value, minSelect, minSelect.value);
    staff.pitchRange[1] = maxSelect.value;
    saveToLocalStorage();
  });
  minRhythm.addEventListener("change", () => {
    const staff = getActiveStaves()[staffName];
    staff.rhythmRange[0] = parseFloat(minRhythm.value);
    populateMaxRhythm(staff.rhythmRange[0], maxRhythm, staff.rhythmRange[1]);
    saveToLocalStorage();
  });
  maxRhythm.addEventListener("change", () => {
    const staff = getActiveStaves()[staffName];
    staff.rhythmRange[1] = parseFloat(maxRhythm.value);
    populateMinRhythm(staff.rhythmRange[1], minRhythm, staff.rhythmRange[0]);
    saveToLocalStorage();
  });
  muteButton.addEventListener("click", () => {
    muteButton.classList.toggle("active");
    getActiveStaves()[staffName].muted = muteButton.classList.contains("active");
    saveToLocalStorage();
  });
  harmonizeButton.addEventListener('click', () => {
    harmonizeButton.classList.toggle('active');
    mainStaves[staffName].harmonize = harmonizeButton.classList.contains('active');
    saveToLocalStorage();
  });
});

document.querySelectorAll('.staffSettingsBlank').forEach(blank => {
  blank.addEventListener('click', () => {
    const settings = blank.closest('.staffSettings') as HTMLElement;
    const staffName = settings.dataset.staff!;
    const existing = getSelection(staffName);

    if (existing) {
      clearSelection(staffName);
    } else {
      const totalDur = totalLength();
      setSelection(staffName, { start: 0, end: totalDur });
    }
  });
});

document.addEventListener('click', (event) => {
  const bar = document.getElementById('measureBar');
  if (bar && !bar.contains(event.target as Node)) {
    selectedMeasureIndex = null;
    drawMeasureBar(
      getGlobalMeasureWidths(
        Object.values(getActiveStaves())
      )
    );
  }
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

  for (let index = MAX_INTERVAL; index >= 1; index--) {
    const opt = document.createElement("option");
    opt.value = String(index);
    opt.textContent = `+${index}`;
    transposeDropdown.appendChild(opt);
  }
  for (let itemIndex = 1; itemIndex <= MAX_INTERVAL; itemIndex++) {
    const opt = document.createElement("option");
    opt.value = String(-itemIndex);
    opt.textContent = `-${itemIndex}`;
    transposeDropdown.appendChild(opt);
  }

  transposeDropdown.style.display = "block";
  transposeDropdown.selectedIndex = 0;
  transposeDropdown.focus();
});

transposeDropdown.addEventListener("click", () => {
  if (transposeDropdown.value === "") return;
  const interval = parseInt(transposeDropdown.value, 10);
  const active = getActiveStaves();
  let anyApplied = false;
  for (const name of staves) {
    if (applyToRange(active[name], (notes) => transposeNotes(notes, active[name], interval))) anyApplied = true;
  }
  if (anyApplied) { drawAllStaves(); updateMemory(); }
  transposeDropdown.style.display = "none";
});

transposeDropdown.addEventListener("blur", () => {
  transposeDropdown.style.display = "none";
});

const shiftSelect = document.querySelector("#shiftSelect") as HTMLSelectElement;

shiftButton.addEventListener("click", (event: Event) => {
  event.stopPropagation();
  shiftSelect.style.display = shiftSelect.style.display === "block" ? "none" : "block";
});

shiftSelect.addEventListener("click", () => {
  const selectedValue = shiftSelect.value;
  for (const staff of getSelectedStaves()) {
    shiftStaff(staff, selectedValue);
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

reflectButton.addEventListener("click", (event: Event) => {
  event.stopPropagation();
  reflectSelect.style.display = reflectSelect.style.display === "block" ? "none" : "block";
});

reflectSelect.addEventListener("click", () => {
  const axisPitch = reflectSelect.value;
  const active = getActiveStaves();
  let anyApplied = false;
  for (const name of staves) {
    if (applyToRange(active[name], (notes) => reflectNotes(notes, active[name], axisPitch))) anyApplied = true;
  }
  if (anyApplied) { drawAllStaves(); updateMemory(); }
  reflectSelect.style.display = "none";
});

document.addEventListener("click", (event: Event) => {
  if (!reflectButton.contains(event.target as Node) && !reflectSelect.contains(event.target as Node)) {
    reflectSelect.style.display = "none";
  }
});

function bindStaffAction(button: HTMLButtonElement | null, transform: (notes: UnprocessedNote[], startOffset: number) => UnprocessedNote[]): void {
  if (!button) return;
  button.addEventListener("click", () => {
    const active = getActiveStaves();
    let anyApplied = false;
    for (const name of staves) {
      if (applyToRange(active[name], transform)) anyApplied = true;
    }
    if (anyApplied) {
      drawAllStaves();
      updateMemory();
    }
  });
}

bpmSlider.addEventListener("input", () => {
  bpmValueDisplay.textContent = bpmSlider.value;
});

setupPlayButton(playButton, () => Object.values(getActiveStaves()));

generatePhraseButton?.addEventListener("click", () => {
  const active = getActiveStaves();
  let anyApplied = false;
  for (const name of staves) {
    if (generateIntoSelection(active[name])) anyApplied = true;
  }
  if (anyApplied) { drawAllStaves(); updateMemory(); }
});

separateStaffButton?.addEventListener("click", () => {
  if (!gridViewOn) return;
  if (separateStaff()) { drawAllStaves(); updateMemory(); }
});
bindStaffAction(reverseButton,       reverseNotes);
changeRhythmButton?.addEventListener("click", () => {
  applyPerStaffTransform((staff, notes, startOffset) => changeRhythmNotes(notes, staff, startOffset));
});
bindStaffAction(shuffleRhythmButton, shuffleRhythmNotes);
bindStaffAction(shuffleNotesButton,  shuffleNotesNotes);
bindStaffAction(shufflePitchButton,  shufflePitchNotes);
changePitchButton?.addEventListener("click", () => {
  applyPerStaffTransform((staff, notes, startOffset) => changePitchNotes(notes, staff, startOffset));
});
complicateButton?.addEventListener("click", () => {
  applyPerStaffTransform((staff, notes, startOffset) => complicateNotes(notes, staff, startOffset));
});
bindStaffAction(simplifyButton,      simplifyNotes);

// Select buttons now appear in both the Create and Edit tabs — bind every instance found,
// not just the first (a plain querySelector would silently miss the second one).
document.querySelectorAll('.previousButton').forEach(btn => {
  btn.addEventListener('click', () => accessMemory(-1));
});
document.querySelectorAll('.nextButton').forEach(btn => {
  btn.addEventListener('click', () => accessMemory(1));
});

document.addEventListener('keydown', (event: KeyboardEvent) => {
  const target = event.target as HTMLElement;
  const isTextEntry =
    (target.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'range') ||
    target.tagName === 'SELECT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable;

  if (isTextEntry) return;

  if (event.code === 'Space') {
    event.preventDefault();
    playButton?.click();
    return;
  }

  if (event.ctrlKey || event.metaKey) {
    if (event.key === 'z' || event.key === 'Z') {
      event.preventDefault();
      accessMemory(-1);
      return;
    }
    if (event.key === 'y' || event.key === 'Y') {
      event.preventDefault();
      accessMemory(1);
      return;
    }
    if (event.key === 'c' || event.key === 'C') {
      event.preventDefault();
      copySelection();
      return;
    }
    if (event.key === 'v' || event.key === 'V') {
      event.preventDefault();
      pasteSelection();
      updateMemory();
      return;
    }
  }
});

setupGridInteraction();

document.addEventListener('keydown', (event: KeyboardEvent) => {
  const targetElement = event.target as HTMLElement;
  const typing = (targetElement.tagName === 'INPUT' && (targetElement as HTMLInputElement).type !== 'range') ||
    targetElement.tagName === 'SELECT' || targetElement.tagName === 'TEXTAREA' || targetElement.isContentEditable;
  if (typing) return;
  if ((event.key === 'g' || event.key === 'G') && !event.ctrlKey && !event.metaKey) setGridView(!gridViewOn);
});

gridSlider?.addEventListener('input', () => {
  const index = parseInt(gridSlider.value, 10);
  gridDivision = GRID_DIVISIONS[index];
  gridSliderValue.textContent = GRID_LABELS[index];
  drawAllStaves();
});
gridSlider?.addEventListener('change', () => gridSlider.blur());   // keeps Space/Ctrl shortcuts working

setGridView(true);

document.querySelectorAll<HTMLButtonElement>('.modeButton').forEach(btn => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode;                 // 'insert' | 'overwrite' | 'polyphony'
    insertMode = mode === 'insert';
    polyphonyMode = mode === 'polyphony';
    document.querySelectorAll<HTMLButtonElement>('.modeButton')
      .forEach(button => button.classList.toggle('active', button === btn));
    btn.blur();                                    // so Space still triggers Play
    scheduleEditRefresh();
  });
});

const isVisibleTab = (id: string): boolean => !document.getElementById(id)?.classList.contains('hidden');

document.addEventListener('keydown', (event: KeyboardEvent) => {
  if (!gridViewOn) return;
  if (event.key !== 'Delete' && event.key !== 'Backspace') return;
  const targetElement = event.target as HTMLElement;
  const typing = (targetElement.tagName === 'INPUT' && (targetElement as HTMLInputElement).type !== 'range') ||
    targetElement.tagName === 'SELECT' || targetElement.tagName === 'TEXTAREA' || targetElement.isContentEditable;
  if (typing) return;

  if (currentTab === 'edit' && isVisibleTab('edit-menu')) {
    event.preventDefault();
    deleteAtSelection();
  } else if (currentTab === 'create' && isVisibleTab('input-menu')) {
    event.preventDefault();
    deleteNotesInRanges();
  }
});

buildEditMenu();
scheduleEditRefresh();

setupEntryInteraction();

setupClipboardKeys();

ignoreBlankClicksWhileWriting();
