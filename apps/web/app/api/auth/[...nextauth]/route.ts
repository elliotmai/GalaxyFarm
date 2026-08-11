import { handlers } from "@/lib/auth";

/**
 * Auth.js route handlers. The configuration lives in `lib/auth.ts`; this file
 * exists only to mount it.
 */
export const { GET, POST } = handlers;
