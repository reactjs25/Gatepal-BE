const { SUPPORTED_LANGUAGE_CODES } = require('./enums/languageEnums');

const LANGUAGE_LOCALES = Object.freeze({
  en: 'en-US',
  hi: 'hi-IN',
  gu: 'gu-IN',
});

const normalizeLanguageCode = (languageCode) => {
  const normalized = (languageCode || 'en').toString().trim().toLowerCase();
  return SUPPORTED_LANGUAGE_CODES.includes(normalized) ? normalized : 'en';
};

const getLanguageLocale = (languageCode) => LANGUAGE_LOCALES[normalizeLanguageCode(languageCode)] || 'en-US';

const getRelativeDayLabel = (languageCode, dayDiff) => {
  const lang = normalizeLanguageCode(languageCode);
  if (lang === 'hi') {
    if (dayDiff === 0) return 'आज';
    if (dayDiff === 1) return 'कल';
    return '';
  }
  if (lang === 'gu') {
    if (dayDiff === 0) return 'આજે';
    if (dayDiff === 1) return 'ગઇકાલે';
    return '';
  }
  if (dayDiff === 0) return 'Today';
  if (dayDiff === 1) return 'Yesterday';
  return '';
};

const getNotificationMessage = (key, params = {}, languageCode = 'en') => {
  const lang = normalizeLanguageCode(languageCode);
  const month = params.month || '';
  const year = params.year || '';
  const reason = params.reason || '';
  const societyName = params.societyName || '';
  const daysLeft = Number(params.daysLeft || 0);
  const daysOverdue = Number(params.daysOverdue || 0);
  const dueDate = params.dueDate || '';
  const meetingDateLabel = params.meetingDateLabel || '';
  const meetingTimeLabel = params.meetingTimeLabel || '';
  const venue = params.venue || '';
  const announcementTitle = params.announcementTitle || '';
  const timeText = params.timeText || '';
  const categoryLabel = params.categoryLabel || '';

  const byLang = {
    en: {
      test_notification: {
        title: 'Test Notification',
        body: 'This is a test push notification from GatePal!',
      },
      maintenance_verified: {
        title: 'Maintenance Verified',
        body: `Your maintenance payment for ${month} ${year} has been verified.`,
      },
      maintenance_rejected: {
        title: 'Maintenance Rejected',
        body: `Your maintenance payment for ${month} ${year} was rejected. Reason: ${reason}`,
      },
      announcement_new: {
        title: 'New Announcement',
        body: announcementTitle,
      },
      meeting_scheduled: {
        title: 'New Meeting Scheduled',
        body: `Meeting on ${meetingDateLabel} at ${meetingTimeLabel}. Venue: ${venue}`,
      },
      maintenance_due: {
        title: `Maintenance Due - ${societyName}`,
        body:
          daysLeft === 0
            ? `Today is the last day to pay maintenance for ${month} ${year}. Upload maintenance proof now.`
            : `${daysLeft} days left to pay maintenance for ${month} ${year}. Upload maintenance proof on or before ${dueDate}th.`,
      },
      maintenance_overdue: {
        title: `Maintenance Overdue - ${societyName}`,
        body: `Maintenance proof upload for ${month} ${year} is overdue by ${daysOverdue} day(s). Upload maintenance proof.`,
      },
      contract_expiring: {
        title: `App Access Expiring Soon - ${societyName}`,
        body: `Your GatePal app access is expiring in ${timeText}. Renew your contract soon.`,
      },
      app_inactive: {
        title: `App Inactive - ${societyName}`,
        body: 'There is a payment overdue from your society and hence the app is inactive. Please renew your contract to restore access.',
      },
      society_rule_new: {
        title: 'New Society Rule',
        body: `New rule added: ${categoryLabel}`,
      },
      society_rule_updated: {
        title: 'Society Rule Updated',
        body: `Rule updated: ${categoryLabel}`,
      },
    },
    hi: {
      test_notification: {
        title: 'टेस्ट नोटिफिकेशन',
        body: 'यह GatePal का टेस्ट पुश नोटिफिकेशन है।',
      },
      maintenance_verified: {
        title: 'मेंटेनेंस सत्यापित',
        body: `${month} ${year} का आपका मेंटेनेंस भुगतान सत्यापित हो गया है।`,
      },
      maintenance_rejected: {
        title: 'मेंटेनेंस अस्वीकृत',
        body: `${month} ${year} का आपका मेंटेनेंस भुगतान अस्वीकृत कर दिया गया है। कारण: ${reason}`,
      },
      announcement_new: {
        title: 'नई घोषणा',
        body: announcementTitle,
      },
      meeting_scheduled: {
        title: 'नई मीटिंग निर्धारित',
        body: `${meetingDateLabel} को ${meetingTimeLabel} बजे मीटिंग है। स्थान: ${venue}`,
      },
      maintenance_due: {
        title: `मेंटेनेंस देय - ${societyName}`,
        body:
          daysLeft === 0
            ? `${month} ${year} के मेंटेनेंस भुगतान का आज अंतिम दिन है। अभी प्रूफ अपलोड करें।`
            : `${month} ${year} के मेंटेनेंस भुगतान के लिए ${daysLeft} दिन शेष हैं। ${dueDate} तारीख तक प्रूफ अपलोड करें।`,
      },
      maintenance_overdue: {
        title: `मेंटेनेंस लंबित - ${societyName}`,
        body: `${month} ${year} का मेंटेनेंस प्रूफ अपलोड ${daysOverdue} दिन से लंबित है। कृपया प्रूफ अपलोड करें।`,
      },
      contract_expiring: {
        title: `ऐप एक्सेस जल्द समाप्त - ${societyName}`,
        body: `आपका GatePal ऐप एक्सेस ${timeText} में समाप्त हो जाएगा। कृपया जल्द नवीनीकरण करें।`,
      },
      app_inactive: {
        title: `ऐप निष्क्रिय - ${societyName}`,
        body: 'आपकी सोसाइटी का भुगतान लंबित होने के कारण ऐप निष्क्रिय है। एक्सेस बहाल करने के लिए कॉन्ट्रैक्ट रिन्यू करें।',
      },
      society_rule_new: {
        title: 'नया सोसाइटी नियम',
        body: `नया नियम जोड़ा गया: ${categoryLabel}`,
      },
      society_rule_updated: {
        title: 'सोसाइटी नियम अपडेट',
        body: `नियम अपडेट किया गया: ${categoryLabel}`,
      },
    },
    gu: {
      test_notification: {
        title: 'ટેસ્ટ નોટિફિકેશન',
        body: 'આ GatePal તરફથી ટેસ્ટ પુશ નોટિફિકેશન છે.',
      },
      maintenance_verified: {
        title: 'મેન્ટેનન્સ ચકાસાયેલ',
        body: `${month} ${year} માટે તમારું મેન્ટેનન્સ પેમેન્ટ ચકાસાયેલ છે.`,
      },
      maintenance_rejected: {
        title: 'મેન્ટેનન્સ નકારવામાં આવ્યું',
        body: `${month} ${year} માટે તમારું મેન્ટેનન્સ પેમેન્ટ નકારવામાં આવ્યું છે. કારણ: ${reason}`,
      },
      announcement_new: {
        title: 'નવી જાહેરાત',
        body: announcementTitle,
      },
      meeting_scheduled: {
        title: 'નવી મીટિંગ નક્કી',
        body: `${meetingDateLabel} ના રોજ ${meetingTimeLabel} વાગ્યે મીટિંગ છે. સ્થળ: ${venue}`,
      },
      maintenance_due: {
        title: `મેન્ટેનન્સ બાકી - ${societyName}`,
        body:
          daysLeft === 0
            ? `${month} ${year} નું મેન્ટેનન્સ ભરવાનો આજે છેલ્લો દિવસ છે. હમણાં પુરાવો અપલોડ કરો.`
            : `${month} ${year} નું મેન્ટેનન્સ ભરવા માટે ${daysLeft} દિવસ બાકી છે. ${dueDate} સુધી પુરાવો અપલોડ કરો.`,
      },
      maintenance_overdue: {
        title: `મેન્ટેનન્સ મોડું - ${societyName}`,
        body: `${month} ${year} માટે મેન્ટેનન્સનો પુરાવો અપલોડ ${daysOverdue} દિવસથી મોડો છે. કૃપા કરીને પુરાવો અપલોડ કરો.`,
      },
      contract_expiring: {
        title: `એપ એક્સેસ ટૂંક સમયમાં સમાપ્ત - ${societyName}`,
        body: `તમારું GatePal એપ એક્સેસ ${timeText} માં સમાપ્ત થશે. કૃપા કરીને કરાર વહેલો રિન્યુ કરો.`,
      },
      app_inactive: {
        title: `એપ નિષ્ક્રિય - ${societyName}`,
        body: 'તમારી સોસાયટીનું પેમેન્ટ બાકી હોવાથી એપ નિષ્ક્રિય છે. એક્સેસ ફરી મેળવવા કરાર રિન્યુ કરો.',
      },
      society_rule_new: {
        title: 'નવો સોસાયટી નિયમ',
        body: `નવો નિયમ ઉમેરાયો: ${categoryLabel}`,
      },
      society_rule_updated: {
        title: 'સોસાયટી નિયમ અપડેટ',
        body: `નિયમ અપડેટ કરાયો: ${categoryLabel}`,
      },
    },
  };

  const message = (byLang[lang] && byLang[lang][key]) || byLang.en[key];
  if (!message) {
    return { title: '', body: '' };
  }
  return message;
};

module.exports = {
  normalizeLanguageCode,
  getLanguageLocale,
  getRelativeDayLabel,
  getNotificationMessage,
};
