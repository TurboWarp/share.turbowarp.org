class APIError extends Error {
  /**
   * @param {number} status HTTP status code for the error.
   * @param {string} message The error message, which may be shown to users.
   */
  constructor(status, message) {
    super(`${message}`);
    this.status = status;
    this.name = 'APIError';
  }
}

module.exports = APIError;
