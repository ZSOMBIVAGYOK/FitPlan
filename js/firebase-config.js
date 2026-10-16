// ============================================================
// firebase-config.js — Firebase inicializálás
// FitPlan Pro | CDN-alapú, GitHub Pages kompatibilis
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth }       from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore }  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey:            "AIzaSyCiT4KQNBoPI-r47zGwQVTCVV5CZBUXcJQ",
  authDomain:        "zsombor-etrend.firebaseapp.com",
  projectId:         "zsombor-etrend",
  storageBucket:     "zsombor-etrend.firebasestorage.app",
  messagingSenderId: "487266487659",
  appId:             "1:487266487659:web:bf2a366a178ffc02af102e",
  measurementId:     "G-YDD1SE90LE"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db   = getFirestore(app);
