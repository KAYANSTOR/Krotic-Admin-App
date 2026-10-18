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
      return (data?.uid === uid || !data?.uid) ? { ...data, uid } : null;
    };
    const targetDb = db || getFirestore(auth?.app || app, firestoreDatabaseId);

    // 1. Try canonical Admins collection, then fallback admins collection
    for (const col of ['Admins', 'admins']) {
      try {
        const adminDoc = await getDocFromServer(doc(targetDb, col, uid));
        if (adminDoc.exists()) {
          const verified = toVerifiedAdmin(adminDoc);
          if (verified) return { admin: verified, fromCache: false };
        }
      } catch (error) {
        if (error?.code === 'unavailable') {
          try {
            const cachedDoc = await getDocFromCache(doc(targetDb, col, uid));
            if (cachedDoc.exists()) {
              const verified = toVerifiedAdmin(cachedDoc);
              if (verified) return { admin: verified, fromCache: true };
            }
          } catch {}
        }
      }
    }
    return { admin: null, fromCache: false };
  }

  async function verifyAdmin(uid) {
    return (await readVerifiedAdmin(uid)).admin;
  }

  async function login(email, password) {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    try {
      let { admin, fromCache } = await readVerifiedAdmin(userCredential.user.uid);

      // Self-heal / Bootstrap admin account via server if document is not yet in active Firestore
      if (!admin) {
        try {
          const idToken = await userCredential.user.getIdToken();
          const response = await fetch('/api/admin-session', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify({ action: 'bootstrap' }),
          });

          if (response.ok) {
            const data = await response.json();
            if (data?.success && data?.admin) {
              admin = data.admin;
              fromCache = false;
            } else if (data?.error === 'client_account') {
              throw new Error(data.message || 'هذا الحساب مسجل كصاحب شبكة/عميل في التطبيق وليس كمدير للنظام.');
            }
          } else {
            const errData = await response.json().catch(() => ({}));
            if (errData?.error === 'client_account') {
              throw new Error(errData.message || 'هذا الحساب مسجل كصاحب شبكة/عميل في التطبيق وليس كمدير للنظام.');
            }
          }
        } catch (serverErr) {
          if (serverErr?.message && serverErr.message.includes('صاحب شبكة')) {
            throw serverErr;
          }
          console.warn('Server admin session bootstrap check failed:', serverErr);
        }
      }

      if (!admin) {
        throw new Error('هذا الحساب ليس مسجلاً كمدير في لوحة التحكم.');
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
