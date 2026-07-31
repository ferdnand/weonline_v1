/**
 * AuthService implementation backed by Firebase Auth.
 *
 * Kept so the app can flip back to Firebase by editing src/data/index.ts only.
 * Not imported while the IndexedDB backend is active, so the Firebase SDK is not
 * bundled or executed in local mode.
 */

import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged as fbOnAuthStateChanged,
  signOut as fbSignOut,
  type User as FirebaseUser,
} from 'firebase/auth';
import { auth } from '../../firebase';
import type { AuthService, AuthUser } from '../types';

function toAuthUser(u: FirebaseUser | null): AuthUser | null {
  return u ? { uid: u.uid, email: u.email, displayName: u.displayName } : null;
}

export const firebaseAuth: AuthService = {
  onAuthStateChanged(cb) {
    return fbOnAuthStateChanged(auth, (u) => cb(toAuthUser(u)));
  },
  async signInWithEmail(email, password) {
    await signInWithEmailAndPassword(auth, email, password);
  },
  async signUpWithEmail(email, password) {
    await createUserWithEmailAndPassword(auth, email, password);
  },
  async signInWithGoogle() {
    await signInWithPopup(auth, new GoogleAuthProvider());
  },
  async signOut() {
    await fbSignOut(auth);
  },
};
