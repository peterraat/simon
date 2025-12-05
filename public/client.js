const socket = io();

// ===== UI elements =====
const landingScreen = document.getElementById("landing-screen");
const lobbyScreen = document.getElementById("lobby-screen");
const gameScreen = document.getElementById("game-screen");
const gameoverScreen = document.getElementById("gameover-screen");

const singleModeBtn = document.getElementById("single-mode-btn");
const multiModeBtn = document.getElementById("multi-mode-btn");

const singleForm = document.getElementById("single-form");
const hostForm = document.getElementById("host-form");
const joinForm = document.getElementById("join-form");

const singleNameInput = document.getElementById("single-name-input");
const singleDifficultySelect = document.getElementById(
  "single-difficulty-select"
);
const startSingleBtn = document.getElementById("start-single-btn");

const hostNameInput = document.getElementById("host-name-input");
const difficultySelect = document.getElementById("difficulty-select");
const startLobbyBtn = document.getElementById("start-lobby-btn");

const joinInfo = document.getElementById("join-info");
const joinNameInput = document.getElementById("join-name-input");
const joinLobbyBtn = document.getElementById("join-lobby-btn");

const landingError = document.getElementById("landing-error");

const lobbyDifficulty = document.getElementById("lobby-difficulty");
const lobbyCountdown = document.getElementById("lobby-countdown");
const lobbyPlayersList = document.getElementById("lobby-players");

const roundInfo = document.getElementById("round-info");
const statusMessage = document.getElementById("status-message");
const gamePlayersList = document.getElementById("game-players");

const pads = Array.from(document.querySelectorAll(".pad"));
const simonImage = document.getElementById("simon-image");

const countdownOverlay = document.getElementById("countdown-overlay");
const countdownNumberEl = document.getElementById("countdown-number");

const leaderboardList = document.getElementById("leaderboard-list");
const backToHomeBtn = document.getElementById("back-to-home-btn");

const eliminationPill = document.getElementById("elimination-pill");
const giveUpBtn = document.getElementById("give-up-btn");

// ===== Local state =====
const COLORS = ["green", "red", "yellow", "blue"];

let mode = "single"; // "single" or "multi"

let currentRoomId = null;
let myName = "";

// multiplayer state (client side only)
let inputEnabled = false;
let playingSequence = false;

// single-player state
const singleDifficultyConfig = {
  easy: { onTime: 800, offTime: 400 },
  medium: { onTime: 600, offTime: 300 },
  hard: { onTime: 400, offTime: 200 },
  insane: { onTime: 300, offTime: 150 }
};

let spDifficulty = "easy";
let spSequence = [];
let spRound = 0;
let spInputIndex = 0;
let spGameOver = false;

// fixed tone length so sound feels consistent on all speeds
const BASE_TONE_DURATION_MS = 260;

// ===== Image mapping for lights =====
const IMAGE_MAP = {
  green: "/images/02_simon_green_light_on.png",
  red: "/images/03_simon_red_light_on.png",
  blue: "/images/04_simon_blue_lights_on.png",
  yellow: "/images/05_simon_yellow_lights_on.png",
  off: "/images/01_simon_no_lights.png"
};

// Preload all images into memory to avoid lag on first flash
const preloadedImages = {};
Object.values(IMAGE_MAP).forEach((src) => {
  const img = new Image();
  img.src = src;
  preloadedImages[src] = img;
});

// ===== External audio files =====
// Make sure these exist in /public/media/
const countdownAudio = new Audio("/media/321.mp3");
const wrongAudio = new Audio("/media/wrong_sound_effect.mp3");

// ===== Web Audio for tones =====
const AudioContext = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;

const TONE_MAP = {
  red: 440, // A4
  yellow: 554, // C#5
  green: 659, // E5
  blue: 330 // E4
};

function ensureAudioContext() {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
}

function playTone(color, durationMs) {
  const freq = TONE_MAP[color];
  if (!freq) return;

  ensureAudioContext();

  const osc = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();

  osc.type = "sine";
  osc.frequency.value = freq;

  const now = audioCtx.currentTime;
  gainNode.gain.setValueAtTime(0.0001, now);
  gainNode.gain.exponentialRampToValueAtTime(0.3, now + 0.01);
  gainNode.gain.exponentialRampToValueAtTime(
    0.0001,
    now + durationMs / 1000 - 0.02
  );

  osc.connect(gainNode).connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + durationMs / 1000);
}

// Wrong answer sound using external file
function playWrongSfx() {
  try {
    wrongAudio.currentTime = 0;
    wrongAudio.play();
  } catch (e) {
    console.warn("Could not play wrong sound effect:", e);
  }
}

