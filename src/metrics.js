const http = require('node:http');
const client = require('@prometheus-io/client');
const db = require('./db');
const Limits = require('./config/limits');

const httpRequests = new client.Counter({
  name: 'http_requests_total',
  help: 'HTTP requests',
  labelNames: ['method', 'route', 'status']
});

const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration',
  labelNames: ['method', 'route', 'status']
});

const projects = new client.Gauge({
  name: 'share_projects',
  help: 'Projects in database',
  labelNames: ['state'],
  collect() {
    const counts = db.countProjects();
    this.set({state: 'complete'}, counts.complete);
    this.set({state: 'incomplete'}, counts.incomplete);
  }
});

const assets = new client.Gauge({
  name: 'share_assets',
  help: 'Assets in database',
  collect() {
    this.set(db.countAssets());
  }
});

const reportsPending = new client.Gauge({
  name: 'share_reports_pending',
  help: 'Unresolved reports',
  collect() {
    this.set(db.countReports());
  }
});

const storage = new client.Gauge({
  name: 'share_storage_bytes',
  help: 'Storage counted towards limit',
  labelNames: ['kind'],
  collect() {
    const sizes = db.getStorageSizes();
    this.set({kind: 'project_json'}, sizes.projectData);
    this.set({kind: 'assets'}, sizes.assets);
    this.set({kind: 'incomplete_assets'}, sizes.incompleteAssets);
  }
});

const storageLimit = new client.Gauge({
  name: 'share_storage_limit_bytes',
  help: 'Storage limit',
  collect() {
    this.set(Limits.MAX_EVERYTHING_SIZE);
  }
});

const databaseFile = new client.Gauge({
  name: 'share_database_file_bytes',
  help: 'Database file size',
  labelNames: ['kind'],
  collect() {
    const sizes = db.getDatabaseFileSizes();
    this.set({kind: 'total'}, sizes.size);
    this.set({kind: 'free'}, sizes.free);
  }
});

const projectsCreated = new client.Counter({
  name: 'share_projects_created_total',
  help: 'Projects created'
});

const projectAssets = new client.Counter({
  name: 'share_project_assets_total',
  help: 'Assets referenced by new projects',
  labelNames: ['state']
});

const projectJSONSize = new client.Histogram({
  name: 'share_project_json_bytes',
  help: 'project.json size',
  buckets: client.exponentialBuckets(1000, 4, 8)
});

const projectSize = new client.Histogram({
  name: 'share_project_size_bytes',
  help: 'Total project size',
  buckets: client.exponentialBuckets(10000, 4, 9)
});

const projectAssetCount = new client.Histogram({
  name: 'share_project_asset_count',
  help: 'Assets per project',
  buckets: [0, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000]
});

const projectUploadDuration = new client.Histogram({
  name: 'share_project_upload_duration_seconds',
  help: 'Time from project creation to completion',
  buckets: [1, 2, 5, 10, 20, 30, 60, 120, 300, 600, 1800, 3600, 86400]
});

const assetUploadSize = new client.Histogram({
  name: 'share_asset_upload_bytes',
  help: 'Uploaded asset size',
  buckets: client.exponentialBuckets(1000, 4, 8)
});

const projectsDeleted = new client.Counter({
  name: 'share_projects_deleted_total',
  help: 'Projects deleted',
  labelNames: ['by']
});

const reports = new client.Counter({
  name: 'share_reports_total',
  help: 'Reports',
  labelNames: ['ignored']
});

const reportWebhooks = new client.Counter({
  name: 'share_report_webhooks_total',
  help: 'Report webhooks',
  labelNames: ['result']
});

const getLowCardinalityPath = (req) => {
  // Explicit route name
  if (req.metricsRoute) {
    return req.metricsRoute;
  }
  // Express route, eg. /api/projects/:project
  if (req.route && typeof req.route.path === 'string') {
    return (req.baseUrl || '') + req.route.path;
  }
  // Fallback - don't let 404 explode cardinality
  return 'other';
};

const middleware = (req, res, next) => {
  const end = httpDuration.startTimer();
  res.on('close', () => {
    try {
      const labels = {
        method: req.method,
        route: getLowCardinalityPath(req),
        status: res.writableFinished ? res.statusCode : 'aborted'
      };
      httpRequests.inc(labels);
      end(labels);
    } catch (error) {
      console.error(error);
    }
  });
  next();
};

const listen = () => {
  if (!process.env.METRICS_PORT) {
    return;
  }

  const port = +process.env.METRICS_PORT;
  client.collectDefaultMetrics();

  const metricsServer = http.createServer((req, res) => {
    client.register.metrics()
      .then((body) => {
        res.setHeader('Content-Type', client.register.contentType);
        res.end(body);
      })
      .catch((error) => {
        console.error(error);
        res.statusCode = 500;
        res.end();
      });
  });

  metricsServer.listen(port, '127.0.0.1', () => {
    console.log(`Metrics on port ${port}`);
  });
};

module.exports = {
  projectsCreated,
  projectAssets,
  projectJSONSize,
  projectSize,
  projectAssetCount,
  projectUploadDuration,
  assetUploadSize,
  projectsDeleted,
  reports,
  reportWebhooks,
  middleware,
  listen
};
