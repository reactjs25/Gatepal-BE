class HttpError extends Error {
  constructor(message, statusCode = 500, options = {}) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.publicMessage = options.publicMessage || message;
    this.details = options.details;
    this.expose = options.expose ?? statusCode < 500;
  }
}

const createHttpError = (message, statusCode = 500, options = {}) =>
  new HttpError(message, statusCode, options);

module.exports = {
  HttpError,
  createHttpError,
};

