/**
 * Registers the jest-dom matchers with Vitest's `Assertion` interface.
 *
 * The runtime side is handled by the shared setup file; this is purely so
 * `toBeInTheDocument` and friends typecheck. It has to be a static import —
 * the setup file loads jest-dom dynamically (it is guarded on `document`
 * existing), and a dynamic import does not trigger module augmentation.
 */
import "@testing-library/jest-dom/vitest";
