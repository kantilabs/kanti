import { writable } from 'svelte/store';
import type { BackendStatus, BackendListEntry, BackendSelectOpts } from '../../preload';

// Renderer-side mirror of the main process's active exec backend. The chat Agent
// header mounts BackendSelector, which drives select() and reflects status here.
export interface BackendState {
  /** The kind actually in use (a docker request can downgrade to local). */
  kind: 'local' | 'docker';
  /** The kind the user requested. */
  requested: 'local' | 'docker';
  provisioned: boolean;
  containerId: string;
  image: string;
  /** Downgrade explanation from the main-process resolver, if any. */
  warning?: string;
  /** Selectable kinds + availability, for the dropdown. */
  available: BackendListEntry[];
  /** True while a select/provision/teardown IPC round-trip is in flight. */
  busy: boolean;
}

const initial: BackendState = {
  kind: 'local',
  requested: 'local',
  provisioned: false,
  containerId: '',
  image: 'kanti-toolbox:latest',
  warning: undefined,
  available: [],
  busy: false
};

const hasApi = () => typeof window !== 'undefined' && !!window.electronAPI?.backend;

const createBackendStore = () => {
  const { subscribe, set, update } = writable<BackendState>(initial);

  const applyStatus = (s: BackendStatus) =>
    update((v) => ({
      ...v,
      kind: s.kind,
      requested: s.requested,
      provisioned: s.provisioned,
      containerId: s.containerId,
      image: s.image,
      warning: s.warning
    }));

  // Load the current status + selectable kinds from main on first use.
  const init = async () => {
    if (!hasApi()) return;
    try {
      const [status, available] = await Promise.all([
        window.electronAPI.backend.status(),
        window.electronAPI.backend.list()
      ]);
      update((v) => ({ ...v, available }));
      applyStatus(status);
    } catch (error) {
      console.error('Error initializing backend store:', error);
    }
  };

  const select = async (kind: 'local' | 'docker', opts: BackendSelectOpts = {}) => {
    if (!hasApi()) return;
    update((v) => ({ ...v, busy: true }));
    try {
      const status = await window.electronAPI.backend.select(kind, opts);
      applyStatus(status);
    } catch (error) {
      console.error('Error selecting backend:', error);
    } finally {
      update((v) => ({ ...v, busy: false }));
    }
  };

  const provision = async () => {
    if (!hasApi()) return;
    update((v) => ({ ...v, busy: true }));
    try {
      applyStatus(await window.electronAPI.backend.provision());
    } catch (error) {
      console.error('Error provisioning backend:', error);
    } finally {
      update((v) => ({ ...v, busy: false }));
    }
  };

  const teardown = async () => {
    if (!hasApi()) return;
    update((v) => ({ ...v, busy: true }));
    try {
      applyStatus(await window.electronAPI.backend.teardown());
    } catch (error) {
      console.error('Error tearing down backend:', error);
    } finally {
      update((v) => ({ ...v, busy: false }));
    }
  };

  init();

  return { subscribe, set, update, init, select, provision, teardown };
};

export const backendStore = createBackendStore();
