/* eslint-disable max-len */
const {onDocumentCreated} = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

// ========= KONFIGURATION & REGELN =========
const MAX_WG_SIZE = 3;
// ANGEPASST: Wir senken den Mindestscore, da es jetzt negative Punkte gibt.
const MIN_PAIR_SCORE = 4;

exports.runMatchingOnNewUser = onDocumentCreated("users/{userId}", async (event) => {
  console.log("Neuer Nutzer erkannt. Starte Matching ohne Veto, mit Malus-Punkten.");

  // 1. DATEN HOLEN (unverändert)
  const usersSnapshot = await db.collection("users").get();
  const allUsers = [];
  const userIdToNameMap = new Map();
  usersSnapshot.forEach((doc) => {
    const userData = doc.data();
    allUsers.push({id: doc.id, ...userData});
    userIdToNameMap.set(doc.id, userData.name);
  });

  if (allUsers.length < 2) return null;
  console.log(`Verarbeite ${allUsers.length} Nutzer.`);

  // 2. PAAR-SCORES BERECHNEN (ANGEPASSTE LOGIK)
  const scores = {};
  for (let i = 0; i < allUsers.length; i++) {
    for (let j = i + 1; j < allUsers.length; j++) {
      const userA = allUsers[i];
      const userB = allUsers[j];
      let currentScore = 0;

      const answersA = userA.answers.reduce((acc, ans) => ({...acc, [ans.questionId]: ans.answer}), {});
      const answersB = userB.answers.reduce((acc, ans) => ({...acc, [ans.questionId]: ans.answer}), {});
      const allQuestionIds = Object.keys(answersA);

      // === NEUE SCORING-LOGIK OHNE VETO ===
      for (const qId of allQuestionIds) {
        const answerA = answersA[qId];
        const answerB = answersB[qId];

        if ((answerA === "like" && answerB === "dislike") || (answerA === "dislike" && answerB === "like")) {
          // Regel: Statt Veto gibt es -3 Malus-Punkte
          currentScore -= 3;
        } else if (answerA === answerB) {
          // Regel: Geteilte Meinung gibt +2 Punkte
          currentScore += 2;
        } else if (answerA === "egal" || answerB === "egal") {
          // Regel: Einer ist tolerant, gibt +1 Punkt
          currentScore += 1;
        }
      }
      // Der Score wird immer gespeichert, da es kein Veto mehr gibt.
      const pairKey = [userA.id, userB.id].sort().join("-");
      scores[pairKey] = currentScore;
    }
  }

  // 3. POTENZIELLE WGs FINDEN (unverändert, nutzt jetzt aber die neuen Scores)
  const potentialWgs = [];
  // 3a. Alle gültigen 3er-WGs
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

        // Qualitäts-Check mit dem neuen, niedrigeren Mindest-Score
        if (scoreAB >= MIN_PAIR_SCORE && scoreAC >= MIN_PAIR_SCORE && scoreBC >= MIN_PAIR_SCORE) {
          potentialWgs.push({
            members: [userA.id, userB.id, userC.id],
            totalScore: scoreAB + scoreAC + scoreBC,
          });
        }
      }
    }
  }
  // 3b. Alle 2er-WGs
  for (const pairKey in scores) {
    if (scores.hasOwnProperty(pairKey)) {
      potentialWgs.push({
        members: pairKey.split("-"),
        totalScore: scores[pairKey],
      });
    }
  }

  // 4. & 5. & 6. & 7. WG-BILDUNG & SPEICHERN (unverändert)
  potentialWgs.sort((a, b) => b.totalScore - a.totalScore);
  const finalWgs = [];
  const matchedUserIds = new Set();
  for (const wg of potentialWgs) {
    const isAlreadyMatched = wg.members.some((memberId) => matchedUserIds.has(memberId));
    if (!isAlreadyMatched) {
      finalWgs.push(wg);
      wg.members.forEach((memberId) => matchedUserIds.add(memberId));
    }
  }
  const unmatchedUsers = allUsers.filter((u) => !matchedUserIds.has(u.id));
  unmatchedUsers.forEach((user) => {
    finalWgs.push({ members: [user.id], totalScore: 0 });
  });
  const wgsWithNames = finalWgs.map((wg) => ({
    totalScore: wg.totalScore,
    members: wg.members.map((id) => ({ id: id, name: userIdToNameMap.get(id) })),
  }));
  const oldWgsSnapshot = await db.collection("wgs").get();
  const deletePromises = [];
  oldWgsSnapshot.forEach((doc) => deletePromises.push(doc.ref.delete()));
  await Promise.all(deletePromises);
  const savePromises = [];
  wgsWithNames.forEach((wg) => savePromises.push(db.collection("wgs").add(wg)));
  await Promise.all(savePromises);

  console.log("Matching (ohne Veto, mit Malus) abgeschlossen.");
  return null;
});