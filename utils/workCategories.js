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

const WORK_CATEGORY_BY_LOWER = new Map(
  WORK_CATEGORIES.map((name) => [name.toLowerCase(), name])
);

const normalizeWorkCategory = (value) => (value || '').toString().trim();

const getWorkCategoryDisplayName = (value) => {
  const normalized = normalizeWorkCategory(value).toLowerCase();
  return WORK_CATEGORY_BY_LOWER.get(normalized) || null;
};

const isAllowedWorkCategory = (value) => Boolean(getWorkCategoryDisplayName(value));

module.exports = {
  WORK_CATEGORIES,
  normalizeWorkCategory,
  getWorkCategoryDisplayName,
  isAllowedWorkCategory,
};
