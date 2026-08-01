# AgentSims

A handful of AI-driven residents living their own lives in a small 2D town —
watch them wander around, meet each other, chat, become friends or rivals,
fall in love, and start families. Everything runs in your browser; there's no
backend of ours involved at all. AgentSims supports two free ways to power
the agents' "brains" — pick whichever fits your hardware.

## Quick start

**Option A — Local (Ollama).** Free, unlimited, fully private, but needs a
reasonably capable machine to run a model at a decent speed.

1. **Install [Ollama](https://ollama.com/download)** and pull a small, fast
   model:

   ```bash
   ollama pull llama3.2
   ```

2. **Start Ollama with browser access enabled.** By default Ollama only
   accepts requests from its own CLI, not from a web page. Allow this app's
   origin (or all origins, for local use):

   ```bash
   OLLAMA_ORIGINS=* ollama serve
   ```

   (If Ollama is already running as a background service, stop it first, or
   set `OLLAMA_ORIGINS` in its environment/service config and restart it.)

**Option B — Cloud (NVIDIA API key).** No GPU or local install needed — good
if your computer can't comfortably run a local model. NVIDIA's
[build.nvidia.com](https://build.nvidia.com) catalog offers a long list of
free-tier hosted models (Llama, Qwen, DeepSeek, Nemotron, and more).

1. Grab a free API key at [build.nvidia.com](https://build.nvidia.com) (sign
   in, open any model page, click **Get API Key**).
2. In the app's **AI settings** panel, switch to **Cloud (NVIDIA key)**,
   paste the key, and pick a model (a small instruct model like
   `meta/llama-3.1-8b-instruct` responds fastest for this turn-based sim —
   the big "reasoning" models work but are noticeably slower per turn).
3. Click **Test**. The key is stored only in your browser's local storage and
   is sent only to NVIDIA's API — never to us or anywhere else.

**Then, either way:**

```bash
npm install
npm run dev
```

Open the printed `http://localhost:5173/agentsims/` URL, confirm your chosen
backend shows "Connected", and hit **Play**.

That's it — no accounts required for local mode, and no cost either way
beyond NVIDIA's free tier limits if you choose cloud mode.

## Which mode should I use?

- **Local (Ollama)** if you have a decent GPU (or are willing to wait on
  CPU): fully private, no rate limits, no account.
- **Cloud (NVIDIA key)** if your machine can't run a local model well: no
  hardware requirements, but free-tier usage is rate-limited by NVIDIA, and
  ⚠️ **direct browser calls to NVIDIA's API haven't been verified to work
  past CORS restrictions** — if **Test** keeps failing with a network error
  after you've confirmed the key and model are correct, that's likely why,
  and local Ollama mode is the reliable fallback. (If you hit this, a small
  free serverless proxy — e.g. a Cloudflare Worker — could relay the request
  and fix it; open an issue/ask if you want that added.)

## Deploying (GitHub Pages)

A workflow at `.github/workflows/deploy.yml` builds and publishes the app to
GitHub Pages on every push to `main` (enable it once under **Settings → Pages
→ Source: GitHub Actions**). The static site talks directly to whichever
backend you pick (your local Ollama, or NVIDIA's API with your key) — it
never phones home anywhere else.

One catch for **local mode**: a page served over `https://` (like GitHub
Pages) calling `http://localhost:11434` can be blocked by the browser as
"mixed content." Most browsers exempt `localhost`, but if yours doesn't:
- run the app locally instead (`npm run dev`), which avoids the issue
  entirely, or
- allow insecure content for the Pages site in your browser's site settings.

For **cloud mode**, see the CORS caveat above — it should work the same
whether hosted or run locally, but hasn't been confirmed against NVIDIA's
actual API.

## How it works

- **World**: a small hand-built map (two homes, a café, a park) rendered on
  an HTML canvas.
- **Agents**: each has a persona, needs (energy/hunger/social/fun) that decay
  over time, and a short memory stream.
- **Decisions**: when an agent is free, it asks the LLM what to do next
  (sleep, eat, relax, socialize, or talk to someone nearby), constrained to a
  small JSON action schema. A deterministic safety net forces sleep/food/fun
  when a need gets critical, so the sim stays stable even with a small or
  distractible model.
- **Conversations**: when two agents meet, one LLM call writes a short
  in-character exchange and reports how it went (sentiment, and whether
  either side showed romantic interest).
- **Relationships**: a state machine turns repeated positive interactions
  into acquaintance → friend/rival → (if mutual) romantic interest → dating →
  married → and eventually a child, a new autonomous agent added to the town.
  Milestones are posted to the town feed.
- **Everything is unrestricted** beyond what your chosen model itself will or
  won't generate — friendship, conflict, romance, all of it is fair game.

Project layout: simulation logic lives in `src/sim/`, the LLM backends
(Ollama + NVIDIA) and prompts in `src/llm/`, app state in
`src/state/simStore.ts`, rendering in `src/render/`, and UI panels in
`src/ui/`.

## Save / load

Use the **Save** / **Load** buttons to snapshot the whole town (agents,
relationships, memories, event log) to your browser's local storage, so you
can pick up where you left off.