// ===== helpers =====
function showScreen(target) {
  [landingScreen, lobbyScreen, gameScreen, gameoverScreen].forEach((s) =>
    s.classList.remove("active")
  );
  target.classList.add("active");
}

function setPadInteractivity(enabled) {
  inputEnabled = enabled;
  pads.forEach((pad) => {
    if (enabled) {
      pad.classList.remove("disabled");
    } else {
      pad.classList.add("disabled");
    }
  });
}

// Visual duration can be different from tone duration.
// - visualDuration: how long the light stays on
// - tone: fixed BASE_TONE_DURATION_MS so it always sounds full
function flashPad(color, visualDurationOverride) {
  const visualDuration = visualDurationOverride || BASE_TONE_DURATION_MS;

  simonImage.src = IMAGE_MAP[color];
  playTone(color, BASE_TONE_DURATION_MS);

  setTimeout(() => {
    simonImage.src = IMAGE_MAP.off;
  }, visualDuration);
}

// Plays a normal sequence (for actual round play)
function playSequence(sequence, onTime, offTime) {
  playingSequence = true;
  setPadInteractivity(false);
  statusMessage.textContent = "Watch the pattern…";

  sequence.forEach((color, index) => {
    const t = index * (onTime + offTime);
    setTimeout(() => {
      flashPad(color, onTime); // visual speed = onTime, sound fixed
    }, t);
  });

  const totalTime = sequence.length * (onTime + offTime);
  setTimeout(() => {
    playingSequence = false;
    setPadInteractivity(true);
    statusMessage.textContent = "Your turn! Repeat the pattern.";
  }, totalTime + 50);
}

// Plays a sequence only for review (no input re-enabled afterwards)
function playSequencePassive(sequence, onTime, offTime, done) {
  playingSequence = true;
  setPadInteractivity(false);
  statusMessage.textContent = "Watch the correct pattern…";

  sequence.forEach((color, index) => {
    const t = index * (onTime + offTime);
    setTimeout(() => {
      flashPad(color, onTime);
    }, t);
  });

  const totalTime = sequence.length * (onTime + offTime);
  setTimeout(() => {
    playingSequence = false;
    if (typeof done === "function") done();
  }, totalTime + 60);
}

// 3-2-1 countdown overlay, then callback (e.g. start first round)
function runCountdown(onDone) {
  if (!countdownOverlay || !countdownNumberEl) {
    if (onDone) onDone();
    return;
  }

  let count = 3;
  countdownNumberEl.textContent = count.toString();
  countdownOverlay.classList.remove("hidden");

  // Play 3-2-1 sound once
  try {
    countdownAudio.currentTime = 0;
    countdownAudio.play();
  } catch (e) {
    console.warn("Could not play countdown audio:", e);
  }

  setTimeout(() => {
    count = 2;
    countdownNumberEl.textContent = count.toString();
  }, 1000);

  setTimeout(() => {
    count = 1;
    countdownNumberEl.textContent = count.toString();
  }, 2000);

  setTimeout(() => {
    // Hide overlay BEFORE the game starts
    countdownOverlay.classList.add("hidden");
    countdownNumberEl.textContent = "";

    // Small pause so they "feel" the start
    if (typeof onDone === "function") {
      setTimeout(() => {
        onDone();
      }, 500);
    }
  }, 3000);
}

// Show "Peter is out of the game (Round 5)" pill at the bottom
function showEliminationPill(name, roundsSurvived) {
  if (!eliminationPill) return;

  const roundText =
    typeof roundsSurvived === "number" && roundsSurvived > 0
      ? ` (Round ${roundsSurvived})`
      : "";

  eliminationPill.textContent = `${name} is out of the game${roundText}`;

  eliminationPill.classList.remove("hidden");
  // restart animation
  eliminationPill.style.animation = "none";
  void eliminationPill.offsetWidth; // force reflow
  eliminationPill.style.animation = "";
  eliminationPill.style.animation = "pillSlideUp 0.4s ease-out";

  setTimeout(() => {
    eliminationPill.classList.add("hidden");
  }, 2000);
}

// ===== mode switching =====
function setMode(newMode) {
  mode = newMode;
  landingError.textContent = "";

  if (newMode === "single") {
    singleModeBtn.classList.add("mode-btn-active");
    multiModeBtn.classList.remove("mode-btn-active");

    singleForm.classList.remove("hidden");
    hostForm.classList.add("hidden");
    joinForm.classList.add("hidden");
  } else {
    singleModeBtn.classList.remove("mode-btn-active");
    multiModeBtn.classList.add("mode-btn-active");

    singleForm.classList.add("hidden");
    // ask server if lobby exists
    socket.emit("checkActiveLobby");
  }
}

