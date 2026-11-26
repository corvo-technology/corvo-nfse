import { connect, type TLSSocket } from 'node:tls';
import { isIP } from 'node:net';

export const PROBE_TIMEOUT_MS = 5_000;

/**
 * Opens a TCP connection and completes the TLS handshake with `host`, then closes it. No HTTP
 * request and no certificate: it only answers "can we reach that machine from here". The
 * certificate chain is not checked on purpose; a bad chain is not a network problem.
 */
export function probeTls(
  host: string,
  port = 443,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<boolean> {
  return new Promise((resolve) => {
    let socket: TLSSocket | undefined;
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      socket?.destroy();
      resolve(ok);
    };
    try {
      socket = connect({
        host,
        port,
        ...(isIP(host) ? {} : { servername: host }),
        rejectUnauthorized: false,
        timeout: timeoutMs,
      });
      socket.once('secureConnect', () => finish(true));
      socket.once('error', () => finish(false));
      socket.once('timeout', () => finish(false));
    } catch {
      finish(false);
    }
  });
}
