const toDateOnly = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().split('T')[0];
};

const toISTTimeLabel = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(d);
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
  return `${dateFmt}, ${timeFmt}`;
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

module.exports = {
  toDateOnly,
  toISTTimeLabel,
  toISTDateTimeLabel,
  toISTDateLabel,
};