// ===== Single-player logic =====
function startSingleGameWithCountdown(name, difficulty) {
  mode = "single";
  myName = name || "You";
  spDifficulty = difficulty;
  spSequence = [];
  spRound = 0;
  spInputIndex = 0;
  spGameOver = false;

  showScreen(gameScreen);
  gamePlayersList.innerHTML = "";
  const li = document.createElement("li");
  li.textContent = `🟢 ${myName}`;
  gamePlayersList.appendChild(li);

  setPadInteractivity(false);
  simonImage.src = IMAGE_MAP.off;

  // Run the 3-2-1, then start the first round
  runCountdown(() => {
    nextSingleRound();
  });
}

function nextSingleRound() {
  if (spGameOver) return;

  spRound += 1;
  roundInfo.textContent = `Round ${spRound}`;
  statusMessage.textContent = `Round ${spRound}. Watch the pattern…`;

  const nextColor = COLORS[Math.floor(Math.random() * COLORS.length)];
  spSequence.push(nextColor);

  const cfg =
    singleDifficultyConfig[spDifficulty] || singleDifficultyConfig.easy;
  playSequence(spSequence, cfg.onTime, cfg.offTime);

  const totalTime = spSequence.length * (cfg.onTime + cfg.offTime);
  setTimeout(() => {
    if (!spGameOver) {
      spInputIndex = 0;
      setPadInteractivity(true);
      statusMessage.textContent = "Your turn! Repeat the pattern.";
    }
  }, totalTime + 60);
}

function handleSingleInput(color) {
  if (spGameOver) return;
  const expected = spSequence[spInputIndex];

  if (color !== expected) {
    // WRONG: end game, play wrong sound, replay full correct sequence, then show game over
    spGameOver = true;
    setPadInteractivity(false);
    statusMessage.textContent = "Wrong! Watch the correct pattern.";
    playWrongSfx();

    const cfg =
      singleDifficultyConfig[spDifficulty] || singleDifficultyConfig.easy;

    playSequencePassive(spSequence, cfg.onTime, cfg.offTime, () => {
      leaderboardList.innerHTML = "";
      const li = document.createElement("li");
      const survived = Math.max(spRound - 1, 0);
      li.textContent = `${myName} — survived ${survived} round${
        survived === 1 ? "" : "s"
      }`;
      leaderboardList.appendChild(li);

      setTimeout(() => {
        showScreen(gameoverScreen);
      }, 600);
    });

    return;
  }

  // Correct step
  spInputIndex += 1;
  if (spInputIndex === spSequence.length) {
    statusMessage.textContent = "Round complete!";
    setPadInteractivity(false);
    setTimeout(() => {
      nextSingleRound();
    }, 600);
  }
}

// Single-player "Give Up"
function handleSingleGiveUp() {
  if (spGameOver) return;
  spGameOver = true;
  setPadInteractivity(false);
  statusMessage.textContent = "You gave up!";

  const roundDisplay = spRound > 0 ? spRound : 1;

  leaderboardList.innerHTML = "";
  const li = document.createElement("li");
  li.textContent = `${myName} — gave up (Round ${roundDisplay})`;
  leaderboardList.appendChild(li);

  setTimeout(() => {
    showScreen(gameoverScreen);
  }, 600);
}

// ===== initial setup =====
showScreen(landingScreen);
setMode("single");

// ===== event listeners =====
singleModeBtn.addEventListener("click", () => setMode("single"));
multiModeBtn.addEventListener("click", () => setMode("multi"));

startSingleBtn.addEventListener("click", () => {
  const name = singleNameInput.value.trim();
  const difficulty = singleDifficultySelect.value;
  startSingleGameWithCountdown(name, difficulty);
});

startLobbyBtn.addEventListener("click", () => {
  landingError.textContent = "";
  const name = hostNameInput.value.trim() || "Host";
  const difficulty = difficultySelect.value;
  myName = name;
  socket.emit("createLobby", { name, difficulty });
});

joinLobbyBtn.addEventListener("click", () => {
  landingError.textContent = "";
  const name = joinNameInput.value.trim() || "Player";
  myName = name;
  socket.emit("joinLobby", { name });
});

// Give Up button (single + multi)
giveUpBtn.addEventListener("click", () => {
  if (mode === "single") {
    handleSingleGiveUp();
  } else {
    socket.emit("giveUp");
  }
});

// Pad clicks (both modes)
pads.forEach((pad) => {
  pad.addEventListener("click", () => {
    if (!inputEnabled || playingSequence) return;

    const color = pad.dataset.color;

    // visual duration for clicks (sound stays fixed)
    flashPad(color, 220);

    if (mode === "single") {
      handleSingleInput(color);
    } else {
      socket.emit("playerInput", { color });
    }
  });
});

