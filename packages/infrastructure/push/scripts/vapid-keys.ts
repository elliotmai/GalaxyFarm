import { generateVapidKeys } from "../src/vapid.js";

/**
 * `pnpm vapid:keys` — mint the one keypair this farm's push notifications use.
 *
 * A script rather than a paragraph in the README telling somebody to run
 * `openssl ecparam`, because the output has to be exactly the two base64url
 * strings the browser and the push service expect, and every hand-rolled
 * incantation for producing them gets the encoding wrong in a way that only
 * shows up as a 401 from a push service weeks later.
 *
 * Run it once. Replacing the pair later invalidates every subscription on
 * every device — see the note in `src/vapid.ts` — so the output belongs in
 * `.env.local` and in the Netlify environment variables, not in a commit.
 */

const { publicKey, privateKey } = generateVapidKeys();

console.log(`
A VAPID keypair for Galaxy Farm. Put both in .env.local for a laptop, and in
the Netlify environment variables for the deployed site. Keep the private one
out of the repository — it is a server secret, like RESEND_API_KEY.

NEXT_PUBLIC_VAPID_PUBLIC_KEY="${publicKey}"
VAPID_PRIVATE_KEY="${privateKey}"
VAPID_SUBJECT="mailto:you@example.com"

VAPID_SUBJECT is who a push service contacts about this application server, so
set it to an address somebody reads. Every existing subscription is bound to
the public key above: generating a second pair silently stops every device
that already subscribed, and the only fix is for each of them to subscribe
again.
`);
