// File: js/firebase-config.js

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAmlSol_3Wmfs53A98sEdEm-uSaByGzo28",
  authDomain: "tournament-sys.firebaseapp.com",
  projectId: "tournament-sys",
  storageBucket: "tournament-sys.firebasestorage.app",
  messagingSenderId: "519201807872",
  appId: "1:519201807872:web:9054f639cbd8190d9ec2e5"
};

const app = initializeApp(firebaseConfig);

// Kita 'export' db dan auth supaya file lain bisa meminjamnya
export const db = getFirestore(app);
export const auth = getAuth(app);
