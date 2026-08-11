import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { hashPassword } from "@galaxy-farm/infra-auth";

import { createDatabase, describeConnection, seed } from "@galaxy-farm/infra-db";

/**
 * `pnpm db:seed` — put the farm in the database and create the first owner.
 *
 * The password is asked for rather than taken from an argument or an
 * environment variable: both end up in a shell history file, and the first
 * owner's password is the key to everything else here.
 *
 * It lives in the app rather than in `infra-db` because it composes two
 * adapters — the database and the password hashing — and §4.1 says only the
 * composition root does that. A seed script is a composition root; it just
 * happens to be one with no UI.
 *
 * `.mts`, not `.ts`. A Next app has no `"type": "module"` in its manifest, so
 * tsx compiles a plain `.ts` as CommonJS and every top-level `await` below
 * fails to parse. The extension is the only thing that says otherwise.
 */

const url = process.env["DATABASE_URL"];
if (url === undefined || url === "") {
  console.error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
  process.exit(1);
}

const target = describeConnection(url);
console.log(`Seeding ${target.database} at ${target.host}`);

const rl = createInterface({ input: stdin, output: stdout });
const email = (await rl.question("Owner email (blank to skip creating a user): ")).trim();

let owner: { email: string; name: string; passwordHash: string } | undefined;
if (email !== "") {
  const name = (await rl.question("Owner name: ")).trim();
  const password = (await rl.question("Owner password: ")).trim();

  if (password.length < 12) {
    console.error("Use at least 12 characters. This is the key to the whole farm.");
    rl.close();
    process.exit(1);
  }

  owner = { email, name: name === "" ? email : name, passwordHash: await hashPassword(password) };
}
rl.close();

const { db, close } = createDatabase(url);
try {
  const summary = await seed(db, { now: new Date(), ...(owner === undefined ? {} : { owner }) });
  console.log(
    `Seeded ${summary.zones} zones, ${summary.waterSources} water sources, ` +
      `${summary.animals} animal${summary.animals === 1 ? "" : "s"}.`,
  );
  if (summary.ownerId !== undefined) console.log(`Owner ready: ${email}`);
  console.log("Re-running this is safe — it updates rather than duplicates.");
} finally {
  await close();
}
