const crypto = require('crypto');
const QRCode = require('qrcode');
const Society = require('../../model/societySchema');
const MemberUnit = require('../../model/memberUnitSchema');
const { sendSuccessResponse } = require('../../utils/response');
const { createHttpError, setErrorDefaults } = require('../../utils/httpError');

const generateStableMemberCode = (userId) => {
  const hex = crypto.createHash('sha256').update(String(userId)).digest('hex');
  const num = parseInt(hex.slice(0, 8), 16);
  return String((num % 900000) + 100000);
};

const buildQrPayload = ({ user, society, memberCode }) => {
  const payload = {
    t: 'gatepal_member',
    mc: memberCode,
    uid: String(user._id),
    role: user.role,
    sid: society ? String(society._id) : null,
    sn: society ? society.societyName : user.societyName,
    wi: user.wingName || null,
    un: user.unitNumber || null,
  };
  return JSON.stringify(payload);
};

const getMemberProfile = async (req, res, next) => {
  try {
    const user = req.appUser;
    if (!user) {
      return next(createHttpError('Unauthorized', 401));
    }

    const society = user.societyId ? await Society.findById(user.societyId).lean() : null;

    const units = await MemberUnit.find({ memberId: user._id }).lean();

    const memberCode = generateStableMemberCode(user._id);

    let qrCodeImage = user.qrCodeImage || null;
    if (!qrCodeImage) {
      const payload = buildQrPayload({ user, society, memberCode });
      try {
        qrCodeImage = await QRCode.toDataURL(payload, {
          errorCorrectionLevel: 'M',
          margin: 1,
          width: 256,
        });
        user.qrCodeImage = qrCodeImage;
        user.qrCodeGeneratedAt = new Date();
        await user.save();
      } catch (e) {
        qrCodeImage = null;
      }
    }

    const effectiveRole = req.user?.effectiveRole || user.role;

    return sendSuccessResponse(res, 200, 'Member profile fetched successfully', {
      data: {
        id: String(user._id),
        memberId: memberCode,
        name: user.fullName || null,
        role: effectiveRole,
        occupantType: user.occupantType || null,
        occupancyStatus: user.occupancyStatus || null,
        wingName: user.wingName || null,
        unitNumber: user.unitNumber || null,
        societyName: society ? society.societyName : user.societyName || null,
        society: society
          ? {
              id: String(society._id),
              name: society.societyName,
              pin: society.societyPin,
              address: society.address,
              city: society.city,
              country: society.country,
            }
          : null,
        units: units.map((u) => ({
          id: String(u._id),
          societyId: String(u.societyId),
          wingName: u.wingName,
          unitNumber: u.unitNumber,
          occupantType: u.occupantType,
          occupancyStatus: u.occupancyStatus,
          createdAt: u.createdAt,
          updatedAt: u.updatedAt,
        })),
        qrCodeImage,
      },
    });
  } catch (error) {
    return next(setErrorDefaults(error, 'Failed to fetch member profile'));
  }
};

module.exports = {
  getMemberProfile,
};
