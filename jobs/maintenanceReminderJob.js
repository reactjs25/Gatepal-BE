






const Society = require('../model/societySchema');
const User = require('../model/userSchema');
const Maintenance = require('../model/maintenanceSchema');
const MaintenanceReminderTracking = require('../model/maintenanceReminderTrackingSchema');
const { sendScheduledNotification, sendScheduledAdminNotification } = require('../utils/pushNotificationService');
const { getNotificationMessage } = require('../utils/notificationMessages');

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];




const getCurrentMonthYear = () => {
  const now = new Date();
  return {
    month: MONTH_NAMES[now.getMonth()],
    year: now.getFullYear(),
    day: now.getDate(),
  };
};




const getDaysUntilDue = (dueDate, currentDay) => {
  return dueDate - currentDay;
};




const getAllUnits = (structure) => {
  const units = [];
  if (!structure || !Array.isArray(structure)) return units;

  structure.forEach((wing) => {
    if (wing.units && Array.isArray(wing.units)) {
      wing.units.forEach((unit) => {
        units.push({
          unitId: `${wing.wingName}-${unit.unitNumber}`,
          wingName: wing.wingName,
          unitNumber: unit.unitNumber,
        });
      });
    }
  });

  return units;
};




const hasUnitPaidMaintenance = async (unitId, month, year) => {
  const payment = await Maintenance.findOne({
    unitId,
    month,
    year,
    status: { $in: ['Uploaded', 'Verified'] },
    deletedAt: null,
  }).lean();

  return !!payment;
};




const wasReminderSentToday = async (societyId, unitId, month, year) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tracking = await MaintenanceReminderTracking.findOne({
    societyId,
    unitId,
    month,
    year,
    reminderType: 'reminder',
    lastReminderSentAt: { $gte: today },
  }).lean();

  return !!tracking;
};




const getUsersForUnit = async (societyId, wingName, unitNumber) => {
  const users = await User.find({
    societyId,
    wingName,
    unitNumber,
    status: 'active',
    role: 'member',
    occupantType: { $in: ['unit_owner', 'tenant'] },
  }).select('_id').lean();

  return users.map((u) => u._id);
};




const getSocietyAdminsForUnit = (societyAdmins, wingName, unitNumber) => {
  if (!societyAdmins || !Array.isArray(societyAdmins)) return [];
  
  return societyAdmins.filter(admin => {
    if (admin.status !== 'Active') return false;
    
    const adminUnit = admin.wingName && admin.unitNumber 
      ? `${admin.wingName}-${admin.unitNumber}`
      : null;
    const targetUnit = `${wingName}-${unitNumber}`;
    return adminUnit === targetUnit;
  });
};




const updateReminderTracking = async (societyId, unitId, month, year) => {
  const now = new Date();

  await MaintenanceReminderTracking.findOneAndUpdate(
    {
      societyId,
      unitId,
      month,
      year,
      reminderType: 'reminder',
    },
    {
      $inc: { reminderCount: 1 },
      $push: { remindersSentAt: now },
      $set: { lastReminderSentAt: now },
    },
    { upsert: true, new: true }
  );
};




const runMaintenanceReminderJob = async () => {
  console.log('[MaintenanceReminderJob] Starting...');

  const { month, year, day } = getCurrentMonthYear();

  try {
    
    const societies = await Society.find({
      status: 'Active',
    }).select('_id societyName maintenanceDueDate structure societyAdmins').lean();

    console.log(`[MaintenanceReminderJob] Found ${societies.length} active societies`);

    let totalReminders = 0;

    for (const society of societies) {
      const daysUntilDue = getDaysUntilDue(society.maintenanceDueDate, day);

      
      if (daysUntilDue > 5 || daysUntilDue < 0) {
        continue;
      }

      const units = getAllUnits(society.structure);
      console.log(`[MaintenanceReminderJob] Checking ${units.length} units in ${society.societyName}`);

      for (const unit of units) {
        try {
          
          const isPaid = await hasUnitPaidMaintenance(unit.unitId, month, year);
          if (isPaid) {
            continue;
          }

          
          const alreadySent = await wasReminderSentToday(society._id, unit.unitId, month, year);
          if (alreadySent) {
            continue;
          }

          
          const userIds = await getUsersForUnit(society._id, unit.wingName, unit.unitNumber);
          
          
          const adminsForUnit = getSocietyAdminsForUnit(society.societyAdmins, unit.wingName, unit.unitNumber);
          
          
          if (userIds.length === 0 && adminsForUnit.length === 0) {
            continue;
          }

          
          const title = `Maintenance Due - ${society.societyName}`;
          const body = daysUntilDue === 0
            ? `Today is the last day to pay maintenance for ${month} ${year}. Upload maintenance proof now.`
            : `${daysUntilDue} days left to pay maintenance for ${month} ${year}. Upload maintenance proof on or before ${society.maintenanceDueDate}th.`;

          
          if (userIds.length > 0) {
            await sendScheduledNotification({
              userIds,
              title,
              body,
              type: 'maintenance_reminder',
              data: {
                month,
                year: String(year),
                daysLeft: String(daysUntilDue),
                dueDate: String(society.maintenanceDueDate),
                unitId: unit.unitId,
              },
              societyId: society._id,
              societyName: society.societyName,
              localizedContentResolver: ({ languageCode }) =>
                getNotificationMessage(
                  'maintenance_due',
                  {
                    societyName: society.societyName,
                    month,
                    year: String(year),
                    daysLeft: daysUntilDue,
                    dueDate: String(society.maintenanceDueDate),
                  },
                  languageCode
                ),
            });
          }

          
          for (const admin of adminsForUnit) {
            await sendScheduledAdminNotification({
              societyAdminId: admin._id,
              title,
              body,
              type: 'maintenance_reminder',
              data: {
                month,
                year: String(year),
                daysLeft: String(daysUntilDue),
                dueDate: String(society.maintenanceDueDate),
                unitId: unit.unitId,
              },
              societyId: society._id,
              societyName: society.societyName,
              localizedContentResolver: ({ languageCode }) =>
                getNotificationMessage(
                  'maintenance_due',
                  {
                    societyName: society.societyName,
                    month,
                    year: String(year),
                    daysLeft: daysUntilDue,
                    dueDate: String(society.maintenanceDueDate),
                  },
                  languageCode
                ),
            });
          }

          
          await updateReminderTracking(society._id, unit.unitId, month, year);

          totalReminders++;
        } catch (error) {
          console.error(`[MaintenanceReminderJob] Error processing unit ${unit.unitId}:`, error.message);
        }
      }
    }

    console.log(`[MaintenanceReminderJob] Completed. Sent ${totalReminders} reminders.`);
    return { success: true, remindersSent: totalReminders };
  } catch (error) {
    console.error('[MaintenanceReminderJob] Failed:', error.message);
    return { success: false, error: error.message };
  }
};

module.exports = { runMaintenanceReminderJob };
