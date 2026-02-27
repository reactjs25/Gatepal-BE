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

const setErrorDefaults = (error, publicMessage, statusCode = 500) => {
  error.statusCode = error.statusCode || statusCode;
  error.publicMessage = error.publicMessage || publicMessage;
  return error;
};

module.exports = {
  HttpError,
  createHttpError,
  setErrorDefaults,
};

