
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Save/Load State
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

let currentSlug: string | null = null;
let currentTitle: string | null = null;

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Element References
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

const saveButton           = document.querySelector('.saveButton')           as HTMLButtonElement;
const newCompositionButton = document.querySelector('.newCompositionButton') as HTMLButtonElement;
const compositionList      = document.getElementById('compositionList')      as HTMLElement;
const currentCompositionTitle = document.getElementById('currentCompositionTitle') as HTMLElement;
const projectTitleBtn = document.getElementById('projectTitleBtn') as HTMLButtonElement;
const createTabBtn = document.getElementById('createTabBtn') as HTMLButtonElement;
const editTabBtn   = document.getElementById('editTabBtn')   as HTMLButtonElement;
const loadTabBtn   = document.getElementById('loadTabBtn')   as HTMLButtonElement;
const exportTabBtn = document.getElementById('exportTabBtn') as HTMLButtonElement;
let previousTabId: string = 'input-menu';

projectTitleBtn?.addEventListener('click', () => {
  const loadMenu = document.getElementById('load-menu') as HTMLElement;
  const exportMenu = document.getElementById('export-menu') as HTMLElement;
  const isLoadAreaOpen = !loadTabBtn.classList.contains('hidden');

  if (isLoadAreaOpen) {
    // Switch back to Create/Edit
    loadTabBtn.classList.add('hidden');
    exportTabBtn.classList.add('hidden');
    loadTabBtn.classList.remove('active');
    exportTabBtn.classList.remove('active');
    createTabBtn.classList.remove('hidden');
    editTabBtn.classList.remove('hidden');
    loadMenu.classList.add('hidden');
    exportMenu.classList.add('hidden');
    projectTitleBtn.classList.remove('active');

    const prevBtn = document.querySelector(`.tab-btn[data-target="${previousTabId}"]`) as HTMLButtonElement;
    prevBtn?.classList.add('active');
    document.getElementById(previousTabId)?.classList.remove('hidden');

  } else {
    // Remember which tab was active, then switch to Load/Export
    const activeBtn = document.querySelector('.tab-btn.active') as HTMLButtonElement;
    previousTabId = activeBtn?.dataset.target ?? 'input-menu';

    document.querySelectorAll('.tab-btn').forEach(button => button.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.add('hidden'));

    createTabBtn.classList.add('hidden');
    editTabBtn.classList.add('hidden');
    loadTabBtn.classList.remove('hidden');
    exportTabBtn.classList.remove('hidden');
    loadTabBtn.classList.add('active');

    loadMenu.classList.remove('hidden');
    projectTitleBtn.classList.add('active');
    loadCompositionList();
  }
});

const exportMidiButton     = document.querySelector('.exportMidiButton')     as HTMLButtonElement;
const exportMusicXMLButton = document.querySelector('.exportMusicXMLButton') as HTMLButtonElement;

exportMidiButton?.addEventListener('click', () => exportLayerToMidi());
exportMusicXMLButton?.addEventListener('click', () => exportLayerToMusicXML());

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Helpers
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

