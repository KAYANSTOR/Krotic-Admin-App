import { createContext, useContext, useState, useEffect } from 'react';
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
} from 'firebase/auth';
import { doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore';
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
  const [isFirstSetup, setIsFirstSetup] = useState(false);

  // Check if Admins collection is empty (first time setup)
  async function checkFirstSetup() {
    try {
      const adminsSnap = await getDocs(collection(db, 'Admins'));
      return adminsSnap.empty;
    } catch (error) {
      console.error('Error checking first setup:', error);
      return false;
    }
  }

  // Verify if a user is an admin
  async function verifyAdmin(uid) {
    try {
      const adminDoc = await getDoc(doc(db, 'Admins', uid));
      if (adminDoc.exists()) {
        return adminDoc.data();
      }
      return null;
    } catch (error) {
      console.error('Error verifying admin:', error);
      return null;
    }
  }

  // Login
  async function login(email, password) {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const admin = await verifyAdmin(userCredential.user.uid);
    if (!admin) {
      await signOut(auth);
      throw new Error('هذا الحساب ليس مسجلاً كمدير. لا يمكنك الدخول.');
    }
    setAdminData(admin);
    return userCredential;
  }

  // Logout
  async function logout() {
    setAdminData(null);
    return signOut(auth);
  }

  // Create the first admin account (initial setup)
  async function createFirstAdmin(email, password, name, phone) {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const uid = userCredential.user.uid;

    await setDoc(doc(db, 'Admins', uid), {
      uid,
      name,
      email,
      phone,
      createdAt: Date.now(),
    });

    setAdminData({ uid, name, email, phone });
    setIsFirstSetup(false);
    return userCredential;
  }

  // Create additional admin (from AdminsPage, without signing out current admin)
  async function createAdmin(email, password, name, phone) {
    const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    const uid = userCredential.user.uid;

    await setDoc(doc(db, 'Admins', uid), {
      uid,
      name,
      email,
      phone,
      createdAt: Date.now(),
    });

    // Sign out from secondary auth so it doesn't maintain state
    await secondarySignOut(secondaryAuth);
    return uid;
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const admin = await verifyAdmin(user.uid);
        if (admin) {
          setCurrentUser(user);
          setAdminData(admin);
        } else {
          // User is logged in but not an admin
          await signOut(auth);
          setCurrentUser(null);
          setAdminData(null);
        }
      } else {
        setCurrentUser(null);
        setAdminData(null);
        // Check if first setup needed
        const needsSetup = await checkFirstSetup();
        setIsFirstSetup(needsSetup);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const value = {
    currentUser,
    adminData,
    isFirstSetup,
    loading,
    login,
    logout,
    createFirstAdmin,
    createAdmin,
    verifyAdmin,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
