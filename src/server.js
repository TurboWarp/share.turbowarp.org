const path = require('node:path');
const express = require('express');
const {Eta} = require('eta');
const db = require('./db');
const environment = require('./environment');
const {APP_NAME, CONTACT} = require('./config/brand');
const metrics = require('./metrics');
const APIError = require('./APIError');
const Limits = require('./config/limits');
const {parseProject} = require('./parse');
const {isNaughty} = require('./naughty');

const app = express();

app.set('case sensitive routing', true);
app.set('x-powered-by', false);
app.set('query parser', (q) => new URLSearchParams(q));

const eta = new Eta({
  views: path.join(__dirname, '..', 'views'),
  cache: !environment.isDevelopment
});

/**
 * @param {import('express').Response} res
 * @param {string} template Name of a file in views/, without extension
 * @param {object} [data]
 */
const render = (res, template, data) => {
  res.type('text/html').send(eta.render(`./${template}`, {
    APP_NAME,
    CONTACT,
    ...data
  }));
};

app.use(metrics.middleware);

app.use((req, res, next) => {
  res.header('X-Content-Type-Options', 'nosniff');
  next();
});

const STATIC_ROOT = path.join(__dirname, '..', 'static');
const staticOptions = {
  setHeaders: (res) => {
    res.req.metricsRoute = 'static';
  }
};
app.use(express.static(STATIC_ROOT, staticOptions));

/**
 * @param {string} route
 * @param {string} file
 */
const serveFile = (route, file) => {
  app.get(route, (req, res) => {
    req.metricsRoute = 'static';
    // Without a callback, Express ignores clients aborting the download instead of treating it as an error.
    // dotfiles: 'allow' so this still works if the app is installed under a directory starting with a dot.
    res.sendFile(file, {
      dotfiles: 'allow'
    });
  });
};
serveFile('/js/parse.js', path.join(__dirname, 'parse.js'));
serveFile('/js/vendor/jszip.min.js', require.resolve('@turbowarp/jszip/dist/jszip.min.js'));
serveFile('/js/vendor/scaffolding-full.js', require.resolve('@turbowarp/packager/dist/scaffolding/scaffolding-full.js'));

/**
 * @param {import('express').Request} req
 * @param {string} name
 * @returns {string|null}
 */
const getCookie = (req, name) => {
  const header = req.get('cookie');
  if (!header) {
    return null;
  }
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) {
      continue;
    }
    if (part.substring(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.substring(index + 1).trim());
      } catch (e) {
        return null;
      }
    }
  }
  return null;
};

/**
 * @param {import('express').Request} req
 * @returns {boolean}
 */
const hasAdminPermissions = (req) => {
  const token = getCookie(req, 'adminToken');
  return typeof token === 'string' && db.isValidAdminToken(token);
};

/**
 * @param {import('express').Request} req
 */
const validateAdminPermissions = (req) => {
  if (!hasAdminPermissions(req)) {
    throw new APIError(401, 'invalid admin token');
  }
};

/**
 * @param {import('express').Request} req
 */
const validateOwnership = (req) => {
  const token = req.get('x-ownership-token');
  if (typeof token !== 'string') {
    throw new APIError(400, 'ownership token missing');
  }
  if (!db.isValidOwnershipToken(req.params.project, token)) {
    throw new APIError(401, 'invalid ownership token');
  }
};

const isObject = (object) => (
  !!object &&
  !Array.isArray(object) &&
  typeof object === 'object'
);

const isSHA256 = (str) => typeof str === 'string' && /^[a-f0-9]{64}$/.test(str);

const isMd5ext = (str) => typeof str === 'string' && /^[a-f0-9]{32}\.[a-z0-9]{3}$/.test(str);

/**
 * @param {unknown} object
 * @returns {boolean}
 */
const isAssetInformation = (object) => {
  if (!isObject(object)) {
    return false;
  }
  for (const key of Object.keys(object)) {
    if (!isMd5ext(key)) {
      return false;
    }
    const asset = object[key];
    if (!isObject(asset)) {
      return false;
    }
    if (!isSHA256(asset.sha256) || typeof asset.size !== 'number') {
      return false;
    }
  }
  return true;
};

// project.json is sent as a JSON string, so escaping can make it a lot bigger than the
// limit on the decoded data. The real limit is enforced after decoding.
const newProjectBody = express.json({
  limit: Limits.MAX_PROJECT_DATA_SIZE * 3 + 5 * 1000 * 1000
});
const smallJSONBody = express.json({
  limit: '100kb'
});
const assetBody = express.raw({
  type: () => true,
  limit: Limits.MAX_ASSET_SIZE
});

app.get('/', (req, res) => {
  render(res, 'home');
});

app.get('/privacy', (req, res) => {
  render(res, 'privacy');
});

app.get('/contact', (req, res) => {
  render(res, 'contact');
});

app.get('/deleted', (req, res) => {
  render(res, 'deleted');
});

const DEFAULT_TITLE = 'Untitled';
const DEFAULT_DESCRIPTION = 'No description';

app.get('/projects/:project', (req, res) => {
  const projectId = req.params.project;
  const metadata = db.getCompleteProjectMetadata(projectId);
  const md5extsToSha256 = db.getMd5extToSha256(projectId);
  const adminOwnershipToken = hasAdminPermissions(req) ? db.getAdminOwnershipToken(projectId) : null;
  db.markProjectAsVisited(projectId);
  render(res, 'project', {
    projectId,
    metadata,
    md5extsToSha256,
    adminOwnershipToken,
    DEFAULT_TITLE,
    DEFAULT_DESCRIPTION
  });
});

