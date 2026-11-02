"use strict";
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// App: settings wiring and everything that runs when the page loads
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
StaveNote.format = customStaveNoteFormat;
createStaffContainers(["staff1", "staff2", "staff3", "staff4"]);
Object.entries(containers).forEach(([name, container]) => {
    renderers[name] = new Renderer(container, Renderer.Backends.SVG);
    contexts[name] = renderers[name].getContext();
});
document.getElementById('layerToggle')?.addEventListener('click', () => {
    currentLayer = currentLayer === 'main' ? 'harmony' : 'main';
    const btn = document.getElementById('layerToggle');
    btn.textContent = currentLayer === 'main' ? 'Main' : 'Harmony';
    document.querySelectorAll('.harmonizeButton').forEach(btn => {
        btn.style.display = currentLayer === 'main' ? '' : 'none';
    });
    document.querySelectorAll(".staffSettings").forEach(settings => {
        const staffName = settings.dataset.staff;
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
        const target = document.getElementById(btn.dataset.target);
        target?.classList.remove('hidden');
        const dest = btn.dataset.target;
        if (dest === 'input-menu')
            setCurrentTab('create');
        else if (dest === 'edit-menu')
            setCurrentTab('edit');
        else if (dest === 'detail-menu')
            setCurrentTab('detail');
        else
            renderGridOverlays(Object.values(getActiveStaves()));
    });
});
// Voice Settings //////////////////////////////////////////////////////////////////////
const allPitches = (() => {
    const list = [];
    ["A", "Bb", "B"].forEach(noteName => list.push(noteName + "0"));
    for (let oct = 1; oct <= 7; oct++) {
        ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"].forEach(noteName => list.push(noteName + oct));
    }
    list.push("C8");
    return list;
})();
const pitchIndex = (pitch) => allPitches.indexOf(pitch);
const toPitchStr = (value) => Array.isArray(value) ? `${value[0]}${value[1]}` : value;
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
    allPitches.forEach((pitch, index) => {
        if (index <= maxIdx) {
            const opt = document.createElement("option");
            opt.value = pitch;
            opt.textContent = pitch;
            minSelect.appendChild(opt);
        }
    });
    if (selectedMin && pitchIndex(selectedMin) <= maxIdx)
        minSelect.value = selectedMin;
}
function populateMaxFor(minPitch, maxSelect, selectedMax) {
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
    if (selectedMax && pitchIndex(selectedMax) >= minIdx)
        maxSelect.value = selectedMax;
}
const rhythmOptions = [
    { id: 1, symbol: "𝅝" },
    { id: 0.5, symbol: "𝅗𝅥" },
    { id: 0.25, symbol: "𝅘𝅥" },
    { id: 0.125, symbol: "𝅘𝅥𝅮" },
    { id: 0.0625, symbol: "𝅘𝅥𝅯" },
    { id: 0.03125, symbol: "𝅘𝅥𝅰" },
];
function populateMinRhythm(maxId, selectEl, selectedId) {
    const maxIndex = rhythmOptions.findIndex(option => option.id === maxId);
    selectEl.innerHTML = "";
    rhythmOptions.forEach((opt, index) => {
        if (index >= maxIndex) {
            const option = document.createElement("option");
            option.value = String(opt.id);
            option.textContent = opt.symbol;
            if (opt.id === selectedId)
                option.selected = true;
            selectEl.appendChild(option);
        }
    });
}
function populateMaxRhythm(minId, selectEl, selectedId) {
    const minIndex = rhythmOptions.findIndex(option => option.id === minId);
    selectEl.innerHTML = "";
    rhythmOptions.forEach((opt, index) => {
        if (index <= minIndex) {
            const option = document.createElement("option");
            option.value = String(opt.id);
            option.textContent = opt.symbol;
            if (opt.id === selectedId)
                option.selected = true;
            selectEl.appendChild(option);
        }
    });
}
function populateStaffSettings(settings, staffName) {
    const staff = getActiveStaves()[staffName];
    const rootSelect = settings.querySelectorAll('.rootSelect')[0];
    const scaleSelect = settings.querySelector('.scaleSelect');
    const minSelect = settings.querySelector('.minPitch');
    const maxSelect = settings.querySelector('.maxPitch');
    const minRhythm = settings.querySelector('.minRhythm');
    const maxRhythm = settings.querySelector('.maxRhythm');
    const harmonizeButton = settings.querySelector('.harmonizeButton');
    const muteButton = settings.querySelector('.muteButton');
    populateScaleSelect(scaleSelect);
    if (staff.scale && staff.scale[1]) {
        scaleSelect.value = staff.scale[1];
    }
    else {
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
    if (harmonizeButton)
        harmonizeButton.classList.toggle('active', staff.harmonize);
    if (muteButton)
        muteButton.classList.toggle('active', staff.muted);
}
// Wire up one track's settings panel (called for each track, including ones added later)
function setupStaffSettings(settings) {
    const staffName = settings.dataset.staff;
    const muteButton = settings.querySelector('.muteButton');
    const rootSelect = settings.querySelectorAll('.rootSelect')[0];
    const scaleSelect = settings.querySelector('.scaleSelect');
    const minSelect = settings.querySelector('.minPitch');
    const maxSelect = settings.querySelector('.maxPitch');
    const minRhythm = settings.querySelector('.minRhythm');
    const maxRhythm = settings.querySelector('.maxRhythm');
    const harmonizeButton = settings.querySelector('.harmonizeButton');
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
}
document.querySelectorAll(".staffSettings").forEach(setupStaffSettings);
// Clicking the blank part of a track's settings selects (or deselects) the whole track
function setupSettingsBlank(blank) {
    blank.addEventListener('click', () => {
        const settings = blank.closest('.staffSettings');
        const staffName = settings.dataset.staff;
        const existing = getSelection(staffName);
        if (existing) {
            clearSelection(staffName);
        }
        else {
            const totalDur = totalLength();
            setSelection(staffName, { start: 0, end: totalDur });
        }
    });
}
document.querySelectorAll('.staffSettingsBlank').forEach(setupSettingsBlank);
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Tracks: add and delete (right-click a track's settings) and reorder (drag its settings up or down)
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
const TRACK_DRAG_START_PX = 6;
let lastTrackNumber = staves.length; // new tracks are numbered upward and never reuse a number
function nextTrackName() {
    lastTrackNumber += 1;
    return `staff${lastTrackNumber}`;
}
function trackWrapper(name) {
    return containers[name]?.closest('.staffWrapper');
}
function trackHasNotes(name) {
    return [mainStaves[name], harmonyStaves[name]].some(staff => staffVoices(staff).some(voice => voice.unprocessedNotes.some(note => !note.isRest)));
}
function removeTrack(name) {
    if (entryState.entry?.staffName === name)
        stopEntry();
    trackWrapper(name)?.remove();
    delete containers[name];
    delete renderers[name];
    delete contexts[name];
    delete mainStaves[name];
    delete harmonyStaves[name];
    delete gridLayout[name];
    delete trackClefs[name];
    delete trackKeys[name];
    delete clipboard[name];
    for (const layer of ['main', 'harmony']) {
        delete selections[layer][name];
        if (lastSelectedStaff[layer] === name)
            lastSelectedStaff[layer] = null;
    }
    staves.splice(staves.indexOf(name), 1);
}
function addTrack(name) {
    createStaffContainers([name]);
    renderers[name] = new Renderer(containers[name], Renderer.Backends.SVG);
    contexts[name] = renderers[name].getContext();
    mainStaves[name] = new Staff(name, [...defaultPitchRange(name)]);
    harmonyStaves[name] = new Staff(name, [...defaultPitchRange(name)], [0.25, 1]);
    staves.push(name);
    processNotes(mainStaves[name], fillDurationWithRests(totalLength()));
    processNotes(harmonyStaves[name], fillDurationWithRests(totalLength()));
    const settings = document.querySelector(`.staffSettings[data-staff="${name}"]`);
    setupStaffSettings(settings);
    setupSettingsBlank(settings.querySelector('.staffSettingsBlank'));
    setupTrackControls(settings);
    setupTrackGridInteraction(name);
    setupTrackEntryInteraction(name);
    settings.querySelectorAll('.harmonizeButton').forEach(button => {
        button.style.display = currentLayer === 'main' ? '' : 'none';
    });
}
// Make the tracks exactly these names, in this order (adding and removing as needed). Does not redraw.
function applyTrackOrder(names) {
    for (const name of [...staves])
        if (!names.includes(name))
            removeTrack(name);
    for (const name of names)
        if (!staves.includes(name))
            addTrack(name);
    staves.splice(0, staves.length, ...names);
    for (const name of names)
        output.appendChild(trackWrapper(name));
    for (const name of names)
        lastTrackNumber = Math.max(lastTrackNumber, parseInt(name.replace(/\D/g, ''), 10) || 0);
}
function changeTracks(names) {
    applyTrackOrder(names);
    renderGridOverlays(Object.values(getActiveStaves()));
    drawAllStaves();
    updateMemory();
}
function insertTrackNextTo(name, offset) {
    const names = [...staves];
    names.splice(names.indexOf(name) + offset, 0, nextTrackName());
    changeTracks(names);
}
function deleteTrack(name) {
    if (staves.length <= 1)
        return;
    if (trackHasNotes(name) && !confirm('Delete this track and its notes?'))
        return;
    changeTracks(staves.filter(other => other !== name));
}
let closeTrackMenu = null;
function openTrackMenu(event, name) {
    closeTrackMenu?.();
    const menu = document.createElement('div');
    menu.className = 'trackMenu';
    menu.style.cssText = `position: fixed; left: ${event.clientX}px; top: ${event.clientY}px; z-index: 10000;`;
    const items = [
        { label: 'Add track above', disabled: false, run: () => insertTrackNextTo(name, 0) },
        { label: 'Add track below', disabled: false, run: () => insertTrackNextTo(name, 1) },
        { label: 'Delete track', disabled: staves.length <= 1, run: () => deleteTrack(name) },
    ];
    for (const item of items) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'trackMenuItem';
        button.style.cssText = 'display: block; width: 100%;';
        button.textContent = item.label;
        button.disabled = item.disabled;
        button.addEventListener('click', () => { closeTrackMenu?.(); item.run(); });
        menu.appendChild(button);
    }
    document.body.appendChild(menu);
    const closeOnOutsideClick = (outsideEvent) => { if (!menu.contains(outsideEvent.target))
        closeTrackMenu?.(); };
    const closeOnEscape = (keyEvent) => { if (keyEvent.key === 'Escape')
        closeTrackMenu?.(); };
    closeTrackMenu = () => {
        menu.remove();
        document.removeEventListener('pointerdown', closeOnOutsideClick, true);
        document.removeEventListener('keydown', closeOnEscape);
        window.removeEventListener('scroll', closeOnOutsideClick, true);
        closeTrackMenu = null;
    };
    document.addEventListener('pointerdown', closeOnOutsideClick, true);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('scroll', closeOnOutsideClick, true);
}
// Drag a track's settings up or down; the track follows the pointer and the new order is kept on release
function startTrackDrag(settings, startEvent) {
    const name = settings.dataset.staff;
    const wrapper = trackWrapper(name);
    const startY = startEvent.clientY;
    let dragging = false;
    const onMove = (moveEvent) => {
        if (!dragging) {
            if (Math.abs(moveEvent.clientY - startY) < TRACK_DRAG_START_PX)
                return;
            dragging = true;
            wrapper.classList.add('trackDragging');
            document.body.style.userSelect = 'none';
        }
        const others = staves.filter(other => other !== name).map(other => trackWrapper(other));
        const next = others.find(other => {
            const box = other.getBoundingClientRect();
            return moveEvent.clientY < box.top + box.height / 2;
        });
        if (next && wrapper.nextElementSibling !== next)
            output.insertBefore(wrapper, next);
        else if (!next && output.lastElementChild !== wrapper)
            output.appendChild(wrapper);
    };
    const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        if (!dragging)
            return;
        wrapper.classList.remove('trackDragging');
        document.body.style.userSelect = '';
        // the drag ends in a click on the settings, which must not select the track
        const swallowClick = (clickEvent) => clickEvent.stopPropagation();
        document.addEventListener('click', swallowClick, true);
        window.setTimeout(() => document.removeEventListener('click', swallowClick, true), 50);
        const order = [...output.querySelectorAll('.staffContainer')].map(container => container.dataset.name);
        if (order.join() !== staves.join())
            changeTracks(order);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
}
function setupTrackControls(settings) {
    settings.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        openTrackMenu(event, settings.dataset.staff);
    });
    settings.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || event.target.closest('select, button, input'))
            return;
        startTrackDrag(settings, event);
    });
}
document.querySelectorAll('.staffSettings').forEach(settings => setupTrackControls(settings));
document.addEventListener('click', (event) => {
    const bar = document.getElementById('measureBar');
    if (bar && !bar.contains(event.target)) {
        selectedMeasureIndex = null;
        drawMeasureBar(getGlobalMeasureWidths(Object.values(getActiveStaves())));
    }
});
////////////////////////////////////////////////////////////////////////////////////
const transposeDropdown = document.getElementById("transposeDropdown");
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
    if (transposeDropdown.value === "")
        return;
    const interval = parseInt(transposeDropdown.value, 10);
    const active = getActiveStaves();
    let anyApplied = false;
    for (const name of staves) {
        if (applyToRange(active[name], (notes) => transposeNotes(notes, active[name], interval)))
            anyApplied = true;
    }
    if (anyApplied) {
        drawAllStaves();
        updateMemory();
    }
    transposeDropdown.style.display = "none";
});
transposeDropdown.addEventListener("blur", () => {
    transposeDropdown.style.display = "none";
});
const shiftSelect = document.querySelector("#shiftSelect");
shiftButton.addEventListener("click", (event) => {
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
document.addEventListener("click", (event) => {
    if (!shiftSelect.contains(event.target) && !shiftButton.contains(event.target)) {
        shiftSelect.style.display = "none";
    }
});
const reflectSelect = document.querySelector("#reflectSelect");
reflectButton.addEventListener("click", (event) => {
    event.stopPropagation();
    reflectSelect.style.display = reflectSelect.style.display === "block" ? "none" : "block";
});
reflectSelect.addEventListener("click", () => {
    const axisPitch = reflectSelect.value;
    const active = getActiveStaves();
    let anyApplied = false;
    for (const name of staves) {
        if (applyToRange(active[name], (notes) => reflectNotes(notes, active[name], axisPitch)))
            anyApplied = true;
    }
    if (anyApplied) {
        drawAllStaves();
        updateMemory();
    }
    reflectSelect.style.display = "none";
});
document.addEventListener("click", (event) => {
    if (!reflectButton.contains(event.target) && !reflectSelect.contains(event.target)) {
        reflectSelect.style.display = "none";
    }
});
function bindStaffAction(button, transform) {
    if (!button)
        return;
    button.addEventListener("click", () => {
        const active = getActiveStaves();
        let anyApplied = false;
        for (const name of staves) {
            if (applyToRange(active[name], transform))
                anyApplied = true;
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
        if (generateIntoSelection(active[name]))
            anyApplied = true;
    }
    if (anyApplied) {
        drawAllStaves();
        updateMemory();
    }
});
separateStaffButton?.addEventListener("click", () => {
    if (!gridViewOn)
        return;
    if (separateStaff()) {
        drawAllStaves();
        updateMemory();
    }
});
bindStaffAction(reverseButton, reverseNotes);
changeRhythmButton?.addEventListener("click", () => {
    applyPerStaffTransform((staff, notes, startOffset) => changeRhythmNotes(notes, staff, startOffset));
});
bindStaffAction(shuffleRhythmButton, shuffleRhythmNotes);
bindStaffAction(shuffleNotesButton, shuffleNotesNotes);
bindStaffAction(shufflePitchButton, shufflePitchNotes);
changePitchButton?.addEventListener("click", () => {
    applyPerStaffTransform((staff, notes, startOffset) => changePitchNotes(notes, staff, startOffset));
});
complicateButton?.addEventListener("click", () => {
    applyPerStaffTransform((staff, notes, startOffset) => complicateNotes(notes, staff, startOffset));
});
bindStaffAction(simplifyButton, simplifyNotes);
// Select buttons now appear in both the Create and Edit tabs — bind every instance found,
// not just the first (a plain querySelector would silently miss the second one).
document.querySelectorAll('.previousButton').forEach(btn => {
    btn.addEventListener('click', () => accessMemory(-1));
});
document.querySelectorAll('.nextButton').forEach(btn => {
    btn.addEventListener('click', () => accessMemory(1));
});
document.addEventListener('keydown', (event) => {
    const target = event.target;
    const isTextEntry = (target.tagName === 'INPUT' && target.type !== 'range') ||
        target.tagName === 'SELECT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;
    if (isTextEntry)
        return;
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
document.addEventListener('keydown', (event) => {
    const targetElement = event.target;
    const typing = (targetElement.tagName === 'INPUT' && targetElement.type !== 'range') ||
        targetElement.tagName === 'SELECT' || targetElement.tagName === 'TEXTAREA' || targetElement.isContentEditable;
    if (typing)
        return;
    if ((event.key === 'g' || event.key === 'G') && !event.ctrlKey && !event.metaKey)
        setGridView(!gridViewOn);
});
document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape')
        return;
    const targetElement = event.target;
    const typing = (targetElement.tagName === 'INPUT' && targetElement.type !== 'range') ||
        targetElement.tagName === 'SELECT' || targetElement.tagName === 'TEXTAREA' || targetElement.isContentEditable;
    if (typing)
        return;
    // Esc clears the selection; with nothing selected it selects every track from start to end
    if (currentTab !== 'create' || staves.some(staffName => getSelection(staffName))) {
        for (const staffName of staves)
            clearSelection(staffName);
    }
    else {
        const whole = {};
        for (const staffName of staves)
            whole[staffName] = { start: 0, end: totalLength(), voice: 'all', base: { start: 0, end: totalLength() } };
        setSelectionsBulk(whole, staves[0]);
    }
});
document.addEventListener('keydown', (event) => {
    const targetElement = event.target;
    const typing = targetElement.tagName === 'INPUT' || targetElement.tagName === 'SELECT' ||
        targetElement.tagName === 'TEXTAREA' || targetElement.isContentEditable;
    if (typing || entryState.entry)
        return;
    if (handleArrowKey(event))
        event.preventDefault();
});
gridSlider?.addEventListener('input', () => {
    const index = parseInt(gridSlider.value, 10);
    gridDivision = GRID_DIVISIONS[index];
    gridSliderValue.textContent = GRID_LABELS[index];
    drawAllStaves();
});
gridSlider?.addEventListener('change', () => gridSlider.blur()); // keeps Space/Ctrl shortcuts working
setGridView(true);
document.querySelectorAll('.modeButton').forEach(btn => {
    btn.addEventListener('click', () => {
        const mode = btn.dataset.mode; // 'insert' | 'overwrite' | 'polyphony'
        insertMode = mode === 'insert';
        polyphonyMode = mode === 'polyphony';
        document.querySelectorAll('.modeButton')
            .forEach(button => button.classList.toggle('active', button === btn));
        btn.blur(); // so Space still triggers Play
        scheduleEditRefresh();
    });
});
const isVisibleTab = (id) => !document.getElementById(id)?.classList.contains('hidden');
document.addEventListener('keydown', (event) => {
    if (!gridViewOn)
        return;
    if (event.key !== 'Delete' && event.key !== 'Backspace')
        return;
    const targetElement = event.target;
    const typing = (targetElement.tagName === 'INPUT' && targetElement.type !== 'range') ||
        targetElement.tagName === 'SELECT' || targetElement.tagName === 'TEXTAREA' || targetElement.isContentEditable;
    if (typing)
        return;
    if (currentTab === 'edit' && isVisibleTab('edit-menu')) {
        event.preventDefault();
        deleteAtSelection();
    }
    else if (currentTab === 'create' && isVisibleTab('input-menu')) {
        event.preventDefault();
        deleteNotesInRanges();
    }
});
buildEditMenu();
scheduleEditRefresh();
buildDetailMenu();
scheduleDetailRefresh();
setupEntryInteraction();
setupClipboardKeys();
ignoreBlankClicksWhileWriting();
setupScaleWidget();
