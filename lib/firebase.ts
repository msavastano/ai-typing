import { initializeApp, getApps } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

const useEmulators = process.env.NEXT_PUBLIC_USE_EMULATORS === 'true';

export const db = useEmulators
  ? getFirestore(app)
  : getFirestore(app, firebaseConfig.firestoreDatabaseId);

export const auth = getAuth(app);

if (useEmulators && typeof window !== 'undefined') {
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, 'localhost', 8080);
}
