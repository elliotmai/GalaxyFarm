/**
 * The design system (spec §8).
 *
 * Presentation only: it takes data as props and knows nothing about the domain
 * beyond the shared kernel's types. The architecture test fails the build if
 * this package ever imports a module or an infrastructure adapter.
 */

export * from "./confirm/index.js";
export * from "./primitives/index.js";
export * from "./tokens/contrast.js";
export * from "./safety/safety-badge.js";
export * from "./halter/halter-swatch.js";
export * from "./brand/logomark.js";
