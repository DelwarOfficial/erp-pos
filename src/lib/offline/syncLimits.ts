// Shared by request validation and disposable scale verification.
//
// One batch is applied in one SERIALIZABLE transaction with the default
// 30-second timeout, holding its locks throughout. 200 cash sales took about
// 24 s on an idle disposable MariaDB and over 30 s under load (F-71), so a
// batch is capped at 100 (about 12 s). A terminal with more sends several
// batches; duplicate detection makes a resend safe.
export const OFFLINE_SYNC_MAX_COMMANDS = 100;

// The most of one product an offline sale line may hold: the device carries
// the server's priced total for each quantity up to this.
export const OFFLINE_MAX_QTY = 10;

// How far an offline sale's own date may be from the server's clock: a till
// can be a few minutes fast, and may hold sales for up to a week offline.
export const OFFLINE_CLOCK_SKEW_MS = 5 * 60 * 1000;
export const OFFLINE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
