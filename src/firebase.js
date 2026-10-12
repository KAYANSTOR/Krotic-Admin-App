import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';

// All values must come from environment variables.
// Create a .env file based on .env.example and fill in your NEW Firebase project credentials.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

// Safety check – fail early if config is missing
if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  console.error(
    'Firebase config is missing. Please create a .env file with your Firebase project credentials (see .env.example).'
  );
}

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
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

export default app;
