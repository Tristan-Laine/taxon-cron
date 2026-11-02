// Hourly trigger for the "streak at risk" push of the games still on Vercel.
//
// GitHub's schedule ran push-hourly.yml only 4 to 6 times a day, and each route
// only sends in a subscriber's 21:00 hour, so most evenings had no run. Cloudflare
// runs this one every hour. A game on Cloudflare has its own trigger in its Worker
// (OverwatchDLE since 2026-11-02): "push": false on its line in sites.json. Once
// every game has moved, this Worker can be deleted.
//
// Each /api/push-send decides on its own who is in their local evening and at
// risk, and never sends twice in a day. Never add ?force=1 here: it writes to
// every subscriber.

import sites from '../sites.json';

const TIMEOUT_MS = 25000;

async function ping(site, tokens) {
  const token = tokens[site.id];
  if (!token) throw new Error('no entry in CRON_SECRETS');
  const res = await fetch(`https://${site.domain}/api/push-send`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // No secret in these answers: the counts, or the error.
  const body = (await res.text()).slice(0, 200);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${body}`);
  return body;
}

export default {
  async scheduled(_controller, env, ctx) {
    const tokens = JSON.parse(env.CRON_SECRETS);
    const targets = sites.filter((site) => site.push !== false);
    ctx.waitUntil(
      // A game that fails does not stop the others; the run then ends in error,
      // so it shows in the Worker's logs.
      Promise.allSettled(targets.map((site) => ping(site, tokens))).then((results) => {
        const failed = [];
        results.forEach((result, i) => {
          const { id } = targets[i];
          if (result.status === 'fulfilled') {
            console.log(`ok ${id} ${result.value}`);
          } else {
            console.error(`failed ${id}: ${result.reason?.message ?? result.reason}`);
            failed.push(id);
          }
        });
        if (failed.length > 0) throw new Error(`push-send failed for: ${failed.join(' ')}`);
      }),
    );
  },
};
