const { normalizeSupportedLanguageCode } = require('./enums/languageEnums');

const ENTITY_TRANSLATIONS = Object.freeze({
  hi: Object.freeze({
    'visitor profile': 'विज़िटर प्रोफ़ाइल',
    'delivery companies': 'डिलीवरी कंपनियां',
    'work categories': 'कार्य श्रेणियां',
    'taxi driver companies': 'टैक्सी ड्राइवर कंपनियां',
    'other visitor companies': 'अन्य विज़िटर कंपनियां',
    'delivery company': 'डिलीवरी कंपनी',
    'taxi driver company': 'टैक्सी ड्राइवर कंपनी',
    'other visitor company': 'अन्य विज़िटर कंपनी',
    'otp': 'ओटीपी',
    'onboarding': 'ऑनबोर्डिंग',
    'society': 'सोसाइटी',
    'societies': 'सोसाइटियां',
    'fcm token': 'एफसीएम टोकन',
    'preferences': 'प्राथमिकताएं',
    'taxi/cab pre-approval': 'टैक्सी/कैब प्री-अप्रूवल',
    'delivery pre-approval': 'डिलीवरी प्री-अप्रूवल',
    'visitor pre-approval': 'विज़िटर प्री-अप्रूवल',
    'super admin': 'सुपर एडमिन',
    'country and city options': 'देश और शहर विकल्प',
    'country flags': 'देश के झंडे',
    'registration hierarchy': 'रजिस्ट्रेशन हाइरार्की',
    'group guest invite': 'ग्रुप गेस्ट इनवाइट',
    'frequent guest invite': 'फ्रीक्वेंट गेस्ट इनवाइट',
    'guest quick invite': 'गेस्ट क्विक इनवाइट',
    'guest invite': 'गेस्ट इनवाइट',
    'visitor qr code': 'विज़िटर क्यूआर कोड',
    'member qr code': 'सदस्य क्यूआर कोड',
    'recent guests': 'हाल के मेहमान',
    'entry details': 'प्रवेश विवरण',
    'guest entry requests': 'गेस्ट एंट्री अनुरोध',
    'guest entry request': 'गेस्ट एंट्री अनुरोध',
    'entry requests': 'एंट्री अनुरोध',
    'visitor log': 'विज़िटर लॉग',
    'action reasons': 'एक्शन कारण',
    'feedback': 'फीडबैक',
    'guard profile': 'गार्ड प्रोफ़ाइल',
    'society daily help': 'सोसाइटी डेली हेल्प',
    'test notification': 'टेस्ट नोटिफिकेशन',
    'notifications': 'नोटिफिकेशन',
    'unread count': 'अपठित संख्या',
    'notification': 'नोटिफिकेशन',
    'notification preferences': 'नोटिफिकेशन प्राथमिकताएं',
    'vehicle details': 'वाहन विवरण',
    'vehicles': 'वाहन',
    'vehicle': 'वाहन',
    'announcement details': 'घोषणा विवरण',
    'announcements': 'घोषणाएं',
    'announcement': 'घोषणा',
    'unit': 'यूनिट',
    'unit details': 'यूनिट विवरण',
    'unit dashboard': 'यूनिट डैशबोर्ड',
    'occupancy status': 'ओक्यूपेंसी स्टेटस',
    'guard logs': 'गार्ड लॉग्स',
    'member profile': 'सदस्य प्रोफ़ाइल',
    'daily help categories': 'डेली हेल्प श्रेणियां',
    'daily help reject reason categories': 'डेली हेल्प अस्वीकृति कारण श्रेणियां',
    'pet details': 'पेट विवरण',
    'pets': 'पेट',
    'pet': 'पेट',
    'maintenance report': 'मेंटेनेंस रिपोर्ट',
    'maintenance proof': 'मेंटेनेंस प्रूफ',
    'maintenance': 'मेंटेनेंस',
    'maintenance yearly summary': 'मेंटेनेंस वार्षिक सारांश',
    'maintenance summary': 'मेंटेनेंस सारांश',
    'maintenance uploads': 'मेंटेनेंस अपलोड',
    'maintenance reject reason categories': 'मेंटेनेंस अस्वीकृति कारण श्रेणियां',
    'family member details': 'परिवार सदस्य विवरण',
    'family members': 'परिवार सदस्य',
    'family member': 'परिवार सदस्य',
    'guards log report': 'गार्ड्स लॉग रिपोर्ट',
    'visitor log report': 'विज़िटर लॉग रिपोर्ट',
    'daily help': 'डेली हेल्प',
    'daily help details': 'डेली हेल्प विवरण',
    'daily help profile': 'डेली हेल्प प्रोफ़ाइल',
    'vehicle report': 'वाहन रिपोर्ट',
    'society info': 'सोसाइटी जानकारी',
    'society units': 'सोसाइटी यूनिट्स',
    'society residents': 'सोसाइटी निवासी',
    'resident unit': 'निवासी यूनिट',
    'society vehicles': 'सोसाइटी वाहन',
    'society pets': 'सोसाइटी पेट',
    'society activity summary': 'सोसाइटी गतिविधि सारांश',
    'pet report': 'पेट रिपोर्ट',
    'unit list report': 'यूनिट सूची रिपोर्ट',
    'resident report': 'रेज़िडेंट रिपोर्ट',
    'guest approval request': 'गेस्ट अप्रूवल अनुरोध',
    'guest approval requests': 'गेस्ट अप्रूवल अनुरोध',
    'guest photo': 'गेस्ट फोटो',
    'visitor': 'विज़िटर',
    'visitor entry request': 'विज़िटर एंट्री अनुरोध',
    'visitor entry requests': 'विज़िटर एंट्री अनुरोध',
    'duty': 'ड्यूटी',
    'diagnostic error': 'डायग्नोस्टिक त्रुटि',
    'diagnostic alert email': 'डायग्नोस्टिक अलर्ट ईमेल',
    'society admin': 'सोसाइटी एडमिन',
    'society admins': 'सोसाइटी एडमिन्स',
    'meeting': 'मीटिंग',
    'meetings': 'मीटिंग्स',
    'meeting discussions': 'मीटिंग चर्चा',
    'society rule': 'सोसाइटी नियम',
    'society rules': 'सोसाइटी नियम',
    'society rule categories': 'सोसाइटी नियम श्रेणियां',
    'delivery companies.': 'डिलीवरी कंपनियां',
    'work categories.': 'कार्य श्रेणियां',
    'taxi driver companies.': 'टैक्सी ड्राइवर कंपनियां',
    'other visitor companies.': 'अन्य विज़िटर कंपनियां',
    'delivery company.': 'डिलीवरी कंपनी',
    'taxi driver company.': 'टैक्सी ड्राइवर कंपनी',
    'other visitor company.': 'अन्य विज़िटर कंपनी'
  }),
  gu: Object.freeze({
    'visitor profile': 'વિઝિટર પ્રોફાઇલ',
    'delivery companies': 'ડિલિવરી કંપનીઓ',
    'work categories': 'કાર્ય શ્રેણીઓ',
    'taxi driver companies': 'ટેક્સી ડ્રાઇવર કંપનીઓ',
    'other visitor companies': 'અન્ય વિઝિટર કંપનીઓ',
    'delivery company': 'ડિલિવરી કંપની',
    'taxi driver company': 'ટેક્સી ડ્રાઇવર કંપની',
    'other visitor company': 'અન્ય વિઝિટર કંપની',
    'otp': 'ઓટીપી',
    'onboarding': 'ઓનબોર્ડિંગ',
    'society': 'સોસાયટી',
    'societies': 'સોસાયટીઓ',
    'fcm token': 'એફસીએમ ટોકન',
    'preferences': 'પસંદગીઓ',
    'taxi/cab pre-approval': 'ટેક્સી/કેબ પ્રી-અપ્રુવલ',
    'delivery pre-approval': 'ડિલિવરી પ્રી-અપ્રુવલ',
    'visitor pre-approval': 'વિઝિટર પ્રી-અપ્રુવલ',
    'super admin': 'સુપર એડમિન',
    'country and city options': 'દેશ અને શહેર વિકલ્પો',
    'country flags': 'દેશના ધ્વજો',
    'registration hierarchy': 'રજિસ્ટ્રેશન હાયરાર્કી',
    'group guest invite': 'ગ્રુપ ગેસ્ટ ઇન્વાઇટ',
    'frequent guest invite': 'ફ્રીક્વન્ટ ગેસ્ટ ઇન્વાઇટ',
    'guest quick invite': 'ગેસ્ટ ક્વિક ઇન્વાઇટ',
    'guest invite': 'ગેસ્ટ ઇન્વાઇટ',
    'visitor qr code': 'વિઝિટર ક્યુઆર કોડ',
    'member qr code': 'સભ્ય ક્યુઆર કોડ',
    'recent guests': 'તાજેતરના મહેમાનો',
    'entry details': 'પ્રવેશ વિગતો',
    'guest entry requests': 'ગેસ્ટ એન્ટ્રી વિનંતીઓ',
    'guest entry request': 'ગેસ્ટ એન્ટ્રી વિનંતી',
    'entry requests': 'એન્ટ્રી વિનંતીઓ',
    'visitor log': 'વિઝિટર લોગ',
    'action reasons': 'ક્રિયા કારણો',
    'feedback': 'પ્રતિસાદ',
    'guard profile': 'ગાર્ડ પ્રોફાઇલ',
    'society daily help': 'સોસાયટી ડેઇલી હેલ્પ',
    'test notification': 'ટેસ્ટ નોટિફિકેશન',
    'notifications': 'નોટિફિકેશન્સ',
    'unread count': 'અવાંચિત ગણતરી',
    'notification': 'નોટિફિકેશન',
    'notification preferences': 'નોટિફિકેશન પસંદગીઓ',
    'vehicle details': 'વાહન વિગતો',
    'vehicles': 'વાહનો',
    'vehicle': 'વાહન',
    'announcement details': 'જાહેરાત વિગતો',
    'announcements': 'જાહેરાતો',
    'announcement': 'જાહેરાત',
    'unit': 'યુનિટ',
    'unit details': 'યુનિટ વિગતો',
    'unit dashboard': 'યુનિટ ડેશબોર્ડ',
    'occupancy status': 'ઓક્યુપન્સી સ્થિતિ',
    'guard logs': 'ગાર્ડ લોગ્સ',
    'member profile': 'સભ્ય પ્રોફાઇલ',
    'daily help categories': 'ડેઇલી હેલ્પ શ્રેણીઓ',
    'daily help reject reason categories': 'ડેઇલી હેલ્પ નકારવાના કારણોની શ્રેણીઓ',
    'pet details': 'પેટ વિગતો',
    'pets': 'પેટ્સ',
    'pet': 'પેટ',
    'maintenance report': 'મેન્ટેનન્સ રિપોર્ટ',
    'maintenance proof': 'મેન્ટેનન્સ પુરાવો',
    'maintenance': 'મેન્ટેનન્સ',
    'maintenance yearly summary': 'મેન્ટેનન્સ વાર્ષિક સારાંશ',
    'maintenance summary': 'મેન્ટેનન્સ સારાંશ',
    'maintenance uploads': 'મેન્ટેનન્સ અપલોડ્સ',
    'maintenance reject reason categories': 'મેન્ટેનન્સ નકારવાના કારણોની શ્રેણીઓ',
    'family member details': 'કુટુંબ સભ્યની વિગતો',
    'family members': 'કુટુંબ સભ્યો',
    'family member': 'કુટુંબ સભ્ય',
    'guards log report': 'ગાર્ડ લોગ રિપોર્ટ',
    'visitor log report': 'વિઝિટર લોગ રિપોર્ટ',
    'daily help': 'ડેઇલી હેલ્પ',
    'daily help details': 'ડેઇલી હેલ્પ વિગતો',
    'daily help profile': 'ડેઇલી હેલ્પ પ્રોફાઇલ',
    'vehicle report': 'વાહન રિપોર્ટ',
    'society info': 'સોસાયટી માહિતી',
    'society units': 'સોસાયટી યુનિટ્સ',
    'society residents': 'સોસાયટી રહેવાસીઓ',
    'resident unit': 'રહેવાસી યુનિટ',
    'society vehicles': 'સોસાયટી વાહનો',
    'society pets': 'સોસાયટી પેટ્સ',
    'society activity summary': 'સોસાયટી પ્રવૃત્તિ સારાંશ',
    'pet report': 'પેટ રિપોર્ટ',
    'unit list report': 'યુનિટ યાદી રિપોર્ટ',
    'resident report': 'રહેવાસી રિપોર્ટ',
    'guest approval request': 'ગેસ્ટ અપ્રુવલ વિનંતી',
    'guest approval requests': 'ગેસ્ટ અપ્રુવલ વિનંતીઓ',
    'guest photo': 'ગેસ્ટ ફોટો',
    'visitor': 'વિઝિટર',
    'visitor entry request': 'વિઝિટર એન્ટ્રી વિનંતી',
    'visitor entry requests': 'વિઝિટર એન્ટ્રી વિનંતીઓ',
    'duty': 'ડ્યૂટી',
    'diagnostic error': 'ડાયગ્નોસ્ટિક ભૂલ',
    'diagnostic alert email': 'ડાયગ્નોસ્ટિક એલર્ટ ઇમેઇલ',
    'society admin': 'સોસાયટી એડમિન',
    'society admins': 'સોસાયટી એડમિન્સ',
    'meeting': 'મીટિંગ',
    'meetings': 'મીટિંગ્સ',
    'meeting discussions': 'મીટિંગ ચર્ચાઓ',
    'society rule': 'સોસાયટી નિયમ',
    'society rules': 'સોસાયટી નિયમો',
    'society rule categories': 'સોસાયટી નિયમ શ્રેણીઓ'
  }),
});

