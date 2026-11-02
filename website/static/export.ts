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

    // every voice of the staff goes on the staff's track, as it sounds (ties joined, grace notes and glissandos played)
    const secondsPerWhole = (60 / (parseFloat(bpmSlider.value) || 120)) * 4;
    for (const voice of staffVoices(staff)) {
      for (const event of soundingEvents(staff, voice)) {
        for (const pitchName of event.pitch) {
          track.addNote({ name: pitchName, time: event.start * secondsPerWhole, duration: (event.end - event.start) * secondsPerWhole });
        }
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

const XML_DIVISIONS_PER_QUARTER = 2520;   // divisible by 8, 9, 5 and 7, so thirty-seconds and nested tuplets come out whole
const XML_CLEFS: Record<string, [string, number]> = { treble: ['G', 2], bass: ['F', 4], alto: ['C', 3], tenor: ['C', 4] };
const XML_ARTICULATIONS: Record<string, string> = { 'a.': 'staccato', 'a>': 'accent', 'a-': 'tenuto', 'av': 'staccatissimo', 'a^': 'strong-accent' };

interface XmlPiece { note: UnprocessedNote; start: number; tieStart: boolean; }

// A voice's notes cut at barlines (a note across one becomes tied pieces), each with where it starts
function xmlPieces(notes: UnprocessedNote[]): XmlPiece[] {
  const pieces: XmlPiece[] = [];
  let time = 0;
  for (const note of notes) {
    const length = getRealDuration(note);
    if (note.tupletInfo) {
      pieces.push({ note, start: time, tieStart: note.tiedToNext });
      time = round(time + length);
      continue;
    }
    let remaining = round(length);
    let first = true;
    while (remaining > 1e-9) {
      const take = Math.min(remaining, spaceToBarline(time));
      const isLast = remaining - take <= 1e-9;
      const chunk = Math.abs(take - length) < 1e-9 ? [note] : fillDurationAsUnprocessed(take, note);
      chunk.forEach((piece, index) => {
        if (!first) piece.articulations = [];
        const tied = index < chunk.length - 1 ? piece.tiedToNext : (isLast ? note.tiedToNext : !note.isRest);
        pieces.push({ note: piece, start: time, tieStart: tied && !note.isRest });
        time = round(time + getRealDuration(piece));
      });
      remaining = round(remaining - take);
      first = false;
    }
  }
  return pieces;
}

interface XmlSpanMarks { slurStarts: number[]; slurStops: number[]; glissStarts: number[]; glissStops: number[]; }

// Which pieces of a voice start and stop each slur and glissando of the staff
function xmlSpanMarks(staff: Staff, voiceId: VoiceId, pieces: XmlPiece[]): Map<XmlPiece, XmlSpanMarks> {
  const marks = new Map<XmlPiece, XmlSpanMarks>();
  const marksOf = (piece: XmlPiece): XmlSpanMarks => {
    if (!marks.has(piece)) marks.set(piece, { slurStarts: [], slurStops: [], glissStarts: [], glissStops: [] });
    return marks.get(piece)!;
  };
  const pitched = pieces.filter(piece => !piece.note.isRest);
  staff.slurs.filter(slur => slur.voice === voiceId).forEach((slur, index) => {
    const covered = pitched.filter(piece => piece.start >= slur.start - 1e-6 && piece.start < slur.end - 1e-6);
    if (covered.length < 2) return;
    marksOf(covered[0]).slurStarts.push(index % 16 + 1);
    marksOf(covered[covered.length - 1]).slurStops.push(index % 16 + 1);
  });
  staff.glissandos.filter(mark => mark.voice === voiceId).forEach((mark, index) => {
    const from = pitched.find(piece => Math.abs(piece.start - mark.start) < 1e-6);
    const to = pitched.find(piece => Math.abs(piece.start - mark.end) < 1e-6);
    if (!from || !to) return;
    marksOf(from).glissStarts.push(index % 16 + 1);
    marksOf(to).glissStops.push(index % 16 + 1);
  });
  return marks;
}

const XML_GRACE_TYPES: Record<string, string> = { '8': 'eighth', '16': '16th', '32': '32nd' };

function xmlGraceNotes(note: UnprocessedNote, voiceNumber: number): string {
  let xml = '';
  for (const grace of note.graceNotes) {
    grace.noteName.forEach((name, pitchIndex) => {
      const { letter, acc } = parsePitchName(name);
      xml += `<note>\n  <grace${grace.slash ? ' slash="yes"' : ''}/>\n`;
      if (pitchIndex > 0) xml += `  <chord/>\n`;
      xml += `  <pitch>\n    <step>${letter}</step>\n`;
      if (ACC_SEMITONE[acc] !== 0) xml += `    <alter>${ACC_SEMITONE[acc]}</alter>\n`;
      xml += `    <octave>${grace.octaves[pitchIndex]}</octave>\n  </pitch>\n  <voice>${voiceNumber}</voice>\n  <type>${XML_GRACE_TYPES[grace.duration] ?? 'eighth'}</type>\n</note>\n`;
    });
  }
  return xml;
}

function xmlNote(piece: XmlPiece, tieStop: boolean, voiceNumber: number, spans?: XmlSpanMarks): string {
  const note = piece.note;
  const { type, dotted } = getMusicXmlTypeAndDot(note);
  const durationDivs = Math.round(getRealDuration(note) * 4 * XML_DIVISIONS_PER_QUARTER);
  const levels = tupletLevels(note);
  let xml = note.isRest ? '' : xmlGraceNotes(note, voiceNumber);

  // a chord is one <note> per pitch, the later ones marked <chord/>
  const pitchCount = note.isRest ? 1 : note.noteName.length;
  for (let pitchIndex = 0; pitchIndex < pitchCount; pitchIndex++) {
    xml += `<note>\n`;
    if (pitchIndex > 0) xml += `  <chord/>\n`;
    if (note.isRest) {
      xml += `  <rest/>\n`;
    } else {
      const { letter, acc } = parsePitchName(note.noteName[pitchIndex]);
      xml += `  <pitch>\n    <step>${letter}</step>\n`;
      if (ACC_SEMITONE[acc] !== 0) xml += `    <alter>${ACC_SEMITONE[acc]}</alter>\n`;
      xml += `    <octave>${note.octaves[pitchIndex]}</octave>\n  </pitch>\n`;
    }
    xml += `  <duration>${durationDivs}</duration>\n`;
    if (!note.isRest && tieStop) xml += `  <tie type="stop"/>\n`;
    if (!note.isRest && piece.tieStart) xml += `  <tie type="start"/>\n`;
    xml += `  <voice>${voiceNumber}</voice>\n  <type>${type}</type>\n`;
    if (dotted) xml += `  <dot/>\n`;

    if (levels.length) {
      // tuplets inside tuplets multiply their ratios
      const actualNotes = levels.reduce((product, level) => product * level.ratio[0], 1);
      const normalNotes = levels.reduce((product, level) => product * level.ratio[1], 1);
      xml += `  <time-modification>\n    <actual-notes>${actualNotes}</actual-notes>\n    <normal-notes>${normalNotes}</normal-notes>\n  </time-modification>\n`;
    }

    const marks: string[] = [];
    if (!note.isRest && tieStop) marks.push(`<tied type="stop"/>`);
    if (!note.isRest && piece.tieStart) marks.push(`<tied type="start"/>`);
    if (pitchIndex === 0) {
      levels.forEach((level, depth) => {
        if (level.index === 1) marks.push(`<tuplet type="start" number="${depth + 1}" bracket="yes"><tuplet-actual><tuplet-number>${level.ratio[0]}</tuplet-number></tuplet-actual><tuplet-normal><tuplet-number>${level.ratio[1]}</tuplet-number></tuplet-normal></tuplet>`);
        if (level.index === level.count) marks.push(`<tuplet type="stop" number="${depth + 1}"/>`);
      });
      const articulations = note.articulations.filter(code => XML_ARTICULATIONS[code]);
      if (articulations.length) marks.push(`<articulations>${articulations.map(code => `<${XML_ARTICULATIONS[code]}/>`).join('')}</articulations>`);
      if (note.articulations.includes('a@a')) marks.push(`<fermata/>`);
      for (const number of spans?.slurStops ?? []) marks.push(`<slur type="stop" number="${number}"/>`);
      for (const number of spans?.slurStarts ?? []) marks.push(`<slur type="start" number="${number}"/>`);
      for (const number of spans?.glissStops ?? []) marks.push(`<glissando type="stop" number="${number}"/>`);
      for (const number of spans?.glissStarts ?? []) marks.push(`<glissando type="start" number="${number}" line-type="wavy"/>`);
    }
    if (marks.length) xml += `  <notations>\n    ${marks.join('\n    ')}\n  </notations>\n`;
    xml += `</note>\n`;
  }
  return xml;
}

// Dynamics, hairpins and technique words that fall in one measure, each placed with an offset from the measure's start
function xmlDirections(staff: Staff, measureIndex: number): string {
  const measureStart = measureStartOf(measureIndex);
  const measureEnd = round(measureStart + measureLenOf(measureIndex));
  const isLast = measureIndex === numMeasures - 1;
  const inside = (time: number): boolean => time >= measureStart - 1e-6 && (time < measureEnd - 1e-6 || (isLast && time <= measureEnd + 1e-6));
  const offsetOf = (time: number): string => {
    const divisions = Math.round((time - measureStart) * 4 * XML_DIVISIONS_PER_QUARTER);
    return divisions > 0 ? `  <offset>${divisions}</offset>\n` : '';
  };
  const direction = (time: number, content: string): string => `<direction placement="below">\n  <direction-type>\n    ${content}\n  </direction-type>\n${offsetOf(time)}</direction>\n`;

  let xml = '';
  staff.dynamics.forEach((mark, index) => {
    const number = index % 16 + 1;
    if (mark.kind === 'level') {
      if (inside(mark.start)) xml += direction(mark.start, `<dynamics><${mark.level}/></dynamics>`);
      return;
    }
    if (inside(mark.start)) xml += direction(mark.start, `<wedge type="${mark.kind}" number="${number}"/>`);
    if (inside(mark.end)) xml += direction(mark.end, `<wedge type="stop" number="${number}"/>`);
  });
  for (const mark of staff.techniques) {
    if (inside(mark.start)) xml += `<direction placement="above">\n  <direction-type>\n    <words font-style="italic">${mark.text}</words>\n  </direction-type>\n${offsetOf(mark.start)}</direction>\n`;
  }
  return xml;
}

function exportLayerToMusicXML(): void {
  const layerStaves = getActiveStaves();

  let partList = '';
  staves.forEach((staffName, index) => {
    partList += `    <score-part id="P${index + 1}">\n      <part-name>${staffName}</part-name>\n    </score-part>\n`;
  });

  let parts = '';
  staves.forEach((staffName, itemIndex) => {
    const staff = layerStaves[staffName];
    const voicesHere = staffVoices(staff);
    const spanMarks = voicesHere.map((voice, index) => null as Map<XmlPiece, XmlSpanMarks> | null);
    const pieceLists = voicesHere.map(voice => xmlPieces(voice.unprocessedNotes.length > 0 ? voice.unprocessedNotes : fillDurationWithRests(totalLength())));

    parts += `  <part id="P${itemIndex + 1}">\n`;
    for (let measureIndex = 0; measureIndex < numMeasures; measureIndex++) {
      const measureStart = measureStartOf(measureIndex);
      const measureEnd = round(measureStart + measureLenOf(measureIndex));
      parts += `    <measure number="${measureIndex + 1}">\n`;

      // divisions, time signature, clef and key are written at the start and wherever they change
      const sig = sigOf(measureIndex);
      const sigChanged = measureIndex === 0 || sigOf(measureIndex - 1).num !== sig.num || sigOf(measureIndex - 1).den !== sig.den;
      const clef = clefAt(staffName, measureIndex);
      const clefChanged = measureIndex === 0 || clefAt(staffName, measureIndex - 1) !== clef;
      const key = keyAt(staffName, measureIndex);
      const keyChanged = measureIndex === 0 || keyAt(staffName, measureIndex - 1) !== key;
      if (sigChanged || clefChanged || keyChanged) {
        parts += `      <attributes>\n`;
        if (measureIndex === 0) parts += `        <divisions>${XML_DIVISIONS_PER_QUARTER}</divisions>\n`;
        if (keyChanged) parts += `        <key>\n          <fifths>${KEY_ACCIDENTAL_COUNT[key] ?? 0}</fifths>\n        </key>\n`;
        if (sigChanged) parts += `        <time>\n          <beats>${sig.num}</beats>\n          <beat-type>${sig.den}</beat-type>\n        </time>\n`;
        if (clefChanged) parts += `        <clef>\n          <sign>${XML_CLEFS[clef][0]}</sign>\n          <line>${XML_CLEFS[clef][1]}</line>\n        </clef>\n`;
        parts += `      </attributes>\n`;
      }

      parts += xmlDirections(staff, measureIndex);

      voicesHere.forEach((voice, voiceIndex) => {
        const voiceNumber = VOICE_DEFS.findIndex(voiceDef => voiceDef.id === voice.id) + 1;
        const all = pieceLists[voiceIndex];
        if (!spanMarks[voiceIndex]) spanMarks[voiceIndex] = xmlSpanMarks(staff, voice.id, all);
        let here = all.filter(piece => piece.start >= measureStart - 1e-9 && piece.start < measureEnd - 1e-9);
        if (!here.length) here = xmlPieces(fillDurationWithRests(round(measureEnd - measureStart), measureStart)).map(piece => ({ ...piece, start: piece.start + measureStart }));

        let voiceDivs = 0;
        for (const piece of here) {
          const before = all[all.indexOf(piece) - 1];
          const tieStop = !!before && before.tieStart && !before.note.isRest && !piece.note.isRest;
          parts += xmlNote(piece, tieStop, voiceNumber, spanMarks[voiceIndex]!.get(piece));
          voiceDivs += Math.round(getRealDuration(piece.note) * 4 * XML_DIVISIONS_PER_QUARTER);
        }
        // the next voice starts again at the beginning of the measure
        if (voiceIndex < voicesHere.length - 1) parts += `<backup>\n  <duration>${voiceDivs}</duration>\n</backup>\n`;
      });
      parts += `    </measure>\n`;
    }
    parts += `  </part>\n`;
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
