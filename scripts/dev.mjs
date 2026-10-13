import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const windows = process.platform === 'win32';
const children = new Set();
let stopping = false;

function signalChild(child, signal) {
  if (!child.pid) return;
  try {
    if (windows) {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      // Yarn launches watchers and servers: signal the whole process group.
      process.kill(-child.pid, signal);
    }
  } catch (error) {
    if (error.code !== 'ESRCH') console.error(error.message);
  }
}

function stop(exitCode) {
  if (stopping) return;
  stopping = true;
  process.exitCode = exitCode;
  for (const child of children) signalChild(child, 'SIGTERM');
  setTimeout(() => {
    for (const child of children) signalChild(child, 'SIGKILL');
  }, 5_000);
}

process.once('SIGINT', () => stop(130));
process.once('SIGTERM', () => stop(143));

for (const [service, script] of [['api', 'start:dev'], ['web', 'dev']]) {
  if (stopping) break;
  const yarn = process.env.npm_execpath;
  const command = yarn ? process.execPath : (windows ? 'yarn.cmd' : 'yarn');
  const args = [...(yarn ? [yarn] : []), '--cwd', service, 'run', script];
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', detached: !windows });
  children.add(child);
  child.once('error', (error) => {
    console.error(`[${service}] ${error.message}`);
    stop(1);
  });
  child.once('close', (code, signal) => {
    if (!stopping) {
      console.error(`[${service}] exited (${signal ?? code}); stopping services.`);
      stop(code && code > 0 ? code : 1);
    }
    // Keep the process group until the final kill: a watcher may exit before
    // one of its descendants has stopped. The shutdown budget is five seconds.
  });
}
