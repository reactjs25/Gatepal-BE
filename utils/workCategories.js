const WORK_CATEGORIES = [
  'Appliance Repair',
  'Beautician',
  'Car Cleaner',
  'Construction Work',
  'Cook',
  'Furniture Work',
  'Internet Repair',
  'Laundry',
  'Maid',
  'Milkman',
  'Newspaper',
  'Others',
];

const normalizeWorkCategory = (value) =>
  (value || '')
    .toString()
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');

const toCategoryKey = (value) => normalizeWorkCategory(value).toLowerCase();
const toCompactCategoryKey = (value) => toCategoryKey(value).replace(/[^a-z0-9]/g, '');

const WORK_CATEGORY_BY_KEY = new Map();
for (const name of WORK_CATEGORIES) {
  WORK_CATEGORY_BY_KEY.set(toCategoryKey(name), name);
  WORK_CATEGORY_BY_KEY.set(toCompactCategoryKey(name), name);
}

const getWorkCategoryDisplayName = (value) => {
  const byKey = WORK_CATEGORY_BY_KEY.get(toCategoryKey(value));
  if (byKey) return byKey;

  return WORK_CATEGORY_BY_KEY.get(toCompactCategoryKey(value)) || null;
};

const isAllowedWorkCategory = (value) => Boolean(getWorkCategoryDisplayName(value));

module.exports = {
  WORK_CATEGORIES,
  normalizeWorkCategory,
  getWorkCategoryDisplayName,
  isAllowedWorkCategory,
};
