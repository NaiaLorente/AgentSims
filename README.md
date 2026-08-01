# AgentSims

A handful of AI-driven residents living their own lives in a small 2D town —
watch them wander around, meet each other, chat, become friends or rivals,
fall in love, and start families. Everything runs in your browser; there's no
backend and no API key. The "brains" are your own local LLM, served by
[Ollama](https://ollama.com), so it's completely free to run.

## Quick start

1. **Install [Ollama](https://ollama.com/download)** and pull a small,
   fast model:

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

3. **Run AgentSims:**

   ```bash
   npm install
   npm run dev
   ```

   Open the printed `http://localhost:5173/agentsims/` URL, open the
   **Ollama settings** panel, and click **Test**. Once it says "Connected",
   pick your model and hit **Play**.

That's it — no accounts, no API keys, no usage limits beyond your own
hardware.

## Why local-only?

The goal was an AI sandbox that costs nothing to run, for anyone. Instead of
bring-your-own-API-key (which still costs the user money and rate-limits
them), AgentSims talks to a model running on your own machine. It's slower
than a big hosted model, but free and unlimited — and everything agents say
stays on your machine.

## Deploying (GitHub Pages)

A workflow at `.github/workflows/deploy.yml` builds and publishes the app to
GitHub Pages on every push to `main` (enable it once under **Settings → Pages
→ Source: GitHub Actions**). The static site still needs a local Ollama
server to talk to — it never phones home anywhere else.

One catch: a page served over `https://` (like GitHub Pages) calling
`http://localhost:11434` can be blocked by the browser as "mixed content."
Most browsers exempt `localhost`, but if yours doesn't:
- run the app locally instead (`npm run dev`), which avoids the issue
  entirely, or
- allow insecure content for the Pages site in your browser's site settings.

## How it works

- **World**: a small hand-built map (two homes, a café, a park) rendered on
  an HTML canvas.
- **Agents**: each has a persona, needs (energy/hunger/social/fun) that decay
  over time, and a short memory stream.
- **Decisions**: when an agent is free, it asks the local LLM what to do next
  (sleep, eat, relax, socialize, or talk to someone nearby), constrained to a
  small JSON action schema. A deterministic safety net forces sleep/food/fun
  when a need gets critical, so the sim stays stable even with a small or
  distractible local model.
- **Conversations**: when two agents meet, one LLM call writes a short
  in-character exchange and reports how it went (sentiment, and whether
  either side showed romantic interest).
- **Relationships**: a state machine turns repeated positive interactions
  into acquaintance → friend/rival → (if mutual) romantic interest → dating →
  married → and eventually a child, a new autonomous agent added to the town.
  Milestones are posted to the town feed.
- **Everything is unrestricted** beyond what your chosen local model itself
  will or won't generate — friendship, conflict, romance, all of it is fair
  game.

Project layout: simulation logic lives in `src/sim/`, the Ollama client and
prompts in `src/llm/`, app state in `src/state/simStore.ts`, rendering in
`src/render/`, and UI panels in `src/ui/`.

## Save / load

Use the **Save** / **Load** buttons to snapshot the whole town (agents,
relationships, memories, event log) to your browser's local storage, so you
can pick up where you left off.
