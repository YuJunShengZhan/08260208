
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getDatabase,
  ref,
  set,
  onValue,
  get,
  push,
  remove,
  update,
  onDisconnect,
  runTransaction
}
from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyCnb0mN8CFMTMPRp-2Z-7LMU2ekw6njybc",
  authDomain: "yujunshengzhan.firebaseapp.com",
  databaseURL: "https://yujunshengzhan-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "yujunshengzhan",
  storageBucket: "yujunshengzhan.firebasestorage.app",
  messagingSenderId: "808547698488",
  appId: "1:808547698488:web:5b35ff76d7db5ee613e3cd",
  measurementId: "G-0MJ3KQ51J8"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

window._fb = {
  db,
  ref,
  set,
  onValue,
  get,
  push,
  remove,
  update,
  onDisconnect,
  runTransaction
};
window.dispatchEvent(new Event('firebaseReady'));
