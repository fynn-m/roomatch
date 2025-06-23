/* eslint-disable max-len */
const {onDocumentCreated} = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

exports.runMatchingOnNewUser = onDocumentCreated("users/{userId}", async (event) => {
  console.log("Neuer Nutzer erkannt. Starte das Matching...");

  const usersSnapshot = await db.collection("users").get();
  const allUsers = [];
  // NEU: Eine Map, um Namen blitzschnell per ID zu finden.
  const userIdToNameMap = new Map();

  usersSnapshot.forEach((doc) => {
    const userData = doc.data();
    allUsers.push({id: doc.id, ...userData});
    // NEU: Wir füllen die Map mit den Daten jedes Nutzers.
    userIdToNameMap.set(doc.id, userData.name);
  });

  if (allUsers.length < 2) {
    console.log("Nicht genug Nutzer zum Matchen.");
    return null;
  }
  console.log(`Hole Daten von ${allUsers.length} Nutzern.`);

  // ======================================================
  // DER MATCHING-ALGORITHMUS (Veto, Score, Gruppierung)
  // Dieser Teil bleibt exakt gleich wie bisher.
  // ======================================================
  const scores = {};
  for (let i = 0; i < allUsers.length; i++) {
    for (let j = i + 1; j < allUsers.length; j++) {
      const userA = allUsers[i];
      const userB = allUsers[j];
      const pairKey = `${userA.id}-${userB.id}`;
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
        if (answerA === answerB) currentScore += 2;
        else if (answerA === "egal" || answerB === "egal") currentScore += 1;
      }
      if (!isVeto) scores[pairKey] = currentScore;
    }
  }

  const MAX_WG_SIZE = 5;
  const wgsData = [];
  const matchedUserIds = new Set();
  const sortedPairs = Object.keys(scores).sort((a, b) => scores[b] - scores[a]);

  for (const pairKey of sortedPairs) {
    const [userAId, userBId] = pairKey.split("-");
    if (matchedUserIds.has(userAId) || matchedUserIds.has(userBId)) continue;
    const newWg = [userAId, userBId];
    matchedUserIds.add(userAId);
    matchedUserIds.add(userBId);

    while (newWg.length < MAX_WG_SIZE) {
      let bestCandidateId = null;
      let highestCandidateScore = -1;
      for (const user of allUsers) {
        if (matchedUserIds.has(user.id)) continue;
        let candidateScore = 0;
        let candidateIsCompatible = true;
        for (const memberId of newWg) {
          const memberPairKey = [user.id, memberId].sort().join("-");
          if (scores[memberPairKey] === undefined) {
            candidateIsCompatible = false;
            break;
          }
          candidateScore += scores[memberPairKey];
        }
        if (candidateIsCompatible && candidateScore > highestCandidateScore) {
          highestCandidateScore = candidateScore;
          bestCandidateId = user.id;
        }
      }
      if (bestCandidateId) {
        newWg.push(bestCandidateId);
        matchedUserIds.add(bestCandidateId);
      } else {
        break;
      }
    }
    wgsData.push({members: newWg});
  }
  const unmatchedUsers = allUsers.filter((u) => !matchedUserIds.has(u.id));
  if (unmatchedUsers.length > 0) {
    wgsData.push({members: unmatchedUsers.map((u) => u.id)});
  }
  // ======================================================
  // ENDE DES MATCHING-ALGORITHMUS
  // ======================================================

  // NEU: Wir wandeln die WG-Daten (nur IDs) in ein Format mit IDs und Namen um.
  const wgsWithNames = wgsData.map((wg) => {
    return {
      members: wg.members.map((memberId) => {
        return {
          id: memberId,
          name: userIdToNameMap.get(memberId) || "Unbekannt",
        };
      }),
    };
  });

  // Alte WG-Ergebnisse löschen
  const oldWgsSnapshot = await db.collection("wgs").get();
  const deletePromises = [];
  oldWgsSnapshot.forEach((doc) => deletePromises.push(doc.ref.delete()));
  await Promise.all(deletePromises);

  // Die neuen WGs mit Namen in die Datenbank speichern
  const savePromises = [];
  wgsWithNames.forEach((wg) => savePromises.push(db.collection("wgs").add(wg)));
  await Promise.all(savePromises);

  console.log("Matching abgeschlossen. WGs mit Namen wurden geschrieben.");
  return null;
});