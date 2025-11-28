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

    const unitsFromDb = await MemberUnit.find({ memberId: user._id }).lean();

    const societyIds = new Set(unitsFromDb.map((u) => String(u.societyId)).filter(Boolean));
    const societies = societyIds.size
      ? await Society.find({ _id: { $in: Array.from(societyIds) } }).lean()
      : [];
    const societyMap = societies.reduce((acc, s) => {
      acc[String(s._id)] = s;
      return acc;
    }, {});

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
        units: unitsFromDb.map((u) => {
          const s = societyMap[String(u.societyId)] || null;
          return {
            id: String(u._id),
            wingName: u.wingName,
            unitNumber: u.unitNumber,
            occupantType: u.occupantType,
            occupancyStatus: u.occupancyStatus,
            society: s
              ? {
                  id: String(s._id),
                  name: s.societyName,
                  pin: s.societyPin,
                  address: s.address,
                  city: s.city,
                  country: s.country,
                }
              : null,
            createdAt: u.createdAt,
            updatedAt: u.updatedAt,
          };
        }),
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
