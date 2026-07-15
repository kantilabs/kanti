/// <reference types="svelte" />
/// <reference types="@sveltejs/kit" />
/// <reference types="vite/client" />

import type { ExposeInRendererTypes, ProxyAPI, ProjectAPI, FfufAPI, TabAPI, LlmAPI, FetchAPI, BackendAPI, AgentAPI } from './preload.ts';

interface ElectronAPI extends ExposeInRendererTypes {
  proxy: ProxyAPI;
  project: ProjectAPI;
  ffuf: FfufAPI;
  tab: TabAPI;
  llm: LlmAPI;
  fetch: FetchAPI;
  backend: BackendAPI;
  agent: AgentAPI;
  // Optional: a scope-settings bridge some views probe defensively (`if
  // (electronAPI.scope)`). Not currently wired in preload, so it is optional.
  scope?: {
    getSettings: () => Promise<any>;
  };
}

declare global {
  // Lets typescript know about exposed preload functions
  interface Window {
    electronAPI: ElectronAPI;
    setTitleBarColors: (backgroundColor: string, textColor: string) => void;
    // Exposed directly on window by preload's exposeInRenderer bridge.
    toggleDevTools: () => void;
  }

  // See https://kit.svelte.dev/docs/types#app
  // for information about these interfaces
  namespace App {
    interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
}

export {};
