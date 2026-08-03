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
  time and visible in the **Agents** inspector. They never block a choice —
  an agent is always free to ignore a need entirely — but they're not just
  flavor text either: being very tired visibly slows how fast an agent
  covers ground tick to tick, and being very hungry or bored shortens how
  far a single deliberate move actually gets it. Energy is restored by
  resting at a house it owns, fun by spending time at the park, hunger by
  buying food, and social by simply talking to people.
- **Sustained neglect has real stakes, not just a slowdown.** The needs
  above never block anything and self-correct the moment you act on them —
  but an agent that leaves hunger or energy critically low for a long
  stretch also drains a separate **condition** stat, visible in its
  inspector, that doesn't bounce back the instant a single need does.
  Below a threshold it's visibly worse off — a darker sprite on the canvas,
  a note in its own memory — and if condition bottoms out entirely while it
  owns a house, that house is repossessed, back to unowned for anyone to
  buy, logged as an event. Condition recovers noticeably slower than it
  falls, so running yourself into the ground can't be undone with a single
  meal. The **Model comparison** dashboard tracks how many houses each
  model's agents have lost this way.
- **Jobs, houses, and money**: an agent can claim a job title at the shop or
  restaurant, in its own words (a title it makes up, not picked from a
  list) — but only while actually standing at one of those two places, and
  nothing stops two agents from claiming the same one. Holding a job at the
  shop or restaurant lets an agent work there to earn money. Houses are
  different: they can be *bought*
  outright, and buying one is exclusive — once an agent owns a house, only
  they can rest there, so money and shelter actually matter to what an agent
  can do next. It's a real, if small, economy — entirely opt-in.
- **Money moves between agents, too.** Any agent can hand some of its own
  money to someone standing right next to it, however much it chooses —
  nothing about who gets what or why is suggested. That's the only lever
  needed for hoarding, generosity, or one agent bankrolling another's house
  to all be genuinely possible outcomes, not something scripted in.
- **Politics, informally.** There's no election system or ranking — "leader
  of the park," "shopkeeper," or anything else is just a role an agent
  declares for itself the same way a job is claimed. Conflicting claims,
  alliances, or rivalries aren't resolved by the engine; they only exist in
  what the agents say and do about them. The **Zones** panel shows who's
  claimed what, where, as a single across-the-map view.
- **Decisions**: when an agent is free, its own assigned model is asked what
  it wants to do — move, walk to a specific place, approach and talk to a
  nearby agent, say something out loud, rest, have fun, buy food, buy a
  house, claim a role, work, or do nothing — via a minimal JSON action
  schema. That schema is the only "instruction" involved; it describes
  what's mechanically possible, not what the agent should want. Every
  planning prompt also states plainly which place, if any, the agent is
  currently standing in — since several actions (resting, buying, working)
  only succeed there, leaving that to be inferred from memory alone was
  producing agents stuck repeating a failed action because an earlier walk
  there hadn't actually landed. Failed attempts otherwise get a plain
  factual message, not a suggested fix — an agent that can't afford a
  house, or can't find anywhere to rest, is left to work that out itself;
  correcting it in the moment would be coaching it toward a decision that's
  supposed to be its own. The prompts
  never mention AI, models, or "free will" as a concept — telling an agent
  what it *is* just gets it talking about that instead of acting, so it's
  only ever told what it can do, in-world, first person. There is no
  separate system prompt steering tone, personality, or how an agent should
  talk — whatever character comes through is entirely the underlying
  model's own.
