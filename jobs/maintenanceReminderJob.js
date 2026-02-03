/**
 * Maintenance Reminder Job
 * Sends reminders to unit members starting 5 days before maintenance due date
 * Runs daily at 9 AM IST
 * Sends until maintenance is paid or due date passes
 */

const Society = require('../model/societySchema');
const User = require('../model/userSchema');
const Maintenance = require('../model/maintenanceSchema');
const MaintenanceReminderTracking = require('../model/maintenanceReminderTrackingSchema');
const { sendScheduledNotification, sendScheduledAdminNotification } = require('../utils/pushNotificationService');

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Get current month and year
 */
const getCurrentMonthYear = () => {
  const now = new Date();
  return {
    month: MONTH_NAMES[now.getMonth()],
    year: now.getFullYear(),
    day: now.getDate(),
  };
};

/**
 * Calculate days until maintenance due date
 */
const getDaysUntilDue = (dueDate, currentDay) => {
  return dueDate - currentDay;
};

/**
 * Get all units from a society structure
 */
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

/**
 * Check if a unit has paid maintenance for a given month/year
 */
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

/**
 * Check if reminder was already sent today
 */
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

/**
 * Get users for a unit
 */
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

/**
 * Get society admins who own the specified unit
 */
const getSocietyAdminsForUnit = (societyAdmins, wingName, unitNumber) => {
  if (!societyAdmins || !Array.isArray(societyAdmins)) return [];
  
  return societyAdmins.filter(admin => {
    if (admin.status !== 'Active') return false;
    // Check if admin's unit matches (format: wingName-unitNumber like "A-A-5" or just "A-5")
    const adminUnit = admin.wingName && admin.unitNumber 
      ? `${admin.wingName}-${admin.unitNumber}`
      : null;
    const targetUnit = `${wingName}-${unitNumber}`;
    return adminUnit === targetUnit;
  });
};

/**
 * Update or create reminder tracking record
 */
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

/**
 * Main job function - run maintenance reminder checks
 */
const runMaintenanceReminderJob = async () => {
  console.log('[MaintenanceReminderJob] Starting...');

  const { month, year, day } = getCurrentMonthYear();

  try {
    // Get all active societies
    const societies = await Society.find({
      status: 'Active',
    }).select('_id societyName maintenanceDueDate structure societyAdmins').lean();

    console.log(`[MaintenanceReminderJob] Found ${societies.length} active societies`);

    let totalReminders = 0;

    for (const society of societies) {
      const daysUntilDue = getDaysUntilDue(society.maintenanceDueDate, day);

      // Only send reminders 5 days before to due date (not after)
      if (daysUntilDue > 5 || daysUntilDue < 0) {
        continue;
      }

      const units = getAllUnits(society.structure);
      console.log(`[MaintenanceReminderJob] Checking ${units.length} units in ${society.societyName}`);

      for (const unit of units) {
        try {
          // Check if already paid
          const isPaid = await hasUnitPaidMaintenance(unit.unitId, month, year);
          if (isPaid) {
            continue;
          }

          // Check if reminder already sent today
          const alreadySent = await wasReminderSentToday(society._id, unit.unitId, month, year);
          if (alreadySent) {
            continue;
          }

          // Get users for this unit
          const userIds = await getUsersForUnit(society._id, unit.wingName, unit.unitNumber);
          
          // Get society admins who own this unit
          const adminsForUnit = getSocietyAdminsForUnit(society.societyAdmins, unit.wingName, unit.unitNumber);
          
          // Skip if no users AND no admins for this unit
          if (userIds.length === 0 && adminsForUnit.length === 0) {
            continue;
          }

          // Send reminder notification
          const title = `Maintenance Due - ${society.societyName}`;
          const body = daysUntilDue === 0
            ? `Today is the last day to pay maintenance for ${month} ${year}. Upload maintenance proof now.`
            : `${daysUntilDue} days left to pay maintenance for ${month} ${year}. Upload maintenance proof on or before ${society.maintenanceDueDate}th.`;

          // Send to regular members
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
            });
          }

          // Send to society admins who own this unit
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
            });
          }

          // Update tracking
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
