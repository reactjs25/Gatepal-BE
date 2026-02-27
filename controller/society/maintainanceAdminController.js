const PDFDocument = require('pdfkit');
const path = require('path');
const Maintenance = require('../../model/maintenanceSchema');
const Society = require('../../model/societySchema');
const MemberUnit = require('../../model/memberUnitSchema');
const User = require('../../model/userSchema');
const { sendSuccessResponse } = require('../../utils/response');
const { createHttpError, setErrorDefaults } = require('../../utils/httpError');
const { normalizeString } = require('../../utils/strings');
const { resolveAdminSocietyFromContext } = require('../../utils/adminSocietyContext');
const { toDateOnly, toISTDateLabel, toISTDateTimeLabel } = require('../../utils/dateTime');
const { sendToUser } = require('../../utils/pushNotificationService');
const { getNotificationMessage } = require('../../utils/notificationMessages');
const { uploadBufferToS3, getS3ObjectKeyFromUrl } = require('../../utils/s3Upload');
const { generateAndUploadMaintenanceReport } = require('../../service/report/maintenanceReportService');

const MONTH_LABELS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const MAINTENANCE_REJECT_REASON_CATEGORIES = [
  'Transaction ID is not found in the bank records',
  'Uploaded proof is not readable',
  'Uploaded proof is not valid',
  'Wrong transaction details',
  'Others',
];

const MAINTENANCE_REJECT_REASON_CODES = new Set(
  MAINTENANCE_REJECT_REASON_CATEGORIES.map((name) => name.toLowerCase().replace(/\s+/g, '_'))
);


const FONT_PATH = path.join(__dirname, '../../assets/fonts');
const FONTS = {
  regular: path.join(FONT_PATH, 'NotoSans-Regular.ttf'),
  bold: path.join(FONT_PATH, 'NotoSans-Bold.ttf'),
  italic: path.join(FONT_PATH, 'NotoSans-Italic.ttf'),
};

const LOGO_PATH = path.join(__dirname, '../../assets/Logo.png');


const toTitleCase = (str) => {
  if (!str) return '';
  return str
    .toLowerCase()
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};


const formatAmount = (value) => {
  if (value == null || Number.isNaN(Number(value))) return null;
  return Number(value).toFixed(2);
};

const formatAmountForReceipt = (value) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '';
  return value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatDateDdMmYyyy = (date) => {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
};

const formatMonthYearShort = (month, year) => {
  if (!month || !year) return '';
  const m = String(month).substring(0, 3);
  return `${m}, ${year}`;
};

const buildMaintenanceReceiptPdf = async ({
  society,
  maintenance,
  unitLabel,
  ownerName,
  paidByName,
}) =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];

    
    doc.registerFont('NotoSans', FONTS.regular);
    doc.registerFont('NotoSans-Bold', FONTS.bold);
    doc.registerFont('NotoSans-Italic', FONTS.italic);

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', (err) => reject(err));

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const left = doc.page.margins.left;

    
    doc.image(LOGO_PATH, left, 35, { height: 30 });

    
    doc.moveDown(1.5);
    doc.fillColor('#000000').fontSize(12).font('NotoSans-Bold');
    doc.text(`Society Name: ${toTitleCase(society.societyName)}`, left, 75);
    doc.font('NotoSans');

    
    const addressParts = [society.address, society.city, society.state, society.country].filter(Boolean);
    if (addressParts.length) {
      doc.fontSize(10).text(`Address: ${addressParts.join(', ')}`, left, 95);
    }

    let y = 130;
    const headerHeight = 80;
    const headerRightWidthRatio = 0.42;
    const headerRightX = left + pageWidth * (1 - headerRightWidthRatio);

    
    doc.lineWidth(1).strokeColor('#4A90D9').dash(3, { space: 2 });
    doc.rect(left, y, pageWidth, headerHeight).stroke();
    doc.moveTo(headerRightX, y).lineTo(headerRightX, y + headerHeight).stroke();
    doc.undash(); 

    const labelOffsetX = 10;
    const valueOffsetX = 120;
    const lineGap = 22;

    doc.fontSize(10).fillColor('#000000');
    doc.text('Owner', left + labelOffsetX, y + 12);
    doc.text(':', left + valueOffsetX - 10, y + 12);
    doc.font('NotoSans-Bold').text(toTitleCase(ownerName) || '-', left + valueOffsetX, y + 12);
    doc.font('NotoSans');

    doc.text('Unit Number', left + labelOffsetX, y + 12 + lineGap);
    doc.text(':', left + valueOffsetX - 10, y + 12 + lineGap);
    doc.font('NotoSans-Bold').text(unitLabel || '-', left + valueOffsetX, y + 12 + lineGap);
    doc.font('NotoSans');

    doc.text('Paid By', left + labelOffsetX, y + 12 + lineGap * 2);
    doc.text(':', left + valueOffsetX - 10, y + 12 + lineGap * 2);
    doc.font('NotoSans-Bold').text(toTitleCase(paidByName) || '-', left + valueOffsetX, y + 12 + lineGap * 2);
    doc.font('NotoSans');

    const rightLabelOffsetX = 10;
    const rightValueOffsetX = 140;

    doc.text('Receipt Number', headerRightX + rightLabelOffsetX, y + 12);
    doc.text(':', headerRightX + rightValueOffsetX - 10, y + 12);
    doc.font('NotoSans-Bold').text(String(maintenance.receiptNumber || ''), headerRightX + rightValueOffsetX, y + 12);
    doc.font('NotoSans');

    const receiptDate = maintenance.verifiedAt || maintenance.updatedAt || new Date();
    doc.text('Receipt Date', headerRightX + rightLabelOffsetX, y + 12 + lineGap);
    doc.text(':', headerRightX + rightValueOffsetX - 10, y + 12 + lineGap);
    doc.font('NotoSans-Bold').text(formatDateDdMmYyyy(receiptDate), headerRightX + rightValueOffsetX, y + 12 + lineGap);
    doc.font('NotoSans');

    y += headerHeight + 10;

    const receiptBarHeight = 22;
    doc.rect(left, y, pageWidth, receiptBarHeight).fillAndStroke('#00A651', '#00A651');
    doc.fillColor('#FFFFFF').fontSize(12).font('NotoSans-Bold').text('Receipt', left + 10, y + 4);

    y += receiptBarHeight;
    const headerRowHeight = 24;
    const dataRowHeight = 26;

    const colWidths = [
      pageWidth * 0.32,
      pageWidth * 0.16,
      pageWidth * 0.16,
      pageWidth * 0.2,
      pageWidth * 0.16,
    ];

    const colX = [
      left,
      left + colWidths[0],
      left + colWidths[0] + colWidths[1],
      left + colWidths[0] + colWidths[1] + colWidths[2],
      left + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3],
    ];

    doc.fillColor('#000000').fontSize(10).font('NotoSans-Bold');
    doc.rect(left, y, pageWidth, headerRowHeight).stroke('#000000');
    for (let i = 1; i < colX.length; i += 1) {
      doc.moveTo(colX[i], y).lineTo(colX[i], y + headerRowHeight + dataRowHeight).stroke();
    }

    const headerTitles = [
      'Description',
      'Month',
      'Due Date',
      'Payment Date',
      'Amount (₹)',
    ];

    for (let i = 0; i < headerTitles.length; i += 1) {
      doc.text(headerTitles[i], colX[i] + 6, y + 6);
    }

    y += headerRowHeight;

    doc.font('NotoSans').rect(left, y, pageWidth, dataRowHeight).stroke('#000000');

    const paymentDate = maintenance.transactionDate;

    const monthYearLabel = formatMonthYearShort(maintenance.month, maintenance.year);

    const dueDateDay =
      typeof society.maintenanceDueDate === 'number' && Number.isFinite(society.maintenanceDueDate)
        ? society.maintenanceDueDate
        : null;

    let dueDate = '';
    if (dueDateDay) {
      const monthIndex = MONTH_LABELS.indexOf(maintenance.month);
      if (monthIndex >= 0) {
        const d = new Date(maintenance.year, monthIndex, dueDateDay);
        dueDate = formatDateDdMmYyyy(d);
      }
    }

    doc.text('Maintenance Charges', colX[0] + 6, y + 6);
    doc.text(monthYearLabel, colX[1] + 6, y + 6);
    doc.text(dueDate || '-', colX[2] + 6, y + 6);
    doc.text(formatDateDdMmYyyy(paymentDate), colX[3] + 6, y + 6);
    doc.text(formatAmountForReceipt(maintenance.amount), colX[4] + 6, y + 6, {
      align: 'right',
      width: colWidths[4] - 12,
    });

    y += dataRowHeight + 24;

    doc.font('NotoSans-Italic')
      .fontSize(9)
      .fillColor('#555555')
      .text('This is a computer generated receipt and requires no authentication.', left, y, {
        align: 'left',
      });

    doc.end();
  });

