const sqlite = require('better-sqlite3');
const nodeCrypto = require('node:crypto');
const APIError = require('./APIError');
const Limits = require('./config/limits');
const environment = require('./environment');

/*

Terminology:
 - SHA-256: A SHA-256 sum in hex format
   Example: 281b3e68790665fde7a4d952e9f43114ceb1778d1ce14fde31371b73db23cfdc
 - md5ext: A MD5 sum and a file extension
   Example: 4626b10e05ba7ec6386b1996e44b0a84.svg

 */

const db = new sqlite(environment.isTest ? ':memory:' : 'unshared.db');

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/*
  BEGIN TRANSACTION;
  ALTER TABLE projects ADD COLUMN created_at INTEGER NOT NULL;
  ALTER TABLE projects ADD COLUMN last_visited_at INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE projects ADD COLUMN last_loaded_at INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE projects ADD COLUMN last_started_at INTEGER NOT NULL DEFAULT 0;
  COMMIT;
*/
db.exec(`
CREATE TABLE IF NOT EXISTS projects (
  -- unique ID for project, visible to user
  project_id TEXT PRIMARY KEY NOT NULL,

  -- 1 if all assets have been uploaded
  complete INT NOT NULL,

  -- raw project.json data
  data BLOB NOT NULL,

  project_title TEXT NOT NULL,
  project_description TEXT NOT NULL,

  created_at INTEGER NOT NULL,
  last_visited_at INTEGER NOT NULL DEFAULT 0,
  last_loaded_at INTEGER NOT NULL DEFAULT 0,
  last_started_at INTEGER NOT NULL DEFAULT 0
) STRICT;`);

db.exec(`
CREATE TABLE IF NOT EXISTS ownership_tokens (
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,

  -- secret token to prove project ownership
  ownership_token TEXT NOT NULL,

  PRIMARY KEY(project_id, ownership_token)
) STRICT;`);

db.exec(`
CREATE TABLE IF NOT EXISTS assets (
  -- SHA-256 of data, has already been verified
  asset_sha256 TEXT PRIMARY KEY NOT NULL,

  -- raw asset data
  data BLOB NOT NULL
) STRICT;`);

/*
  BEGIN TRANSACTION;
  CREATE TABLE complete_project_assets_new (
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    asset_sha256 TEXT NOT NULL REFERENCES assets(asset_sha256) ON DELETE CASCADE,
    asset_md5ext TEXT NOT NULL,
    PRIMARY KEY(project_id, asset_md5ext)
  ) STRICT;
  INSERT INTO complete_project_assets_new SELECT project_id, asset_sha256, asset_md5ext FROM complete_project_assets;
  DROP TABLE complete_project_assets;
  ALTER TABLE complete_project_assets_new RENAME TO complete_project_assets;
  COMMIT;
*/
db.exec(`
CREATE TABLE IF NOT EXISTS complete_project_assets (
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,

  -- SHA-256 of the asset
  asset_sha256 TEXT NOT NULL REFERENCES assets(asset_sha256) ON DELETE CASCADE,

  -- user-provided md5ext with file extension
  asset_md5ext TEXT NOT NULL,

  PRIMARY KEY(project_id, asset_md5ext)
) STRICT;`);

db.exec(`
CREATE TABLE IF NOT EXISTS incomplete_project_assets (
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,

  -- user-provided SHA-256 that this asset should have (untrusted)
  asset_sha256 TEXT NOT NULL,

  -- user-provided md5ext with file extension that this asset should have (untrusted)
  asset_md5ext TEXT NOT NULL,

  -- user-provided size in bytes that this asset should have (untrusted)
  asset_size INT NOT NULL,

  PRIMARY KEY(project_id, asset_md5ext)
) STRICT;`);

db.exec(`
CREATE TRIGGER IF NOT EXISTS remove_unused_assets AFTER DELETE ON complete_project_assets
BEGIN
  DELETE FROM assets WHERE asset_sha256=OLD.asset_sha256 AND
    NOT EXISTS (SELECT 1 FROM complete_project_assets WHERE asset_sha256=assets.asset_sha256);
END;`);

db.exec(`CREATE INDEX IF NOT EXISTS complete_project_assets_by_sha256 ON complete_project_assets(asset_sha256);`);

// TODO: I would not be surprised if this is susceptible to timing attacks
db.exec(`
CREATE TABLE IF NOT EXISTS admin_tokens (
  secret_token TEXT PRIMARY KEY NOT NULL,

  -- name is just a more memorable description; this isn't used for security
  name TEXT NOT NULL
) STRICT;
`);

db.exec(`
CREATE TABLE IF NOT EXISTS admin_project_reports (
  report_id INTEGER PRIMARY KEY NOT NULL,
  report_body TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE
) STRICT;
`);

