////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Audio: playback
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

function setupPlayButton(button: HTMLButtonElement | null, getParts: () => Staff[]): void {
  if (!button) return;
  button.addEventListener("click", () => {
    if (isPlaying) {
      stopPlayback(button);
      return;
    }
    setupSampler().then(() => playAllStaves(getParts(), button));
  });
}

let isPlaying = false;
let playStartMeasure = 0;
let stopTimeoutId: number | null = null;

async function playAllStaves(staffList: Staff[], button: HTMLButtonElement): Promise<void> {
  await Tone.start();

  Tone.Transport.stop();
  Tone.Transport.cancel();
  Tone.Transport.position = 0;

  const bpm = parseFloat(bpmSlider.value) || 120;
  const secondsPerWhole = (60 / bpm) * 4;
  const startT = measureStartOf(playStartMeasure);
  let endT = startT;

  staffList.forEach(staff => {
    if (staff.muted) return;

    staffVoices(staff).forEach(voice => {
      let elapsed = 0;   // whole notes from the start of the piece

      voice.toneNotes.forEach(([pitch, duration]) => {
        const noteStart = elapsed;
        const noteEnd = round(elapsed + duration);
        elapsed = noteEnd;
        if (noteEnd > endT) endT = noteEnd;
        if (noteEnd <= startT + 1e-9 || pitch == null) return;   // before the start, or a rest

        // A note already sounding at the start plays its remaining length
        const from = Math.max(noteStart, startT);
        const when = (from - startT) * secondsPerWhole;
        const dur = (noteEnd - from) * secondsPerWhole;
        Tone.Transport.schedule((time: number) => {
          for (const pitchName of pitch) sampler!.triggerAttackRelease(pitchName, dur, time);
        }, when);
      });
    });
  });

  if (endT - startT < 1e-9) return;   // nothing to play from here

  isPlaying = true;
  button.classList.add("active");
  Tone.Transport.start();

  stopTimeoutId = window.setTimeout(
    () => stopPlayback(button),
    (endT - startT) * secondsPerWhole * 1000 + 250
  );
}

function stopPlayback(button: HTMLButtonElement | null): void {
  Tone.Transport.stop();
  Tone.Transport.cancel();
  if (sampler) sampler.releaseAll();
  if (stopTimeoutId !== null) {
    clearTimeout(stopTimeoutId);
    stopTimeoutId = null;
  }
  isPlaying = false;
  if (button) button.classList.remove("active");
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
