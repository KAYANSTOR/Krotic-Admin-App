import { initializeApp, getApps, getApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';

import firebaseConfigJson from '../firebase-applet-config.json';

export const firestoreDatabaseId =
  import.meta.env.VITE_FIRESTORE_DATABASE_ID ||
  firebaseConfigJson.firestoreDatabaseId ||
  '(default)';

// All values come from environment variables or the provisioned applet configuration.
export const isFirebaseConfigured = Boolean(
  (import.meta.env.VITE_FIREBASE_API_KEY || firebaseConfigJson.apiKey) &&
  (import.meta.env.VITE_FIREBASE_PROJECT_ID || firebaseConfigJson.projectId)
);

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || firebaseConfigJson.apiKey || 'AIzaSyDemoPlaceholderKeyForInitOnly000',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || firebaseConfigJson.authDomain || 'kroty-434e3.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || firebaseConfigJson.projectId || 'kroty-434e3',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || firebaseConfigJson.storageBucket || 'kroty-434e3.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || firebaseConfigJson.messagingSenderId || '614239660563',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || firebaseConfigJson.appId || '1:614239660563:web:786dd69cda8b635fa7ede6',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || firebaseConfigJson.measurementId || '',
};

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
const useEmulators = import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true';
if (useEmulators) {
  connectAuthEmulator(auth, `http://${import.meta.env.VITE_AUTH_EMULATOR_HOST || '127.0.0.1'}:${import.meta.env.VITE_AUTH_EMULATOR_PORT || 9099}`, { disableWarnings: true });
}

// Keep Firestore documents in IndexedDB. The dashboard can render its last
// known state immediately, while Firestore revalidates only what is missing.
// Some embedded/private browser contexts do not support persistence, so the
// fallback keeps the application functional without local caching.
let db;
try {
  db = initializeFirestore(
    app,
    {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    },
    firestoreDatabaseId
  );
} catch (error) {
  console.warn('Persistent Firestore cache unavailable; using memory/default cache.', error);
  try {
    db = getFirestore(app, firestoreDatabaseId);
  } catch (err2) {
    console.warn('getFirestore failed, falling back to basic initializeFirestore:', err2);
    try {
      db = initializeFirestore(app, {}, firestoreDatabaseId);
    } catch {
      db = getFirestore(app, firestoreDatabaseId);
    }
  }
}

if (!db) {
  try {
    db = getFirestore(app, firestoreDatabaseId);
  } catch {
    db = initializeFirestore(app, {}, firestoreDatabaseId);
  }
}
export { db };

// Secondary app instance for creating new admin users without signing out the current admin
const secondaryApp = getApps().find((a) => a.name === 'SecondaryApp') || initializeApp(firebaseConfig, 'SecondaryApp');
export const secondaryAuth = getAuth(secondaryApp);
if (useEmulators && db) {
  connectFirestoreEmulator(
    db,
    import.meta.env.VITE_FIRESTORE_EMULATOR_HOST || '127.0.0.1',
    Number(import.meta.env.VITE_FIRESTORE_EMULATOR_PORT || 8080),
  );
  connectAuthEmulator(secondaryAuth, `http://${import.meta.env.VITE_AUTH_EMULATOR_HOST || '127.0.0.1'}:${import.meta.env.VITE_AUTH_EMULATOR_PORT || 9099}`, { disableWarnings: true });
}

export default app;
