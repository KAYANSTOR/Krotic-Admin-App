import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyBq0BXktt8KtzmiLEilf_XcD8ZgWsfsfu0',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'netcard-pro.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'netcard-pro',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'netcard-pro.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '9969478641',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:9969478641:web:7ebc065f59f800bf0c3250',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || 'G-7G13M9G356',
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Secondary app instance for creating new admin users without signing out the current admin
const secondaryApp = initializeApp(firebaseConfig, 'SecondaryApp');
export const secondaryAuth = getAuth(secondaryApp);

export default app;
