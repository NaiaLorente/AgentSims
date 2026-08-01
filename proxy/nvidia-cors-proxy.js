// AgentSims — NVIDIA API CORS relay
//
// NVIDIA's build.nvidia.com API doesn't send CORS headers, so browsers
// block AgentSims from calling it directly. This Worker is a thin,
// stateless relay: it forwards whatever request it receives (including
// your API key, untouched) to NVIDIA and adds the one header the browser
// needs to accept the response. It never stores or logs anything.
//
// Deploy (free, ~2 minutes, no CLI required):
//   1. https://dash.cloudflare.com -> sign up/log in (free plan is enough)
//   2. Workers & Pages -> Create -> Create Worker
//   3. Replace the default code with this whole file, click Deploy
//   4. Copy the worker's URL (looks like https://<name>.<you>.workers.dev)
//   5. Paste it into AgentSims' NVIDIA settings -> "Proxy URL"
//
// Optional: change ALLOWED_ORIGIN below to your AgentSims URL instead of
// '*' to restrict who can use your worker.

const NVIDIA_API_BASE = 'https://integrate.api.nvidia.com';
const ALLOWED_ORIGIN = '*';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const target = NVIDIA_API_BASE + url.pathname + url.search;

    const forwardHeaders = new Headers();
    const contentType = request.headers.get('content-type');
    const authorization = request.headers.get('authorization');
    if (contentType) forwardHeaders.set('content-type', contentType);
    if (authorization) forwardHeaders.set('authorization', authorization);

    let upstreamResponse;
    try {
      upstreamResponse = await fetch(target, {
        method: request.method,
        headers: forwardHeaders,
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text(),
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: `Proxy could not reach NVIDIA: ${String(err)}` }), {
        status: 502,
        headers: { 'content-type': 'application/json', ...corsHeaders() },
      });
    }

    const responseHeaders = new Headers(upstreamResponse.headers);
    for (const [key, value] of Object.entries(corsHeaders())) {
      responseHeaders.set(key, value);
    }

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: responseHeaders,
    });
  },
};
