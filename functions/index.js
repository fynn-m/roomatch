/* eslint-disable max-len */
const {onDocumentCreated} = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

// ========= NEUE KONFIGURATIONEN & REGELN =========
const MAX_WG_SIZE = 3;
const MIN_PAIR_SCORE = 7; // Jedes Paar in einer 3er-WG muss diesen Score erreichen

exports.runMatchingOnNewUser = onDocumentCreated("users/{userId}", async (event) => {
  console.log("Neuer Nutzer erkannt. Starte das neue Matching 'Beste-Gruppe-Zuerst'.");

  // 1. ALLE NUTZERDATEN HOLEN (wie bisher)
  const usersSnapshot = await db.collection("users").get();
  const allUsers = [];
  const userIdToNameMap = new Map();
  usersSnapshot.forEach((doc) => {
    const userData = doc.data();
    allUsers.push({id: doc.id, ...userData});
    userIdToNameMap.set(doc.id, userData.name);
  });

  if (allUsers.length < 2) {
    return null;
  }
  console.log(`Verarbeite ${allUsers.length} Nutzer.`);

  // 2. PAAR-SCORES BERECHNEN (wie bisher)
  const scores = {};
  for (let i = 0; i < allUsers.length; i++) {
    for (let j = i + 1; j < allUsers.length; j++) {
      const userA = allUsers[i];
      const userB = allUsers[j];
      let currentScore = 0;
      let isVeto = false;
      const answersA = userA.answers.reduce((acc, ans) => ({...acc, [ans.questionId]: ans.answer}), {});
      const answersB = userB.answers.reduce((acc, ans) => ({...acc, [ans.questionId]: ans.answer}), {});
      const allQuestionIds = Object.keys(answersA);

      for (const qId of allQuestionIds) {
        const answerA = answersA[qId];
        const answerB = answersB[qId];
        if ((answerA === "like" && answerB === "dislike") || (answerA === "dislike" && answerB === "like")) {
          isVeto = true;
          break;
        }
        if (answerA === "answerB") currentScore += 2;
        else if (answerA === "egal" || answerB === "egal") currentScore += 1;
      }
      if (!isVeto) {
        const pairKey = [userA.id, userB.id].sort().join("-");
        scores[pairKey] = currentScore;
      }
    }
  }

  // ========= NEUER ALGORITHMUS: POTENZIELLE WGs FINDEN & BEWERTEN =========
  const potentialWgs = [];

  // 3a. Alle gültigen 3er-WGs finden
  for (let i = 0; i < allUsers.length; i++) {
    for (let j = i + 1; j < allUsers.length; j++) {
      for (let k = j + 1; k < allUsers.length; k++) {
        const userA = allUsers[i];
        const userB = allUsers[j];
        const userC = allUsers[k];

        const pairKeyAB = [userA.id, userB.id].sort().join("-");
        const pairKeyAC = [userA.id, userC.id].sort().join("-");
        const pairKeyBC = [userB.id, userC.id].sort().join("-");

        const scoreAB = scores[pairKeyAB];
        const scoreAC = scores[pairKeyAC];
        const scoreBC = scores[pairKeyBC];
        
        // Qualitäts-Check: Nur wenn alle Paare existieren (kein Veto) UND den Mindest-Score erreichen
        if (scoreAB !== undefined && scoreAC !== undefined && scoreBC !== undefined &&
            scoreAB >= MIN_PAIR_SCORE && scoreAC >= MIN_PAIR_SCORE && scoreBC >= MIN_PAIR_SCORE) {
          potentialWgs.push({
            members: [userA.id, userB.id, userC.id],
            totalScore: scoreAB + scoreAC + scoreBC,
          });
        }
      }
    }
  }

  // 3b. Alle gültigen 2er-WGs hinzufügen
  for (const pairKey in scores) {
    if (scores.hasOwnProperty(pairKey)) {
      potentialWgs.push({
        members: pairKey.split("-"),
        totalScore: scores[pairKey],
      });
    }
  }

  // 4. Sortiere alle potenziellen WGs nach dem höchsten Gesamt-Score
  potentialWgs.sort((a, b) => b.totalScore - a.totalScore);

  // 5. FINALE WGs BILDEN (Beste-Gruppe-Zuerst)
  const finalWgs = [];
  const matchedUserIds = new Set();

  for (const wg of potentialWgs) {
    // Prüfen, ob ein Mitglied dieser WG schon vergeben ist
    const isAlreadyMatched = wg.members.some((memberId) => matchedUserIds.has(memberId));

    if (!isAlreadyMatched) {
      // Super, diese WG wird gebildet!
      finalWgs.push(wg);
      // Alle Mitglieder als "vergeben" markieren
      wg.members.forEach((memberId) => matchedUserIds.add(memberId));
    }
  }

  // 6. ÜBRIGGEBLIEBENE in Einzel-WGs stecken
  const unmatchedUsers = allUsers.filter((u) => !matchedUserIds.has(u.id));
  unmatchedUsers.forEach((user) => {
    finalWgs.push({
      members: [user.id],
      totalScore: 0, // Einzelpersonen haben keinen WG-Score
    });
  });
  
  // 7. FINALES ERGEBNIS mit Namen anreichern und speichern
  const wgsWithNames = finalWgs.map((wg) => ({
    totalScore: wg.totalScore,
    members: wg.members.map((id) => ({
      id: id,
      name: userIdToNameMap.get(id),
    })),
  }));

  // Alte Ergebnisse löschen
  const oldWgsSnapshot = await db.collection("wgs").get();
  const deletePromises = [];
  oldWgsSnapshot.forEach((doc) => deletePromises.push(doc.ref.delete()));
  await Promise.all(deletePromises);

  // Neue Ergebnisse speichern
  const savePromises = [];
  wgsWithNames.forEach((wg) => savePromises.push(db.collection("wgs").add(wg)));
  await Promise.all(savePromises);

  console.log("Matching (Beste-Gruppe-Zuerst) abgeschlossen. WGs wurden geschrieben.");
  return null;
});