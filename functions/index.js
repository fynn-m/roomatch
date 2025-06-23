/* eslint-disable max-len */
const {onDocumentCreated} = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

const MAX_WG_SIZE = 3;
const MIN_PAIR_SCORE = 4;

exports.runMatchingOnNewUser = onDocumentCreated("users/{userId}", async (event) => {
  console.log("Matching gestartet (ohne Veto, mit Score-Debug)...");

  // 1. & 2. DATEN HOLEN & PAAR-SCORES BERECHNEN (unverändert)
  const usersSnapshot = await db.collection("users").get();
  const allUsers = [];
  const userIdToNameMap = new Map();
  usersSnapshot.forEach((doc) => {
    const userData = doc.data();
    allUsers.push({id: doc.id, ...userData});
    userIdToNameMap.set(doc.id, userData.name);
  });
  if (allUsers.length < 2) return null;
  const scores = {};
  for (let i = 0; i < allUsers.length; i++) {
    for (let j = i + 1; j < allUsers.length; j++) {
      const userA = allUsers[i];
      const userB = allUsers[j];
      let currentScore = 0;
      const answersA = userA.answers.reduce((acc, ans) => ({...acc, [ans.questionId]: ans.answer}), {});
      const answersB = userB.answers.reduce((acc, ans) => ({...acc, [ans.questionId]: ans.answer}), {});
      const allQuestionIds = Object.keys(answersA);
      for (const qId of allQuestionIds) {
        const answerA = answersA[qId];
        const answerB = answersB[qId];
        if ((answerA === "like" && answerB === "dislike") || (answerA === "dislike" && answerB === "like")) {
          currentScore -= 3;
        } else if (answerA === answerB) {
          currentScore += 2;
        } else if (answerA === "egal" || answerB === "egal") {
          currentScore += 1;
        }
      }
      const pairKey = [userA.id, userB.id].sort().join("-");
      scores[pairKey] = currentScore;
    }
  }

  // 3. bis 6. WG-BILDUNG (unverändert)
  const potentialWgs = [];
  for (let i = 0; i < allUsers.length; i++) {
    for (let j = i + 1; j < allUsers.length; j++) {
      for (let k = j + 1; k < allUsers.length; k++) {
        const userA = allUsers[i]; const userB = allUsers[j]; const userC = allUsers[k];
        const pairKeyAB = [userA.id, userB.id].sort().join("-");
        const pairKeyAC = [userA.id, userC.id].sort().join("-");
        const pairKeyBC = [userB.id, userC.id].sort().join("-");
        const scoreAB = scores[pairKeyAB]; const scoreAC = scores[pairKeyAC]; const scoreBC = scores[pairKeyBC];
        if (scoreAB >= MIN_PAIR_SCORE && scoreAC >= MIN_PAIR_SCORE && scoreBC >= MIN_PAIR_SCORE) {
          potentialWgs.push({
            members: [userA.id, userB.id, userC.id],
            totalScore: scoreAB + scoreAC + scoreBC,
          });
        }
      }
    }
  }
  for (const pairKey in scores) {
    if (scores.hasOwnProperty(pairKey)) {
      potentialWgs.push({ members: pairKey.split("-"), totalScore: scores[pairKey] });
    }
  }
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

  // 7. FINALES ERGEBNIS mit Namen anreichern und speichern (unverändert)
  const wgsWithNames = finalWgs.map((wg) => ({
    totalScore: wg.totalScore,
    members: wg.members.map((id) => ({ id: id, name: userIdToNameMap.get(id) })),
  }));
  const oldWgsSnapshot = await db.collection("wgs").get();
  const deletePromisesWgs = [];
  oldWgsSnapshot.forEach((doc) => deletePromisesWgs.push(doc.ref.delete()));
  await Promise.all(deletePromisesWgs);
  const savePromisesWgs = [];
  wgsWithNames.forEach((wg) => savePromisesWgs.push(db.collection("wgs").add(wg)));
  await Promise.all(savePromisesWgs);
  console.log("Matching abgeschlossen. WGs wurden geschrieben.");
  
  // ======================================================
  // NEU: Speichere die Score-Matrix für Debugging-Zwecke
  // ======================================================
  const readableScores = Object.keys(scores).map((pairKey) => {
    const [id1, id2] = pairKey.split("-");
    return {
      pair: `${userIdToNameMap.get(id1)} - ${userIdToNameMap.get(id2)}`,
      score: scores[pairKey],
    };
  }).sort((a, b) => b.score - a.score); // Sortieren für bessere Übersicht

  // Wir überschreiben immer dasselbe Dokument, um die Collection nicht vollzumüllen.
  const scoresDocRef = db.collection("debug_scores").doc("latest_run");
  await scoresDocRef.set({
    last_updated: new Date(),
    scores: readableScores,
  });
  console.log("Debug-Scores wurden in 'debug_scores/latest_run' gespeichert.");

  return null;
});