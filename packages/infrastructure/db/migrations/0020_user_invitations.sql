-- An account exists before its password does.
--
-- People are added by email and role, and set their own password from a
-- single-use invitation link. A password chosen on somebody's behalf is a
-- password two people know, travels over whatever channel was to hand, and is
-- almost never changed afterwards.
--
-- So `password_hash` becomes nullable: NULL means "invited, has not accepted",
-- which is a real and visible state rather than a placeholder. Every sign-in
-- path already refuses a row it cannot verify against, and now refuses this one
-- explicitly instead of relying on a hash that parses to nothing.
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;

-- Only the hash of the token, never the token. Whoever holds this column holds
-- nothing: a stolen backup cannot be turned into a link that sets somebody's
-- password. SHA-256 rather than scrypt deliberately — the token is 256 bits of
-- randomness, so there is nothing to brute-force, and the lookup has to find a
-- row by the value the link carries, which a salted hash cannot do.
ALTER TABLE "users" ADD COLUMN "invite_token_hash" text;

-- Nullable, and cleared the moment the invitation is used or replaced. A
-- non-null expiry with a null hash is an invitation already accepted.
ALTER TABLE "users" ADD COLUMN "invite_expires_at" timestamp with time zone;

-- The accept path arrives holding only the token, so this is the index it
-- lands on. Partial, because every accepted account has NULL here and there is
-- no reason to carry them.
CREATE INDEX IF NOT EXISTS "users_invite_token_hash_idx"
  ON "users" ("invite_token_hash")
  WHERE "invite_token_hash" IS NOT NULL;