app.get('/admin', (req, res) => {
  validateAdminPermissions(req);
  render(res, 'admin');
});

app.get('/admin/reports', (req, res) => {
  validateAdminPermissions(req);
  render(res, 'admin-reports', {
    reports: db.getAllReports()
  });
});

app.delete('/admin/api/reports/:report', (req, res) => {
  validateAdminPermissions(req);
  const reportId = +req.params.report;
  if (!Number.isSafeInteger(reportId)) {
    throw new APIError(400, 'invalid report ID');
  }
  db.deleteReport(reportId);
  res.json({});
});

app.get('/api/assets/:sha256', (req, res) => {
  // TODO: prevent hotlinking
  const data = db.getAssetData(req.params.sha256);
  res.header('Cache-Control', 'public, max-age=31557600, immutable');
  res.header('Content-Security-Policy', 'default-src \'none\'');
  res.type('application/octet-stream');
  res.send(data);
});

// Must be registered before the /api/projects/:project routes
app.post('/api/projects/new', newProjectBody, (req, res) => {
  const body = req.body || {};

  const projectData = body.project;
  if (typeof projectData !== 'string') {
    throw new APIError(400, 'missing project');
  }

  if (!isAssetInformation(body.assetInformation)) {
    throw new APIError(400, 'invalid asset information');
  }

  let parsedProject;
  try {
    parsedProject = parseProject(projectData);
  } catch (e) {
    throw new APIError(400, `invalid project: ${e.message}`);
  }

  let title = body.title;
  if (typeof title !== 'string') {
    throw new APIError(400, 'invalid or missing title');
  }
  if (isNaughty(title) || title.length > Limits.MAX_TITLE_LENGTH) {
    title = 'Project';
  }

  const incompleteProject = db.createIncompleteProject(
    Buffer.from(projectData),
    parsedProject,
    body.assetInformation,
    title
  );
  res.json(incompleteProject);
});

app.get('/api/projects/:project', (req, res) => {
  const data = db.getProjectData(req.params.project);
  db.markProjectAsLoaded(req.params.project);
  res.type('application/json');
  res.send(data);
});

app.post('/api/projects/:project', smallJSONBody, (req, res) => {
  validateOwnership(req);
  const body = req.body || {};

  const title = body.title;
  if (typeof title === 'string') {
    if (isNaughty(title)) {
      throw new APIError(400, 'title is naughty');
    }
    if (title.length > Limits.MAX_TITLE_LENGTH) {
      throw new APIError(400, 'title is too long');
    }
    db.setProjectTitle(req.params.project, title);
  }

  const description = body.description;
  if (typeof description === 'string') {
    if (isNaughty(description)) {
      throw new APIError(400, 'description is naughty');
    }
    if (description.length > Limits.MAX_DESCRIPTION_LENGTH) {
      throw new APIError(400, 'description is too long');
    }
    db.setProjectDescription(req.params.project, description);
  }

  res.json({});
});

app.delete('/api/projects/:project', (req, res) => {
  validateOwnership(req);
  db.deleteProject(req.params.project);
  res.json({});
});

app.post('/api/projects/:project/assets/:md5ext', assetBody, (req, res) => {
  validateOwnership(req);
  if (!Buffer.isBuffer(req.body)) {
    throw new APIError(400, 'missing asset');
  }
  db.finishIncompleteAsset(req.params.project, req.params.md5ext, req.body);
  res.json({});
});

app.post('/api/projects/:project/complete', (req, res) => {
  validateOwnership(req);
  db.finishIncompleteProject(req.params.project);
  res.json({});
});

app.post('/api/projects/:project/report', smallJSONBody, (req, res) => {
  const projectId = req.params.project;
  const reportBody = (req.body || {}).body;
  if (typeof reportBody !== 'string') {
    throw new APIError(400, 'invalid report body');
  }
  if (reportBody.length > Limits.MAX_REPORT_BODY_LENGTH) {
    throw new APIError(400, 'report body too long');
  }

  // Throws 404 if the project doesn't exist
  db.getCompleteProjectMetadata(projectId);
  db.createReport(projectId, reportBody);

  if (process.env.REPORT_WEBHOOK) {
    fetch(process.env.REPORT_WEBHOOK, {
      method: 'POST',
      body: JSON.stringify({
        content: '<@751651888205922348> Someone reported a project on placeholder <https://share.turbowarp.org/admin/reports>'
      }),
      headers: {
        'content-type': 'application/json'
      }
    })
      .then((r) => {
        console.log('webhook status', r.status);
      })
      .catch((err) => {
        console.error('webhook error', err);
      });
  }

  // No reason to respond with anything such as the report's ID.
  res.json({});
});

app.put('/api/projects/:project/started', (req, res) => {
  db.markProjectAsStarted(req.params.project);
  res.json({});
});

app.use((req, res, next) => {
  next(new APIError(404, 'Not Found'));
});

app.use((err, req, res, next) => {
  // APIError and body-parser errors (too large, invalid JSON, ...) have a status
  const errorStatus = err && (err.status || err.statusCode);
  const status = (typeof errorStatus === 'number' && errorStatus >= 400 && errorStatus < 600) ? errorStatus : 500;
  const message = status < 500 ? `${err.message}` : 'Internal Server Error';
  if (status >= 500) {
    console.error(err);
  }

  if (res.headersSent) {
    next(err);
    return;
  }

  res.status(status);
  if (req.path.startsWith('/api/') || req.path.startsWith('/admin/api/')) {
    res.json({
      message
    });
  } else {
    render(res, 'error', {
      status,
      message
    });
  }
});

module.exports = app;