const EXACT_TRANSLATIONS = Object.freeze({
  hi: Object.freeze({
    OK: 'ठीक है।',
    'Gatepal API is up and running': 'Gatepal API चालू है और सही काम कर रही है।',
    'Login successful.': 'लॉगिन सफल रहा।',
    'Society switched successfully.': 'सोसाइटी सफलतापूर्वक बदली गई।',
    'OTP sent successfully.': 'ओटीपी सफलतापूर्वक भेजा गया।',
    'OTP verified successfully.': 'ओटीपी सफलतापूर्वक सत्यापित किया गया।',
    'Password reset successful.': 'पासवर्ड सफलतापूर्वक रीसेट किया गया।',
    'FCM token registered successfully.': 'एफसीएम टोकन सफलतापूर्वक रजिस्टर किया गया।',
    'FCM token removed successfully.': 'एफसीएम टोकन सफलतापूर्वक हटाया गया।',
    'Preferences fetched successfully.': 'प्राथमिकताएं सफलतापूर्वक प्राप्त की गईं।',
    'Preferences updated successfully.': 'प्राथमिकताएं सफलतापूर्वक अपडेट की गईं।',
    'Entry request cancelled successfully.': 'एंट्री अनुरोध सफलतापूर्वक रद्द किया गया।',
    'Your request has been recorded. We will notify you once this location is available.': 'आपका अनुरोध दर्ज कर लिया गया है। यह लोकेशन उपलब्ध होते ही हम आपको सूचित करेंगे।',
    'Photo required before creating request.': 'अनुरोध बनाने से पहले फोटो आवश्यक है।',
    'Entry already allowed.': 'प्रवेश पहले ही अनुमति दी जा चुकी है।',
    'Entry allowed successfully.': 'प्रवेश की अनुमति सफलतापूर्वक दी गई।',
    'Entry allowed without member approval.': 'सदस्य की मंजूरी के बिना प्रवेश की अनुमति दी गई।',
    'Exit already allowed.': 'निकास की अनुमति पहले ही दी जा चुकी है।',
    'Exit allowed successfully.': 'निकास की अनुमति सफलतापूर्वक दी गई।',
    'Visitor has already left.': 'विज़िटर पहले ही जा चुका है।',
    'This visitor is already marked as wrong entry.': 'इस विज़िटर को पहले ही गलत एंट्री के रूप में चिह्नित किया जा चुका है।',
    'Visitor marked as left successfully.': 'विज़िटर को सफलतापूर्वक बाहर गया चिह्नित किया गया।',
    'Visitor marked as wrong entry successfully.': 'विज़िटर को सफलतापूर्वक गलत एंट्री के रूप में चिह्नित किया गया।',
    'Feedback fetched.': 'फीडबैक प्राप्त किया गया।',
    'Feedback updated.': 'फीडबैक अपडेट किया गया।',
    'Thank you for your feedback.': 'आपके फीडबैक के लिए धन्यवाद।',
    'No changes provided.': 'कोई बदलाव प्रदान नहीं किया गया।',
    'Test notification sent.': 'टेस्ट नोटिफिकेशन भेज दिया गया।',
    'Notification marked as read.': 'नोटिफिकेशन को पढ़ा हुआ चिह्नित किया गया।',
    'Notifications marked as read.': 'नोटिफिकेशन्स को पढ़ा हुआ चिह्नित किया गया।',
    'All notifications marked as read.': 'सभी नोटिफिकेशन्स को पढ़ा हुआ चिह्नित किया गया।',
    'Read notifications cleared.': 'पढ़े गए नोटिफिकेशन्स साफ कर दिए गए।',
    'Duty started successfully': 'ड्यूटी सफलतापूर्वक शुरू हुई।',
    'Duty ended successfully': 'ड्यूटी सफलतापूर्वक समाप्त हुई।',
    'Daily help approved successfully.': 'डेली हेल्प सफलतापूर्वक स्वीकृत की गई।',
    'Daily help rejected successfully.': 'डेली हेल्प सफलतापूर्वक अस्वीकृत की गई।',
    'Daily help already added for unit.': 'इस यूनिट के लिए डेली हेल्प पहले से जोड़ी गई है।',
    'Daily help already removed.': 'डेली हेल्प पहले ही हटाई जा चुकी है।',
    'Daily help already removed from society.': 'डेली हेल्प पहले ही सोसाइटी से हटाई जा चुकी है।',
    'Maintenance verified successfully.': 'मेंटेनेंस सफलतापूर्वक सत्यापित किया गया।',
    'Maintenance rejected successfully.': 'मेंटेनेंस सफलतापूर्वक अस्वीकृत किया गया।',
    'Society suspended successfully.': 'सोसाइटी सफलतापूर्वक निलंबित की गई।',
    'Registration initiated. Please verify the OTP to continue onboarding.': 'रजिस्ट्रेशन शुरू कर दिया गया है। ऑनबोर्डिंग जारी रखने के लिए कृपया ओटीपी सत्यापित करें।',
    'OTP verified successfully. Continue onboarding.': 'ओटीपी सफलतापूर्वक सत्यापित किया गया। ऑनबोर्डिंग जारी रखें।',
    'Onboarding completed successfully.': 'ऑनबोर्डिंग सफलतापूर्वक पूरी हुई।',
    'If the email exists, a password reset link has been sent.': 'यदि ईमेल मौजूद है, तो पासवर्ड रीसेट लिंक भेज दिया गया है।',
    'Unauthorized.': 'अनधिकृत अनुरोध।',
    'Authorization token missing or invalid': 'ऑथराइजेशन टोकन अनुपलब्ध है या अमान्य है।',
    'Invalid or expired token': 'टोकन अमान्य है या उसकी अवधि समाप्त हो चुकी है।',
    'Unauthorized: invalid society admin context': 'अनधिकृत: सोसाइटी एडमिन संदर्भ अमान्य है।',
    'Unauthorized: user not found': 'अनधिकृत: उपयोगकर्ता नहीं मिला।',
    'Access denied': 'एक्सेस अस्वीकृत है।',
    'Account not found for the provided details.': 'दिए गए विवरणों के लिए खाता नहीं मिला।',
    'Invalid credentials.': 'अमान्य क्रेडेंशियल्स।',
    'No society admin mapping found for this user.': 'इस उपयोगकर्ता के लिए कोई सोसाइटी एडमिन मैपिंग नहीं मिली।',
    'Phone number, password, and confirm password are required.': 'फोन नंबर, पासवर्ड और कन्फर्म पासवर्ड आवश्यक हैं।',
    'Password and confirm password do not match.': 'पासवर्ड और कन्फर्म पासवर्ड मेल नहीं खाते।',
    'You must accept the terms to continue.': 'आगे बढ़ने के लिए आपको शर्तें स्वीकार करनी होंगी।',
    'Phone number is required.': 'फोन नंबर आवश्यक है।',
    'Phone number must contain between 10 and 12 digits.': 'फोन नंबर 10 से 12 अंकों का होना चाहिए।',
    'Admin mobile must contain between 10 and 12 digits.': 'एडमिन मोबाइल 10 से 12 अंकों का होना चाहिए।',
    'A user already exists with this phone number.': 'इस फोन नंबर के साथ उपयोगकर्ता पहले से मौजूद है।',
    'User ID and OTP are required.': 'यूज़र आईडी और ओटीपी आवश्यक हैं।',
    'OTP verification is not required for this account.': 'इस खाते के लिए ओटीपी सत्यापन आवश्यक नहीं है।',
    'Role and mobile number are required.': 'रोल और मोबाइल नंबर आवश्यक हैं।',
    'Role, mobile number, and OTP are required.': 'रोल, मोबाइल नंबर और ओटीपी आवश्यक हैं।',
    'Role, mobile number, password, and reset token are required.': 'रोल, मोबाइल नंबर, पासवर्ड और रीसेट टोकन आवश्यक हैं।',
    'Role, phone number, and password are required.': 'रोल, फोन नंबर और पासवर्ड आवश्यक हैं।',
    'A valid societyId is required.': 'मान्य societyId आवश्यक है।',
    'All fields are required.': 'सभी फ़ील्ड आवश्यक हैं।',
    'Email and password are required.': 'ईमेल और पासवर्ड आवश्यक हैं।',
    'Email is required.': 'ईमेल आवश्यक है।',
    'Token, email, and password are required.': 'टोकन, ईमेल और पासवर्ड आवश्यक हैं।',
    'fcmToken is required.': 'fcmToken आवश्यक है।',
    'deviceType must be android, ios, or web.': 'deviceType android, ios या web होना चाहिए।',
    'preferredLanguage is required.': 'preferredLanguage आवश्यक है।',
    'Invalid or expired reset token.': 'रीसेट टोकन अमान्य है या उसकी अवधि समाप्त हो गई है।',
    'Unsupported preferredLanguage value.': 'preferredLanguage का मान समर्थित नहीं है।',
    'Invalid filter. Allowed values: today, this_month, past_3_months.': 'अमान्य फ़िल्टर। मान्य मान हैं: today, this_month, past_3_months।',
    'Invalid month. Use full month name like September.': 'अमान्य महीना। September जैसा पूरा महीने का नाम उपयोग करें।',
    'year must be a 4-digit number.': 'year 4 अंकों की संख्या होनी चाहिए।',
    'status is required. Allowed values: uploaded, verified, rejected.': 'status आवश्यक है। मान्य मान हैं: uploaded, verified, rejected।',
    'Invalid status. Allowed values: uploaded, verified, rejected.': 'अमान्य status। मान्य मान हैं: uploaded, verified, rejected।',
    'Invalid location type. Expected country, city, or society.': 'अमान्य लोकेशन प्रकार। country, city या society अपेक्षित है।',
    'Name is required for the missing location.': 'गुम लोकेशन के लिए नाम आवश्यक है।',
    'validityHours must be a positive number.': 'validityHours एक धनात्मक संख्या होनी चाहिए।',
    'validityHours cannot exceed 24 hours.': 'validityHours 24 घंटे से अधिक नहीं हो सकता।',
    'validTill must be after validFrom.': 'validTill, validFrom के बाद होना चाहिए।',
    'selectedDate is required when dateOption is selectDate.': 'जब dateOption selectDate हो, तब selectedDate आवश्यक है।',
    'Unsupported onboarding flow.': 'ऑनबोर्डिंग फ्लो समर्थित नहीं है।',
    'Only image or PDF files are allowed in multipart uploads.': 'मल्टीपार्ट अपलोड में केवल इमेज या PDF फाइलें अनुमत हैं।',
    'File size must be 10MB or less.': 'फाइल आकार 10MB या उससे कम होना चाहिए।',
    'Too many files uploaded in a single request.': 'एक ही अनुरोध में बहुत अधिक फाइलें अपलोड की गईं।',
    'Message is required to trigger an alert email.': 'अलर्ट ईमेल ट्रिगर करने के लिए संदेश आवश्यक है।',
    'Role is required': 'रोल आवश्यक है।',
    'Unsupported role provided': 'दिया गया रोल समर्थित नहीं है।',
    'unitId path parameter is required': 'unitId पाथ पैरामीटर आवश्यक है।',
    'Invalid unit ID format': 'यूनिट आईडी का प्रारूप अमान्य है।',
    'fullName cannot be empty.': 'fullName खाली नहीं हो सकता।',
    'Please enter a valid phone number.': 'कृपया मान्य फोन नंबर दर्ज करें।',
    'companyName must be between 2 and 80 characters.': 'companyName 2 से 80 अक्षरों के बीच होना चाहिए।',
    'subCategory must be between 3 and 60 characters.': 'subCategory 3 से 60 अक्षरों के बीच होना चाहिए।',
    'This phone number already exists in the system.': 'यह फोन नंबर पहले से सिस्टम में मौजूद है।',
    'Company already exists.': 'कंपनी पहले से मौजूद है।',
    'Onboarding is already completed for this account. Use add unit flow for this user.': 'इस खाते के लिए ऑनबोर्डिंग पहले ही पूरी हो चुकी है। इस उपयोगकर्ता के लिए add unit फ्लो का उपयोग करें।',
    'Onboarding already completed for this account.': 'इस खाते के लिए ऑनबोर्डिंग पहले ही पूरी हो चुकी है।',
    'Pre-approval not found.': 'प्री-अप्रूवल नहीं मिला।',
    'Only active pre-approvals can be updated.': 'केवल सक्रिय प्री-अप्रूवल ही अपडेट किए जा सकते हैं।',
    'Cannot cancel while visitor is inside society.': 'जब विज़िटर सोसाइटी के अंदर हो तब रद्द नहीं किया जा सकता।',
    'Entry request cannot be cancelled in current status.': 'वर्तमान स्थिति में एंट्री अनुरोध रद्द नहीं किया जा सकता।',
    'Pre-approval is already cancelled.': 'प्री-अप्रूवल पहले ही रद्द किया जा चुका है।',
    'Cannot cancel pre-approval while visitor is inside society.': 'जब विज़िटर सोसाइटी के अंदर हो तब प्री-अप्रूवल रद्द नहीं किया जा सकता।',
    'Society is already suspended.': 'सोसाइटी पहले ही निलंबित है।',
    'Route not found': 'रूट नहीं मिला।',
    'Unit not found': 'यूनिट नहीं मिला।',
    'Society not found.': 'सोसाइटी नहीं मिली।',
    'User not found.': 'उपयोगकर्ता नहीं मिला।',
    'No account found with this email address.': 'इस ईमेल पते के साथ कोई खाता नहीं मिला।',
    'Daily help profile not found.': 'डेली हेल्प प्रोफ़ाइल नहीं मिली।',
    'Unable to generate a unique Society PIN. Please try again later.': 'एक अद्वितीय सोसाइटी पिन जनरेट नहीं किया जा सका। कृपया बाद में पुनः प्रयास करें।',
    'Failed to upload multipart file.': 'मल्टीपार्ट फाइल अपलोड करने में विफल।',
    'societyId is required for report generation.': 'रिपोर्ट जनरेशन के लिए societyId आवश्यक है।',
    'OTP you have entered is incorrect.': 'आपके द्वारा दर्ज किया गया ओटीपी गलत है।'
  }),
  gu: Object.freeze({
    OK: 'બરાબર.',
    'Gatepal API is up and running': 'Gatepal API ચાલુ છે અને યોગ્ય રીતે કાર્ય કરી રહી છે.',
    'Login successful.': 'લૉગિન સફળ થયું.',
    'Society switched successfully.': 'સોસાયટી સફળતાપૂર્વક બદલાઈ ગઈ.',
    'OTP sent successfully.': 'ઓટીપી સફળતાપૂર્વક મોકલાયો.',
    'OTP verified successfully.': 'ઓટીપી સફળતાપૂર્વક ચકાસાયો.',
    'Password reset successful.': 'પાસવર્ડ સફળતાપૂર્વક રીસેટ થયો.',
    'FCM token registered successfully.': 'એફસીએમ ટોકન સફળતાપૂર્વક નોંધાયું.',
    'FCM token removed successfully.': 'એફસીએમ ટોકન સફળતાપૂર્વક દૂર કરવામાં આવ્યું.',
    'Preferences fetched successfully.': 'પસંદગીઓ સફળતાપૂર્વક મેળવાઈ.',
    'Preferences updated successfully.': 'પસંદગીઓ સફળતાપૂર્વક અપડેટ થઈ.',
    'Entry request cancelled successfully.': 'એન્ટ્રી વિનંતી સફળતાપૂર્વક રદ થઈ.',
    'Your request has been recorded. We will notify you once this location is available.': 'તમારી વિનંતી નોંધાઈ ગઈ છે. આ સ્થાન ઉપલબ્ધ થતાં જ અમે તમને જાણ કરીશું.',
    'Photo required before creating request.': 'વિનંતી બનાવતા પહેલાં ફોટો જરૂરી છે.',
    'Entry already allowed.': 'પ્રવેશ માટે પહેલેથી જ મંજૂરી આપવામાં આવી છે.',
    'Entry allowed successfully.': 'પ્રવેશ માટે સફળતાપૂર્વક મંજૂરી આપવામાં આવી.',
    'Entry allowed without member approval.': 'સભ્યની મંજૂરી વગર પ્રવેશ માટે મંજૂરી આપવામાં આવી.',
    'Exit already allowed.': 'બહાર નીકળવા માટે પહેલેથી જ મંજૂરી આપવામાં આવી છે.',
    'Exit allowed successfully.': 'બહાર નીકળવા માટે સફળતાપૂર્વક મંજૂરી આપવામાં આવી.',
    'Visitor has already left.': 'વિઝિટર પહેલેથી જ જઈ ચૂક્યો છે.',
    'This visitor is already marked as wrong entry.': 'આ વિઝિટરને પહેલેથી જ ખોટી એન્ટ્રી તરીકે ચિહ્નિત કરવામાં આવ્યો છે.',
    'Visitor marked as left successfully.': 'વિઝિટરને સફળતાપૂર્વક નીકળી ગયેલા તરીકે ચિહ્નિત કર્યો.',
    'Visitor marked as wrong entry successfully.': 'વિઝિટરને સફળતાપૂર્વક ખોટી એન્ટ્રી તરીકે ચિહ્નિત કર્યો.',
    'Feedback fetched.': 'પ્રતિસાદ મેળવાયો.',
    'Feedback updated.': 'પ્રતિસાદ અપડેટ થયો.',
    'Thank you for your feedback.': 'તમારા પ્રતિસાદ માટે આભાર.',
    'No changes provided.': 'કોઈ ફેરફાર આપવામાં આવ્યો નથી.',
    'Test notification sent.': 'ટેસ્ટ નોટિફિકેશન મોકલાયું.',
    'Notification marked as read.': 'નોટિફિકેશનને વાંચેલું તરીકે ચિહ્નિત કરાયું.',
    'Notifications marked as read.': 'નોટિફિકેશન્સને વાંચેલાં તરીકે ચિહ્નિત કરાયા.',
    'All notifications marked as read.': 'બધા નોટિફિકેશન્સને વાંચેલાં તરીકે ચિહ્નિત કરાયા.',
    'Read notifications cleared.': 'વાંચેલાં નોટિફિકેશન્સ સાફ કરાયા.',
    'Duty started successfully': 'ડ્યૂટી સફળતાપૂર્વક શરૂ થઈ.',
    'Duty ended successfully': 'ડ્યૂટી સફળતાપૂર્વક પૂર્ણ થઈ.',
    'Daily help approved successfully.': 'ડેઇલી હેલ્પ સફળતાપૂર્વક મંજૂર થઈ.',
    'Daily help rejected successfully.': 'ડેઇલી હેલ્પ સફળતાપૂર્વક નકારાઈ.',
    'Daily help already added for unit.': 'આ યુનિટ માટે ડેઇલી હેલ્પ પહેલેથી જ ઉમેરાઈ ગઈ છે.',
    'Daily help already removed.': 'ડેઇલી હેલ્પ પહેલેથી જ દૂર થઈ ગઈ છે.',
    'Daily help already removed from society.': 'ડેઇલી હેલ્પ પહેલેથી જ સોસાયટીમાંથી દૂર થઈ ગઈ છે.',
    'Maintenance verified successfully.': 'મેન્ટેનન્સ સફળતાપૂર્વક ચકાસાયું.',
    'Maintenance rejected successfully.': 'મેન્ટેનન્સ સફળતાપૂર્વક નકારાયું.',
    'Society suspended successfully.': 'સોસાયટી સફળતાપૂર્વક સસ્પેન્ડ થઈ.',
    'Registration initiated. Please verify the OTP to continue onboarding.': 'રજિસ્ટ્રેશન શરૂ થયું છે. ઓનબોર્ડિંગ ચાલુ રાખવા કૃપા કરીને ઓટીપી ચકાસો.',
    'OTP verified successfully. Continue onboarding.': 'ઓટીપી સફળતાપૂર્વક ચકાસાયું. ઓનબોર્ડિંગ ચાલુ રાખો.',
    'Onboarding completed successfully.': 'ઓનબોર્ડિંગ સફળતાપૂર્વક પૂર્ણ થયું.',
    'If the email exists, a password reset link has been sent.': 'જો ઈમેઇલ અસ્તિત્વમાં હશે તો પાસવર્ડ રીસેટ લિંક મોકલી દેવામાં આવી છે.',
    'Unauthorized.': 'અનધિકૃત વિનંતી.',
    'Authorization token missing or invalid': 'ઓથોરાઇઝેશન ટોકન ઉપલબ્ધ નથી અથવા અમાન્ય છે.',
    'Invalid or expired token': 'ટોકન અમાન્ય છે અથવા તેની મુદત સમાપ્ત થઈ ગઈ છે.',
    'Unauthorized: invalid society admin context': 'અનધિકૃત: સોસાયટી એડમિન કોન્ટેક્સ્ટ અમાન્ય છે.',
    'Unauthorized: user not found': 'અનધિકૃત: વપરાશકર્તા મળ્યો નથી.',
    'Access denied': 'ઍક્સેસ નકારાયો.',
    'Account not found for the provided details.': 'આપેલ વિગતો માટે એકાઉન્ટ મળ્યું નથી.',
    'Invalid credentials.': 'અમાન્ય ક્રેડેન્શિયલ્સ.',
    'No society admin mapping found for this user.': 'આ વપરાશકર્તા માટે કોઈ સોસાયટી એડમિન મેપિંગ મળ્યું નથી.',
    'Phone number, password, and confirm password are required.': 'ફોન નંબર, પાસવર્ડ અને કન્ફર્મ પાસવર્ડ જરૂરી છે.',
    'Password and confirm password do not match.': 'પાસવર્ડ અને કન્ફર્મ પાસવર્ડ મેળ ખાતા નથી.',
    'You must accept the terms to continue.': 'આગળ વધવા માટે તમને શરતો સ્વીકારવી પડશે.',
    'Phone number is required.': 'ફોન નંબર જરૂરી છે.',
    'Phone number must contain between 10 and 12 digits.': 'ફોન નંબરમાં 10 થી 12 અંકો હોવા જોઈએ.',
    'Admin mobile must contain between 10 and 12 digits.': 'એડમિન મોબાઇલમાં 10 થી 12 અંકો હોવા જોઈએ.',
    'A user already exists with this phone number.': 'આ ફોન નંબર સાથે વપરાશકર્તા પહેલેથી જ અસ્તિત્વમાં છે.',
    'User ID and OTP are required.': 'યૂઝર આઈડી અને ઓટીપી જરૂરી છે.',
    'OTP verification is not required for this account.': 'આ ખાતા માટે ઓટીપી ચકાસણી જરૂરી નથી.',
    'Role and mobile number are required.': 'રોલ અને મોબાઇલ નંબર જરૂરી છે.',
    'Role, mobile number, and OTP are required.': 'રોલ, મોબાઇલ નંબર અને ઓટીપી જરૂરી છે.',
    'Role, mobile number, password, and reset token are required.': 'રોલ, મોબાઇલ નંબર, પાસવર્ડ અને રીસેટ ટોકન જરૂરી છે.',
    'Role, phone number, and password are required.': 'રોલ, ફોન નંબર અને પાસવર્ડ જરૂરી છે.',
    'A valid societyId is required.': 'માન્ય societyId જરૂરી છે.',
    'All fields are required.': 'બધા ફીલ્ડ્સ જરૂરી છે.',
    'Email and password are required.': 'ઈમેઇલ અને પાસવર્ડ જરૂરી છે.',
    'Email is required.': 'ઈમેઇલ જરૂરી છે.',
    'Token, email, and password are required.': 'ટોકન, ઈમેઇલ અને પાસવર્ડ જરૂરી છે.',
    'fcmToken is required.': 'fcmToken જરૂરી છે.',
    'deviceType must be android, ios, or web.': 'deviceType android, ios અથવા web હોવું જોઈએ.',
    'preferredLanguage is required.': 'preferredLanguage જરૂરી છે.',
    'Invalid or expired reset token.': 'રીસેટ ટોકન અમાન્ય છે અથવા તેની મુદત પૂરી થઈ ગઈ છે.',
    'Unsupported preferredLanguage value.': 'preferredLanguage નું મૂલ્ય સમર્થિત નથી.',
    'Invalid filter. Allowed values: today, this_month, past_3_months.': 'અમાન્ય ફિલ્ટર. માન્ય મૂલ્યો: today, this_month, past_3_months.',
    'Invalid month. Use full month name like September.': 'અમાન્ય મહિનો. September જેવું પૂરું મહિનાનું નામ વાપરો.',
    'year must be a 4-digit number.': 'year 4 અંકોની સંખ્યા હોવી જોઈએ.',
    'status is required. Allowed values: uploaded, verified, rejected.': 'status જરૂરી છે. માન્ય મૂલ્યો: uploaded, verified, rejected.',
    'Invalid status. Allowed values: uploaded, verified, rejected.': 'અમાન્ય status. માન્ય મૂલ્યો: uploaded, verified, rejected.',
    'Invalid location type. Expected country, city, or society.': 'અમાન્ય લોકેશન પ્રકાર. country, city અથવા society અપેક્ષિત છે.',
    'Name is required for the missing location.': 'ગુમ થયેલ લોકેશન માટે નામ જરૂરી છે.',
    'validityHours must be a positive number.': 'validityHours એક ધનાત્મક સંખ્યા હોવી જોઈએ.',
    'validityHours cannot exceed 24 hours.': 'validityHours 24 કલાકથી વધુ ન હોઈ શકે.',
    'validTill must be after validFrom.': 'validTill, validFrom પછી હોવું જોઈએ.',
    'selectedDate is required when dateOption is selectDate.': 'જ્યારે dateOption selectDate હોય ત્યારે selectedDate જરૂરી છે.',
    'Unsupported onboarding flow.': 'ઓનબોર્ડિંગ ફ્લો સમર્થિત નથી.',
    'Only image or PDF files are allowed in multipart uploads.': 'મલ્ટિપાર્ટ અપલોડમાં ફક્ત ઇમેજ અથવા PDF ફાઇલો જ મંજૂર છે.',
    'File size must be 10MB or less.': 'ફાઇલ સાઇઝ 10MB અથવા ઓછી હોવી જોઈએ.',
    'Too many files uploaded in a single request.': 'એક જ વિનંતીમાં ખૂબ જ વધુ ફાઇલો અપલોડ થઈ ગઈ.',
    'Message is required to trigger an alert email.': 'અલર્ટ ઇમેઇલ ટ્રિગર કરવા માટે મેસેજ જરૂરી છે.',
    'Role is required': 'રોલ જરૂરી છે.',
    'Unsupported role provided': 'આપેલ રોલ સમર્થિત નથી.',
    'unitId path parameter is required': 'unitId પાથ પેરામીટર જરૂરી છે.',
    'Invalid unit ID format': 'યુનિટ આઈડી ફોર્મેટ અમાન્ય છે.',
    'fullName cannot be empty.': 'fullName ખાલી હોઈ શકતું નથી.',
    'Please enter a valid phone number.': 'કૃપા કરીને માન્ય ફોન નંબર દાખલ કરો.',
    'companyName must be between 2 and 80 characters.': 'companyName 2 થી 80 અક્ષરો વચ્ચે હોવું જોઈએ.',
    'subCategory must be between 3 and 60 characters.': 'subCategory 3 થી 60 અક્ષરો વચ્ચે હોવું જોઈએ.',
    'This phone number already exists in the system.': 'આ ફોન નંબર સિસ્ટમમાં પહેલેથી જ અસ્તિત્વમાં છે.',
    'Company already exists.': 'કંપની પહેલેથી જ અસ્તિત્વમાં છે.',
    'Onboarding is already completed for this account. Use add unit flow for this user.': 'આ એકાઉન્ટ માટે ઓનબોર્ડિંગ પહેલેથી જ પૂર્ણ થયું છે. આ વપરાશકર્તા માટે add unit ફ્લો વાપરો.',
    'Onboarding already completed for this account.': 'આ એકાઉન્ટ માટે ઓનબોર્ડિંગ પહેલેથી જ પૂર્ણ થયું છે.',
    'Pre-approval not found.': 'પ્રી-અપ્રુવલ મળ્યું નથી.',
    'Only active pre-approvals can be updated.': 'ફક્ત સક્રિય પ્રી-અપ્રુવલ્સ અપડેટ કરી શકાય છે.',
    'Cannot cancel while visitor is inside society.': 'જ્યારે વિઝિટર સોસાયટીની અંદર હોય ત્યારે રદ કરી શકાય નહીં.',
    'Entry request cannot be cancelled in current status.': 'હાલની સ્થિતિમાં એન્ટ્રી વિનંતી રદ કરી શકાય નહીં.',
    'Pre-approval is already cancelled.': 'પ્રી-અપ્રુવલ પહેલેથી જ રદ થઈ ચૂક્યું છે.',
    'Cannot cancel pre-approval while visitor is inside society.': 'જ્યારે વિઝિટર સોસાયટીની અંદર હોય ત્યારે પ્રી-અપ્રુવલ રદ કરી શકાય નહીં.',
    'Society is already suspended.': 'સોસાયટી પહેલેથી જ સસ્પેન્ડ છે.',
    'Route not found': 'રૂટ મળ્યો નથી.',
    'Unit not found': 'યુનિટ મળ્યો નથી.',
    'Society not found.': 'સોસાયટી મળી નથી.',
    'User not found.': 'વપરાશકર્તા મળ્યો નથી.',
    'No account found with this email address.': 'આ ઈમેઇલ સરનામા સાથે કોઈ એકાઉન્ટ મળ્યું નથી.',
    'Daily help profile not found.': 'ડેઇલી હેલ્પ પ્રોફાઇલ મળી નથી.',
    'Unable to generate a unique Society PIN. Please try again later.': 'અનન્ય સોસાયટી PIN જનરેટ કરી શકાયું નથી. કૃપા કરીને પછી ફરી પ્રયાસ કરો.',
    'Failed to upload multipart file.': 'મલ્ટિપાર્ટ ફાઇલ અપલોડ કરવામાં નિષ્ફળ.',
    'societyId is required for report generation.': 'રિપોર્ટ જનરેશન માટે societyId જરૂરી છે.',
    'OTP you have entered is incorrect.': 'તમે દાખલ કરેલો ઓટીપી ખોટો છે.'
  }),
});