const _getTotalProjectDataSize = db.prepare('SELECT sum(length(data)) AS size FROM projects;');
const _getTotalCompleteAssetSize = db.prepare('SELECT sum(length(data)) AS size FROM assets;');
const _getTotalIncompleteAssetSize = db.prepare('SELECT sum(asset_size) AS size FROM incomplete_project_assets;');
const getTotalSizeOfEverything = () => {
  return (
    (_getTotalProjectDataSize.get().size ?? 0) +
    (_getTotalCompleteAssetSize.get().size ?? 0) +
    (_getTotalIncompleteAssetSize.get().size ?? 0)
  );
};

/**
 * @typedef IncompleteProject
 * @property {string} projectId
 * @property {string[]} missingMd5exts
 * @property {string} ownershipToken
 */

/**
 * Maps the md5exts in a project to additional information about them.
 * @typedef {Record<string, {sha256: string; size: number}>} AssetInformation
 */

/**
 * @typedef Report
 * @property {number} reportId
 * @property {string} reportBody
 * @property {string} projectId
 * @property {string} projectTitle
 * @property {string} projectDescription
 */

const _insertProject = db.prepare(`
  INSERT INTO projects (
    project_id,
    complete,
    data,
    project_title,
    project_description,
    created_at
  ) VALUES (
    ?,
    FALSE,
    ?,
    ?,
    '',
    strftime('%s', 'now')
  );
`);
const createIncompleteProject = db.transaction(
  /**
   * @param {Buffer} encodedProjectJSON
   * @param {{md5exts: string[]}} parsedProject
   * @param {AssetInformation} assetInformation
   * @param {string} projectTitle
   * @returns {IncompleteProject}
   */
  (encodedProjectJSON, parsedProject, assetInformation, projectTitle) => {
    if (encodedProjectJSON.byteLength > Limits.MAX_PROJECT_DATA_SIZE) {
      throw new APIError(400, 'project.json too large');
    }

    const projectId = nodeCrypto.randomUUID();
    _insertProject.run(projectId, encodedProjectJSON, projectTitle);

    const ownershipToken = createOwnershipToken(projectId);

    const missingMd5exts = [];
    let totalSize = 0;

    for (const md5ext of parsedProject.md5exts) {
      const asset = assetInformation[md5ext];
      if (!asset) {
        throw new APIError(400, `missing asset information: ${md5ext}`);
      }

      if (
        !Number.isSafeInteger(asset.size) ||
        asset.size < 0 ||
        asset.size > Limits.MAX_ASSET_SIZE
      ) {
        throw new APIError(400, `invalid asset size: ${md5ext}`);
      }

      const completeAsset = getCompleteAssetMetadata(asset.sha256);
      if (completeAsset) {
        if (asset.size !== completeAsset.size) {
          throw new APIError(400, 'size of preexisting asset does not match');
        }
        _createCompleteAssetConnection.run(projectId, asset.sha256, md5ext);
      } else {
        missingMd5exts.push(md5ext);
        _createIncompleteAssetConnection.run(projectId, asset.sha256, md5ext, asset.size);
      }

      totalSize += asset.size;
    }

    if (totalSize > Limits.MAX_TOTAL_PROJECT_SIZE) {
      throw new APIError(400, 'total project size is too large');
    }

    if (getTotalSizeOfEverything() > Limits.MAX_EVERYTHING_SIZE) {
      throw new APIError(400, 'the server is out of space');
    }

    return {
      projectId,
      missingMd5exts,
      ownershipToken
    };
  }
);

const _insertOwnershipToken = db.prepare(`
  INSERT INTO ownership_tokens (ownership_token, project_id) VALUES (?, ?);
`);
/**
 * @param {string} projectId
 * @returns {string}
 */
const createOwnershipToken = (projectId) => {
  const token = nodeCrypto.randomUUID();
  _insertOwnershipToken.run(token, projectId);
  return token;
};

const _getAnyOwnershipToken = db.prepare(`SELECT ownership_token FROM ownership_tokens WHERE project_id=?;`);
/**
 * @param {string} projectId
 * @returns {string|null}
 */
const getAdminOwnershipToken = (projectId) => {
  // For now we'll just use the the first token, which is guaranteed to always exist.
  const result = _getAnyOwnershipToken.get(projectId);
  if (!result) {
    return null;
  }
  return result.ownership_token;
};

const _getCompleteAssetSize = db.prepare(`SELECT length(data) AS size FROM assets WHERE asset_sha256=?;`);
/**
 * @param {string} sha256
 * @returns {{size: number}|null}
 */
