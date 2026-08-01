# AgentSims

A sandbox for watching what LLMs actually do when you give them a small town
and total free will inside it. Drop several AI agents — each powered by a
model of your choice — into a shared map with houses, a shop, a restaurant,
and a park, and give them needs, money, jobs, and relationships to manage.
Nothing is scripted or forced: what each agent actually does with any of it —
whether it works, rests, befriends someone, declares itself the park's
leader, or ignores all of it — is entirely up to its own model. Everything
runs in your browser; there's no backend and no API key. The "brains" are
your own local LLMs, served by [Ollama](https://ollama.com), so it's
completely free to run.

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

- **The map**: five fixed places — two houses, a shop, a restaurant, and a
  park — laid out on an open field, always known to every agent from the
  start (like a real map, not something discovered by wandering close
  enough). Agents render as small animated characters (their own color, a
  walk cycle, facing whichever way they're moving); each place renders as a
  labeled, tinted area you can walk into. Scroll to zoom and drag to pan
  around the scene; double-click resets the view.
- **Agents**: each is a model assignment (e.g. "A → llama3.2") plus a
  position, needs, a wallet, and whatever roles/relationships it's picked up
  along the way — no fixed bio or personality. You can add, remove, and
  reassign agents freely in the **Agents** panel — pick the same model twice
  to compare temperature/seed variance, or different models to compare how
  each one behaves.
- **Needs**: hunger, energy, social, and fun, each decaying slowly over
  time and visible in the **Agents** inspector. They're purely informational
  — nothing forces an agent to act on a low need, and nothing bad happens if
  it doesn't. Energy is restored by resting at a house, fun by spending time
  at the park, hunger by buying food, and social by simply talking to people.
- **Jobs & money**: an agent can claim a role or job title anywhere, in its
  own words (a title it makes up, not picked from a list) — but only while
  actually standing at that place, and nothing stops two agents from
  claiming the same one. Holding a job at the shop or restaurant lets an
  agent work there to earn money, which can then be spent on food. It's a
  real, if small, economy — entirely opt-in.
- **Politics, informally.** There's no election system or ranking — "leader
  of the park," "shopkeeper," or anything else is just a role an agent
  declares for itself the same way a job is claimed. Conflicting claims,
  alliances, or rivalries aren't resolved by the engine; they only exist in
  what the agents say and do about them. The **Zones** panel shows who's
  claimed what, where, as a single across-the-map view.
- **Decisions**: when an agent is free, its own assigned model is asked what
  it wants to do — move, walk to a specific place, approach and talk to a
  nearby agent, say something out loud, rest, have fun, buy food, claim a
  role, work, or do nothing — via a minimal JSON action schema. That schema
  is the only "instruction" involved; it describes what's mechanically
  possible, not what the agent should want. The prompts never mention AI,
  models, or "free will" as a concept — telling an agent what it *is* just
  gets it talking about that instead of acting, so it's only ever told what
  it can do, in-world, first person.
- **Conversations are not scripted by one model.** Each line is generated
  turn-by-turn by the actual speaking agent's own model, alternating back
  and forth (up to 8 turns, or until either side chooses to end it) — so
  what you see is genuinely each model's own voice, not one model writing
  both sides.
- **Relationships are remembered, not just implied by chat.** After any
  exchange, the speaking agent's own model can optionally update how it
  feels about the other person — a short label in its own words ("a close
  friend", "someone I don't trust") plus a numeric affinity — stored on the
  agent and visible in its inspector. It's deliberately asymmetric: one
  agent can consider another a friend without that being mutual, and there's
  no fixed ladder of relationship stages the engine imposes.
- **Memory carries across encounters.** Every agent remembers what it's
  said, heard, earned, bought, claimed, and who it's met, and that memory is
  fed back into both its decisions and its next conversation with the same
  agent — so it won't re-introduce itself from scratch every time it runs
  into someone it's already spoken to.
- **Full transcript**: everything said, and every role claimed, is logged
  live in the transcript panel and shown as an on-canvas speech bubble as it
  happens — nothing is summarized or paraphrased. Simultaneous conversations
  (normal once there are 3+ agents) each get their own live card above the
  transcript so they don't blur into one thread.

Project layout: simulation logic lives in `src/sim/`, the Ollama client and
prompts in `src/llm/`, app state (including the agent roster) in
`src/state/simStore.ts`, rendering in `src/render/`, and UI panels in
`src/ui/`.

## Save / load

Use the **Save** / **Load** buttons to snapshot the whole sandbox (agents,
their assigned models, memories, transcript) to your browser's local
storage, so you can pick up where you left off.
