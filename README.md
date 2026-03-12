# Automated Music Composition with VexFlow
A web-based tool for generating, modifying, and playing polyphonic music phrases. Built with Flask, VexFlow, and Tone.js, this project demonstrates real-time music notation rendering and automated composition features.

## Deployed at
[https://music-website-rknm.onrender.com/composer](https://music-website-rknm.onrender.com/composer)

(Because this project is hosted on Render's free tier, the server may spin down when idle. The first request after a period of inactivity can take longer to respond as the server starts up. Subsequent requests should be faster.)

## Features
* Generate musical phrases programmatically.
* Modify phrases: reverse, reflect, shift, transpose, shuffle rhythm/pitch, simplify/complicate.
* Multi-voice support: create and manipulate independent musical voices.
* Real-time playback with adjustable tempo using Tone.js.
* Exportable as MIDI or MusicXML.

## Technologies
* Frontend: HTML, CSS, JavaScript
* Music Rendering: VexFlow
* Audio Playback: Tone.js
* Backend: Python, Flask

## Notes
* This application uses yt-dlp to extract YouTube video titles for composer and composition parsing on the "Index" page. On cloud platforms (e.g., Render) yt-dlp may sometimes fail with an error like: "Sign in to confirm you’re not a bot". This limitation does not occur when running the project locally.
