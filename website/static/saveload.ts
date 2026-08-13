/// <reference path="declarations.d.ts" />

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

function getCompositionData(): object {
  const voiceData: Record<string, object> = {};

  for (const voiceName of [...voices, 'harmonyVoice']) {
    const voice = voicesMap[voiceName];
    voiceData[voiceName] = {
      pitchRange: voice.pitchRange,
      rhythmRange: voice.rhythmRange,
      scale: voice.scale,
      notes: voice.unprocessedNotes.map(note => ({
        noteName:  note.noteName,
        octave:    note.octave,
        duration:  note.duration,
        dotted:    note.dotted,
        tupletInfo: note.tupletInfo,
      })),
    };
  }

  return { timeSignature, numMeasures, mode, voices: voiceData };
}

function loadCompositionData(data: any): void {
  timeSignature = data.timeSignature;
  numMeasures   = data.numMeasures;
  mode          = data.mode;
  measureLength = timeSignature[0] / timeSignature[1];

  modeSelect.value        = mode;

  for (const voiceName of [...voices, 'harmonyVoice']) {
    const voice = voicesMap[voiceName];
    const saved = data.voices[voiceName];
    if (!saved) continue;

    voice.pitchRange  = saved.pitchRange;
    voice.rhythmRange = saved.rhythmRange;
    voice.scale       = saved.scale;

    resetPart(voice);

    const notes = saved.notes.map((n: any) => {
      const note = new UnprocessedNote(n.noteName, n.octave, n.duration, n.dotted, n.tiedToNext ?? false);
      if (n.tupletInfo) note.tupletInfo = { ...n.tupletInfo };
      return note;
    });

    processNotes(voice, notes);
    drawAllVoices();
  }
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
        compositionList.querySelectorAll('div').forEach(r => {
          (r as HTMLElement).style.backgroundColor = '';
        });
        row.style.backgroundColor = '#d3d3d3';
      });

      compositionList.appendChild(row);
    }
  } catch (e) {
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
  } catch (e) {
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
  } catch (e) {
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
      } catch (e) {
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
    const existingTitles: string[] = existing.map((c: any) => c.title);

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
  } catch (e) {
    showSaveError('Network error. Could not save composition.');
  }
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// New Composition Button
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

newCompositionButton?.addEventListener('click', () => {
  if (!confirm('Start a new composition? Unsaved changes will be lost.')) return;

  numMeasures = 1;

  for (const voiceName of [...voices, 'harmonyVoice']) {
    resetPart(voicesMap[voiceName]);
  }

  for (const voiceName of voices) {
    const voice = voicesMap[voiceName];
    const restNotes: UnprocessedNote[] = [];
    const durationsLargestFirst = Object.entries(durationMapping).sort((a, b) => b[1] - a[1]);
    let remaining = numMeasures * measureLength;
    while (remaining > 1e-9) {
      for (const [durStr, durVal] of durationsLargestFirst) {
        if (durVal <= remaining + 1e-9) {
          restNotes.push(new UnprocessedNote(["Rest"], 4, durStr, false));
          remaining = round(remaining - durVal);
          break;
        }
      }
    }
    processNotes(voice, restNotes);
  }

  drawAllVoices();

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
  } catch (e) {
    console.warn('Failed to autosave:', e);
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
  } catch (e) {
    console.warn('Failed to load autosave:', e);
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