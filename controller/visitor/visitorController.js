const fsPromises = require('fs').promises;
const path = require('path');
const { sendSuccessResponse } = require('../../utils/response');
const { createHttpError, setErrorDefaults } = require('../../utils/httpError');
const DeliveryCompany = require('../../model/deliveryCompanySchema');
const TaxiDriverCompany = require('../../model/taxiDriverCompanySchema');
const OtherVisitorCompany = require('../../model/otherVisitorCompanySchema');
const { TAXI_DRIVER_COMPANIES } = require('../../utils/taxiDriverCompanies');
const { WORK_CATEGORIES } = require('../../utils/workCategories');
const { OTHER_VISITOR_COMPANIES } = require('../../utils/otherVisitorCompanies');

const ALLOWED_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const assetsDirPath = path.join(__dirname, '..', '..', 'assets');
const defaultLogoPath = path.join(assetsDirPath, 'Default.png');

const toDisplayName = (filenameBase) =>
  filenameBase.charAt(0).toUpperCase() + filenameBase.slice(1).toLowerCase();

const getDeliveryCompanies = async (req, res, next) => {
  try {
    const user = req.appUser;
    if (!user) {
      return next(createHttpError('Unauthorized.', 401));
    }
    if (!['visitor', 'member', 'guard', 'society_admin'].includes(user.role)) {
      return next(createHttpError('Only visitors, members, or guards can access delivery companies.', 403));
    }

    const existing = await DeliveryCompany.find().lean();

    if (existing && existing.length > 0) {
      return sendSuccessResponse(res, 200, 'Delivery companies fetched successfully.', {
        data: existing.map((c) => ({ id: c.id, name: c.name, imageUrl: c.imageUrl })),
      });
    }

    let files = [];
    try {
      const dirEntries = await fsPromises.readdir(assetsDirPath, { withFileTypes: true });
      files = dirEntries.filter((entry) => entry.isFile()).map((entry) => entry.name);
    } catch (readErr) {
      files = [];
    }

    let defaultBuffer;
    try {
      defaultBuffer = await fsPromises.readFile(defaultLogoPath);
    } catch (e) {
      defaultBuffer = null;
    }

    const companies = [];
    for (const name of files.filter((n) => ALLOWED_IMAGE_EXTENSIONS.has(path.extname(n).toLowerCase()))) {
      const base = path.basename(name, path.extname(name));
      let imageUrl = `/assets/${name}`;
      if (defaultBuffer) {
        try {
          const candidateBuffer = await fsPromises.readFile(path.join(assetsDirPath, name));
          if (candidateBuffer && candidateBuffer.length === defaultBuffer.length && candidateBuffer.equals(defaultBuffer)) {
            imageUrl = `/assets/Default.png`;
          }
        } catch (e) {}
      }
      companies.push({ id: base.toLowerCase(), name: toDisplayName(base), imageUrl });
    }

    if (companies.length > 0) {
      try {
        await DeliveryCompany.insertMany(
          companies.map((c) => ({ id: c.id, name: c.name, imageUrl: c.imageUrl }))
        );
      } catch (seedErr) {}
    }

    return sendSuccessResponse(res, 200, 'Delivery companies fetched successfully.', {
      data: companies,
    });
  } catch (error) {
    next(setErrorDefaults(error, 'Failed to fetch delivery companies.'));
  }
};

const getWorkCategories = async (req, res, next) => {
  try {
    const user = req.appUser;
    if (!user) {
      return next(createHttpError('Unauthorized.', 401));
    }
    if (!['visitor', 'member', 'guard', 'society_admin'].includes(user.role)) {
      return next(createHttpError('Only visitors, members, or guards can access work categories.', 403));
    }
    const categories = WORK_CATEGORIES.map((name) => ({
      id: name.toLowerCase().replace(/\s+/g, '_'),
      name,
    }));

    return sendSuccessResponse(res, 200, 'Work categories fetched successfully.', {
      data: categories,
    });
  } catch (error) {
    next(setErrorDefaults(error, 'Failed to fetch work categories.'));
  }
};

const getTaxiDriverCompanies = async (req, res, next) => {
  try {
    const user = req.appUser;
    if (!user) {
      return next(createHttpError('Unauthorized.', 401));
    }
    if (!['visitor', 'member', 'guard', 'society_admin'].includes(user.role)) {
      return next(createHttpError('Only visitors, members, or guards can access taxi driver companies.', 403));
    }
    const existing = await TaxiDriverCompany.find().lean();

    if (existing && existing.length > 0) {
      return sendSuccessResponse(res, 200, 'Taxi driver companies fetched successfully.', {
        data: existing.map((c) => ({ id: c.id, name: c.name, imageUrl: c.imageUrl })),
      });
    }

    if (TAXI_DRIVER_COMPANIES.length > 0) {
      try {
        await TaxiDriverCompany.insertMany(
          TAXI_DRIVER_COMPANIES.map((c) => ({ id: c.id, name: c.name, imageUrl: c.imageUrl }))
        );
      } catch (seedErr) {}
    }

    return sendSuccessResponse(res, 200, 'Taxi driver companies fetched successfully.', {
      data: TAXI_DRIVER_COMPANIES,
    });
  } catch (error) {
    next(setErrorDefaults(error, 'Failed to fetch taxi driver companies.'));
  }
};

