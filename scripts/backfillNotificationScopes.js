require('dotenv').config();

const mongoose = require('mongoose');
const Notification = require('../model/notificationSchema');
const GuestEntryRequest = require('../model/guestEntryRequestSchema');

const TARGET_TYPES = [
  'guest_entry_request',
  'guest_entry',
  'guest_exit',
  'guest_entry_approved',
  'guest_entry_rejected',
  'guest_wrong_entry',
];

const buildCanonicalUnitId = (societyId, wingNameLower, unitNumberLower) =>
  `${String(societyId)}:${String(wingNameLower).toLowerCase()}:${String(unitNumberLower).toLowerCase()}`;

const buildUnitPayload = (requestDoc) => ({
  wingName: requestDoc.wingName,
  wingNameLower: requestDoc.wingNameLower,
  unitNumber: requestDoc.unitNumber,
  unitNumberLower: requestDoc.unitNumberLower,
});

const main = async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const notifications = await Notification.find({
    type: { $in: TARGET_TYPES },
    'data.requestId': { $exists: true, $ne: null },
    $or: [
      { societyId: null },
      { societyId: { $exists: false } },
      { canonicalUnitIds: { $exists: false } },
      { canonicalUnitIds: { $size: 0 } },
    ],
  }).lean();

  let updated = 0;

  for (const notification of notifications) {
    const requestDoc = await GuestEntryRequest.findOne(
      { requestId: notification.data.requestId },
      { societyId: 1, wingName: 1, wingNameLower: 1, unitNumber: 1, unitNumberLower: 1 }
    ).lean();

    if (!requestDoc) {
      continue;
    }

    await Notification.updateOne(
      { _id: notification._id },
      {
        $set: {
          societyId: requestDoc.societyId,
          canonicalUnitIds: [
            buildCanonicalUnitId(requestDoc.societyId, requestDoc.wingNameLower, requestDoc.unitNumberLower),
          ],
          data: {
            ...(notification.data || {}),
            societyId: String(requestDoc.societyId),
            unit: buildUnitPayload(requestDoc),
          },
        },
      }
    );

    updated += 1;
  }

  console.log(JSON.stringify({ scanned: notifications.length, updated }, null, 2));
  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error(error);
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  process.exit(1);
});