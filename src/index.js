const app = require('./server');
const adminApp = require('./admin');
const metrics = require('./metrics');

const port = process.env.PORT || 3000;
app.listen(port, (err) => {
  if (err) {
    throw err;
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
    console.log(`Admin server listening on ${adminPort}`);
  });
}

metrics.listen();
