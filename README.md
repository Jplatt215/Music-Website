# Classical Music Composition Platform

A full-stack web application for generating, modifying, and playing polyphonic classical music compositions. Built with Flask, TypeScript, VexFlow, and Tone.js, featuring real-time music notation rendering, algorithmic composition tools, user accounts, and persistent storage with shareable compositions.

## Live Demo
[https://josephplatt.dev/](https://josephplatt.dev/)

## Features

### Composition Tools
- Generate musical phrases algorithmically with configurable pitch range, rhythm constraints, and scale
- 10+ compositional transformations: reverse, reflect, shift, transpose, shuffle rhythm/notes/pitch, simplify, complicate
- Multi-voice support (4 independent voices) with custom tuplet rendering and barline-aware rhythm processing
- Harmony mode for generating chord progressions
- Undo/redo via per-voice memory history
- Copy/paste between voices

### Playback & Export
- Real-time audio playback via Tone.js with full sampled piano and adjustable tempo
- MIDI and MusicXML export for use with professional notation software

### Accounts & Persistence
- User registration and login with hashed passwords (Flask-Login, Werkzeug)
- Save, load, and overwrite named compositions
- Public and private compositions with shareable URLs
- Autosave to browser storage for unsaved work

## Tech Stack
- **Frontend:** TypeScript, JavaScript, HTML, CSS
- **Music Rendering:** VexFlow
- **Audio Playback:** Tone.js
- **Backend:** Python, Flask, SQLAlchemy
- **Database:** PostgreSQL
- **Deployment:** Railway

## Notes
This application uses yt-dlp to extract YouTube video titles for composer and composition parsing on the Music Index page. On some cloud platforms, yt-dlp may occasionally fail with a bot-detection error; this does not affect the composition features and does not occur when running locally.