backToHomeBtn.addEventListener("click", () => {
  window.location.reload();
});

// ===== Socket events (multiplayer only) =====
socket.on("lobbyStatus", (payload) => {
  if (mode !== "multi") return;

  if (payload.hasActiveLobby) {
    hostForm.classList.add("hidden");
    joinForm.classList.remove("hidden");
    showScreen(landingScreen);

    const label = payload.difficultyLabel || payload.difficulty;
    joinInfo.textContent = `An active lobby is waiting. Difficulty: ${label}. Game starts in about ${payload.timeLeft}s. Enter your name to join.`;
  } else {
    hostForm.classList.remove("hidden");
    joinForm.classList.add("hidden");
    showScreen(landingScreen);
  }
});

socket.on("errorMessage", (msg) => {
  if (mode !== "multi") {
    landingError.textContent = msg;
  }
});

socket.on("lobbyCreated", ({ roomId, difficulty, difficultyLabel }) => {
  if (mode !== "multi") return;
  currentRoomId = roomId;
  lobbyDifficulty.textContent = difficultyLabel || difficulty;
  lobbyCountdown.textContent = "30";
  lobbyPlayersList.innerHTML = "";
  showScreen(lobbyScreen);
});

socket.on("joinedLobby", ({ roomId, difficulty, difficultyLabel }) => {
  if (mode !== "multi") return;
  currentRoomId = roomId;
  lobbyDifficulty.textContent = difficultyLabel || difficulty;
  lobbyPlayersList.innerHTML = "";
  showScreen(lobbyScreen);
});

socket.on(
  "lobbyUpdate",
  ({ roomId, difficulty, difficultyLabel, timeLeft, players }) => {
    if (mode !== "multi") return;
    if (!currentRoomId) currentRoomId = roomId;
    lobbyDifficulty.textContent = difficultyLabel || difficulty;
    lobbyCountdown.textContent = timeLeft.toString();

    lobbyPlayersList.innerHTML = "";
    players.forEach((p) => {
      const li = document.createElement("li");
      li.textContent = p.name;
      lobbyPlayersList.appendChild(li);
    });
  }
);

socket.on("gameStart", ({ difficultyLabel }) => {
  if (mode !== "multi") return;

  showScreen(gameScreen);
  setPadInteractivity(false);
  roundInfo.textContent = "Round 1";
  statusMessage.textContent = `Difficulty: ${difficultyLabel}. Get ready…`;
  gamePlayersList.innerHTML = "";
  simonImage.src = IMAGE_MAP.off;

  // Show the same 3-2-1 countdown in multiplayer
  runCountdown(() => {
    statusMessage.textContent = "Watch the pattern…";
  });
});

socket.on("roundStart", ({ round, sequenceLength }) => {
  if (mode !== "multi") return;
  roundInfo.textContent = `Round ${round}`;
  statusMessage.textContent = `Round ${round}. Watch ${sequenceLength} step${
    sequenceLength === 1 ? "" : "s"
  }…`;
});

socket.on("playSequence", ({ sequence, onTime, offTime }) => {
  if (mode !== "multi") return;
  playSequence(sequence, onTime, offTime);
});

socket.on("startInputPhase", () => {
  if (mode !== "multi") return;
  if (!playingSequence) {
    setPadInteractivity(true);
    statusMessage.textContent = "Your turn! Repeat the pattern.";
  }
});

socket.on("inputResult", ({ success, message }) => {
  if (mode !== "multi") return;

  if (!success) {
    playWrongSfx();
  }

  statusMessage.textContent = message || (success ? "Good job!" : "Wrong!");
});

// show elimination pill when server says someone is out
socket.on("playerEliminated", ({ name, roundsSurvived }) => {
  showEliminationPill(name, roundsSurvived);
});

socket.on("roundSummary", ({ summary }) => {
  if (mode !== "multi") return;

  gamePlayersList.innerHTML = "";
  summary.forEach((p) => {
    const li = document.createElement("li");
    const icon = p.alive ? "🟢" : "🔴";
    li.textContent = `${icon} ${p.name} — survived ${
      p.roundsSurvived
    } round${p.roundsSurvived === 1 ? "" : "s"}`;
    gamePlayersList.appendChild(li);
  });

  setPadInteractivity(false);
});

socket.on("gameOver", ({ leaderboard }) => {
  if (mode !== "multi") return;

  leaderboardList.innerHTML = "";
  leaderboard.forEach((p, idx) => {
    const li = document.createElement("li");
    const medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : "⬤";
    li.textContent = `${medal} ${p.name} — survived ${
      p.roundsSurvived
    } round${p.roundsSurvived === 1 ? "" : "s"}`;
    leaderboardList.appendChild(li);
  });

  showScreen(gameoverScreen);
});
