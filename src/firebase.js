// Importiere die Funktionen, die wir von Firebase brauchen
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// Dein persönlicher Konfigurations-Block von der Firebase Webseite
const firebaseConfig = {
    apiKey: "AIzaSyBKAxvqzQTwOm46DJoEM9KQKt1jwAp3Oio",
    authDomain: "roomatch-66d21.firebaseapp.com",
    projectId: "roomatch-66d21",
    storageBucket: "roomatch-66d21.firebasestorage.app",
    messagingSenderId: "565256531652",
    appId: "1:565256531652:web:446d6df417609a94c82391"
};

// Initialisiere die Firebase-App mit deiner Konfiguration
const app = initializeApp(firebaseConfig);

// Exportiere die Firestore-Datenbank-Instanz, damit wir sie in anderen Dateien nutzen können
export const db = getFirestore(app);