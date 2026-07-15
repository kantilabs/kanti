import { writable } from 'svelte/store';
import type { CapturedRequest } from '$lib/types';

// A role/session used to replay a request with a different identity.
// `cookie` is a raw Cookie header value (e.g. "session=abc; csrf=xyz").
// `headers` is raw newline-separated extra headers (e.g. "Authorization: Bearer ...").
export interface AuthRole {
  label: string;
  cookie: string;
  headers: string;
}

// The result of replaying one request under one role.
export interface RoleTestResult {
  roleLabel: string;
  statusCode: number;
  responseTime: number;
  responseLength: number;
  success: boolean;
  error?: string;
}

// The aggregated result of replaying one captured request under every role.
export interface AuthTestResult {
  request: CapturedRequest;
  results: RoleTestResult[];
  // True when the roles produced diverging status codes for the same request,
  // which is a potential broken-access-control signal.
  mismatch: boolean;
}

export interface AuthState {
  roles: AuthRole[];
  testResults: AuthTestResult[];
  running: boolean;
}

const STORAGE_KEY = 'authRoles';

function createAuthStore() {
  const { subscribe, set, update } = writable<AuthState>({
    roles: [],
    testResults: [],
    running: false
  });

  return {
    subscribe,
    set,

    // Add a role/session
    addRole(role: AuthRole) {
      update(state => ({ ...state, roles: [...state.roles, role] }));
    },

    // Remove a role/session by index
    removeRole(index: number) {
      update(state => ({
        ...state,
        roles: state.roles.filter((_, i) => i !== index)
      }));
    },

    // Update a role/session in place
    updateRole(index: number, role: AuthRole) {
      update(state => ({
        ...state,
        roles: state.roles.map((r, i) => (i === index ? role : r))
      }));
    },

    // Replace the whole roles array
    setRoles(roles: AuthRole[]) {
      update(state => ({ ...state, roles }));
    },

    // Toggle the running flag while tests are in flight
    setRunning(running: boolean) {
      update(state => ({ ...state, running }));
    },

    // Add a test result (newest first, capped at 100)
    addTestResult(result: AuthTestResult) {
      update(state => ({
        ...state,
        testResults: [result, ...state.testResults].slice(0, 100)
      }));
    },

    // Clear all test results
    clearTestResults() {
      update(state => ({ ...state, testResults: [] }));
    },

    // Load roles from localStorage
    loadFromStorage() {
      if (typeof localStorage === 'undefined') return;
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return;
      try {
        const roles = JSON.parse(saved) as AuthRole[];
        update(state => ({ ...state, roles }));
      } catch (error) {
        console.error('Failed to load auth roles from storage:', error);
      }
    },

    // Save roles to localStorage
    saveToStorage(roles: AuthRole[]) {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(roles));
    }
  };
}

export const authStore = createAuthStore();
