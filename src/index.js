const app = require('./server');
const metrics = require('./metrics');

// Same environment variables as @sveltejs/adapter-node so existing deployments keep working.
const socketPath = process.env.SOCKET_PATH;
const host = process.env.HOST || '0.0.0.0';
const port = +process.env.PORT || 3000;

const onListening = (err) => {
  if (err) {
    throw err;
  }
  console.log(`Listening on ${socketPath || `${host}:${port}`}`);
};

if (socketPath) {
  app.listen(socketPath, onListening);
} else {
  app.listen(port, host, onListening);
}

metrics.listen();