const getCompleteAssetMetadata = (sha256) => {
  const result = _getCompleteAssetSize.get(sha256);
  if (!result) {
    return null;
  }
  return {
    size: result.size
  };
};

const _createCompleteAssetConnection = db.prepare(`
  INSERT INTO complete_project_assets (project_id, asset_sha256, asset_md5ext) VALUES (?, ?, ?);
`);

const _createIncompleteAssetConnection = db.prepare(`
  INSERT INTO incomplete_project_assets (project_id, asset_sha256, asset_md5ext, asset_size) VALUES (?, ?, ?, ?);
`);

const _getIncompleteAssetMetadata = db.prepare(`
  SELECT asset_sha256, asset_size FROM incomplete_project_assets WHERE project_id=? AND asset_md5ext=?;
`);
/**
 * @param {string} projectId
 * @param {string} md5ext
 * @returns {{sha256: string; size: number}}
 */
const getIncompleteAssetMetadata = (projectId, md5ext) => {
  const metadata = _getIncompleteAssetMetadata.get(projectId, md5ext);
  if (!metadata) {
    throw new APIError(400, 'unknown asset');
  }
  return {
    sha256: metadata.asset_sha256,
    size: metadata.asset_size
  };
};

const _deleteIncompleteAsset = db.prepare(`
  DELETE FROM incomplete_project_assets WHERE project_id=? AND asset_md5ext=?;
`);
const _createAsset = db.prepare(`
  INSERT INTO assets (asset_sha256, data) VALUES (?, ?) ON CONFLICT DO NOTHING;
`);
const finishIncompleteAsset = db.transaction(
  /**
   * @param {string} projectId
   * @param {string} md5ext
   * @param {Buffer} data
   */
  (projectId, md5ext, data) => {
    const metadata = getIncompleteAssetMetadata(projectId, md5ext);

    if (data.byteLength !== metadata.size) {
      throw new APIError(400, 'size mismatch');
    }

    const expectedMd5 = md5ext.split('.')[0];
    const actualMd5 = nodeCrypto
      .createHash('md5')
      .update(data)
      .digest('hex');
    if (expectedMd5 !== actualMd5) {
      throw new APIError(400, 'md5 mismatch');
    }

    const expectedSha256 = metadata.sha256;
    const actualSha256 = nodeCrypto
      .createHash('sha256')
      .update(data)
      .digest('hex');
    if (expectedSha256 !== actualSha256) {
      throw new APIError(400, 'sha256 mismatch');
    }

    _deleteIncompleteAsset.run(projectId, md5ext);
    _createAsset.run(metadata.sha256, data);
    _createCompleteAssetConnection.run(projectId, metadata.sha256, md5ext);
  }
);

const _hasIncompleteAssets = db.prepare(`
  SELECT 1 FROM incomplete_project_assets WHERE project_id=?;
`);
const _finishIncompleteProject = db.prepare(`
  UPDATE projects SET complete=TRUE WHERE project_id=?;
`);
const finishIncompleteProject = db.transaction(
  /**
   * @param {string} projectId
   */
  (projectId) => {
    const hasIncompleteAssets = !!_hasIncompleteAssets.get(projectId);
    if (hasIncompleteAssets) {
      throw new APIError(400, 'project is not complete');
    }
    _finishIncompleteProject.run(projectId);
  }
);

const _isValidOwnershipToken = db.prepare(`
  SELECT 1 FROM ownership_tokens WHERE project_id=? AND ownership_token=?;
`);
/**
 * @param {string} projectId
 * @param {string} ownershipToken
 * @returns {boolean}
 */
const isValidOwnershipToken = (projectId, ownershipToken) => {
  return !!_isValidOwnershipToken.get(projectId, ownershipToken);
};

const _getCompleteProjectMetadata = db.prepare(`
  SELECT project_title, project_description FROM projects WHERE project_id=? AND complete=TRUE;
`);
/**
 * @param {string} projectId
 * @returns {{title: string; description: string}}
 */
const getCompleteProjectMetadata = (projectId) => {
  const projectMeta = _getCompleteProjectMetadata.get(projectId);
  if (!projectMeta) {
    throw new APIError(404, 'project does not exist');
  }
  return {
    title: projectMeta.project_title,
    description: projectMeta.project_description
  };
};

const _getCompleteAssets = db.prepare(`
  SELECT asset_sha256, asset_md5ext FROM complete_project_assets WHERE project_id=?;
`);
/**
 * @param {string} projectId
 * @returns {Record<string, string>}
 */
const getMd5extToSha256 = (projectId) => {
  const assets = _getCompleteAssets.all(projectId);
  const record = {};
  for (const {asset_sha256, asset_md5ext} of assets) {
    record[asset_md5ext] = asset_sha256;
  }
  return record;
};

