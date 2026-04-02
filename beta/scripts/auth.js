import { auth } from "./firebase-shared.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

export const signup = (email, pass) =>
  createUserWithEmailAndPassword(auth, email, pass);

export const login = (email, pass) =>
  signInWithEmailAndPassword(auth, email, pass);

export const logout = () => signOut(auth);

export const onUserChange = (cb) =>
  onAuthStateChanged(auth, cb);