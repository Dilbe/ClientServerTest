// The server's log lines (issue #168). In a container the log is simply what
// the server writes to its standard output and standard error: Hostim
// collects both and shows them in the app's Logs tab, a bit like a Windows
// service writing to the Event Log, except the server knows nothing about
// where its lines end up.
//
// Hostim shows the time to the second only, so lines from an old and a new
// server in the same second can come out in the wrong order. Every line
// therefore starts with its own time in UTC, with milliseconds:
//
//   2026-10-10T18:31:05.123Z Restored the database from /data/game.db.before-step-9.
//
// Never log secrets (passwords, session cookies) or personal data (account
// names, IP addresses): the log is stored by Hostim and anyone with access to
// the dashboard can read it.

/** Writes a line to standard output. `details`, like an error, are printed after it as console.log would. */
export function log(message: string, ...details: unknown[]): void {
  console.log(`${new Date().toISOString()} ${message}`, ...details);
}

/** Writes a line to standard error, for things that went wrong. An error in `details` is printed with its stack trace. */
export function logError(message: string, ...details: unknown[]): void {
  console.error(`${new Date().toISOString()} ${message}`, ...details);
}
