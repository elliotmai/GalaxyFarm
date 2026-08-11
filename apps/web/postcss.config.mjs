/**
 * Tailwind v4 needs no JS config — the design tokens are declared in CSS, in
 * `app/globals.css`, next to the custom properties they are built from.
 */
const config = {
  plugins: { "@tailwindcss/postcss": {} },
};

export default config;
