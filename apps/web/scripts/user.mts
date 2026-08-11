import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { ROLES, encodeUlid, type Role } from "@galaxy-farm/core";
import { hashPassword } from "@galaxy-farm/infra-auth";
import { createDatabase, describeConnection, users, SEED_PROPERTY_ID } from "@galaxy-farm/infra-db";
import { eq } from "drizzle-orm";

/**
 * `pnpm db:user` — create an account, or reset a password.
 *
 * There is no sign-up page and there is not going to be one. This is a private
 * farm: every account is either the two owners, somebody hired, a boarding
 * customer, or a housesitter watching the place for a week. All four are
 * created by someone who already has an account, and a public form would be a
 * way for anyone on the internet to become a user of a system that lists where
 * the animals are.
 *
 * Until the user-management screen exists (§7, `/admin/settings`), this is how.
 * It is also the password-reset path, since nobody has email wired yet.
 *
 * The password is prompted for rather than passed as an argument: arguments
 * land in shell history and in the process list.
 */

const url = process.env["DATABASE_URL"];
if (url === undefined || url === "") {
  console.error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
  process.exit(1);
}

const target = describeConnection(url);
console.log(`Users in ${target.database} at ${target.host}`);

const rl = createInterface({ input: stdin, output: stdout });
const email = (await rl.question("Email: ")).trim().toLowerCase();
if (email === "") {
  console.error("An email is required.");
  rl.close();
  process.exit(1);
}

const { db, close } = createDatabase(url);

try {
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  if (existing !== undefined) {
    console.log(`Found ${existing.name} (${existing.role}). Leaving the role alone.`);
  }

  const name = existing?.name ?? ((await rl.question("Name: ")).trim() || email);

  let role: Role = (existing?.role as Role | undefined) ?? "owner";
  if (existing === undefined) {
    const answer = (await rl.question(`Role [${ROLES.join(" | ")}] (owner): `)).trim();
    if (answer !== "") {
      if (!(ROLES as readonly string[]).includes(answer)) {
        console.error(`Not a role. Choose one of: ${ROLES.join(", ")}`);
        rl.close();
        await close();
        process.exit(1);
      }
      role = answer as Role;
    }
  }

  const password = (await rl.question("Password: ")).trim();
  if (password.length < 12) {
    console.error("Use at least 12 characters.");
    rl.close();
    await close();
    process.exit(1);
  }

  const now = new Date();
  const passwordHash = await hashPassword(password);

  if (existing === undefined) {
    await db.insert(users).values({
      id: encodeUlid(now.getTime()),
      propertyId: SEED_PROPERTY_ID,
      createdAt: now,
      updatedAt: now,
      email,
      name,
      role,
      passwordHash,
      active: true,
    });
    console.log(`Created ${email} as ${role}.`);
  } else {
    // A password change is a real edit to the row, so updatedAt moves with it.
    await db
      .update(users)
      .set({ passwordHash, active: true, updatedAt: now })
      .where(eq(users.email, email));
    console.log(`Password reset for ${email}. The account is active.`);
  }
} finally {
  rl.close();
  await close();
}
