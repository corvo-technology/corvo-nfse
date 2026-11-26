import { connect, type Socket } from 'node:net';

export const PROBE_TIMEOUT_MS = 5_000;

/**
 * Opens a TCP connection to `host` and closes it. No TLS and no HTTP request: it only answers
 * "can we reach that machine from here". A completed connect is enough; the certificate chain is
 * not a network problem (gov hosts may use ICP-Brasil chains outside Node's CA store), so it is
 * never inspected.
 */
export function probeTcp(
  host: string,
  port = 443,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<boolean> {
  return new Promise((resolve) => {
    let socket: Socket | undefined;
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      socket?.destroy();
      resolve(ok);
    };
    try {
      socket = connect({ host, port, timeout: timeoutMs });
      socket.once('connect', () => finish(true));
      socket.once('error', () => finish(false));
      socket.once('timeout', () => finish(false));
    } catch {
      finish(false);
    }
  });
}
