






const Society = require('../model/societySchema');
const { sendScheduledAdminNotification } = require('../utils/pushNotificationService');




const getMonthsUntilExpiry = (endDate) => {
  const now = new Date();
  const end = new Date(endDate);
  
  const diffTime = end.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  const diffMonths = Math.ceil(diffDays / 30);
  
  return { diffMonths, diffDays };
};




const shouldSendWeeklyNotification = (lastNotificationAt) => {
  if (!lastNotificationAt) return true;
  
  const now = new Date();
  const lastSent = new Date(lastNotificationAt);
  const diffTime = now.getTime() - lastSent.getTime();
  const diffDays = diffTime / (1000 * 60 * 60 * 24);
  
  return diffDays >= 7;
};




const runContractExpiryJob = async () => {
  console.log('[ContractExpiryJob] Starting...');

  try {
    
    const societies = await Society.find({
      status: 'Active',
      'engagement.endDate': { $exists: true },
    }).select('_id societyName engagement societyAdmins lastContractExpiryNotificationAt contractExpiryNotificationCount status');

    console.log(`[ContractExpiryJob] Found ${societies.length} active societies to check`);

    let totalNotifications = 0;
    let totalExpired = 0;

    for (const society of societies) {
      try {
        if (!society.engagement || !society.engagement.endDate) {
          continue;
        }

        const { diffMonths, diffDays } = getMonthsUntilExpiry(society.engagement.endDate);

        // If engagement has expired, set society to Inactive
        if (diffDays <= 0) {
          society.status = 'Inactive';
          await society.save();
          totalExpired++;
          console.log(`[ContractExpiryJob] Society "${society.societyName}" marked as Inactive (engagement expired)`);
          continue;
        }
        
        if (diffDays > 90) {
          continue;
        }

        
        if (!shouldSendWeeklyNotification(society.lastContractExpiryNotificationAt)) {
          continue;
        }

        
        if (!society.societyAdmins || society.societyAdmins.length === 0) {
          continue;
        }

        
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

        
        society.lastContractExpiryNotificationAt = new Date();
        society.contractExpiryNotificationCount = (society.contractExpiryNotificationCount || 0) + 1;
        await society.save();

      } catch (error) {
        console.error(`[ContractExpiryJob] Error processing society ${society.societyName}:`, error.message);
      }
    }

    console.log(`[ContractExpiryJob] Completed. Sent ${totalNotifications} expiry notifications. Marked ${totalExpired} societies as Inactive.`);
    return { success: true, notificationsSent: totalNotifications, expiredSocieties: totalExpired };
  } catch (error) {
    console.error('[ContractExpiryJob] Failed:', error.message);
    return { success: false, error: error.message };
  }
};

module.exports = { runContractExpiryJob };
