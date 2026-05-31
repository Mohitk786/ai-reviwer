/**
 * PostCSS config — Tailwind v4 uses a single PostCSS plugin (`@tailwindcss/postcss`).
 * No `tailwind.config.js` needed in v4 — themeing is done via `@theme` in CSS.
 */

const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
