const admin = require('firebase-admin');

let firebaseApp = null;

const initializeFirebase = () => {
  if (firebaseApp) {
    return firebaseApp;
  }

  try {
    const firebaseJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

    if (!firebaseJson) {
      console.warn('[Firebase] FIREBASE_SERVICE_ACCOUNT_JSON not found');
      console.warn('[Firebase] Push notifications will be disabled.');
      return null;
    }

    const serviceAccount = JSON.parse(firebaseJson);

    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });

    console.log('[Firebase] Initialized successfully');
    return firebaseApp;
  } catch (error) {
    console.error('[Firebase] Failed to initialize:', error.message);
    return null;
  }
};

const getFirebaseApp = () => {
  if (!firebaseApp) {
    return initializeFirebase();
  }
  return firebaseApp;
};

const getMessaging = () => {
  const app = getFirebaseApp();
  if (!app) {
    return null;
  }
  return admin.messaging(app);
};

module.exports = {
  initializeFirebase,
  getFirebaseApp,
  getMessaging,
  admin,
};
