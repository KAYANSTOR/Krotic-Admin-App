import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged, createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, getDocFromCache, getDocFromServer, getFirestore, setDoc } from 'firebase/firestore';
import app, { auth, db, secondaryAuth, firestoreDatabaseId } from '../firebase';
import { signOut as secondarySignOut } from 'firebase/auth';
import { clearAdminDataCache, invalidateAdminListData } from '../lib/adminData';
import { callAdminApi, adminApiError } from '../lib/adminApi';

const AuthContext = createContext();

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [adminData, setAdminData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [offlineSession, setOfflineSession] = useState(false);
  const sessionVersion = useRef(0);
  const currentUid = useRef(null);

  // Admin documents are always addressed by the Firebase Auth UID.
  async function readVerifiedAdmin(uid) {
    if (!uid) return { admin: null, fromCache: false };
    const toVerifiedAdmin = (adminDoc) => {
      if (!adminDoc || !adminDoc.exists()) return null;
      const data = adminDoc.data();
      return data?.uid === uid ? { ...data, uid } : null;
    };
    const targetDb = db || getFirestore(auth?.app || app, firestoreDatabaseId);
    try {
      const adminDoc = await getDocFromServer(doc(targetDb, 'Admins', uid));
      return { admin: toVerifiedAdmin(adminDoc), fromCache: false };
    } catch (error) {
      // Never use a cached Admin document after permission-denied or another
      // server/auth failure. `unavailable` is Firestore's real offline path.
      if (error?.code !== 'unavailable') throw error;
      const cachedAdminDoc = await getDocFromCache(doc(targetDb, 'Admins', uid));
      return {
        admin: toVerifiedAdmin(cachedAdminDoc),
        fromCache: true,
      };
    }
  }

  async function verifyAdmin(uid) {
    return (await readVerifiedAdmin(uid)).admin;
  }

  async function login(email, password) {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    try {
      const { admin, fromCache } = await readVerifiedAdmin(userCredential.user.uid);
      if (!admin) {
        throw new Error('هذا الحساب ليس مسجلاً كمدير. يجب إنشاء المستند Admins/{UID} أولاً.');
      }
      if (auth.currentUser?.uid !== userCredential.user.uid) {
        throw new Error('تغيرت جلسة المصادقة أثناء تسجيل الدخول.');
      }
      setCurrentUser(userCredential.user);
      setAdminData(admin);
      setOfflineSession(fromCache);
      return userCredential;
    } catch (error) {
      // Never leave a signed-in Firebase session behind when admin verification fails.
      if (auth.currentUser?.uid === userCredential.user.uid) await signOut(auth).catch(() => undefined);
      throw error;
    }
  }

  async function logout() {
    sessionVersion.current += 1;
    currentUid.current = null;
    clearAdminDataCache();
    setAdminData(null);
    setCurrentUser(null);
    setOfflineSession(false);
    return signOut(auth);
  }

  async function createAdmin(email, password, name, phone) {
    // قرار و3: إنشاء المدراء عبر المسار الخادمي فقط (لا كتابة عميل على Admins).
    const result = await callAdminApi('/api/admins', { action: 'create', email, password, name, phone });
    if (!result.ok) throw new Error(adminApiError(result.error, 'تعذر إنشاء حساب المدير'));
    invalidateAdminListData();
    return result.data?.uid;
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      const eventVersion = ++sessionVersion.current;
      const uid = user?.uid || null;
      if (currentUid.current !== uid) {
        const hadPreviousUid = Boolean(currentUid.current);
        currentUid.current = uid;
        // Unmount protected routes before verifying a different account; never
        // leave the prior admin's identity or page state visible during the await.
        setLoading(true);
        setCurrentUser(null);
        setAdminData(null);
        // On a fresh app start keep only the restored UID's snapshot; an actual
        // account transition/logout clears every custom snapshot.
        clearAdminDataCache(hadPreviousUid ? undefined : { preserveUid: uid });
        setOfflineSession(false);
      }
      try {
        if (user) {
          const { admin, fromCache } = await readVerifiedAdmin(user.uid);
          if (eventVersion !== sessionVersion.current || auth.currentUser?.uid !== user.uid) return;
          if (admin) {
            setCurrentUser(user);
            setAdminData(admin);
            setOfflineSession(fromCache);
          } else {
            await signOut(auth);
            if (eventVersion !== sessionVersion.current) return;
            setCurrentUser(null);
            setAdminData(null);
            setOfflineSession(false);
          }
        } else {
          setCurrentUser(null);
          setAdminData(null);
          setOfflineSession(false);
        }
      } catch (error) {
        console.error('Error verifying signed-in admin:', error);
        if (eventVersion !== sessionVersion.current || auth.currentUser?.uid !== uid) return;
        await signOut(auth).catch(() => undefined);
        if (eventVersion !== sessionVersion.current) return;
        setCurrentUser(null);
        setAdminData(null);
        setOfflineSession(false);
      } finally {
        if (eventVersion === sessionVersion.current) setLoading(false);
      }
    });
    return unsubscribe;
  }, []);

  const value = {
    currentUser,
    adminData,
    loading,
    offlineSession,
    isOffline: offlineSession,
    login,
    logout,
    createAdmin,
    verifyAdmin,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