const ACTION_TRANSLATIONS = Object.freeze({
  hi: Object.freeze({
    fetch: 'प्राप्त करने',
    update: 'अपडेट करने',
    add: 'जोड़ने',
    remove: 'हटाने',
    create: 'बनाने',
    delete: 'हटाने',
    send: 'भेजने',
    verify: 'सत्यापित करने',
    reset: 'रीसेट करने',
    login: 'लॉगिन करने',
    switch: 'बदलने',
    toggle: 'टॉगल करने',
    suspend: 'निलंबित करने',
    approve: 'स्वीकृत करने',
    reject: 'अस्वीकृत करने',
    complete: 'पूरा करने',
    initiate: 'शुरू करने',
    cancel: 'रद्द करने',
    record: 'दर्ज करने',
    generate: 'जेनरेट करने',
    upload: 'अपलोड करने',
    register: 'रजिस्टर करने',
    allow: 'अनुमति देने',
    mark: 'चिह्नित करने'
  }),
  gu: Object.freeze({
    fetch: 'મેળવવામાં',
    update: 'અપડેટ કરવામાં',
    add: 'ઉમેરવામાં',
    remove: 'દૂર કરવામાં',
    create: 'બનાવવામાં',
    delete: 'કાઢી નાખવામાં',
    send: 'મોકલવામાં',
    verify: 'ચકાસવામાં',
    reset: 'રીસેટ કરવામાં',
    login: 'લૉગિન કરવામાં',
    switch: 'બદલવામાં',
    toggle: 'ટોગલ કરવામાં',
    suspend: 'સસ્પેન્ડ કરવામાં',
    approve: 'મંજૂર કરવામાં',
    reject: 'નકારવામાં',
    complete: 'પૂર્ણ કરવામાં',
    initiate: 'શરૂ કરવામાં',
    cancel: 'રદ કરવામાં',
    record: 'નોંધવામાં',
    generate: 'જનરેટ કરવામાં',
    upload: 'અપલોડ કરવામાં',
    register: 'નોંધાવવામાં',
    allow: 'મંજૂરી આપવામાં',
    mark: 'ચિહ્નિત કરવામાં'
  }),
});

