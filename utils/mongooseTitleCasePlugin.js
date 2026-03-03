const { toTitleCaseName } = require('./strings');

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

const normalizeValue = (value) => {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return toTitleCaseName(value);
  if (Array.isArray(value)) return value.map((item) => normalizeValue(item));
  return value;
};

const applyPathTransform = (target, segments) => {
  if (!target) return;

  const walk = (node, index) => {
    if (node === null || node === undefined) return;

    if (Array.isArray(node)) {
      node.forEach((item) => walk(item, index));
      return;
    }

    if (typeof node !== 'object') return;

    const key = segments[index];
    if (index === segments.length - 1) {
      if (hasOwn(node, key)) {
        node[key] = normalizeValue(node[key]);
      }
      return;
    }

    walk(node[key], index + 1);
  };

  walk(target, 0);
};

const normalizeUpdateObject = (update, paths) => {
  if (!update || typeof update !== 'object') return;

  const buckets = [update, update.$set, update.$setOnInsert].filter(Boolean);

  for (const bucket of buckets) {
    for (const path of paths) {
      if (hasOwn(bucket, path)) {
        bucket[path] = normalizeValue(bucket[path]);
      }
      applyPathTransform(bucket, path.split('.'));
    }
  }
};

const applyTitleCasePlugin = (schema, options = {}) => {
  const rawPaths = Array.isArray(options.paths) ? options.paths : [];
  const paths = rawPaths.filter((path) => typeof path === 'string' && path.trim());
  if (paths.length === 0) return;

  schema.pre('validate', function onValidate(next) {
    try {
      for (const path of paths) {
        const current = this.get(path);
        if (current === undefined) continue;
        this.set(path, normalizeValue(current));
      }
      next();
    } catch (error) {
      next(error);
    }
  });

  const queryHooks = ['updateOne', 'updateMany', 'findOneAndUpdate', 'update'];
  queryHooks.forEach((hookName) => {
    schema.pre(hookName, function onUpdate(next) {
      try {
        const update = this.getUpdate();
        normalizeUpdateObject(update, paths);
        this.setUpdate(update);
        next();
      } catch (error) {
        next(error);
      }
    });
  });
};

module.exports = {
  applyTitleCasePlugin,
};
