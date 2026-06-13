"use strict";
/// <reference path="declarations.d.ts" />
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Save/Load State
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
let currentSlug = null;
let currentTitle = null;
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Element References
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
const saveButton = document.querySelector('.saveButton');
const newCompositionButton = document.querySelector('.newCompositionButton');
const compositionList = document.getElementById('compositionList');
const currentCompositionTitle = document.getElementById('currentCompositionTitle');
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Serialize / Deserialize
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
function getCompositionData() {
    const voiceData = {};
    for (const voiceName of [...voices, 'harmonyVoice']) {
        const voice = voicesMap[voiceName];
        voiceData[voiceName] = {
            pitchRange: voice.pitchRange,
            rhythmRange: voice.rhythmRange,
            scale: voice.scale,
            notes: voice.unprocessedNotes.map(note => ({
                noteName: note.noteName,
                octave: note.octave,
                duration: note.duration,
                dotted: note.dotted,
                tupletInfo: note.tupletInfo,
            })),
        };
    }
    return { timeSignature, numMeasures, mode, voices: voiceData };
}
function loadCompositionData(data) {
    timeSignature = data.timeSignature;
    numMeasures = data.numMeasures;
    mode = data.mode;
    measureLength = timeSignature[0] / timeSignature[1];
    // Sync UI dropdowns to loaded values
    topSelect.value = String(timeSignature[0]);
    bottomSelect.value = String(timeSignature[1]);
    numMeasuresSelect.value = String(numMeasures);
    modeSelect.value = mode;
    for (const voiceName of [...voices, 'harmonyVoice']) {
        const voice = voicesMap[voiceName];
        const saved = data.voices[voiceName];
        if (!saved)
            continue;
        voice.pitchRange = saved.pitchRange;
        voice.rhythmRange = saved.rhythmRange;
        voice.scale = saved.scale;
        resetPart(voice);
        const notes = saved.notes.map((n) => {
            const note = new UnprocessedNote(n.noteName, n.octave, n.duration, n.dotted);
            if (n.tupletInfo)
                note.tupletInfo = { ...n.tupletInfo };
            return note;
        });
        processNotes(voice, notes, voiceName === 'harmonyVoice');
    }
}
async function loadCompositionList() {
    const res = await fetch('/api/compositions');
    const compositions = await res.json();
    compositionList.innerHTML = '';
    if (!compositions.length) {
        compositionList.innerHTML = '<p style="padding: 8px; font-size: 12px; color: #888;">No saved compositions</p>';
        return;
    }
    for (const comp of compositions) {
        const row = document.createElement('div');
        row.style.cssText = 'padding: 6px 8px; cursor: pointer; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
        row.textContent = (comp.is_public ? '🌐 ' : '🔒 ') + comp.title;
        row.title = comp.title;
        row.dataset.slug = comp.slug;
        // Highlight if currently selected
        if (comp.slug === currentSlug) {
            row.style.backgroundColor = '#d3d3d3';
        }
        row.addEventListener('click', () => {
            // Autosave current before switching
            saveToLocalStorage();
            loadComposition(comp.slug, comp.title);
            // Highlight selected row
            compositionList.querySelectorAll('div').forEach(r => {
                r.style.backgroundColor = '';
            });
            row.style.backgroundColor = '#d3d3d3';
        });
        compositionList.appendChild(row);
    }
}
// Delete current project
const deleteCompositionButton = document.querySelector('.deleteCompositionButton');
deleteCompositionButton?.addEventListener('click', async () => {
    if (!currentSlug) {
        alert('No project selected.');
        return;
    }
    if (!confirm(`Delete "${currentTitle}"? This cannot be undone.`))
        return;
    await fetch(`/api/compositions/${currentSlug}`, { method: 'DELETE' });
    currentSlug = null;
    currentTitle = null;
    currentCompositionTitle.textContent = 'Untitled';
    history.pushState({}, '', '/composer');
    localStorage.removeItem('composerCurrentSlug');
    localStorage.removeItem('composerCurrentTitle');
    loadCompositionList();
});
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Load a Composition
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
async function loadComposition(slug, title) {
    const res = await fetch(`/api/compositions/${slug}`);
    const data = await res.json();
    if (!data.success)
        return;
    loadCompositionData(data.data);
    currentSlug = slug;
    currentTitle = title || data.title;
    currentCompositionTitle.textContent = currentTitle;
    history.pushState({}, '', `/compositions/${slug}`);
    saveToLocalStorage();
}
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Delete a Composition
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
async function deleteComposition(slug) {
    if (!confirm('Delete this composition?'))
        return;
    await fetch(`/api/compositions/${slug}`, { method: 'DELETE' });
    if (currentSlug === slug) {
        currentSlug = null;
        currentTitle = null;
        currentCompositionTitle.textContent = 'Untitled';
        history.pushState({}, '', '/composer');
    }
    loadCompositionList();
}
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Save Button
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
saveButton?.addEventListener('click', async () => {
    if (!isLoggedIn) {
        // Prompt login if not authenticated
        const authModal = document.getElementById('authModal');
        authModal.classList.remove('hidden');
        return;
    }
    if (currentSlug) {
        // Named composition — ask overwrite or save as new
        const overwrite = confirm(`Overwrite "${currentTitle}"?\n\nOK to overwrite — Cancel to save as new.`);
        if (overwrite) {
            await fetch(`/api/compositions/${currentSlug}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data: getCompositionData() }),
            });
        }
        else {
            await saveAsNew();
        }
    }
    else {
        await saveAsNew();
    }
    loadCompositionList();
});
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Save as New
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
async function saveAsNew() {
    // Build a default title that doesn't collide with existing ones
    const listRes = await fetch('/api/compositions');
    const existing = await listRes.json();
    const existingTitles = existing.map((c) => c.title);
    const baseName = currentTitle || 'Project';
    let newTitle = baseName;
    if (existingTitles.includes(newTitle)) {
        let num = 2;
        while (existingTitles.includes(`${baseName} (${num})`))
            num++;
        newTitle = `${baseName} (${num})`;
    }
    const title = prompt('Save as:', newTitle);
    if (!title)
        return;
    const isPublic = confirm('Make this composition public?\n\nOK = public   Cancel = private');
    const saveRes = await fetch('/api/compositions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, is_public: isPublic, data: getCompositionData() }),
    });
    const data = await saveRes.json();
    if (data.success) {
        currentSlug = data.slug;
        currentTitle = title;
        currentCompositionTitle.textContent = title;
        history.pushState({}, '', `/compositions/${data.slug}`);
        saveToLocalStorage();
    }
}
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// New Composition Button
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
newCompositionButton?.addEventListener('click', () => {
    if (!confirm('Start a new composition? Unsaved changes will be lost.'))
        return;
    for (const voiceName of [...voices, 'harmonyVoice']) {
        resetPart(voicesMap[voiceName]);
    }
    drawAllVoices();
    currentSlug = null;
    currentTitle = null;
    currentCompositionTitle.textContent = 'Untitled';
    history.pushState({}, '', '/composer');
    saveToLocalStorage();
});
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Autosave to localStorage
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
function saveToLocalStorage() {
    localStorage.setItem('composerAutosave', JSON.stringify(getCompositionData()));
    if (currentSlug)
        localStorage.setItem('composerCurrentSlug', currentSlug);
    if (currentTitle)
        localStorage.setItem('composerCurrentTitle', currentTitle);
}
function loadFromLocalStorage() {
    const saved = localStorage.getItem('composerAutosave');
    if (!saved)
        return;
    try {
        loadCompositionData(JSON.parse(saved));
        const slug = localStorage.getItem('composerCurrentSlug');
        const title = localStorage.getItem('composerCurrentTitle');
        if (slug && title) {
            currentSlug = slug;
            currentTitle = title;
            currentCompositionTitle.textContent = title;
        }
    }
    catch (e) {
        console.warn('Failed to load autosave:', e);
    }
}
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Startup
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Restore last session from localStorage immediately
loadFromLocalStorage();
// If the URL contains a composition slug, load it from the server
const urlSlug = window.location.pathname.match(/\/compositions\/([^/]+)/)?.[1];
if (urlSlug) {
    loadComposition(urlSlug, '');
}