const normalizeTerm = (value) => String(value || '').trim().replace(/\.$/, '').toLowerCase();

const translateEntity = (value, languageCode) => {
  const langMap = ENTITY_TRANSLATIONS[languageCode];
  if (!langMap) {
    return value;
  }

  return langMap[normalizeTerm(value)] || value;
};

const resolveLanguageFromHeaders = (req) => {
  const directHeader = req?.headers?.['x-language-code'] || req?.headers?.['x-preferred-language'];
  if (directHeader) {
    return normalizeSupportedLanguageCode(directHeader) || 'en';
  }

  const acceptLanguage = req?.headers?.['accept-language'];
  if (!acceptLanguage) {
    return 'en';
  }

  const preferredTag = String(acceptLanguage).split(',')[0]?.split(';')[0]?.trim();
  const baseCode = preferredTag?.split('-')[0];
  return normalizeSupportedLanguageCode(baseCode) || 'en';
};

const getRequestLanguageCode = (req, res) => {
  const preferredLanguage =
    res?.locals?.languageCode ||
    req?.appUser?.preferredLanguage ||
    req?.user?.preferredLanguage ||
    req?.preferredLanguage;

  return normalizeSupportedLanguageCode(preferredLanguage) || resolveLanguageFromHeaders(req);
};

