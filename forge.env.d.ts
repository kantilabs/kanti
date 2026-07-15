/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />

// Injected by the electron-forge Vite plugin at build time: a map of Vite dev-server
// URLs keyed by renderer entry name (e.g. VITE_DEV_SERVER_URLS['main_window']). In a
// packaged build these are undefined and the app loads the built files instead.
declare const VITE_DEV_SERVER_URLS: Record<string, string>;
