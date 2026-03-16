const crypto = require('crypto');

const generateStableMemberCode = (userId) => {
  const hex = crypto.createHash('sha256').update(String(userId)).digest('hex');
  const num = parseInt(hex.slice(0, 8), 16);
  return String((num % 900000) + 100000);
};

const buildMemberQrPayload = ({ user, society }) => ({
  type: 'gatepal_member',
  memberId: generateStableMemberCode(user._id),
  userId: String(user._id),
  role: user.role,
  societyId: society ? String(society._id) : user.societyId ? String(user.societyId) : null,
  societyName: society ? society.societyName : user.societyName || null,
  wingName: user.wingName || null,
  unitNumber: user.unitNumber || null,
});

const buildMemberQrPayloadString = ({ user, society }) =>
  JSON.stringify(buildMemberQrPayload({ user, society }));

module.exports = {
  buildMemberQrPayload,
  buildMemberQrPayloadString,
  generateStableMemberCode,
};