const resolveAdminSociety = async (req, authUser) =>
  resolveAdminSocietyFromContext({ req, authUser });

const toCanonicalMonth = (value) => {
  const v = normalizeString(value).toLowerCase();
  if (!v) return '';
  const map = {
    january: 'January',
    february: 'February',
    march: 'March',
    april: 'April',
    may: 'May',
    june: 'June',
    july: 'July',
    august: 'August',
    september: 'September',
    october: 'October',
    november: 'November',
    december: 'December',
  };
  return map[v] || '';
};

const toCanonicalMonthLabel = (value) => {
  const s = normalizeString(value);
  if (!s) return '';
  const parts = s.split(/\s+/);
  if (parts.length < 2) return '';
  const m = toCanonicalMonth(parts[0]);
  const y = Math.round(Number(parts[parts.length - 1]));
  if (!m || !Number.isFinite(y) || String(y).length !== 4) return '';
  return `${m} ${y}`;
};

const uploadMaintenanceReceiptPdf = async ({ societyId, maintenanceId, receiptNumber, buffer }) => {
  if (!buffer) return null;
  return uploadBufferToS3({
    buffer,
    contentType: 'application/pdf',
    keyPrefix: `maintenance/${String(societyId)}/receipts`,
    fileExtension: 'pdf',
    fileName: `maintenance-${maintenanceId || 'unknown'}-receipt-${receiptNumber || 'na'}`,
  });
};

const resolveOrCreateReceiptUrl = async ({ doc, society, unitLabel, ownerName, paidByName }) => {
  if (!society) return null;
  if (String(doc.status || '').toLowerCase() !== 'verified' || !doc.receiptNumber) return null;
  if (doc.receiptUrl) return doc.receiptUrl;

  const buffer = await buildMaintenanceReceiptPdf({
    society,
    maintenance: doc,
    unitLabel,
    ownerName,
    paidByName,
  });

  const receiptUrl = await uploadMaintenanceReceiptPdf({
    societyId: society._id,
    maintenanceId: doc.maintenanceId,
    receiptNumber: doc.receiptNumber,
    buffer,
  });

  if (receiptUrl) {
    await Maintenance.updateOne(
      { maintenanceId: doc.maintenanceId },
      { $set: { receiptUrl } }
    );
  }

  return receiptUrl;
};

const isSameStoredObjectUrl = (incomingValue, storedValue) => {
  const incoming = normalizeString(incomingValue);
  const stored = normalizeString(storedValue);

  if (incoming === stored) return true;

  const incomingKey = getS3ObjectKeyFromUrl(incoming);
  const storedKey = getS3ObjectKeyFromUrl(stored);
  return Boolean(incomingKey && storedKey && incomingKey === storedKey);
};

const getLastBodyValue = (value) => {
  if (!Array.isArray(value)) return value;
  if (value.length === 0) return undefined;
  return value[value.length - 1];
};

