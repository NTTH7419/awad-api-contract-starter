import { open, DB_PATH } from './db.js';
import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 3001);
const server = createApp(open()).listen(port, () =>
  console.log(`menu service on :${port} · db ${DB_PATH} · pid ${process.pid}`));

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(() => process.exit(0));
  // A client may keep an idle HTTP connection open after its response. Do not
  // make process shutdown (and release of the SQLite files) wait for its
  // keep-alive timeout.
  server.closeAllConnections?.();
}

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, shutdown);
