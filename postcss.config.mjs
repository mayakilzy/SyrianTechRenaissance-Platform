const isVitest = !!process.env.VITEST;

// When running under Vitest, return empty plugins so Vite's PostCSS loader
// doesn't try to initialize @tailwindcss/postcss (which pulls in lightningcss,
// a native module that Vite's loader can't resolve). Next.js gets the real
// plugin via string-form autoload.
const config = {
  plugins: isVitest ? [] : ["@tailwindcss/postcss"],
};

export default config;