const getMaintenanceYearlySummary = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    const society = await resolveAdminSociety(req, authUser);

    const year = Math.round(Number((req.body && req.body.year) || (req.query && req.query.year) || new Date().getFullYear()));
    if (!Number.isFinite(year) || String(year).length !== 4) {
      return next(createHttpError('year must be a 4-digit number.', 400));
    }

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonthIndex = now.getMonth(); 
    const minYear = currentYear - 2;
    const maxYear = currentYear + 2;
    if (year < minYear || year > maxYear) {
      return next(createHttpError(`year must be between ${minYear} and ${maxYear}`, 400));
    }

    const wings = Array.isArray(society.structure) ? society.structure : [];
    const totalUnits = wings.reduce((sum, w) => {
      const units = Array.isArray(w.units) ? w.units.length : 0;
      const declared = typeof w.totalUnits === 'number' ? w.totalUnits : 0;
      return sum + (declared || units);
    }, 0);

    const occupants = await MemberUnit.find(
      { societyId: society._id },
      { wingNameLower: 1, unitNumberLower: 1, occupantType: 1, occupancyStatus: 1 }
    ).lean();
    const unitGroups = occupants.reduce((acc, u) => {
      const key = `${u.wingNameLower}:${u.unitNumberLower}`;
      if (!acc[key]) acc[key] = [];
      acc[key].push(u);
      return acc;
    }, {});

    const groupKeys = Object.keys(unitGroups);
    const classify = (items) => {
      const types = new Set(items.map((x) => x.occupantType));
      const statuses = new Set(items.map((x) => x.occupancyStatus));
      if (types.has('tenant') || types.has('tenant_family_member') || statuses.has('unit_rented')) return 'tenant';
      if (statuses.has('unit_vacant') && !statuses.has('currently_residing')) return 'vacant';
      if (types.has('unit_owner') || types.has('unit_owner_family_member')) return 'owner';
      return 'owner';
    };

    const ownerUnitKeys = groupKeys.filter((k) => classify(unitGroups[k]) === 'owner');
    const tenantUnitKeys = groupKeys.filter((k) => classify(unitGroups[k]) === 'tenant');
    const occupiedCount = ownerUnitKeys.length + tenantUnitKeys.length;
    const vacantCount = Math.max(0, totalUnits - occupiedCount);

    const prefix = `${String(society._id)}:`;
    const maintDocsYear = await Maintenance.find(
      { unitId: { $regex: `^${prefix}` }, year, deletedAt: null },
      { unitId: 1, month: 1, status: 1 }
    ).lean();

    const docsByMonth = maintDocsYear.reduce((acc, d) => {
      const m = d.month || '';
      if (!acc[m]) acc[m] = [];
      acc[m].push(d);
      return acc;
    }, {});

    const parseUnit = (u) => {
      const parts = String(u || '').split(':');
      return { wingLower: parts[1] || '', unitLower: parts[2] || '' };
    };

    let monthsToReturn = MONTH_LABELS;
    if (year > currentYear) {
      // For future years, only show months that have any uploads/records.
      monthsToReturn = MONTH_LABELS.filter((m) => (docsByMonth[m] || []).length > 0);
      if (monthsToReturn.length === 0) {
        return sendSuccessResponse(res, 200, 'Maintenance yearly summary fetched successfully.', {
          data: null,
        });
      }
    } else if (year === currentYear) {
      
      monthsToReturn = MONTH_LABELS.slice(0, currentMonthIndex + 1);
    }

    const data = monthsToReturn.map((month) => {
      const maintDocs = docsByMonth[month] || [];

      const statusMap = maintDocs.reduce((acc, d) => {
        const p = parseUnit(d.unitId);
        const key = `${p.wingLower}:${p.unitLower}`;
        const s = normalizeString(d.status).toLowerCase();
        const canonical = s === 'verified' ? 'verified' : s === 'rejected' ? 'rejected' : 'uploaded';
        acc[key] = canonical;
        return acc;
      }, {});

      let owner = { totalUnits: ownerUnitKeys.length, pending: 0, uploaded: 0, verified: 0, rejected: 0 };
      let tenant = { totalUnits: tenantUnitKeys.length, pending: 0, uploaded: 0, verified: 0, rejected: 0 };

      for (const key of ownerUnitKeys) {
        const st = statusMap[key];
        if (!st) owner.pending += 1; else if (st === 'verified') owner.verified += 1; else if (st === 'rejected') owner.rejected += 1; else owner.uploaded += 1;
      }
      for (const key of tenantUnitKeys) {
        const st = statusMap[key];
        if (!st) tenant.pending += 1; else if (st === 'verified') tenant.verified += 1; else if (st === 'rejected') tenant.rejected += 1; else tenant.uploaded += 1;
      }

      const totals = maintDocs.reduce(
        (acc, d) => {
          const s = normalizeString(d.status).toLowerCase();
          if (s === 'verified') acc.verified += 1; else if (s === 'rejected') acc.rejected += 1; else acc.uploaded += 1;
          return acc;
        },
        { pending: owner.pending + tenant.pending, uploaded: 0, verified: 0, rejected: 0 }
      );

      const pendingUnits = owner.pending + tenant.pending;
      const uploaded = totals.uploaded;
      const verified = totals.verified;
      const rejected = totals.rejected;

      let status = 'Pending';
      if (uploaded === 0 && pendingUnits === 0 && (verified + rejected > 0)) {
        status = 'Completed';
      } else if (verified === 0 && rejected === 0 && uploaded === 0) {
        status = 'Pending';
      } else {
        status = 'Partial';
      }

      const statusTag = status === 'Completed' ? 'Completed' : `${pendingUnits} Pending`;

      return {
        month,
        year: String(year),
        monthLabel: `${month} ${year}`,
        status,
        statusTag,
        counts: {
          pendingUnits: String(pendingUnits),
          uploaded: String(uploaded),
          verified: String(verified),
          rejected: String(rejected),
          totalUnits: String(totalUnits),
          vacantUnits: String(vacantCount),
        },
      };
    });

    return sendSuccessResponse(res, 200, 'Maintenance yearly summary fetched successfully.', { data });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch maintenance yearly summary'));
  }
};

