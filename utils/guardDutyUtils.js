const GuardDutyLog = require('../model/guardDutyLogSchema');

const AUTO_END_DUTY_HOURS = 16;
const AUTO_END_DUTY_MS = AUTO_END_DUTY_HOURS * 60 * 60 * 1000;

const toDateOrNull = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
};

const autoEndExpiredDutyForGuard = async (user) => {
  if (!user || user.role !== 'guard') {
    return { autoEndedCount: 0 };
  }

  const guardSocieties = Array.isArray(user.guardSocieties) ? user.guardSocieties : [];
  if (!guardSocieties.length) {
    return { autoEndedCount: 0 };
  }

  const nowTs = Date.now();
  const dutyEndLogs = [];
  let hasUpdates = false;

  for (let index = 0; index < guardSocieties.length; index += 1) {
    const guardSociety = guardSocieties[index];
    if (!guardSociety || guardSociety.isOnDuty !== true) {
      continue;
    }

    const startedAt = toDateOrNull(guardSociety.dutyStartedAt);
    const autoEndAt = startedAt
      ? new Date(startedAt.getTime() + AUTO_END_DUTY_MS)
      : new Date(nowTs);

    if (autoEndAt.getTime() > nowTs) {
      continue;
    }

    hasUpdates = true;

    dutyEndLogs.push({
      guardId: user._id,
      guardName: user.fullName || 'Unknown',
      guardPhone: user.phoneNumber || null,
      societyId: guardSociety.societyId,
      societyName: guardSociety.societyName || user.societyName || null,
      gateId: guardSociety.dutyGateId || null,
      gateName: guardSociety.dutyGateName || null,
      logType: 'duty_end',
      logTime: autoEndAt,
      autoEndDuty: true,
    });

    user.guardSocieties[index].isOnDuty = false;
    user.guardSocieties[index].dutyGateId = null;
    user.guardSocieties[index].dutyGateName = null;
    user.guardSocieties[index].dutyStartedAt = null;
  }

  if (!hasUpdates) {
    return { autoEndedCount: 0 };
  }

  await user.save();

  if (dutyEndLogs.length > 0) {
    await GuardDutyLog.insertMany(dutyEndLogs);
  }

  return { autoEndedCount: dutyEndLogs.length };
};

module.exports = {
  AUTO_END_DUTY_HOURS,
  autoEndExpiredDutyForGuard,
};
