const APIError = require('./APIError');

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const notFound = (req, res, next) => {
  next(new APIError(404, 'Not Found'));
};

/**
 * Responds with JSON under /api/ and an HTML error page elsewhere.
 * @param {ReturnType<import('./render')>} render
 * @returns {import('express').ErrorRequestHandler}
 */
const createErrorHandler = (render) => (err, req, res, next) => {
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
  if (req.path.startsWith('/api/')) {
    res.json({
      message
    });
  } else {
    render(res, 'error', {
      status,
      message
    });
  }
};

module.exports = {
  notFound,
  createErrorHandler
};
