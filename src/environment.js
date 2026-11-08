// Production is the default so that nothing needs to be set when deploying.
module.exports.isTest = process.env.NODE_ENV === 'test';
module.exports.isDevelopment = process.env.NODE_ENV === 'development';