const translatePatternMessage = (message, languageCode) => {
  const fetchedMatch = /^(?<subject>.+?) fetched successfully\.?$/i.exec(message);
  if (fetchedMatch) {
    const subject = translateEntity(fetchedMatch.groups.subject, languageCode);
    return languageCode === 'hi'
      ? `${subject} सफलतापूर्वक प्राप्त किया गया।`
      : `${subject} સફળતાપૂર્વક મેળવાયું.`;
  }

  const updatedMatch = /^(?<subject>.+?) updated successfully\.?$/i.exec(message);
  if (updatedMatch) {
    const subject = translateEntity(updatedMatch.groups.subject, languageCode);
    return languageCode === 'hi'
      ? `${subject} सफलतापूर्वक अपडेट किया गया।`
      : `${subject} સફળતાપૂર્વક અપડેટ થયું.`;
  }

  const createdMatch = /^(?<subject>.+?) created successfully\.?$/i.exec(message);
  if (createdMatch) {
    const subject = translateEntity(createdMatch.groups.subject, languageCode);
    return languageCode === 'hi'
      ? `${subject} सफलतापूर्वक बनाया गया।`
      : `${subject} સફળતાપૂર્વક બનાવાયું.`;
  }

  const addedMatch = /^(?<subject>.+?) added successfully\.?$/i.exec(message);
  if (addedMatch) {
    const subject = translateEntity(addedMatch.groups.subject, languageCode);
    return languageCode === 'hi'
      ? `${subject} सफलतापूर्वक जोड़ा गया।`
      : `${subject} સફળતાપૂર્વક ઉમેરાયું.`;
  }

  const savedMatch = /^(?<subject>.+?) saved successfully\.?$/i.exec(message);
  if (savedMatch) {
    const subject = translateEntity(savedMatch.groups.subject, languageCode);
    return languageCode === 'hi'
      ? `${subject} सफलतापूर्वक सेव किया गया।`
      : `${subject} સફળતાપૂર્વક સાચવાયું.`;
  }

  const removedMatch = /^(?<subject>.+?) removed successfully\.?$/i.exec(message);
  if (removedMatch) {
    const subject = translateEntity(removedMatch.groups.subject, languageCode);
    return languageCode === 'hi'
      ? `${subject} सफलतापूर्वक हटा दिया गया।`
      : `${subject} સફળતાપૂર્વક દૂર કરવામાં આવ્યું.`;
  }

  const deletedMatch = /^(?<subject>.+?) deleted successfully\.?$/i.exec(message);
  if (deletedMatch) {
    const subject = translateEntity(deletedMatch.groups.subject, languageCode);
    return languageCode === 'hi'
      ? `${subject} सफलतापूर्वक हटा दिया गया।`
      : `${subject} સફળતાપૂર્વક કાઢી નાખાયું.`;
  }

  const generatedMatch = /^(?<subject>.+?) generated successfully\.?$/i.exec(message);
  if (generatedMatch) {
    const subject = translateEntity(generatedMatch.groups.subject, languageCode);
    return languageCode === 'hi'
      ? `${subject} सफलतापूर्वक जेनरेट की गई।`
      : `${subject} સફળતાપૂર્વક જનરેટ થયું.`;
  }

  const failedMatch = /^Failed to (?<action>.+?)\.?$/i.exec(message);
  if (failedMatch) {
    const actionText = failedMatch.groups.action.trim();
    const verbMatch = /^(?<verb>\w+)(?:\s+(?<object>.+))?$/.exec(actionText);
    const verb = verbMatch?.groups?.verb?.toLowerCase();
    const object = verbMatch?.groups?.object || '';
    const translatedVerb = ACTION_TRANSLATIONS[languageCode]?.[verb];
    const translatedObject = object ? translateEntity(object, languageCode) : '';

    if (translatedVerb) {
      if (languageCode === 'hi') {
        return translatedObject
          ? `${translatedObject} ${translatedVerb} में विफल।`
          : `${translatedVerb} में विफल।`;
      }

      return translatedObject
        ? `${translatedObject} ${translatedVerb} નિષ્ફળ.`
        : `${translatedVerb} નિષ્ફળ.`;
    }
  }

  const routeNotFoundMatch = /^Route (?<route>.+) not found$/i.exec(message);
  if (routeNotFoundMatch) {
    return languageCode === 'hi'
      ? `रूट ${routeNotFoundMatch.groups.route} नहीं मिला।`
      : `રૂટ ${routeNotFoundMatch.groups.route} મળ્યો નથી.`;
  }

  const duplicateAdminEmailMatch = /^Duplicate admin email (?<value>.+) in payload$/i.exec(message);
  if (duplicateAdminEmailMatch) {
    return languageCode === 'hi'
      ? `पेलोड में एडमिन ईमेल ${duplicateAdminEmailMatch.groups.value} डुप्लिकेट है।`
      : `પેલોડમાં એડમિન ઈમેઇલ ${duplicateAdminEmailMatch.groups.value} ડુપ્લિકેટ છે.`;
  }

  const duplicateAdminMobileMatch = /^Duplicate admin mobile (?<value>.+) in payload$/i.exec(message);
  if (duplicateAdminMobileMatch) {
    return languageCode === 'hi'
      ? `पेलोड में एडमिन मोबाइल ${duplicateAdminMobileMatch.groups.value} डुप्लिकेट है।`
      : `પેલોડમાં એડમિન મોબાઇલ ${duplicateAdminMobileMatch.groups.value} ડુપ્લિકેટ છે.`;
  }

  const inactiveSocietyMatch = /^(?<society>.+) is inactive\. Please renew the contract to continue\.$/i.exec(message);
  if (inactiveSocietyMatch) {
    return languageCode === 'hi'
      ? `${inactiveSocietyMatch.groups.society} निष्क्रिय है। आगे बढ़ने के लिए कृपया कॉन्ट्रैक्ट रिन्यू करें।`
      : `${inactiveSocietyMatch.groups.society} નિષ્ક્રિય છે. આગળ વધવા માટે કૃપા કરીને કરાર રિન્યુ કરો.`;
  }

  const suspendedSocietyMatch = /^(?<society>.+) is suspended\. Please contact support\.$/i.exec(message);
  if (suspendedSocietyMatch) {
    return languageCode === 'hi'
      ? `${suspendedSocietyMatch.groups.society} निलंबित है। कृपया सपोर्ट से संपर्क करें।`
      : `${suspendedSocietyMatch.groups.society} સસ્પેન્ડ છે. કૃપા કરીને સપોર્ટનો સંપર્ક કરો.`;
  }

  return null;
};

const localizeResponseMessage = (message, req, res) => {
  if (!message) {
    return message;
  }

  const languageCode = getRequestLanguageCode(req, res);
  if (languageCode === 'en') {
    return message;
  }

  const exactMatch = EXACT_TRANSLATIONS[languageCode]?.[message];
  if (exactMatch) {
    return exactMatch;
  }

  return translatePatternMessage(message, languageCode) || message;
};

module.exports = {
  getRequestLanguageCode,
  localizeResponseMessage,
};