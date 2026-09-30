// Shared by request validation and disposable scale verification.
//
// One batch is applied in one SERIALIZABLE transaction with the default
// 30-second timeout, holding its locks throughout. 200 cash sales took about
// 24 s on an idle disposable MariaDB and over 30 s under load (F-71), so a
// batch is capped at 100 (about 12 s). A terminal with more sends several
// batches; duplicate detection makes a resend safe.
export const OFFLINE_SYNC_MAX_COMMANDS = 100;