- **Conversations are not scripted by one model, and aren't limited to two
  people.** Each line is generated turn-by-turn by the actual speaking
  agent's own model. Walking up to someone already mid-conversation folds
  you into that same conversation (up to 5 at once) instead of starting a
  separate one, and anyone can leave whenever they choose without ending it
  for whoever's left — so what you see is genuinely each model's own voice,
  in a group that can grow or shrink while it's happening, not one model
  writing every side. It also gets the same map info the planner does — the
  same real places, by name and id — so a conversation that drifts onto
  "where's House A?" has real facts to draw on instead of inventing
  landmarks that don't exist, the way one long real run did before this.
  That's the line this project tries to hold everywhere prompts touch
  behavior: real facts about the world are always given, but nothing is
  ever corrected or coached — a model that loops on its own prior output,
  fixates on a solved need, or never works out how to afford something is
  showing you something real about that model, not a bug to smooth over.
- **Relationships are remembered, not just implied by chat.** After any
  exchange, the speaking agent's own model can optionally update how it
  feels about the other person — a short label in its own words ("a close
  friend", "someone I don't trust") plus a numeric affinity — stored on the
  agent and visible in its inspector. It's deliberately asymmetric: one
  agent can consider another a friend without that being mutual, and there's
  no fixed ladder of relationship stages the engine imposes.
- **Lineage.** Once two agents each independently feel a strong enough bond
  toward the other (affinity 60+, checked on both sides separately), either
  can ask the other to start a family — but nothing happens until the other
  has asked the same thing back, before or after, on their own. Consent has
  to come from both models, not just one; asking doesn't commit anyone to
  anything, and either side can just never follow up. A resulting child
  spawns with fresh needs of its own, inherits one parent's model at random
  so it's immediately part of the run, and shows up in every panel — the
  roster, the canvas, the dashboard — the same as anyone added by hand. A
  fixed population cap (10 agents total, founding or spawned) keeps this
  from spiraling on a long unattended run; once it's hit, a proposal that
  would otherwise succeed just says so instead of quietly failing.
- **Memory carries across encounters.** Every agent remembers what it's
  said, heard, earned, bought, claimed, and who it's met, and that memory is
  fed back into both its decisions and its next conversation with the same
  agent — so it won't re-introduce itself from scratch every time it runs
  into someone it's already spoken to.
- **Reflection, not just recency.** A flat memory list only ever shows the
  last dozen or so raw events, so on a long run older patterns just fall off
  the end. Periodically, an agent's own model looks back over what's built
  up since its last reflection and distills it into a few short first-person
  takeaways ("I've talked to B three times, we get along") — visible in the
  **Agents** inspector and folded into every planning prompt afterward, so
  something it concluded a while ago can still shape what it does now
  instead of only being knowable from a raw play-by-play. This costs an
  extra model call every so often per agent, independent of whatever else
  it's doing at the time.
- **Full transcript**: everything said, and every role claimed, is logged
  live in the transcript panel and shown as an on-canvas speech bubble as it
  happens — nothing is summarized or paraphrased. Simultaneous conversations
  (normal once there are 3+ agents) each get their own live card above the
  transcript so they don't blur into one thread.
- **A model-comparison dashboard.** Since the whole point of running several
  agents on different models is watching how they differ, a **Model
  comparison** panel tallies each model's real behavior — messages spoken,
  money earned/spent/given, and a breakdown of every action it's actually
  taken — grouped by model rather than by agent, so if you reassign a model
  mid-run its earlier history stays correctly attributed. It also charts
  every relationship's affinity as a small trend line over time. Relationship
  bars in the **Agents** inspector use the same color grading (hostile to
  loving) to make the one real affinity number underneath each label visible
  at a glance — this is a visualization of that single existing score, not a
  separate "friendship"/"love" axis the engine tracks, since there's still no
  fixed ladder of relationship stages.

Project layout: simulation logic lives in `src/sim/`, the Ollama client and
prompts in `src/llm/`, app state (including the agent roster) in
`src/state/simStore.ts`, rendering in `src/render/`, and UI panels in
`src/ui/`.

## Save / load

Use the **Save** / **Load** buttons to snapshot the whole sandbox (agents,
their assigned models, memories, reflections, needs, wallets, roles,
relationships, house ownership, transcript, per-model stats, and
relationship-affinity history) to your browser's local storage, so you can
pick up where you left off.
