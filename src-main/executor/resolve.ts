// Backend resolution, mirroring internal/executor/docker.go's Resolve. A "docker"
// request degrades to "local" (the sandboxless backend) when the docker CLI/daemon
// is unavailable or the image is neither present nor pullable — keeping the agent
// productive instead of aborting — and the warning explains the downgrade. Kept
// electron-free: only shells out to `docker`.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DEFAULT_TOOLBOX_IMAGE } from './backend';

const execFileAsync = promisify(execFile);

export interface ResolveResult {
  chosen: 'local' | 'docker';
  /** Non-empty only when a docker request had to downgrade to local. */
  warn?: string;
}

/** dockerAvailable reports whether the docker CLI is present AND the daemon
 *  answers (`docker version` exits 0). */
async function dockerAvailable(): Promise<boolean> {
  try {
    await execFileAsync('docker', ['version'], { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

/** imagePresent reports whether the named image is available locally (so
 *  `docker run <image>` won't have to pull). */
async function imagePresent(image: string): Promise<boolean> {
  try {
    await execFileAsync('docker', ['image', 'inspect', image], { timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

/** imagePullable reports whether the registry has the image (manifest reachable),
 *  so a not-yet-pulled image is still usable. Best-effort; a slow/absent registry
 *  just yields false and we downgrade. */
async function imagePullable(image: string): Promise<boolean> {
  try {
    await execFileAsync('docker', ['manifest', 'inspect', image], { timeout: 20_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * resolve returns the backend to actually use. A local request is honored as-is.
 * A docker request requires the daemon up AND the image present-or-pullable;
 * otherwise it downgrades to local with an actionable warning.
 */
export async function resolve(
  backend: 'local' | 'docker',
  image: string = DEFAULT_TOOLBOX_IMAGE,
): Promise<ResolveResult> {
  if (backend !== 'docker') return { chosen: 'local' };
  const img = image || DEFAULT_TOOLBOX_IMAGE;
  if (!(await dockerAvailable())) {
    return {
      chosen: 'local',
      warn: 'Docker unavailable, using local backend. Install/start Docker, or the agent runs WITHOUT container isolation.',
    };
  }
  if (!(await imagePresent(img)) && !(await imagePullable(img))) {
    return {
      chosen: 'local',
      warn: `Docker image "${img}" not built and not pullable — using local backend (no container isolation). Build it: docker build -t ${img} -f Dockerfile.toolbox .`,
    };
  }
  return { chosen: 'docker' };
}
