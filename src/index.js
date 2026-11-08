const fs = require('node:fs');
const app = require('./server');
const adminApp = require('./admin');
const metrics = require('./metrics');

// PORT and ADMIN_PORT can be a port number or a unix socket path. Unix sockets are chmodded so that
// the reverse proxy can connect even if it runs as a different user.
const isUnixSocket = (port) => typeof port === 'string' && !/^\d+$/.test(port);

const port = process.env.PORT || 3000;
app.listen(port, (err) => {
  if (err) {
    throw err;
  }
  if (isUnixSocket(port)) {
    fs.chmodSync(port, 0o777);
  }
  console.log(`Public server listening on ${port}`);
});

// The admin server has no authentication, so it must only be reachable over localhost or tailscale.
const adminPort = process.env.ADMIN_PORT;
if (adminPort) {
  adminApp.listen(adminPort, '127.0.0.1', (err) => {
    if (err) {
      throw err;
    }
    if (isUnixSocket(adminPort)) {
      fs.chmodSync(adminPort, 0o777);
    }
    console.log(`Admin server listening on ${adminPort}`);
  });
}

metrics.listen();
