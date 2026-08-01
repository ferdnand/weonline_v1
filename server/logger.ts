/**
 * The single structured logger for the whole backend.
 *
 * Replaces the scattered console.* calls so every operational event is emitted
 * as structured JSON with a level, a timestamp, and a `mod` (module) tag. Three
 * output shapes, selected by environment:
 *
 *  - dev            → pretty, colourised lines (pino-pretty) for readability.
 *  - prod (default) → newline-delimited JSON on stdout. Persistent hosts
 *                     (Railway/Render) and their log drains capture stdout, so
 *                     this alone gives searchable, retained logs.
 *  - prod + Better Stack → if BETTERSTACK_SOURCE_TOKEN is set, logs ALSO ship to
 *                     Better Stack (Logtail) via @logtail/pino for hosted search
 *                     and long retention. stdout still receives them too.
 *
 * This is operational logging (requests, ticks, errors). The business audit
 * trail ("who did what") is separate and persisted in the store — see
 * server/audit.ts — though audit events are mirrored here as well so they reach
 * the log platform.
 */

import pino from 'pino';

const isProd = process.env.NODE_ENV === 'production';
const level = process.env.LOG_LEVEL || (isProd ? 'info' : 'debug');

// Better Stack (Logtail) source token — when present, tee logs to the platform.
// Kept optional so the app runs identically with zero external logging config.
const betterStackToken = process.env.BETTERSTACK_SOURCE_TOKEN;
const betterStackEndpoint = process.env.BETTERSTACK_INGESTING_HOST; // e.g. s1234.eu-nbg-2.betterstackdata.com

function buildTransport(): pino.TransportMultiOptions | pino.TransportSingleOptions | undefined {
  const targets: pino.TransportTargetOptions[] = [];

  if (!isProd) {
    // Human-friendly dev console.
    targets.push({
      target: 'pino-pretty',
      level,
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
    });
  } else {
    // Structured JSON to stdout (captured by the host / its log drain).
    targets.push({ target: 'pino/file', level, options: { destination: 1 } });
  }

  // Optional: also ship to Better Stack. Requires BETTERSTACK_SOURCE_TOKEN and,
  // for newer Better Stack sources, BETTERSTACK_INGESTING_HOST.
  if (betterStackToken) {
    targets.push({
      target: '@logtail/pino',
      level,
      options: {
        sourceToken: betterStackToken,
        ...(betterStackEndpoint ? { options: { endpoint: `https://${betterStackEndpoint}` } } : {}),
      },
    });
  }

  return targets.length === 1 ? targets[0] : { targets };
}

export const logger = pino({
  level,
  base: { app: 'weonline' },
  // ISO timestamps read better in aggregators than epoch millis.
  timestamp: pino.stdTimeFunctions.isoTime,
  // Never let a credential leak into logs even if an object carrying one is passed.
  redact: {
    paths: ['password', '*.password', 'req.headers.authorization', 'token', '*.token'],
    censor: '[redacted]',
  },
  transport: buildTransport(),
});

/** A child logger tagged with a module name, e.g. `log('scheduler')`. */
export function log(mod: string) {
  return logger.child({ mod });
}
