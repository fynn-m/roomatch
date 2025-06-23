import { db } from './firebase.js';
import { collection, addDoc, onSnapshot, query, where, getDocs } from "firebase/firestore";

// ============== HTML ELEMENTE ===============
const startCard = document.querySelector('#start-card');
const surveyCard = document.querySelector('#survey-card');
const nameInput = document.querySelector('#name-input');
const startBtn = document.querySelector('#start-btn');
const questionTextElement = document.querySelector('#question-text');
const likeBtn = document.querySelector('#like-btn');
const egalBtn = document.querySelector('#egal-btn');
const dislikeBtn = document.querySelector('#dislike-btn');
const resultsContainer = document.querySelector('#results-container');
const h1 = document.querySelector('h1');
const resetBtn = document.querySelector('#reset-btn');

// ============== STATE-VARIABLEN ===============
const questions = [
  { id: 'q1', text: 'Die Küche wird jeden Abend aufgeräumt hinterlassen.' },
  { id: 'q2', text: 'Es gibt einen wöchentlichen Putzplan, an den sich alle halten.' },
  { id: 'q3', text: 'Regelmäßige Partys in der WG sind willkommen.' },
  { id: 'q4', text: 'Wir kochen oft und gerne zusammen.' },
  { id: 'q5', text: 'Freunde können jederzeit spontan zu Besuch kommen und auch übernachten.' },
  { id: 'q6', text: 'Unsere WG ist eher eine Zweck-WG als eine "WG-Familie".' },
  { id: 'q7', text: 'In den Gemeinschaftsräumen wird geraucht.' },
  { id: 'q8', text: 'Es leben Haustiere (z.B. Hund, Katze) in der WG.' },
  { id: 'q9', text: 'Der allgemeine Lebensmitteleinkauf ist vegetarisch/vegan.' },
  { id: 'q10', text: 'Wir legen für gemeinsame Ausgaben in eine WG-Kasse ein.' }
];

let currentQuestionIndex = 0;
let userAnswers = [];
let userName = '';

// ============== FUNKTIONEN ===============

async function isNameTaken(name) {
  const q = query(collection(db, "users"), where("name", "==", name));
  const querySnapshot = await getDocs(q);
  return !querySnapshot.empty;
}

function displayQuestion() {
  const currentQuestion = questions[currentQuestionIndex];
  questionTextElement.innerText = currentQuestion.text;
  const progressPercent = ((currentQuestionIndex + 1) / questions.length) * 100;
  document.querySelector('#progress-bar').style.width = `${progressPercent}%`;
}

function renderWgDashboard(wgs) {
  h1.innerText = "Live WG-Übersicht";
  
  if (wgs.length === 0) {
    resultsContainer.innerHTML = `<p style="margin-top: 20px;">Noch keine WGs gebildet. Sei der Erste!</p>`;
  } else {
    resultsContainer.innerHTML = wgs.map((wg, index) => {
      const validMembers = wg.members ? wg.members.filter(member => member && member.name) : [];
      return `
        <div class="wg-result-card" style="background-color: white; padding: 20px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); margin-top: 20px;">
          <h3>WG #${index + 1}</h3>
          <ul style="list-style-type: none; padding: 0;">
            ${validMembers.map(member => `<li style="font-size: 1.1rem; padding: 5px 0;">${member.name}</li>`).join('')}
          </ul>
        </div>
      `;
    }).join('');
  }
}

function listenForAllWgs() {
  const q = query(collection(db, "wgs"));
  onSnapshot(q, (snapshot) => {
    let allWgs = snapshot.docs.map(doc => doc.data());
    console.log("Unsortierte WG-Daten empfangen:", allWgs);
    
    allWgs.sort((a, b) => b.totalScore - a.totalScore);
    
    console.log("Sortierte WG-Daten:", allWgs);
    renderWgDashboard(allWgs);
  });
}

async function finishSurveyAndSave() {
  // Verstecke die Umfrage und zeige eine Wartemeldung
  surveyCard.classList.add('hidden');
  resultsContainer.innerHTML = `<p>Danke, ${userName}! Deine Antworten werden verarbeitet...</p>`;

  try {
    await addDoc(collection(db, "users"), {
      name: userName,
      answers: userAnswers,
      createdAt: new Date()
    });
    // KORREKTUR: Wir zeigen jetzt den Neustart-Button an, anstatt der Start-Karte.
    // Der Listener kümmert sich um die Anzeige der Ergebnisse.
    resetBtn.classList.remove('hidden');

  } catch (e) {
    console.error("Fehler beim Speichern:", e);
    resultsContainer.innerHTML = `<p>Ups, da ist etwas schiefgelaufen.</p>`;
  }
}

function handleAnswer(answer) {
  userAnswers.push({ 
    questionId: questions[currentQuestionIndex].id, 
    answer: answer 
  });
  currentQuestionIndex++;
  
  if (currentQuestionIndex < questions.length) {
    displayQuestion();
  } else {
    finishSurveyAndSave();
  }
}

/**
 * Setzt die App in ihren definierten Startzustand.
 */
function setInitialState() {
  h1.innerText = "Live WG-Übersicht";
  surveyCard.classList.add('hidden');
  resetBtn.classList.add('hidden');
  startCard.classList.remove('hidden');
  
  nameInput.value = '';
  startBtn.disabled = false;
  startBtn.innerText = 'Umfrage starten';
}


// ============== EVENT LISTENER ===============

startBtn.addEventListener('click', async () => {
  const name = nameInput.value.trim();
  if (name === '') return alert('Bitte gib deinen Namen ein!');

  startBtn.disabled = true;
  startBtn.innerText = 'Prüfe Namen...';

  if (await isNameTaken(name)) {
    alert('Dieser Name ist leider schon vergeben.');
    startBtn.disabled = false;
    startBtn.innerText = 'Umfrage starten';
    return;
  }
  
  userName = name;
  
  startCard.classList.add('hidden');
  resultsContainer.innerHTML = '';
  h1.innerText = "Fragebogen";
  
  currentQuestionIndex = 0;
  userAnswers = [];
  surveyCard.classList.remove('hidden');
  displayQuestion();
});

resetBtn.addEventListener('click', () => {
    setInitialState();
});

likeBtn.addEventListener('click', () => handleAnswer('like'));
egalBtn.addEventListener('click', () => handleAnswer('egal'));
dislikeBtn.addEventListener('click', () => handleAnswer('dislike'));

// ============== INITIALISIERUNG ===============

setInitialState();
listenForAllWgs();