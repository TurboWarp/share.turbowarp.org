const KB = 1000;
const MB = 1000 * KB;
const GB = 1000 * MB;

/**
 * Maximum size of project.json in bytes.
 */
module.exports.MAX_PROJECT_DATA_SIZE = 5.5 * MB;

/**
 * Maximum size of each individual asset in bytes.
 */
module.exports.MAX_ASSET_SIZE = 10 * MB;

/**
 * Maximum total size of all the assets inside a project including project.json in bytes.
 */
module.exports.MAX_TOTAL_PROJECT_SIZE = 500 * MB;

/**
 * Maximum total size of all assets and projects in the database.
 */
module.exports.MAX_EVERYTHING_SIZE = 30 * GB;

/**
 * Maximum length of project titles.
 */
module.exports.MAX_TITLE_LENGTH = 100;

/**
 * Maximum length of project descriptions.
 */
module.exports.MAX_DESCRIPTION_LENGTH = 10000;

/**
 * Maximum length of report bodies.
 */
module.exports.MAX_REPORT_BODY_LENGTH = 10000;
