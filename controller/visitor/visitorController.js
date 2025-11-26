const fs = require('fs');
const path = require('path');
const { sendSuccessResponse } = require('../../utils/response');

const ALLOWED_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const assetsDirPath = path.join(__dirname, '..', '..', 'assets');

const toDisplayName = (filenameBase) =>
  filenameBase.charAt(0).toUpperCase() + filenameBase.slice(1).toLowerCase();

const getDeliveryCompanies = async (req, res, next) => {
  try {
    let files = [];

    try {
      files = fs.readdirSync(assetsDirPath, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name);
    } catch (readErr) {
      files = [];
    }

    const companies = files
      .filter((name) => ALLOWED_IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase()))
      .map((name) => {
        const base = path.basename(name, path.extname(name));
        return {
          id: base.toLowerCase(),
          name: toDisplayName(base),
          imageUrl: `/assets/${name}`,
        };
      });

    return sendSuccessResponse(res, 200, 'Delivery companies fetched successfully', {
      data: companies,
    });
  } catch (error) {
    error.statusCode = error.statusCode || 500;
    error.publicMessage = error.publicMessage || 'Failed to fetch delivery companies';
    next(error);
  }
};

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

const getWorkCategories = async (req, res, next) => {
  try {
    const categories = WORK_CATEGORIES.map((name) => ({
      id: name.toLowerCase().replace(/\s+/g, '_'),
      name,
    }));

    return sendSuccessResponse(res, 200, 'Work categories fetched successfully', {
      data: categories,
    });
  } catch (error) {
    error.statusCode = error.statusCode || 500;
    error.publicMessage = error.publicMessage || 'Failed to fetch work categories';
    next(error);
  }
};

module.exports = {
  getDeliveryCompanies,
  getWorkCategories,
};
