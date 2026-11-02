"use strict";
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Audio: playback
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
function setupPlayButton(button, getParts) {
    if (!button)
        return;
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
let stopTimeoutId = null;
// Everything a voice sounds, in whole notes from the start of the piece: ties joined, grace notes placed, and a
// glissando played as the first pitch held and then the semitones up to the next note
function soundingEvents(staff, voice) {
    let elapsed = 0;
    const entries = voice.toneNotes.map(([pitch, duration]) => {
        const noteStart = elapsed;
        elapsed = round(elapsed + duration);
        return { pitch, noteStart, noteEnd: elapsed, glideTo: null };
    });
    // a glissando runs from the note sounding at its start to the note that follows it
    for (const mark of staff.glissandos.filter(candidate => candidate.voice === voice.id)) {
        let from = -1;
        entries.forEach((entry, index) => { if (entry.pitch && entry.noteStart >= mark.start - 1e-6 && entry.noteStart < mark.end - 1e-6)
            from = index; });
        const to = entries.findIndex((entry, index) => index > from && from >= 0 && entry.pitch && entry.noteStart >= mark.end - 0.07);
        if (from >= 0 && to >= 0)
            entries[from].glideTo = entries[to].pitch[0];
    }
    const events = [];
    for (const { pitch, noteStart, noteEnd, glideTo } of entries) {
        if (pitch == null)
            continue;
        const startMidi = Math.round(Tone.Frequency(pitch[0]).toMidi());
        const targetMidi = glideTo ? Math.round(Tone.Frequency(glideTo).toMidi()) : startMidi;
        const direction = targetMidi > startMidi ? 1 : -1;
        const stepCount = glideTo ? Math.abs(targetMidi - startMidi) - 1 : 0;
        if (stepCount < 1) {
            events.push({ pitch, start: noteStart, end: noteEnd });
            continue;
        }
        const length = noteEnd - noteStart;
        const hold = length * 0.4;
        const stepLength = (length - hold) / stepCount;
        events.push({ pitch, start: noteStart, end: noteStart + hold });
        for (let step = 1; step <= stepCount; step++) {
            events.push({ pitch: [Tone.Frequency(startMidi + direction * step, 'midi').toNote()], start: noteStart + hold + (step - 1) * stepLength, end: noteStart + hold + step * stepLength });
        }
    }
    return events;
}
async function playAllStaves(staffList, button) {
    await Tone.start();
    Tone.Transport.stop();
    Tone.Transport.cancel();
    Tone.Transport.position = 0;
    const bpm = parseFloat(bpmSlider.value) || 120;
    const secondsPerWhole = (60 / bpm) * 4;
    const startT = measureStartOf(playStartMeasure);
    let endT = startT;
    staffList.forEach(staff => {
        if (staff.muted)
            return;
        staffVoices(staff).forEach(voice => {
            for (const event of soundingEvents(staff, voice)) {
                if (event.end > endT)
                    endT = event.end;
                if (event.end <= startT + 1e-9)
                    continue; // before the start
                // A note already sounding at the start plays its remaining length
                const from = Math.max(event.start, startT);
                const when = (from - startT) * secondsPerWhole;
                const dur = (event.end - from) * secondsPerWhole;
                Tone.Transport.schedule((time) => {
                    for (const pitchName of event.pitch)
                        sampler.triggerAttackRelease(pitchName, dur, time);
                }, when);
            }
        });
    });
    if (endT - startT < 1e-9)
        return; // nothing to play from here
    isPlaying = true;
    button.classList.add("active");
    Tone.Transport.start();
    stopTimeoutId = window.setTimeout(() => stopPlayback(button), (endT - startT) * secondsPerWhole * 1000 + 250);
}
function stopPlayback(button) {
    Tone.Transport.stop();
    Tone.Transport.cancel();
    if (sampler)
        sampler.releaseAll();
    if (stopTimeoutId !== null) {
        clearTimeout(stopTimeoutId);
        stopTimeoutId = null;
    }
    isPlaying = false;
    if (button)
        button.classList.remove("active");
}
async function setupSampler() {
    if (sampler)
        return;
    const sampleMap = {};
    pianoKeys.forEach(key => { sampleMap[key] = `${key}.mp3`; });
    await new Promise(resolve => {
        sampler = new Tone.Sampler({
            urls: sampleMap,
            baseUrl: "/static/notes/",
            onload: resolve,
        }).toDestination();
    });
    await Tone.start();
}
