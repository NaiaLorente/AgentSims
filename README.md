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
   in, open any model page, click **Get API Key** — not "Download", which is
   for self-hosting and needs your own GPU anyway).
2. **Deploy the free CORS proxy** (required — NVIDIA's API blocks direct
   browser requests): see [Proxy setup](#proxy-setup-for-cloud-mode) below.
   Takes about 2 minutes, no coding.
3. In the app's **AI settings** panel, switch to **Cloud (NVIDIA key)**,
   paste your API key, your proxy's URL, and pick a model (a small instruct
   model like `meta/llama-3.1-8b-instruct` responds fastest for this
   turn-based sim — the big "reasoning" models work but are noticeably
   slower per turn).
4. Click **Test**. The key is stored only in your browser's local storage and
   is sent only to your proxy and to NVIDIA's API — never to us or anywhere
   else.

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
  CPU): fully private, no rate limits, no account, no proxy needed.
- **Cloud (NVIDIA key)** if your machine can't run a local model well: no
  hardware requirements, but requires deploying the small free proxy below
  (NVIDIA's API blocks direct browser requests), and free-tier usage is
  rate-limited by NVIDIA.

## Proxy setup (for cloud mode)

NVIDIA's API doesn't send the CORS headers browsers require, so a page
can't call it directly (you'll see `Could not reach NVIDIA's API... Failed
to fetch` in the Test result). The fix is `proxy/nvidia-cors-proxy.js` — a
tiny, stateless relay you deploy to your own free Cloudflare account. It
just forwards your request (and your API key, unmodified) to NVIDIA and
adds the missing header; it never stores or sees anything beyond that one
request.

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) and sign up (or
   log in) — the free plan covers this easily.
2. **Workers & Pages → Create → Create Worker.**
3. Replace the default starter code with the full contents of
   [`proxy/nvidia-cors-proxy.js`](proxy/nvidia-cors-proxy.js), then **Deploy**.
4. Copy the worker's URL (something like
   `https://nvidia-cors-proxy.<your-subdomain>.workers.dev`).
5. Paste it into AgentSims' **Cloud (NVIDIA key)** settings under **Proxy
   URL**.

You only need to do this once; the same worker keeps working for future
sessions.

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

**Cloud mode** works the same whether hosted or run locally, as long as
you've deployed the proxy (see above) — the browser calls your Worker over
https either way, so there's no mixed-content issue there.

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
