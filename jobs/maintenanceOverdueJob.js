
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


const wasOverdueReminderSentToday = async (societyId, unitId, month, year) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tracking = await MaintenanceReminderTracking.findOne({
    societyId,
    unitId,
    month,
    year,
    reminderType: 'overdue',
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


const updateOverdueTracking = async (societyId, unitId, month, year) => {
  const now = new Date();

  await MaintenanceReminderTracking.findOneAndUpdate(
    {
      societyId,
      unitId,
      month,
      year,
      reminderType: 'overdue',
    },
    {
      $inc: { reminderCount: 1 },
      $push: { remindersSentAt: now },
      $set: { lastReminderSentAt: now },
    },
    { upsert: true, new: true }
  );
};


const runMaintenanceOverdueJob = async () => {
  console.log('[MaintenanceOverdueJob] Starting...');

  const { month, year, day } = getCurrentMonthYear();

  try {
   
    const societies = await Society.find({
      status: 'Active',
    }).select('_id societyName maintenanceDueDate structure societyAdmins').lean();

    console.log(`[MaintenanceOverdueJob] Found ${societies.length} active societies`);

    let totalOverdueNotifications = 0;

    for (const society of societies) {
      const daysAfterDue = day - society.maintenanceDueDate;

      if (daysAfterDue < 1) {
        continue;
      }

      const units = getAllUnits(society.structure);
      console.log(`[MaintenanceOverdueJob] Checking ${units.length} units in ${society.societyName}`);

      for (const unit of units) {
        try {
       
          const isPaid = await hasUnitPaidMaintenance(unit.unitId, month, year);
          if (isPaid) {
            continue;
          }

          const alreadySent = await wasOverdueReminderSentToday(society._id, unit.unitId, month, year);
          if (alreadySent) {
            continue;
          }

         
          const userIds = await getUsersForUnit(society._id, unit.wingName, unit.unitNumber);
          
          
          const adminsForUnit = getSocietyAdminsForUnit(society.societyAdmins, unit.wingName, unit.unitNumber);
          
          if (userIds.length === 0 && adminsForUnit.length === 0) {
            continue;
          }

      
          const title = `Maintenance Overdue - ${society.societyName}`;
          const body = `Maintenance proof upload for ${month} ${year} is overdue. Upload maintenance proof.`;

          
          if (userIds.length > 0) {
            await sendScheduledNotification({
              userIds,
              title,
              body,
              type: 'maintenance_overdue',
              data: {
                month,
                year: String(year),
                daysOverdue: String(daysAfterDue),
                unitId: unit.unitId,
              },
              societyId: society._id,
              societyName: society.societyName,
              localizedContentResolver: ({ languageCode }) =>
                getNotificationMessage(
                  'maintenance_overdue',
                  {
                    societyName: society.societyName,
                    month,
                    year: String(year),
                    daysOverdue: daysAfterDue,
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
              type: 'maintenance_overdue',
              data: {
                month,
                year: String(year),
                daysOverdue: String(daysAfterDue),
                unitId: unit.unitId,
              },
              societyId: society._id,
              societyName: society.societyName,
              localizedContentResolver: ({ languageCode }) =>
                getNotificationMessage(
                  'maintenance_overdue',
                  {
                    societyName: society.societyName,
                    month,
                    year: String(year),
                    daysOverdue: daysAfterDue,
                  },
                  languageCode
                ),
            });
          }

          await updateOverdueTracking(society._id, unit.unitId, month, year);

          totalOverdueNotifications++;
        } catch (error) {
          console.error(`[MaintenanceOverdueJob] Error processing unit ${unit.unitId}:`, error.message);
        }
      }
    }

    console.log(`[MaintenanceOverdueJob] Completed. Sent ${totalOverdueNotifications} overdue notifications.`);
    return { success: true, overdueNotificationsSent: totalOverdueNotifications };
  } catch (error) {
    console.error('[MaintenanceOverdueJob] Failed:', error.message);
    return { success: false, error: error.message };
  }
};

module.exports = { runMaintenanceOverdueJob };
