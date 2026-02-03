/**
 * Contract Expiry Job
 * Sends notifications to society admins when contract is expiring within 3 months
 * Runs daily at 9 AM IST
 * Sends weekly reminders to society admin
 */

const Society = require('../model/societySchema');
const { sendScheduledAdminNotification } = require('../utils/pushNotificationService');

/**
 * Calculate months until contract expiry
 */
const getMonthsUntilExpiry = (endDate) => {
  const now = new Date();
  const end = new Date(endDate);
  
  const diffTime = end.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  const diffMonths = Math.ceil(diffDays / 30);
  
  return { diffMonths, diffDays };
};

/**
 * Check if a week has passed since last notification
 */
const shouldSendWeeklyNotification = (lastNotificationAt) => {
  if (!lastNotificationAt) return true;
  
  const now = new Date();
  const lastSent = new Date(lastNotificationAt);
  const diffTime = now.getTime() - lastSent.getTime();
  const diffDays = diffTime / (1000 * 60 * 60 * 24);
  
  return diffDays >= 7;
};

/**
 * Main job function - check for expiring contracts
 */
const runContractExpiryJob = async () => {
  console.log('[ContractExpiryJob] Starting...');

  try {
    // Get all active societies with engagement data
    const societies = await Society.find({
      status: 'Active',
      'engagement.endDate': { $exists: true },
    }).select('_id societyName engagement societyAdmins lastContractExpiryNotificationAt contractExpiryNotificationCount');

    console.log(`[ContractExpiryJob] Found ${societies.length} active societies to check`);

    let totalNotifications = 0;

    for (const society of societies) {
      try {
        if (!society.engagement || !society.engagement.endDate) {
          continue;
        }

        const { diffMonths, diffDays } = getMonthsUntilExpiry(society.engagement.endDate);

        // Only notify if contract expires within 3 months (90 days) and not already expired
        if (diffDays > 90 || diffDays <= 0) {
          continue;
        }

        // Check if we should send weekly notification
        if (!shouldSendWeeklyNotification(society.lastContractExpiryNotificationAt)) {
          continue;
        }

        // Get society admins
        if (!society.societyAdmins || society.societyAdmins.length === 0) {
          continue;
        }

        // Send notification to each admin
        for (const admin of society.societyAdmins) {
          if (admin.status !== 'Active') continue;

          const title = `App Access Expiring Soon - ${society.societyName}`;
          
          let timeText;
          if (diffMonths <= 1) {
            timeText = diffDays === 1 ? '1 day' : `${diffDays} days`;
          } else {
            timeText = `${diffMonths} months`;
          }
          
          const body = `Your GatePal™ app access is expiring in ${timeText}. Renew your contract soon.`;

          const result = await sendScheduledAdminNotification({
            societyAdminId: admin._id,
            title,
            body,
            type: 'contract_expiring',
            data: {
              monthsLeft: String(diffMonths),
              daysLeft: String(diffDays),
              expiryDate: society.engagement.endDate.toISOString(),
            },
            societyId: society._id,
            societyName: society.societyName,
          });

          totalNotifications++;
        }

        // Update society tracking fields
        society.lastContractExpiryNotificationAt = new Date();
        society.contractExpiryNotificationCount = (society.contractExpiryNotificationCount || 0) + 1;
        await society.save();

      } catch (error) {
        console.error(`[ContractExpiryJob] Error processing society ${society.societyName}:`, error.message);
      }
    }

    console.log(`[ContractExpiryJob] Completed. Sent ${totalNotifications} expiry notifications.`);
    return { success: true, notificationsSent: totalNotifications };
  } catch (error) {
    console.error('[ContractExpiryJob] Failed:', error.message);
    return { success: false, error: error.message };
  }
};

module.exports = { runContractExpiryJob };
