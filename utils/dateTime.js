const toDateOnly = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().split('T')[0];
};

const toISTTimeLabel = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  const formatted = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(d);
  return formatted.replace(/\bam\b/gi, 'AM').replace(/\bpm\b/gi, 'PM');
};

const toISTDateTimeLabel = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  const dateFmt = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(d);
  const timeFmt = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(d);
  const formattedTime = timeFmt.replace(/\bam\b/gi, 'AM').replace(/\bpm\b/gi, 'PM');
  return `${dateFmt}, ${formattedTime}`;
};

const toISTDateTimeLabelWithoutYear = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  const dateFmt = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
  }).format(d);
  const timeFmt = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(d);
  const formattedTime = timeFmt.replace(/\bam\b/gi, 'AM').replace(/\bpm\b/gi, 'PM');
  return `${dateFmt}, ${formattedTime}`;
};

const toISTDateTimeLabelNoComma = (value) => {
  const label = toISTDateTimeLabel(value);
  return label ? label.replace(', ', ' ') : null;
};

const toISTDateTimeLabelNoCommaWithoutYear = (value) => {
  const label = toISTDateTimeLabelWithoutYear(value);
  return label ? label.replace(', ', ' ') : null;
};

const toISTDateLabel = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(d);
};

const IST_OFFSET_MS = 5 * 60 * 60 * 1000 + 30 * 60 * 1000;

const getISTComponents = (date) => {
  const d = date instanceof Date ? date : new Date(date || Date.now());
  const istTime = new Date(d.getTime() + IST_OFFSET_MS);
  return {
    year: istTime.getUTCFullYear(),
    month: istTime.getUTCMonth() + 1,
    day: istTime.getUTCDate(),
    hour: istTime.getUTCHours(),
    minute: istTime.getUTCMinutes(),
    second: istTime.getUTCSeconds(),
  };
};

const createISTDate = (year, month, day, hour = 0, minute = 0, second = 0, ms = 0) => {
  const utcMs = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  return new Date(utcMs - IST_OFFSET_MS);
};

const getISTMidnight = (date) => {
  const { year, month, day } = getISTComponents(date);
  return createISTDate(year, month, day, 0, 0, 0, 0);
};

const getISTEndOfDay = (date) => {
  const { year, month, day } = getISTComponents(date);
  return createISTDate(year, month, day, 23, 59, 59, 999);
};

const setISTHours = (date, h, m = 0, s = 0, ms = 0) => {
  const { year, month, day } = getISTComponents(date);
  return createISTDate(year, month, day, h, m, s, ms);
};

module.exports = {
  toDateOnly,
  toISTTimeLabel,
  toISTDateTimeLabel,
  toISTDateTimeLabelWithoutYear,
  toISTDateTimeLabelNoComma,
  toISTDateTimeLabelNoCommaWithoutYear,
  toISTDateLabel,
  getISTComponents,
  createISTDate,
  getISTMidnight,
  getISTEndOfDay,
  setISTHours,
};
