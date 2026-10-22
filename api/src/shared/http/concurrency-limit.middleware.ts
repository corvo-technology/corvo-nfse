import type { NextFunction, Request, Response } from 'express';

const EXEMPT_PATH = /\/health$/;

/**
 * Sheds load once a process already has `max` requests in flight, so a flood
 * cannot queue unbounded work behind the Postgres pool or the event loop. `0` disables it.
 */
export function createConcurrencyLimit(max: number) {
  let inFlight = 0;
  return (req: Request, res: Response, next: NextFunction) => {
    if (max <= 0 || EXEMPT_PATH.test(req.path)) return next();
    if (inFlight >= max) {
      res.setHeader('Retry-After', 1);
      res.status(503).json({
        code: 'ERROR_SERVER_BUSY',
        message: 'Server is busy, retry shortly',
      });
      return;
    }
    inFlight++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      inFlight--;
    };
    res.once('finish', release);
    res.once('close', release);
    next();
  };
}
