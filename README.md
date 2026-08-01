# AgentSims

A sandbox for watching what LLMs actually do when you give them total free
will. Drop several AI agents — each powered by a model of your choice — into
a shared open space with no personality, no needs, no goals, and no
instructions. Watch where they go, whether they approach each other, what
they say, and whether that differs from model to model. Everything runs in
your browser; there's no backend and no API key. The "brains" are your own
local LLMs, served by [Ollama](https://ollama.com), so it's completely free
to run.

## Quick start

1. **Install [Ollama](https://ollama.com/download)** and pull whichever
   models you want to compare:

   ```bash
   ollama pull llama3.2
   ollama pull qwen2.5
   ollama pull mistral
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

   Open the printed `http://localhost:5173/agentsims/` URL, click **Test** in
   the **Ollama connection** panel, then assign a model to each agent in the
   **Agents** list below it (add/remove agents freely, and give the same or
   different models to each one). Hit **Reset** to spawn them, then **Play**.

That's it — no accounts, no API keys, no usage limits beyond your own
hardware.

## Why local-only?

The goal was an AI sandbox that costs nothing to run, for anyone. Instead of
bring-your-own-API-key (which still costs the user money and rate-limits
them), AgentSims talks to models running on your own machine. It's slower
than big hosted models, but free and unlimited — and everything the agents
say stays on your machine.

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

- **World**: a deliberately blank, featureless grid rendered on an HTML
  canvas — nothing suggesting what agents should do or where they should go.
- **Agents**: each is just a model assignment (e.g. "Agent 1 → llama3.2") and
  a position. No bio, no traits, no needs, no goals. You can add, remove, and
  reassign agents freely in the **Agents** panel — pick the same model twice
  to compare temperature/seed variance, or different models to compare how
  each one behaves.
- **Decisions**: when an agent is free, its own assigned model is asked what
  it wants to do — move in a direction, approach and talk to a specific
  nearby agent, say something out loud to no one in particular, or do
  nothing — via a minimal JSON action schema. That schema is the only
  "instruction" involved; it describes what's mechanically possible, not
  what the agent should want.
- **Conversations are not scripted by one model.** Each line is generated
  turn-by-turn by the actual speaking agent's own model, alternating back
  and forth (up to 8 turns, or until either side chooses to end it) — so
  what you see is genuinely each model's own voice, not one model writing
  both sides.
- **Full transcript**: every line anyone says, and who said it, is logged
  live in the transcript panel and shown as an on-canvas speech bubble as it
  happens — nothing is summarized or paraphrased.
- **No relationship system, no milestones, no scoring.** Whatever affinity,
  conflict, or connection emerges is only visible in what the agents actually
  say and do — there's no hidden state machine interpreting it for you.

Project layout: simulation logic lives in `src/sim/`, the Ollama client and
prompts in `src/llm/`, app state (including the agent roster) in
`src/state/simStore.ts`, rendering in `src/render/`, and UI panels in
`src/ui/`.

## Save / load

Use the **Save** / **Load** buttons to snapshot the whole sandbox (agents,
their assigned models, memories, transcript) to your browser's local
storage, so you can pick up where you left off.
