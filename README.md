# montemadethis

beat store: preview -> cart -> Stripe checkout -> mp3 emailed automatically.

## adding / editing beats
1. add a line to `beats.json` (name, bpm, price, featured)
2. drop the files in, named after the beat with dashes (e.g. "midnight run" -> `midnight-run.mp3`):
   - `previews/midnight-run.mp3`  (public 30s preview, tag it)
   - `full/midnight-run.mp3`      (the full mp3 customers receive, KEEP THIS REPO PRIVATE)
3. commit + push. Railway redeploys in about a minute.

Each beat gets its own link automatically: yoursite.com/beat/midnight-run

## environment variables (Railway -> Variables)
see `.env.example`
