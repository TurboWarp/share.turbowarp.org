// The admin server. It has no authentication of its own: it must only be reachable by moderators,
// e.g. by listening on localhost and exposing it with `tailscale serve`. See src/index.js.

const path = require('node:path');
const express = require('express');
const db = require('./db');
const createRenderer = require('./render');
const {notFound, createErrorHandler} = require('./errors');
const {PUBLIC_URL} = require('./config/brand');
const APIError = require('./APIError');

const app = express();

app.set('case sensitive routing', true);
app.set('x-powered-by', false);
app.set('query parser', (q) => new URLSearchParams(q));

const render = createRenderer({
  isAdmin: true,
  PUBLIC_URL
});

app.use((req, res, next) => {
  res.header('X-Content-Type-Options', 'nosniff');
  res.header('X-Frame-Options', 'DENY');
  res.header('Referrer-Policy', 'no-referrer');
  next();
});

// Network access is the only thing protecting this server, so make sure other websites open in
// a moderator's browser can't make it do things. Browsers that don't send Sec-Fetch-Site still
// need a CORS preflight for DELETE, which we never allow.
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const site = req.get('sec-fetch-site');
    if (typeof site === 'string' && site !== 'same-origin') {
      throw new APIError(403, 'cross-origin request');
    }
  }
  next();
});

app.use(express.static(path.join(__dirname, '..', 'static')));

app.get('/', (req, res) => {
  render(res, 'admin-reports', {
    reports: db.getAllReports()
  });
});

app.delete('/api/reports/:report', (req, res) => {
  const reportId = +req.params.report;
  if (!Number.isSafeInteger(reportId)) {
    throw new APIError(400, 'invalid report ID');
  }
  db.deleteReport(reportId);
  res.json({});
});

app.delete('/api/projects/:project', (req, res) => {
  // Also deletes the project's reports
  db.deleteProject(req.params.project);
  res.json({});
});

app.use(notFound);
app.use(createErrorHandler(render));

module.exports = app;