const _getCompleteProjectData = db.prepare('SELECT data FROM projects WHERE project_id=? AND complete=TRUE;');
/**
 * @param {string} projectId
 * @returns {Buffer}
 */
const getProjectData = (projectId) => {
  const project = _getCompleteProjectData.get(projectId);
  if (!project) {
    throw new APIError(404, 'project does not exist');
  }
  return project.data;
};

const _getAssetData = db.prepare('SELECT data FROM assets WHERE asset_sha256=?;');
/**
 * @param {string} sha256
 * @returns {Buffer}
 */
const getAssetData = (sha256) => {
  const asset = _getAssetData.get(sha256);
  if (!asset) {
    throw new APIError(404, 'asset does not exist');
  }
  return asset.data;
};

const _setProjectTitle = db.prepare(`UPDATE projects SET project_title=? WHERE project_id=?;`);
/**
 * @param {string} projectId
 * @param {string} title
 */
const setProjectTitle = (projectId, title) => {
  _setProjectTitle.run(title, projectId);
};

const _setProjectDescription = db.prepare(`UPDATE projects SET project_description=? WHERE project_id=?;`);
/**
 * @param {string} projectId
 * @param {string} description
 */
const setProjectDescription = (projectId, description) => {
  _setProjectDescription.run(description, projectId);
};

const _deleteProject = db.prepare(`DELETE FROM projects WHERE project_id=?;`);
/**
 * @param {string} projectId
 */
const deleteProject = (projectId) => {
  _deleteProject.run(projectId);
};

const _createAdminToken = db.prepare(`INSERT INTO admin_tokens (secret_token, name) VALUES (?, ?);`);
/**
 * @param {string} name
 * @returns {string} The secret token
 */
const createAdminToken = (name) => {
  const secretToken = nodeCrypto.randomUUID();
  _createAdminToken.run(secretToken, name);
  return secretToken;
};

const _validateAdminToken = db.prepare(`SELECT 1 FROM admin_tokens WHERE secret_token=?;`);
/**
 * @param {string} secretToken
 * @returns {boolean}
 */
const isValidAdminToken = (secretToken) => {
  return !!_validateAdminToken.get(secretToken);
};

const _createReport = db.prepare(`INSERT INTO admin_project_reports (project_id, report_body) VALUES (?, ?);`);
/**
 * @param {string} projectId
 * @param {string} reportBody
 */
const createReport = (projectId, reportBody) => {
  _createReport.run(projectId, reportBody);
};

const _deleteReport = db.prepare(`DELETE FROM admin_project_reports WHERE report_id=?;`);
/**
 * @param {number} reportId
 */
const deleteReport = (reportId) => {
  _deleteReport.run(reportId);
};

const _getAllReports = db.prepare(`
  SELECT
    report_id,
    project_id,
    report_body,
    project_title,
    project_description
  FROM admin_project_reports INNER JOIN projects USING(project_id);
`);
/**
 * @returns {Report[]}
 */
const getAllReports = () => {
  return _getAllReports.all().map(response => ({
    reportId: response.report_id,
    projectId: response.project_id,
    reportBody: response.report_body,
    projectTitle: response.project_title,
    projectDescription: response.project_description,
  }));
};

const _markProjectAsVisited = db.prepare(`UPDATE projects SET last_visited_at = strftime('%s', 'now') WHERE project_id=?;`);
/**
 * @param {string} projectId
 */
const markProjectAsVisited = (projectId) => {
  _markProjectAsVisited.run(projectId);
};

const _markProjectAsLoaded = db.prepare(`UPDATE projects SET last_loaded_at = strftime('%s', 'now') WHERE project_id=?;`);
/**
 * @param {string} projectId
 */
const markProjectAsLoaded = (projectId) => {
  _markProjectAsLoaded.run(projectId);
};

const _markProjectAsStarted = db.prepare(`UPDATE projects SET last_started_at = strftime('%s', 'now') WHERE project_id=?;`);
/**
 * @param {string} projectId
 */
const markProjectAsStarted = (projectId) => {
  _markProjectAsStarted.run(projectId);
};

module.exports = {
  createIncompleteProject,
  getAdminOwnershipToken,
  finishIncompleteAsset,
  finishIncompleteProject,
  isValidOwnershipToken,
  getCompleteProjectMetadata,
  getMd5extToSha256,
  getProjectData,
  getAssetData,
  setProjectTitle,
  setProjectDescription,
  deleteProject,
  createAdminToken,
  isValidAdminToken,
  createReport,
  deleteReport,
  getAllReports,
  markProjectAsVisited,
  markProjectAsLoaded,
  markProjectAsStarted
};
