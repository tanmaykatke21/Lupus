# Re-recording the demo videos

Tools used to produce `docs/demo/*.mp4`. Run them during bus service hours for live buses.

Prereqs (outside the repo): `npm i playwright ffmpeg-static`, Google Chrome installed, `npm run dev` on :3000.

1. `node record.mjs <out>`: drives the app on a 390×844 phone viewport (replay mode, location = West Apartments)
   and saves frames for segments 01, 03, 04, 05.
2. `node assets.mjs <comp-dir> <out>`: renders caption panels and the bezel from `comp/`, films the
   "who benefits" card and the architecture tour (needs `docs/diagrams/src/architecture.html` + css/js copied into `<comp-dir>`).
3. Narration: `say -v Samantha -r 180 -f <section>.txt -o <section>.aiff` per section of `docs/Demo_Script.md`.
4. `python3 compose.py <workdir> <dest>`: fits each clip to its narration, composites 1920×1080, joins the full video.
