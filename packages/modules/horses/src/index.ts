/**
 * The horses module (spec §5.9) — a placeholder with two live parts.
 *
 * The module itself is stub routes: herd, pens, feeding and breeding are
 * "coming soon" shells so navigation and permissions are already real. What is
 * live now is the shopping, because §5.9 says horses are "the purchase
 * furthest out and the one most worth researching slowly, so the shopping
 * surface is live long before the module is."
 *
 * That surface is two halves. The candidate extension is what you compare one
 * horse against another on; the roadmap reading is what says whether any of
 * them is the horse you said you wanted, at the price you said you would pay.
 * Neither needs a horse on the place to be useful, which is the whole point.
 *
 * When horses arrive, the build is filling in a prepared module rather than
 * designing one.
 */

export * from "./domain/horse-candidate.js";
export * from "./domain/horse-roadmap.js";
