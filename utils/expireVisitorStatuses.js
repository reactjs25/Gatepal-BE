const GuestEntryRequest = require('../model/guestEntryRequestSchema');
const GuestInvite = require('../model/guestInviteSchema');
const DeliveryPreApproval = require('../model/deliveryPreApprovalSchema');
const TaxiDriverPreApproval = require('../model/taxiDriverPreApprovalSchema');
const OtherVisitorPreApproval = require('../model/otherVisitorPreApprovalSchema');

const expireVisitorStatuses = async ({ now } = {}) => {
  const current = now instanceof Date ? now : new Date(now || Date.now());

  const preApprovalExpiryQuery = {
    status: 'active',
    validTill: { $ne: null, $lte: current },
  };

  await Promise.all([
    GuestEntryRequest.updateMany(
      { status: 'pending', expiresAt: { $ne: null, $lte: current } },
      { $set: { status: 'expired' } }
    ),
    DeliveryPreApproval.updateMany(preApprovalExpiryQuery, { $set: { status: 'expired' } }),
    TaxiDriverPreApproval.updateMany(preApprovalExpiryQuery, { $set: { status: 'expired' } }),
    OtherVisitorPreApproval.updateMany(preApprovalExpiryQuery, { $set: { status: 'expired' } }),
    GuestInvite.updateMany(preApprovalExpiryQuery, { $set: { status: 'expired' } }),
  ]);
};

module.exports = { expireVisitorStatuses };
