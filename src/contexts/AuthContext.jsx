import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged, createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc, getDocFromCache, getDocFromServer, getFirestore, setDoc } from 'firebase/firestore';
import app, { auth, db, secondaryAuth, firestoreDatabaseId } from '../firebase';
import { signOut as secondarySignOut } from 'firebase/auth';
import { callAdminApi, adminApiError } from '../lib/adminApi';
import { trackRead } from '../lib/localDb/readMeter';
import { deleteAdminDb } from '../lib/localDb/db';

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
  async function readVerifiedAdmin(uid, userObj) {
    if (!uid) return { admin: null, fromCache: false };
    const toVerifiedAdmin = (adminDoc) => {
      if (!adminDoc || !adminDoc.exists()) return null;
      const data = adminDoc.data();
      return (data?.uid === uid || !data?.uid) ? { ...data, uid } : null;
    };
    const targetDb = db || getFirestore(auth?.app || app, firestoreDatabaseId);

    // 1. Try canonical Admins collection, then fallback admins collection using getDoc
    for (const col of ['Admins', 'admins']) {
      try {
        const adminDoc = await trackRead(`auth:admin:${col}`, () => getDoc(doc(targetDb, col, uid)));
        if (adminDoc.exists()) {
          const verified = toVerifiedAdmin(adminDoc);
          if (verified) return { admin: verified, fromCache: false };
        }
      } catch (error) {
        try {
          const sDoc = await trackRead(`auth:admin-server:${col}`, () => getDocFromServer(doc(targetDb, col, uid)));
          if (sDoc.exists()) {
            const verified = toVerifiedAdmin(sDoc);
            if (verified) return { admin: verified, fromCache: false };
          }
        } catch {}
        try {
          const cachedDoc = await trackRead(`auth:admin-cache:${col}`, () => getDocFromCache(doc(targetDb, col, uid)));
          if (cachedDoc.exists()) {
            const verified = toVerifiedAdmin(cachedDoc);
            if (verified) return { admin: verified, fromCache: true };
          }
        } catch {}
      }
    }

    // 2. Server verification fallback via /api/admin-session
    try {
      const currentUser = userObj || auth.currentUser;
      if (currentUser && currentUser.uid === uid) {
        const idToken = await currentUser.getIdToken();
        const response = await fetch('/api/admin-session', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ action: 'bootstrap' }),
        });
        if (response.ok) {
          const data = await response.json().catch(() => ({}));
          if (data?.success && data?.admin) {
            return { admin: data.admin, fromCache: false };
          }
        }
      }
    } catch (err) {
      console.warn('readVerifiedAdmin server fallback error:', err);
    }

    // 3. Known Primary Admin guarantee if UID or Email matches
    const email = (userObj?.email || auth.currentUser?.email || '').toLowerCase();
    if (uid === 'akicZMi3cqcDXqlLUZMLL9OdAg53' || email === 'jarallhalkboudi@gmail.com') {
      return {
        admin: {
          uid: 'akicZMi3cqcDXqlLUZMLL9OdAg53',
          email: 'jarallhalkboudi@gmail.com',
          name: 'مدير Krotak Pro',
          role: 'admin',
        },
        fromCache: false,
      };
    }

    return { admin: null, fromCache: false };
  }

  async function verifyAdmin(uid) {
    return (await readVerifiedAdmin(uid, auth.currentUser)).admin;
  }

  async function login(email, password) {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    try {
      let { admin, fromCache } = await readVerifiedAdmin(userCredential.user.uid, userCredential.user);

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
    const previousUid = currentUid.current;
    currentUid.current = null;
    setAdminData(null);
    setCurrentUser(null);
    setOfflineSession(false);
    // البيانات الإدارية لا تبقى على الجهاز بعد الخروج (قرار المالك: حذف تلقائي).
    if (previousUid) await deleteAdminDb(previousUid).catch(() => undefined);
    return signOut(auth);
  }

  async function createAdmin(email, password, name, phone) {
    // قرار و3: إنشاء المدراء عبر المسار الخادمي فقط (لا كتابة عميل على Admins).
    const result = await callAdminApi('/api/admins', { action: 'create', email, password, name, phone });
    if (!result.ok) throw new Error(adminApiError(result.error, 'تعذر إنشاء حساب المدير'));
    return result.data?.uid;
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      const eventVersion = ++sessionVersion.current;
      const uid = user?.uid || null;
      if (currentUid.current !== uid) {
        currentUid.current = uid;
        // Unmount protected routes before verifying a different account; never
        // leave the prior admin's identity or page state visible during the await.
        setLoading(true);
        setCurrentUser(null);
        setAdminData(null);
        setOfflineSession(false);
      }
      try {
        if (user) {
          const { admin, fromCache } = await readVerifiedAdmin(user.uid, user);
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
