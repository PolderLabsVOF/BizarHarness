/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Build SHA injected at vite-build time via `define` in vite.config.ts.
   * Falls back to the literal 'dev' when running `vite` in dev mode or
   * when BIZAR_BUILD_SHA is unset. The Sidebar footer reads this to
   * annotate the running build.
   */
  readonly VITE_BUILD_SHA: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
