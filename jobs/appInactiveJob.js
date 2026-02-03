
const Society = require('../model/societySchema');
const { sendScheduledAdminNotification } = require('../utils/pushNotificationService');

const isContractExpired = (endDate) => {
  if (!endDate) return false;
  const now = new Date();
  const end = new Date(endDate);
  return now > end;
};


const getDaysSinceExpiry = (endDate) => {
  const now = new Date();
  const end = new Date(endDate);
  const diffTime = now.getTime() - end.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
};


const shouldSendWeeklyNotification = (lastNotificationAt) => {
  if (!lastNotificationAt) return true;
  
  const now = new Date();
  const lastSent = new Date(lastNotificationAt);
  const diffTime = now.getTime() - lastSent.getTime();
  const diffDays = diffTime / (1000 * 60 * 60 * 24);
  
  return diffDays >= 7;
};

const runAppInactiveJob = async () => {
  console.log('[AppInactiveJob] Starting...');

  try {
    // Get all societies with engagement data (including inactive)
    const societies = await Society.find({
      'engagement.endDate': { $exists: true },
    }).select('_id societyName status engagement societyAdmins lastAppInactiveNotificationAt appInactiveNotificationCount');

    console.log(`[AppInactiveJob] Found ${societies.length} societies to check`);

    let totalNotifications = 0;
    let societiesMarkedInactive = 0;

    for (const society of societies) {
      try {
        if (!society.engagement || !society.engagement.endDate) {
          continue;
        }

        // Check if contract has expired
        if (!isContractExpired(society.engagement.endDate)) {
          continue;
        }

        const daysSinceExpiry = getDaysSinceExpiry(society.engagement.endDate);

        // Mark society as inactive if not already
        if (society.status !== 'Inactive') {
          society.status = 'Inactive';
          societiesMarkedInactive++;
          console.log(`[AppInactiveJob] Marked ${society.societyName} as Inactive`);
        }

        // Check if we should send weekly notification
        if (!shouldSendWeeklyNotification(society.lastAppInactiveNotificationAt)) {
          await society.save();
          continue;
        }

        // Get society admins
        if (!society.societyAdmins || society.societyAdmins.length === 0) {
          await society.save();
          continue;
        }

        // Send notification to each admin
        for (const admin of society.societyAdmins) {
          // Send even to inactive admins for payment notifications

          const title = `App Inactive - ${society.societyName}`;
          const body = `There is a payment overdue from your society and hence the app is inactive. Please renew your contract to restore access.`;

          await sendScheduledAdminNotification({
            societyAdminId: admin._id,
            title,
            body,
            type: 'app_inactive',
            data: {
              daysSinceExpiry: String(daysSinceExpiry),
              expiryDate: society.engagement.endDate.toISOString(),
              status: 'Inactive',
            },
            societyId: society._id,
            societyName: society.societyName,
          });

          totalNotifications++;
        }

        // Update society tracking fields
        society.lastAppInactiveNotificationAt = new Date();
        society.appInactiveNotificationCount = (society.appInactiveNotificationCount || 0) + 1;
        await society.save();

      } catch (error) {
        console.error(`[AppInactiveJob] Error processing society ${society.societyName}:`, error.message);
      }
    }

    console.log(`[AppInactiveJob] Completed. Sent ${totalNotifications} inactive notifications. Marked ${societiesMarkedInactive} societies as inactive.`);
    return { 
      success: true, 
      notificationsSent: totalNotifications,
      societiesMarkedInactive,
    };
  } catch (error) {
    console.error('[AppInactiveJob] Failed:', error.message);
    return { success: false, error: error.message };
  }
};

module.exports = { runAppInactiveJob };
