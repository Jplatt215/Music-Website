////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Export: MIDI and MusicXML
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

const musicXmlTypeMapping: Record<string, string> = {
  w: "whole", h: "half", q: "quarter", "8": "eighth", "16": "16th", "32": "32nd",
};

function getMusicXmlTypeAndDot(note: UnprocessedNote): { type: string; dotted: boolean } {
  const key = getDurationString(note) ?? note.duration;
  const isDotted = key.endsWith('d');
  const baseKey = isDotted ? key.slice(0, -1) : key;
  return { type: musicXmlTypeMapping[baseKey] ?? "quarter", dotted: isDotted };
}

function exportLayerToMidi(): void {
  const midi = new Midi();
  const layerStaves = getActiveStaves();

  for (const staffName of staves) {
    const staff = layerStaves[staffName];
    const track = midi.addTrack();
    track.name = staffName;

    // every voice of the staff goes on the staff's track
    for (const voice of staffVoices(staff)) {
      const notesToExport = voice.unprocessedNotes.length > 0
        ? voice.unprocessedNotes
        : fillDurationWithRests(totalLength());

      let currentTime = 0;
      for (const note of notesToExport) {
        const noteDurationInSeconds = getNoteDurationInSeconds(staff, note);
        if (note.isRest) { currentTime += noteDurationInSeconds; continue; }
        note.noteName.forEach((noteName, index) => {
          track.addNote({ name: toToneName(noteName, note.octaves[index]), time: currentTime, duration: noteDurationInSeconds });
        });
        currentTime += noteDurationInSeconds;
      }
    }
  }

  const filename = `${currentTitle || 'composition'}_${currentLayer}.mid`;
  const blob = new Blob([midi.toArray()], { type: 'audio/midi' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function exportLayerToMusicXML(): void {
  const DIVS_PER_QUARTER = 32;
  const DIVS_PER_WHOLE = DIVS_PER_QUARTER * 4;
  const layerStaves = getActiveStaves();

  let partList = '';
  staves.forEach((staffName, index) => {
    partList += `    <score-part id="P${index + 1}">\n      <part-name>${staffName}</part-name>\n    </score-part>\n`;
  });

  let parts = '';
  staves.forEach((staffName, itemIndex) => {
    const staff = layerStaves[staffName];

    parts += `  <part id="P${itemIndex + 1}">\n    <measure number="1">\n      <attributes>\n        <divisions>${DIVS_PER_QUARTER}</divisions>\n        <time>\n          <beats>${measureSigs[0].num}</beats>\n          <beat-type>${measureSigs[0].den}</beat-type>\n        </time>\n        <clef>\n          <sign>G</sign>\n          <line>2</line>\n        </clef>\n      </attributes>\n`;

    const voicesHere = staffVoices(staff);
    voicesHere.forEach((voice, voiceIdx) => {
      const voiceNumber = VOICE_DEFS.findIndex(voiceDef => voiceDef.id === voice.id) + 1;
      const notesToExport = voice.unprocessedNotes.length > 0
        ? voice.unprocessedNotes
        : fillDurationWithRests(totalLength());

      let voiceDivs = 0;
      for (const note of notesToExport) {
        const { type, dotted } = getMusicXmlTypeAndDot(note);
        const isTuplet = !!note.tupletInfo;
        const actualDuration = isTuplet
          ? getNoteDuration(note) * note.tupletInfo!.ratio[1] / note.tupletInfo!.ratio[0]
          : getNoteDuration(note);
        const durationDivs = Math.round(actualDuration * DIVS_PER_WHOLE);
        voiceDivs += durationDivs;

        // a chord is one <note> per pitch, the later ones marked <chord/>
        const pitchCount = note.isRest ? 1 : note.noteName.length;
        for (let pitchIndex = 0; pitchIndex < pitchCount; pitchIndex++) {
          parts += `<note>\n`;
          if (pitchIndex > 0) parts += `  <chord/>\n`;
          if (note.isRest) {
            parts += `  <rest/>\n`;
          } else {
            const { letter, acc } = parsePitchName(note.noteName[pitchIndex]);
            parts += `  <pitch>\n    <step>${letter}</step>\n`;
            if (ACC_SEMITONE[acc] !== 0) parts += `    <alter>${ACC_SEMITONE[acc]}</alter>\n`;
            parts += `    <octave>${note.octaves[pitchIndex]}</octave>\n  </pitch>\n`;
          }
          parts += `  <duration>${durationDivs}</duration>\n`;
          parts += `  <voice>${voiceNumber}</voice>\n`;
          parts += `  <type>${type}</type>\n`;
          if (dotted) parts += `  <dot/>\n`;

          if (isTuplet) {
            const [actualNotes, normalNotes] = note.tupletInfo!.ratio;
            parts += `  <time-modification>\n    <actual-notes>${actualNotes}</actual-notes>\n    <normal-notes>${normalNotes}</normal-notes>\n  </time-modification>\n`;

            const { index, count } = note.tupletInfo!;
            if (pitchIndex === 0 && (index === 1 || index === count)) {
              parts += `  <notations>\n`;
              if (index === 1) parts += `    <tuplet type="start"/>\n`;
              if (index === count) parts += `    <tuplet type="stop"/>\n`;
              parts += `  </notations>\n`;
            }
          }
          parts += `</note>\n`;
        }
      }

      // the next voice starts again at the beginning of the staff
      if (voiceIdx < voicesHere.length - 1) parts += `<backup>\n  <duration>${voiceDivs}</duration>\n</backup>\n`;
    });

    parts += `    </measure>\n  </part>\n`;
  });

  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<score-partwise version="3.1">\n  <part-list>\n${partList}  </part-list>\n${parts}</score-partwise>`;

  const filename = `${currentTitle || 'composition'}_${currentLayer}.musicxml`;
  const blob = new Blob([xml], { type: "application/vnd.recordare.musicxml+xml" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