function showSaveError(message: string): void {
  const existing = document.getElementById('saveErrorMsg');
  if (existing) existing.remove();

  const msg = document.createElement('p');
  msg.id = 'saveErrorMsg';
  msg.textContent = message;
  msg.style.cssText = 'color: red; font-size: 12px; padding: 4px 0; margin: 0;';
  compositionList.insertAdjacentElement('beforebegin', msg);

  setTimeout(() => msg.remove(), 4000);
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Serialize / Deserialize
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// Saves made before the staff rename used the keys upperVoice ... voice4
function migrateLegacyStaffKeys(data: any): any {
  const legacy: Record<string, string> = { upperVoice: 'staff1', middleVoice: 'staff2', lowerVoice: 'staff3', voice4: 'staff4' };
  const rename = (obj: any) => {
    if (!obj) return obj;
    const out: any = {};
    for (const key of Object.keys(obj)) out[legacy[key] ?? key] = obj[key];
    return out;
  };
  return { ...data, main: rename(data.main), harmony: rename(data.harmony) };
}

function serializeNotes(notes: UnprocessedNote[]): object[] {
  return notes.map(note => ({
    noteName: note.noteName,
    octave: note.octave,
    octaves: note.octaves,
    duration: note.duration,
    dotted: note.dotted,
    tupletInfo: note.tupletInfo,
    tiedToNext: note.tiedToNext,
  }));
}

function savedNotesToUnprocessed(saved: any[]): UnprocessedNote[] {
  return (saved ?? []).map((savedNote: any) => {
    const note = new UnprocessedNote(savedNote.noteName, savedNote.octaves ?? savedNote.octave, savedNote.duration, savedNote.dotted, savedNote.tiedToNext ?? false);
    if (savedNote.tupletInfo) note.tupletInfo = { ...savedNote.tupletInfo };
    return note;
  });
}

// "notes" is Up 1, so older versions of the app still open new saves; the other voices are in "extraVoices"
function serializeStaff(staff: Staff): object {
  return {
    pitchRange: staff.pitchRange,
    rhythmRange: staff.rhythmRange,
    scale: staff.scale,
    harmonize: staff.harmonize,
    muted: staff.muted,
    notes: serializeNotes(staff.unprocessedNotes),
    extraVoices: staff.extraVoices.map(voice => ({ id: voice.id, notes: serializeNotes(voice.unprocessedNotes) })),
  };
}

function restoreStaff(staff: Staff, saved: any): void {
  if (!saved) return;

  staff.pitchRange  = saved.pitchRange;
  staff.rhythmRange = saved.rhythmRange;
  staff.scale       = saved.scale;
  staff.harmonize   = saved.harmonize ?? staff.harmonize;
  staff.muted       = saved.muted ?? false;

  staff.extraVoices = [];
  resetStaff(staff);
  processNotes(staff, savedNotesToUnprocessed(saved.notes));

  for (const extra of saved.extraVoices ?? []) {
    if (extra.id === 'up1' || !VOICE_DEFS.some(voiceDef => voiceDef.id === extra.id)) continue;
    const voice = getOrCreateVoice(staff, extra.id);
    resetVoice(voice);
    processNotes(voice, savedNotesToUnprocessed(extra.notes));
  }
}

function getCompositionData(): object {
  const mainData: Record<string, object> = {};
  const harmonyData: Record<string, object> = {};

  for (const staffName of staves) {
    mainData[staffName]    = serializeStaff(mainStaves[staffName]);
    harmonyData[staffName] = serializeStaff(harmonyStaves[staffName]);
  }

  return { timeSignature: [measureSigs[0].num, measureSigs[0].den], measureSigs: sigsForSave(), numMeasures, main: mainData, harmony: harmonyData };
}

function loadCompositionData(data: any): void {
    data = migrateLegacyStaffKeys(data);
  numMeasures   = data.numMeasures;
  measureSigs   = sigsFromData(data);

  for (const staffName of staves) {
    restoreStaff(mainStaves[staffName], data.main[staffName]);
    restoreStaff(harmonyStaves[staffName], data.harmony[staffName]);
  }

  // Sync the settings panel UI (scale, pitch/rhythm range, harmonize toggle, mute)
  // to match whichever layer's voices were just restored.
  document.querySelectorAll(".staffSettings").forEach(settings => {
    const staffName = (settings as HTMLElement).dataset.staff!;
    populateStaffSettings(settings, staffName);
  });

  for (const layer of ['main', 'harmony'] as const) {
    selections[layer] = {};
    lastSelectedStaff[layer] = null;
  }
  drawAllStaves();
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Composition List
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

async function loadCompositionList(): Promise<void> {
  try {
    const res = await fetch('/api/compositions');
    if (!res.ok) {
      compositionList.innerHTML = '<p style="padding: 8px; font-size: 12px; color: red;">Failed to load compositions.</p>';
      return;
    }

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

      if (comp.slug === currentSlug) {
        row.style.backgroundColor = '#d3d3d3';
      }

      row.addEventListener('click', () => {
        saveToLocalStorage();
        loadComposition(comp.slug, comp.title);
        compositionList.querySelectorAll('div').forEach(row => {
          (row as HTMLElement).style.backgroundColor = '';
        });
        row.style.backgroundColor = '#d3d3d3';
      });

      compositionList.appendChild(row);
    }
  } catch (error) {
    compositionList.innerHTML = '<p style="padding: 8px; font-size: 12px; color: red;">Network error. Could not load compositions.</p>';
  }
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Load a Composition
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

async function loadComposition(slug: string, title: string): Promise<void> {
  try {
    const res = await fetch(`/api/compositions/${slug}`);
    if (!res.ok) {
      if (res.status === 404) {
        showSaveError('Composition not found.');
        localStorage.removeItem('composerCurrentSlug');
        localStorage.removeItem('composerCurrentTitle');
      } else if (res.status === 403) {
        showSaveError('This composition is private.');
      } else {
        showSaveError('Failed to load composition. Please try again.');
      }
      return;
    }

    const data = await res.json();
    if (!data.success) {
      showSaveError(data.message || 'Failed to load composition.');
      return;
    }

    loadCompositionData(data.data);
    currentSlug  = slug;
    currentTitle = title || data.title;
    currentCompositionTitle.textContent = currentTitle;
    history.pushState({}, '', `/compositions/${slug}`);
    saveToLocalStorage();
  } catch (error) {
    showSaveError('Network error. Could not load composition.');
  }
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Delete a Composition (button handler)
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

const deleteCompositionButton = document.querySelector('.deleteCompositionButton') as HTMLButtonElement;

deleteCompositionButton?.addEventListener('click', async () => {
  if (!currentSlug) {
    alert('No project selected.');
    return;
  }
  if (!confirm(`Delete "${currentTitle}"? This cannot be undone.`)) return;

  try {
    const res = await fetch(`/api/compositions/${currentSlug}`, { method: 'DELETE' });
    if (!res.ok) {
      showSaveError('Failed to delete composition. Please try again.');
      return;
    }

    currentSlug  = null;
    currentTitle = null;
    currentCompositionTitle.textContent = 'Untitled';
    history.pushState({}, '', '/composer');
    localStorage.removeItem('composerCurrentSlug');
    localStorage.removeItem('composerCurrentTitle');
    loadCompositionList();
  } catch (error) {
    showSaveError('Network error. Could not delete composition.');
  }
});

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Save Button
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

saveButton?.addEventListener('click', async () => {
  if (!isLoggedIn) {
    const authModal = document.getElementById('authModal') as HTMLElement;
    authModal.classList.remove('hidden');
    return;
  }

  if (currentSlug) {
    const overwrite = confirm(`Overwrite "${currentTitle}"?\n\nOK to overwrite — Cancel to save as new.`);
    if (overwrite) {
      try {
        const res = await fetch(`/api/compositions/${currentSlug}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: getCompositionData() }),
        });
        if (!res.ok) {
          showSaveError('Failed to save. Please try again.');
          return;
        }
      } catch (error) {
        showSaveError('Network error. Could not save composition.');
        return;
      }
    } else {
      await saveAsNew();
    }
  } else {
    await saveAsNew();
  }

  loadCompositionList();
});

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Save as New
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

async function saveAsNew(): Promise<void> {
  try {
    const listRes = await fetch('/api/compositions');
    const existing = listRes.ok ? await listRes.json() : [];
    const existingTitles: string[] = existing.map((cell: any) => cell.title);

    const baseName = currentTitle || 'Project';
    let newTitle = baseName;

    if (existingTitles.includes(newTitle)) {
      let num = 2;
      while (existingTitles.includes(`${baseName} (${num})`)) num++;
      newTitle = `${baseName} (${num})`;
    }

    const title = prompt('Save as:', newTitle);
    if (!title) return;

    const isPublic = confirm('Make this composition public?\n\nOK = public   Cancel = private');

    const saveRes = await fetch('/api/compositions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, is_public: isPublic, data: getCompositionData() }),
    });

    if (!saveRes.ok) {
      showSaveError('Failed to save. Please try again.');
      return;
    }

    const data = await saveRes.json();
    if (data.success) {
      currentSlug  = data.slug;
      currentTitle = title;
      currentCompositionTitle.textContent = title;
      history.pushState({}, '', `/compositions/${data.slug}`);
      saveToLocalStorage();
    } else {
      showSaveError(data.message || 'Failed to save composition.');
    }
  } catch (error) {
    showSaveError('Network error. Could not save composition.');
  }
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// New Composition Button
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

newCompositionButton?.addEventListener('click', () => {
  if (!confirm('Start a new composition? Unsaved changes will be lost.')) return;

  numMeasures = 1;
  measureSigs = [makeSig(4, 4)];

  for (const staffName of staves) {
    resetStaffToDefaults(mainStaves[staffName], [0.03125, 1]);
    resetStaffToDefaults(harmonyStaves[staffName], [0.25, 1]);
  }

  for (const staffName of staves) {
    processNotes(mainStaves[staffName], fillDurationWithRests(totalLength()));
    processNotes(harmonyStaves[staffName], fillDurationWithRests(totalLength()));
  }

  // Selection reset (replaces the old per-tab block)
  for (const layer of ['main', 'harmony'] as const) {
    selections[layer] = {};
    lastSelectedStaff[layer] = null;
  }
  const fullLength = totalLength();
  selections.main['staff1'] = { start: 0, end: fullLength };
  selections.harmony['staff1'] = { start: 0, end: fullLength };
  lastSelectedStaff.main = 'staff1';
  lastSelectedStaff.harmony = 'staff1';

  document.querySelectorAll(".staffSettings").forEach(settings => {
    const staffName = (settings as HTMLElement).dataset.staff!;
    populateStaffSettings(settings, staffName);
  });

  drawAllStaves();

  currentSlug  = null;
  currentTitle = null;
  currentCompositionTitle.textContent = 'Untitled';
  history.pushState({}, '', '/composer');
  saveToLocalStorage();
});

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Autosave to localStorage
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

function saveToLocalStorage(): void {
  try {
    localStorage.setItem('composerAutosave', JSON.stringify(getCompositionData()));
    if (currentSlug)  localStorage.setItem('composerCurrentSlug',  currentSlug);
    if (currentTitle) localStorage.setItem('composerCurrentTitle', currentTitle);
  } catch (error) {
    console.warn('Failed to autosave:', error);
  }
}

function loadFromLocalStorage(): void {
  const saved = localStorage.getItem('composerAutosave');
  if (!saved) return;

  try {
    loadCompositionData(JSON.parse(saved));
    const slug  = localStorage.getItem('composerCurrentSlug');
    const title = localStorage.getItem('composerCurrentTitle');
    if (slug && title) {
      currentSlug  = slug;
      currentTitle = title;
      currentCompositionTitle.textContent = title;
    }
  } catch (error) {
    console.warn('Failed to load autosave:', error);
    localStorage.removeItem('composerAutosave');
    localStorage.removeItem('composerCurrentSlug');
    localStorage.removeItem('composerCurrentTitle');
  }
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Startup
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

loadFromLocalStorage();

const urlSlug = window.location.pathname.match(/\/compositions\/([^/]+)/)?.[1];
if (urlSlug) {
  loadComposition(urlSlug, '');
}
