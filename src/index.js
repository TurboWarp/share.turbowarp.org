const app = require('./server');
const adminApp = require('./admin');
const metrics = require('./metrics');

// Same environment variables as @sveltejs/adapter-node so existing deployments keep working.
const socketPath = process.env.SOCKET_PATH;
const host = process.env.HOST || '0.0.0.0';
const port = +process.env.PORT || 3000;

const onListening = (name, address) => (err) => {
  if (err) {
    throw err;
  }
  console.log(`${name} listening on ${address}`);
};

if (socketPath) {
  app.listen(socketPath, onListening('Public server', socketPath));
} else {
  app.listen(port, host, onListening('Public server', `${host}:${port}`));
}

// The admin server has no authentication. Keep it on localhost and expose it over tailscale
// (`tailscale serve`), or set ADMIN_HOST to the machine's tailscale IP. Never 0.0.0.0.
if (process.env.ADMIN_PORT) {
  const adminHost = process.env.ADMIN_HOST || '127.0.0.1';
  const adminPort = +process.env.ADMIN_PORT;
  adminApp.listen(adminPort, adminHost, onListening('Admin server', `${adminHost}:${adminPort}`));
}

metrics.listen();
