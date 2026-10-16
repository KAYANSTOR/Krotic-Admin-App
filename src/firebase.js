import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';

// All values must come from environment variables.
// Create a .env file based on .env.example and fill in your NEW Firebase project credentials.
export const isFirebaseConfigured = Boolean(
  import.meta.env.VITE_FIREBASE_API_KEY && import.meta.env.VITE_FIREBASE_PROJECT_ID
);

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyDemoPlaceholderKeyForInitOnly000',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'demo-krotak-pro.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'demo-krotak-pro',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'demo-krotak-pro.appspot.com',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '123456789012',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:123456789012:web:demo1234567890',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || 'G-DEMO',
};

// Safety check – warn if config is missing
if (!isFirebaseConfigured) {
  console.warn(
    'Firebase config is missing. Please create a .env file with your Firebase project credentials (see .env.example).'
  );
}

const app = initializeApp(firebaseConfig);
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
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager(),
    }),
  });
} catch (error) {
  console.warn('Persistent Firestore cache unavailable; using memory cache.', error);
  db = getFirestore(app);
}
export { db };

// Secondary app instance for creating new admin users without signing out the current admin
const secondaryApp = initializeApp(firebaseConfig, 'SecondaryApp');
export const secondaryAuth = getAuth(secondaryApp);
if (useEmulators) {
  connectFirestoreEmulator(
    db,
    import.meta.env.VITE_FIRESTORE_EMULATOR_HOST || '127.0.0.1',
    Number(import.meta.env.VITE_FIRESTORE_EMULATOR_PORT || 8080),
  );
  connectAuthEmulator(secondaryAuth, `http://${import.meta.env.VITE_AUTH_EMULATOR_HOST || '127.0.0.1'}:${import.meta.env.VITE_AUTH_EMULATOR_PORT || 9099}`, { disableWarnings: true });
}

export default app;
