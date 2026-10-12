import { createContext, useContext, useState, useEffect } from 'react';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged, createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db, secondaryAuth } from '../firebase';
import { signOut as secondarySignOut } from 'firebase/auth';

const AuthContext = createContext();

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [adminData, setAdminData] = useState(null);
  const [loading, setLoading] = useState(true);

  // Admin documents are always addressed by the Firebase Auth UID.
  async function verifyAdmin(uid) {
    const adminDoc = await getDoc(doc(db, 'Admins', uid));
    return adminDoc.exists() ? { uid, ...adminDoc.data() } : null;
  }

  async function login(email, password) {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const admin = await verifyAdmin(userCredential.user.uid);

    if (!admin) {
      await signOut(auth);
      throw new Error('هذا الحساب ليس مسجلاً كمدير. يجب إنشاء المستند Admins/{UID} أولاً.');
    }

    setCurrentUser(userCredential.user);
    setAdminData(admin);
    return userCredential;
  }

  async function logout() {
    setAdminData(null);
    setCurrentUser(null);
    return signOut(auth);
  }

  async function createAdmin(email, password, name, phone) {
    const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    const uid = userCredential.user.uid;
    await setDoc(doc(db, 'Admins', uid), { uid, name, email, phone, createdAt: Date.now() });
    await secondarySignOut(secondaryAuth);
    return uid;
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      try {
        if (user) {
          const admin = await verifyAdmin(user.uid);
          if (admin) {
            setCurrentUser(user);
            setAdminData(admin);
          } else {
            await signOut(auth);
            setCurrentUser(null);
            setAdminData(null);
          }
        } else {
          setCurrentUser(null);
          setAdminData(null);
        }
      } catch (error) {
        console.error('Error verifying signed-in admin:', error);
        await signOut(auth).catch(() => undefined);
        setCurrentUser(null);
        setAdminData(null);
      } finally {
        setLoading(false);
      }
    });
    return unsubscribe;
  }, []);

  const value = { currentUser, adminData, loading, login, logout, createAdmin, verifyAdmin };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