const getOtherVisitorCompanies = async (req, res, next) => {
  try {
    const user = req.appUser;
    if (!user) {
      return next(createHttpError('Unauthorized.', 401));
    }
    if (!['visitor', 'member', 'guard', 'society_admin'].includes(user.role)) {
      return next(createHttpError('Only visitors, members, or guards can access other visitor companies.', 403));
    }
    const existing = await OtherVisitorCompany.find().lean();

    if (existing && existing.length > 0) {
      return sendSuccessResponse(res, 200, 'Other visitor companies fetched successfully.', {
        data: existing.map((c) => ({ id: c.id, name: c.name, imageUrl: c.imageUrl })),
      });
    }

    if (OTHER_VISITOR_COMPANIES.length > 0) {
      try {
        await OtherVisitorCompany.insertMany(
          OTHER_VISITOR_COMPANIES.map((c) => ({ id: c.id, name: c.name, imageUrl: c.imageUrl }))
        );
      } catch (seedErr) {}
    }

    return sendSuccessResponse(res, 200, 'Other visitor companies fetched successfully.', {
      data: OTHER_VISITOR_COMPANIES,
    });
  } catch (error) {
    next(setErrorDefaults(error, 'Failed to fetch other visitor companies.'));
  }
};

const addDeliveryCompany = async (req, res, next) => {
  try {
    const user = req.appUser;
    if (!user) {
      return next(createHttpError('Unauthorized.', 401));
    }
    if (!['visitor', 'member', 'guard', 'society_admin'].includes(user.role)) {
      return next(createHttpError('Only visitors, members, or guards can add delivery companies.', 403));
    }

    const { companyName } = req.body || {};

    if (!companyName || typeof companyName !== 'string') {
      return next(createHttpError('companyName is required.', 400));
    }

    const trimmed = companyName.trim();
    const base = trimmed.toLowerCase().replace(/[^a-z0-9]/g, '');

    if (!base) {
      return next(createHttpError('Company name is invalid.', 400));
    }

    const existing = await DeliveryCompany.findOne({ id: base });
    if (existing) {
      return next(createHttpError('Company already exists.', 409));
    }

    const record = await DeliveryCompany.create({
      id: base,
      name: toDisplayName(trimmed),
      imageUrl: `/assets/Default.png`,
    });

    return sendSuccessResponse(res, 201, 'Delivery company added successfully.', {
      data: { id: record.id, name: record.name, imageUrl: record.imageUrl },
    });
  } catch (error) {
    next(setErrorDefaults(error, 'Failed to add delivery company.'));
  }
};

const addTaxiDriverCompany = async (req, res, next) => {
  try {
    const user = req.appUser;
    if (!user) {
      return next(createHttpError('Unauthorized.', 401));
    }
    if (!['visitor', 'member', 'guard', 'society_admin'].includes(user.role)) {
      return next(createHttpError('Only visitors, members, or guards can add taxi driver companies.', 403));
    }

    const { companyName } = req.body || {};

    if (!companyName || typeof companyName !== 'string') {
      return next(createHttpError('companyName is required.', 400));
    }

    const trimmed = companyName.trim();
    const base = trimmed.toLowerCase().replace(/[^a-z0-9]/g, '');

    if (!base) {
      return next(createHttpError('Company name is invalid.', 400));
    }

    const existing = await TaxiDriverCompany.findOne({ id: base });
    if (existing) {
      return next(createHttpError('Company already exists.', 409));
    }

    const record = await TaxiDriverCompany.create({
      id: base,
      name: toDisplayName(trimmed),
      imageUrl: `/assets/Default.png`,
    });

    return sendSuccessResponse(res, 201, 'Taxi driver company added successfully.', {
      data: { id: record.id, name: record.name, imageUrl: record.imageUrl },
    });
  } catch (error) {
    next(setErrorDefaults(error, 'Failed to add taxi driver company.'));
  }
};

const addOtherVisitorCompany = async (req, res, next) => {
  try {
    const user = req.appUser;
    if (!user) {
      return next(createHttpError('Unauthorized.', 401));
    }
    if (!['visitor', 'member', 'guard', 'society_admin'].includes(user.role)) {
      return next(createHttpError('Only visitors, members, or guards can add other visitor companies.', 403));
    }

    const { companyName } = req.body || {};

    if (!companyName || typeof companyName !== 'string') {
      return next(createHttpError('companyName is required.', 400));
    }

    const trimmed = companyName.trim();
    const base = trimmed.toLowerCase().replace(/[^a-z0-9]/g, '');

    if (!base) {
      return next(createHttpError('Company name is invalid.', 400));
    }

    const existing = await OtherVisitorCompany.findOne({ id: base });
    if (existing) {
      return next(createHttpError('Company already exists.', 409));
    }

    const record = await OtherVisitorCompany.create({
      id: base,
      name: toDisplayName(trimmed),
      imageUrl: `/assets/Default.png`,
    });

    return sendSuccessResponse(res, 201, 'Other visitor company added successfully.', {
      data: { id: record.id, name: record.name, imageUrl: record.imageUrl },
    });
  } catch (error) {
    next(setErrorDefaults(error, 'Failed to add other visitor company.'));
  }
};

module.exports = {
  getDeliveryCompanies,
  getWorkCategories,
  getTaxiDriverCompanies,
  getOtherVisitorCompanies,
  addDeliveryCompany,
  addTaxiDriverCompany,
  addOtherVisitorCompany,
};