const getMaintenanceSummaryByMonth = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    const society = await resolveAdminSociety(req, authUser);

    const monthRaw = (req.body && req.body.month) || '';
    const month = toCanonicalMonth(monthRaw);
    if (!month) return next(createHttpError('Invalid month.', 400));
    const year = Math.round(Number((req.body && req.body.year) || new Date().getFullYear()));
    if (!Number.isFinite(year) || String(year).length !== 4) {
      return next(createHttpError('year must be a 4-digit number.', 400));
    }

    const wings = Array.isArray(society.structure) ? society.structure : [];
    const totalUnits = wings.reduce((sum, w) => {
      const units = Array.isArray(w.units) ? w.units.length : 0;
      const declared = typeof w.totalUnits === 'number' ? w.totalUnits : 0;
      return sum + (declared || units);
    }, 0);

    const occupants = await MemberUnit.find(
      { societyId: society._id },
      { wingNameLower: 1, unitNumberLower: 1, occupantType: 1, occupancyStatus: 1 }
    ).lean();
    const unitGroups = occupants.reduce((acc, u) => {
      const key = `${u.wingNameLower}:${u.unitNumberLower}`;
      if (!acc[key]) acc[key] = [];
      acc[key].push(u);
      return acc;
    }, {});

    const groupKeys = Object.keys(unitGroups);
    const classify = (items) => {
      const types = new Set(items.map((x) => x.occupantType));
      const statuses = new Set(items.map((x) => x.occupancyStatus));
      if (types.has('tenant') || types.has('tenant_family_member') || statuses.has('unit_rented')) return 'tenant';
      if (statuses.has('unit_vacant') && !statuses.has('currently_residing')) return 'vacant';
      if (types.has('unit_owner') || types.has('unit_owner_family_member')) return 'owner';
      return 'owner';
    };

    const ownerUnitKeys = groupKeys.filter((k) => classify(unitGroups[k]) === 'owner');
    const tenantUnitKeys = groupKeys.filter((k) => classify(unitGroups[k]) === 'tenant');
    const occupiedCount = ownerUnitKeys.length + tenantUnitKeys.length;
    const vacantCount = Math.max(0, totalUnits - occupiedCount);

    const prefix = `${String(society._id)}:`;
    const maintDocs = await Maintenance.find({ unitId: { $regex: `^${prefix}` }, month, year, deletedAt: null }, { unitId: 1, status: 1 }).lean();
    const parseUnit = (u) => {
      const parts = String(u || '').split(':');
      return { wingLower: parts[1] || '', unitLower: parts[2] || '' };
    };
    const statusMap = maintDocs.reduce((acc, d) => {
      const p = parseUnit(d.unitId);
      const key = `${p.wingLower}:${p.unitLower}`;
      const s = normalizeString(d.status).toLowerCase();
      const canonical = s === 'verified' ? 'verified' : s === 'rejected' ? 'rejected' : 'uploaded';
      acc[key] = canonical;
      return acc;
    }, {});

    let owner = { totalUnits: ownerUnitKeys.length, pending: 0, uploaded: 0, verified: 0, rejected: 0 };
    let tenant = { totalUnits: tenantUnitKeys.length, pending: 0, uploaded: 0, verified: 0, rejected: 0 };

    for (const key of ownerUnitKeys) {
      const st = statusMap[key];
      if (!st) owner.pending += 1; else if (st === 'verified') owner.verified += 1; else if (st === 'rejected') owner.rejected += 1; else owner.uploaded += 1;
    }
    for (const key of tenantUnitKeys) {
      const st = statusMap[key];
      if (!st) tenant.pending += 1; else if (st === 'verified') tenant.verified += 1; else if (st === 'rejected') tenant.rejected += 1; else tenant.uploaded += 1;
    }

    const totals = maintDocs.reduce(
      (acc, d) => {
        const s = normalizeString(d.status).toLowerCase();
        if (s === 'verified') acc.verified += 1; else if (s === 'rejected') acc.rejected += 1; else acc.uploaded += 1;
        return acc;
      },
      { pending: owner.pending + tenant.pending, uploaded: 0, verified: 0, rejected: 0 }
    );

    const totalPending = owner.pending + tenant.pending;

    return sendSuccessResponse(res, 200, 'Maintenance summary fetched successfully.', {
      data: {
        monthLabel: `${month} ${year}`,
        societyId: String(society._id),
        totalPendingCount: `${totalPending} Pending`,
        pendingCount: {
          ownerPendingCount: `${owner.pending} Pending`,
          tenantPendingCount: `${tenant.pending} Pending`,
          vacantCount: `${vacantCount} Vacant`,
        },
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch maintenance summary'));
  }
};

const listUploadedMaintenanceByMonth = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    const society = await resolveAdminSociety(req, authUser);

    const monthRaw = (req.body && req.body.month) || '';
    const month = toCanonicalMonth(monthRaw);
    if (!month) return next(createHttpError('Invalid month parameter.', 400));
    const year = Math.round(Number((req.body && req.body.year) || new Date().getFullYear()));
    if (!Number.isFinite(year) || String(year).length !== 4) {
      return next(createHttpError('year must be a 4-digit number.', 400));
    }

    const statusRaw = normalizeString((req.body && req.body.status) || '');
    const requestedStatusKey = statusRaw ? statusRaw.toLowerCase() : '';
    let statusQuery = null;
    let includePendingMissing = false;
    if (statusRaw) {
      const s = statusRaw.toLowerCase();
      if (s === 'pending') {
        includePendingMissing = true;
        statusQuery = { $in: ['REJECTED', 'Rejected'] };
      } else {
        const statusCanonicalMap = { uploaded: 'UPLOADED', verified: 'VERIFIED', rejected: 'REJECTED' };
        const canonical = statusCanonicalMap[s] || null;
        if (!canonical) return next(createHttpError('Invalid status parameter.', 400));
        const legacyMap = { UPLOADED: 'Uploaded', VERIFIED: 'Verified', REJECTED: 'Rejected' };
        statusQuery = { $in: [canonical, legacyMap[canonical]] };
      }
    }

    const prefix = `${String(society._id)}:`;
    const baseQuery = {
      unitId: { $regex: `^${prefix}` },
      month,
      year,
      deletedAt: null,
    };
    if (statusQuery) {
      baseQuery.status = statusQuery;
    } else {
      baseQuery.$or = [
        { status: { $in: ['UPLOADED', 'Uploaded'] } },
        { status: { $exists: false } },
        { status: null },
      ];
    }

    const items = await Maintenance.find(baseQuery)
      .sort({ createdAt: -1 })
      .lean();

    const parseUnit = (u) => {
      const parts = String(u || '').split(':');
      return { societyId: parts[0] || '', wingLower: parts[1] || '', unitLower: parts[2] || '' };
    };

    let unitDocs = [];
    if (includePendingMissing) {
      unitDocs = await MemberUnit.find(
        { societyId: society._id },
        {
          wingName: 1,
          wingNameLower: 1,
          unitNumber: 1,
          unitNumberLower: 1,
          occupantType: 1,
          occupancyStatus: 1,
          memberId: 1,
        }
      ).lean();
    } else {
      const unitKeys = Array.from(
        new Set(items.map((m) => {
          const p = parseUnit(m.unitId);
          return `${p.wingLower}:${p.unitLower}`;
        }))
      );
      const unitQueryOr = unitKeys.map((key) => {
        const [wingLower, unitLower] = key.split(':');
        return { societyId: society._id, wingNameLower: wingLower, unitNumberLower: unitLower };
      });
      if (unitQueryOr.length > 0) {
        unitDocs = await MemberUnit.find(
          { $or: unitQueryOr },
          {
            wingName: 1,
            wingNameLower: 1,
            unitNumber: 1,
            unitNumberLower: 1,
            occupantType: 1,
            occupancyStatus: 1,
            memberId: 1,
          }
        ).lean();
      }
    }
    const unitGroups = unitDocs.reduce((acc, u) => {
      const key = `${u.wingNameLower}:${u.unitNumberLower}`;
      if (!acc[key]) acc[key] = [];
      acc[key].push(u);
      return acc;
    }, {});

    const uploaderIds = Array.from(new Set(items.map((m) => String(m.memberId))));
    const ownerIds = [];
    const tenantResidentIds = [];
    for (const key of Object.keys(unitGroups)) {
      const group = unitGroups[key] || [];
      const owner = group.find(
        (u) => u.occupantType === 'unit_owner' && u.occupancyStatus === 'currently_residing'
      );
      const tenantResident = group.find(
        (u) => u.occupantType === 'tenant' && u.occupancyStatus === 'unit_rented'
      );
      if (owner) ownerIds.push(String(owner.memberId));
      if (tenantResident) tenantResidentIds.push(String(tenantResident.memberId));
    }
    const verifierIds = Array.from(
      new Set(
        items
          .map((m) => (m.verifiedByUserId ? String(m.verifiedByUserId) : null))
          .filter((id) => id)
      )
    );
    const rejectorIds = Array.from(
      new Set(
        items
          .map((m) => (m.rejectedByUserId ? String(m.rejectedByUserId) : null))
          .filter((id) => id)
      )
    );
    const userIds = Array.from(
      new Set([...uploaderIds, ...ownerIds, ...tenantResidentIds, ...verifierIds, ...rejectorIds])
    );
    const users =
      userIds.length > 0
        ? await User.find({ _id: { $in: userIds } }, { fullName: 1, phoneNumber: 1, role: 1 }).lean()
        : [];
    const userMap = users.reduce((acc, u) => { acc[String(u._id)] = u; return acc; }, {});

    const dataUploaded = await Promise.all(items.map(async (doc) => {
      const p = parseUnit(doc.unitId);
      const key = `${p.wingLower}:${p.unitLower}`;
      const group = unitGroups[key] || [];

      const primaryUnit =
        group.find((u) => u.occupantType === 'unit_owner') ||
        group.find((u) => u.occupantType === 'tenant') ||
        group[0] ||
        null;

      const unitNumber = primaryUnit ? primaryUnit.unitNumber : null;
      const categoryLabel = primaryUnit
        ? primaryUnit.occupantType === 'unit_owner'
          ? 'Owner'
          : primaryUnit.occupantType === 'tenant'
          ? 'Tenant'
          : ''
        : '';

      const residentUnit =
        group.find(
          (u) => u.occupantType === 'unit_owner' && u.occupancyStatus === 'currently_residing'
        ) ||
        group.find(
          (u) => u.occupantType === 'tenant' && u.occupancyStatus === 'unit_rented'
        ) ||
        null;
      const residentUser = residentUnit ? userMap[String(residentUnit.memberId)] || {} : {};

      const verifier = doc.verifiedByUserId ? userMap[String(doc.verifiedByUserId)] || {} : {};
      const rejector = doc.rejectedByUserId ? userMap[String(doc.rejectedByUserId)] || {} : {};

      let receipt = null;
      let receiptDate = null;
      const statusLower = String(doc.status || '').toLowerCase();
      let statusLabel = doc.status;
      if (society && statusLower === 'verified' && doc.receiptNumber) {
        try {
          const unitLabel = primaryUnit
            ? primaryUnit.wingName
              ? `${primaryUnit.wingName}-${primaryUnit.unitNumber}`
              : primaryUnit.unitNumber
            : unitNumber;
          const uploaderUser = userMap[String(doc.memberId)] || {};
          receipt = await resolveOrCreateReceiptUrl({
            doc,
            society,
            unitLabel,
            ownerName: residentUser.fullName || '',
            paidByName: uploaderUser.fullName || '',
          });
          receiptDate = doc.verifiedAt || null;
        } catch (e) {
          receipt = null;
          receiptDate = doc.verifiedAt || null;
        }
      }

      return {
        maintenanceId: doc.maintenanceId,
        unitId: primaryUnit ? String(primaryUnit._id) : null,
        monthLabel: `${month} ${year}`,
        unitNumber,
        unitCategory: categoryLabel || null,
        ownerName: toTitleCase(residentUser.fullName) || '',
        amount: formatAmount(doc.amount),
        transactionDate: toISTDateLabel(doc.transactionDate),
        status: includePendingMissing && statusLower === 'rejected' ? 'Pending Rejected' : statusLabel,
        proofImageUrl: doc.proofImageUrl,
        uploadedOn: toISTDateTimeLabel(doc.createdAt),
        uploadedBy: toTitleCase((userMap[String(doc.memberId)] || {}).fullName) || null,
        verifiedBy: verifier.role || null,
        verifiedOn: doc.verifiedAt ? toISTDateTimeLabel(doc.verifiedAt) : null,
        rejectionReason: doc.rejectionReason || null,
        rejectionDescription: doc.rejectionDescription || null,
        rejectedBy: rejector.role || null,
        rejectedOn: doc.rejectedAt ? toISTDateTimeLabel(doc.rejectedAt) : null,
        receiptNumber: doc.receiptNumber != null ? String(doc.receiptNumber) : null,
        receiptDate,
        receipt,
        rejectedAt: doc.rejectedAt || null,
      };
    }));

    let data = dataUploaded;
    if (includePendingMissing) {
      const presentKeys = new Set(items.map((m) => {
        const p = parseUnit(m.unitId);
        return `${p.wingLower}:${p.unitLower}`;
      }));
      const allKeys = Object.keys(unitGroups);
      const missingKeys = allKeys.filter((k) => {
        const g = unitGroups[k] || [];
        const ownerUnit = g.find((u) => u.occupantType === 'unit_owner') || g.find((u) => u.occupantType === 'tenant') || null;
        return ownerUnit && !presentKeys.has(k);
      });
      const synthetic = missingKeys.map((key) => {
        const g = unitGroups[key] || [];
        const ownerUnit = g.find((u) => u.occupantType === 'unit_owner') || g.find((u) => u.occupantType === 'tenant') || null;
        const unitNumber = ownerUnit ? ownerUnit.unitNumber : null;
        const categoryLabel = ownerUnit ? (ownerUnit.occupantType === 'unit_owner' ? 'Owner' : ownerUnit.occupantType === 'tenant' ? 'Tenant' : '') : '';
        const ownerUser = ownerUnit ? userMap[String(ownerUnit.memberId)] || {} : {};
        return {
          unitId: ownerUnit ? String(ownerUnit._id) : null,
          monthLabel: `${month} ${year}`,
          unitNumber,
          unitCategory: categoryLabel || null,
          ownerName: ownerUser.fullName || null,
        };
      });
      data = dataUploaded.concat(synthetic);
    }

    let report = null;
    if (['uploaded', 'verified', 'rejected'].includes(requestedStatusKey)) {
      try {
        report = await generateAndUploadMaintenanceReport({
          societyId: String(society._id),
          month,
          year,
          status: requestedStatusKey,
        });
      } catch (reportError) {
        report = null;
      }
    }

    return sendSuccessResponse(res, 200, 'Maintenance uploads fetched successfully.', {
      data,
      reportUrl: report?.url || null,
      reportCount: report?.count ?? null,
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch maintenance uploads'));
  }
};

const verifyMaintenance = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    const society = await resolveAdminSociety(req, authUser);

    const maintenanceId = normalizeString((req.body && req.body.maintenanceId) || '');
    if (!maintenanceId) return next(createHttpError('maintenanceId is required.', 400));

    const doc = await Maintenance.findOne({ maintenanceId });
    if (!doc) return next(createHttpError('Maintenance not found.', 404));

    const prefix = `${String(society._id)}:`;
    if (!String(doc.unitId).startsWith(prefix)) {
      return next(createHttpError('Maintenance does not belong to this society.', 403));
    }

    if (doc.deletedAt) return next(createHttpError('Maintenance not found.', 404));
    if (doc.status && doc.status.toLowerCase() === 'verified') {
      return next(createHttpError('Maintenance already verified.', 409));
    }
    if (doc.status && doc.status.toLowerCase() === 'rejected') {
      return next(createHttpError('Maintenance is rejected and cannot be verified.', 409));
    }

    const payload = req.body || {};
    const unitWing = getLastBodyValue(payload.unitWing);
    const unitNumber = getLastBodyValue(payload.unitNumber);
    const unitCategory = getLastBodyValue(payload.unitCategory);
    const ownerName = getLastBodyValue(payload.ownerName);
    const amount = getLastBodyValue(payload.amount);
    const transactionDate = getLastBodyValue(payload.transactionDate);
    const uploadedBy = getLastBodyValue(payload.uploadedBy);
    const proofImageUrl = getLastBodyValue(
      payload.proofImage !== undefined
        ? payload.proofImage
        : payload.proofImageUrl !== undefined
          ? payload.proofImageUrl
          : payload.image !== undefined
            ? payload.image
            : payload.imageUrl
    );
    const uploadedOn = getLastBodyValue(payload.uploadedOn);
    const monthLabel = getLastBodyValue(payload.monthLabel);

    const parseUnit = (u) => {
      const parts = String(u || '').split(':');
      return { societyId: parts[0] || '', wingLower: parts[1] || '', unitLower: parts[2] || '' };
    };
    const parsed = parseUnit(doc.unitId);
    const unitDocs = await MemberUnit.find(
      { societyId: parsed.societyId, wingNameLower: parsed.wingLower, unitNumberLower: parsed.unitLower },
      { wingName: 1, wingNameLower: 1, unitNumber: 1, unitNumberLower: 1, occupantType: 1, memberId: 1 }
    ).lean();
    const ownerUnit = unitDocs.find((u) => u.occupantType === 'unit_owner') || unitDocs.find((u) => u.occupantType === 'tenant') || null;
    const expectedWing = ownerUnit ? ownerUnit.wingName : null;
    const expectedNumber = ownerUnit ? ownerUnit.unitNumber : null;
    const expectedCategory = ownerUnit ? (ownerUnit.occupantType === 'unit_owner' ? 'Owner' : ownerUnit.occupantType === 'tenant' ? 'Tenant' : '') : '';

    const User = require('../../model/userSchema');
    const ownerUser = ownerUnit ? await User.findById(ownerUnit.memberId, { fullName: 1 }).lean() : null;
    const uploaderUser = await User.findById(doc.memberId, { fullName: 1 }).lean();

    if (unitWing !== undefined && normalizeString(unitWing) !== normalizeString(expectedWing)) {
      return next(createHttpError('Payload unitWing does not match record.', 409));
    }
    if (unitNumber !== undefined && normalizeString(unitNumber) !== normalizeString(expectedNumber)) {
      return next(createHttpError('Payload unitNumber does not match record.', 409));
    }
    if (unitCategory !== undefined && normalizeString(unitCategory) !== normalizeString(expectedCategory)) {
      return next(createHttpError('Payload unitCategory does not match record.', 409));
    }
    if (ownerName !== undefined && normalizeString(ownerName) !== normalizeString(ownerUser ? ownerUser.fullName : '')) {
      return next(createHttpError('Payload ownerName does not match record.', 409));
    }
    if (amount !== undefined && Number(amount) !== doc.amount) {
      return next(createHttpError('Payload amount does not match record.', 409));
    }
    if (transactionDate !== undefined) {
      const expectedTransactionDateLabel = normalizeString(toISTDateLabel(doc.transactionDate));
      const payloadTransactionDateLabel = normalizeString(transactionDate);

      if (payloadTransactionDateLabel !== expectedTransactionDateLabel) {
        const txDatePayload = new Date(transactionDate);
        if (Number.isNaN(txDatePayload.getTime())) {
          return next(createHttpError('transactionDate must be a valid date.', 400));
        }

        const payloadAsIstLabel = normalizeString(toISTDateLabel(txDatePayload));
        if (payloadAsIstLabel !== expectedTransactionDateLabel) {
          return next(createHttpError('Payload transactionDate does not match record.', 409));
        }
      }
    }
    if (uploadedBy !== undefined && normalizeString(uploadedBy) !== normalizeString(uploaderUser ? uploaderUser.fullName : '')) {
      return next(createHttpError('Payload uploadedBy does not match record.', 409));
    }

    if (!proofImageUrl) {
      return next(createHttpError('proofImageUrl is required.', 400));
    }
    if (!isSameStoredObjectUrl(proofImageUrl, doc.proofImageUrl)) {
      return next(createHttpError('Payload proofImageUrl does not match record.', 409));
    }
    if (!uploadedOn) {
      return next(createHttpError('uploadedOn is required.', 400));
    }
    const expectedUploadedOn = toISTDateTimeLabel(doc.createdAt);
    if (normalizeString(uploadedOn) !== normalizeString(expectedUploadedOn)) {
      return next(createHttpError('Payload uploadedOn does not match record.', 409));
    }
    if (!monthLabel) {
      return next(createHttpError('monthLabel is required.', 400));
    }
    const canonicalPayloadMonthLabel = toCanonicalMonthLabel(monthLabel);
    const canonicalExpectedMonthLabel = `${doc.month} ${doc.year}`;
    if (canonicalPayloadMonthLabel !== canonicalExpectedMonthLabel) {
      return next(createHttpError('Payload monthLabel does not match record.', 409));
    }

    if (!doc.receiptNumber) {
      const lastWithReceipt = await Maintenance.findOne({ receiptNumber: { $ne: null } })
        .sort({ receiptNumber: -1 })
        .lean();
      const nextReceiptNumber =
        lastWithReceipt && lastWithReceipt.receiptNumber
          ? lastWithReceipt.receiptNumber + 1
          : 1;
      doc.receiptNumber = nextReceiptNumber;
    }

    doc.status = 'Verified';
    doc.verifiedAt = new Date();
    doc.verifiedByUserId = authUser._id || null;
    await doc.save();

    
    if (doc.memberId) {
      sendToUser(
        doc.memberId,
        'Maintenance Verified',
        `Your maintenance payment for ${doc.month} ${doc.year} has been verified.`,
        {
          type: 'maintenance_verified',
          maintenanceId: doc.maintenanceId,
          month: doc.month,
          year: String(doc.year),
        },
        {
          localizedContentResolver: ({ languageCode }) =>
            getNotificationMessage(
              'maintenance_verified',
              { month: doc.month, year: String(doc.year) },
              languageCode
            ),
        }
      ).catch((err) => {
        console.error('[Maintenance] Failed to send verification notification:', err.message);
      });
    }

    const unitLabel =
      expectedWing && expectedNumber ? `${expectedWing}-${expectedNumber}` : expectedNumber || '';

    const receiptBuffer = await buildMaintenanceReceiptPdf({
      society,
      maintenance: doc,
      unitLabel,
      ownerName: ownerUser ? ownerUser.fullName : '',
      paidByName: uploaderUser ? uploaderUser.fullName : '',
    });

    let receipt = null;
    try {
      receipt = await uploadMaintenanceReceiptPdf({
        societyId: society._id,
        maintenanceId: doc.maintenanceId,
        receiptNumber: doc.receiptNumber,
        buffer: receiptBuffer,
      });
      if (receipt) {
        doc.receiptUrl = receipt;
        await doc.save();
      }
    } catch (e) {
      receipt = null;
    }

    return sendSuccessResponse(res, 200, 'Maintenance verified successfully.', {
      data: {
        maintenanceId: doc.maintenanceId,
        monthLabel: `${doc.month} ${doc.year}`,
        unitNumber: expectedNumber,
        unitCategory: expectedCategory || null,
        ownerName: toTitleCase(ownerUser ? ownerUser.fullName : null) || null,
        amount: formatAmount(doc.amount),
        transactionDate: toISTDateLabel(doc.transactionDate),
        status: doc.status,
        proofImageUrl: doc.proofImageUrl,
        uploadedOn: toISTDateTimeLabel(doc.createdAt),
        uploadedBy: toTitleCase(uploaderUser ? uploaderUser.fullName : null) || null,
        receiptNumber: doc.receiptNumber != null ? String(doc.receiptNumber) : null,
        receiptDate: toISTDateLabel(doc.verifiedAt),
        receipt,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to verify maintenance'));
  }
};

const rejectMaintenance = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    const society = await resolveAdminSociety(req, authUser);

    const maintenanceId = normalizeString((req.body && req.body.maintenanceId) || '');
    if (!maintenanceId) return next(createHttpError('maintenanceId is required.', 400));

    const { unitId, rejectReason, description } = req.body || {};
    const reasonRaw = normalizeString(rejectReason);
    if (!reasonRaw) return next(createHttpError('rejectReason is required.', 400));
    const reasonLower = reasonRaw.toLowerCase();
    const reasonCanonical = reasonLower.replace(/\s+/g, '_');
    if (!MAINTENANCE_REJECT_REASON_CODES.has(reasonCanonical)) {
      return next(createHttpError('Invalid rejectReason.', 400));
    }
    const desc = normalizeString(description);
    if (reasonCanonical === 'others' && !desc) {
      return next(createHttpError('description is required when rejectReason is Others.', 400));
    }

    const doc = await Maintenance.findOne({ maintenanceId });
    if (!doc) return next(createHttpError('Maintenance not found.', 404));

    const prefix = `${String(society._id)}:`;
    if (!String(doc.unitId).startsWith(prefix)) {
      return next(createHttpError('Maintenance does not belong to this society.', 403));
    }
    if (doc.deletedAt) return next(createHttpError('Maintenance not found.', 404));
    if (doc.status && doc.status.toLowerCase() === 'verified') {
      return next(createHttpError('Verified maintenance cannot be rejected.', 409));
    }
    if (doc.status && doc.status.toLowerCase() === 'rejected') {
      return next(createHttpError('Maintenance already rejected.', 409));
    }

    if (!unitId) return next(createHttpError('unitId is required.', 400));
    const parseUnit = (u) => {
      const parts = String(u || '').split(':');
      return { societyId: parts[0] || '', wingLower: parts[1] || '', unitLower: parts[2] || '' };
    };
    const parsed = parseUnit(doc.unitId);
    const unitDocs = await MemberUnit.find({ societyId: parsed.societyId, wingNameLower: parsed.wingLower, unitNumberLower: parsed.unitLower }, { _id: 1, wingName: 1, unitNumber: 1, occupantType: 1, memberId: 1 }).lean();
    const acceptableUnitIds = new Set([String(doc.unitId)]);
    for (const u of unitDocs) acceptableUnitIds.add(String(u._id));
    if (!acceptableUnitIds.has(String(unitId))) {
      return next(createHttpError('unitId does not match record.', 409));
    }

    doc.status = 'Rejected';
    doc.rejectedAt = new Date();
    doc.rejectedByUserId = authUser._id || null;
    doc.rejectionReason = reasonCanonical;
    doc.rejectionDescription = desc || null;
    await doc.save();

    
    if (doc.memberId) {
      const reasonDisplay = reasonRaw.replace(/_/g, ' ');
      sendToUser(
        doc.memberId,
        'Maintenance Rejected',
        `Your maintenance payment for ${doc.month} ${doc.year} was rejected. Reason: ${reasonDisplay}`,
        {
          type: 'maintenance_rejected',
          maintenanceId: doc.maintenanceId,
          month: doc.month,
          year: String(doc.year),
          reason: reasonCanonical,
        },
        {
          localizedContentResolver: ({ languageCode }) =>
            getNotificationMessage(
              'maintenance_rejected',
              { month: doc.month, year: String(doc.year), reason: reasonDisplay },
              languageCode
            ),
        }
      ).catch((err) => {
        console.error('[Maintenance] Failed to send rejection notification:', err.message);
      });
    }

    const uploaderUser = await User.findById(doc.memberId, { fullName: 1 }).lean();
    const primaryUnitDoc = unitDocs.find((u) => u.occupantType === 'unit_owner') || unitDocs.find((u) => u.occupantType === 'tenant') || unitDocs[0] || null;

    return sendSuccessResponse(res, 200, 'Maintenance rejected successfully.', {
      data: {
        maintenanceId: doc.maintenanceId,
        monthLabel: `${doc.month} ${doc.year}`,
        unitWing: primaryUnitDoc ? primaryUnitDoc.wingName : null,
        unitNumber: primaryUnitDoc ? primaryUnitDoc.unitNumber : null,
        unitLabel: primaryUnitDoc ? `${primaryUnitDoc.wingName} ${primaryUnitDoc.unitNumber}` : null,
        unitCategory: primaryUnitDoc ? (primaryUnitDoc.occupantType === 'unit_owner' ? 'Owner' : primaryUnitDoc.occupantType === 'tenant' ? 'Tenant' : '') : null,
        amount: formatAmount(doc.amount),
        transactionDate: toISTDateLabel(doc.transactionDate),
        status: doc.status,
        proofImageUrl: doc.proofImageUrl,
        uploadedOn: toISTDateTimeLabel(doc.createdAt),
        uploadedBy: uploaderUser ? uploaderUser.fullName : null,
        rejectedAt: doc.rejectedAt,
        rejectedByUserId: doc.rejectedByUserId ? String(doc.rejectedByUserId) : null,
        rejectionReason: doc.rejectionReason,
        rejectionDescription: doc.rejectionDescription,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to reject maintenance'));
  }
};

const getMaintenanceRejectReasonCategories = async (req, res, next) => {
  try {
    const authUser = req.appUser;
    await resolveAdminSociety(req, authUser);

    const categories = MAINTENANCE_REJECT_REASON_CATEGORIES.map((name) => ({
      id: name.toLowerCase().replace(/\s+/g, '_'),
      name,
    }));

    return sendSuccessResponse(res, 200, 'Maintenance reject reason categories fetched successfully.', {
      data: categories,
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch maintenance reject reason categories'));
  }
};

module.exports = {
  getMaintenanceYearlySummary,
  listUploadedMaintenanceByMonth,
  getMaintenanceSummaryByMonth,
  verifyMaintenance,
  rejectMaintenance,
  getMaintenanceRejectReasonCategories,
  buildMaintenanceReceiptPdf,
};














