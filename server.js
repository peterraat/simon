const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve public folder
app.use(express.static(path.join(__dirname, "public")));

// ----- Game state -----

const rooms = {};

const COLORS = ["green", "red", "yellow", "blue"];

const difficultyConfig = {
  easy:       { onTime: 800, offTime: 400, label: "Easy" },
  medium:     { onTime: 600, offTime: 300, label: "Medium" },
  hard:       { onTime: 400, offTime: 200, label: "Hard" },
  insane:     { onTime: 300, offTime: 150, label: "Insane" },

  // ⭐ NEW IMPOSSIBLE MODE ⭐
  impossible: { onTime: 220, offTime: 120, label: "Impossible" }
};

function generateRoomId() {
  return Math.random().toString(36).slice(2, 8);
}

// ----- Helper functions -----

function getActiveLobby() {
  const now = Date.now();
  for (const roomId in rooms) {
    const room = rooms[roomId];
    if (room.phase === "lobby" && room.lobbyEndTime > now) {
      return room;
    }
  }
  return null;
}

function broadcastLobbyUpdate(room) {
  const now = Date.now();
  const timeLeft = Math.max(
    0,
    Math.round((room.lobbyEndTime - now) / 1000)
  );

  io.to(room.id).emit("lobbyUpdate", {
    roomId: room.id,
    difficulty: room.difficulty,
    difficultyLabel: room.difficultyLabel,
    timeLeft,
    players: room.players.map((p) => ({ id: p.id, name: p.name }))
  });
}

function startLobbyCountdown(room) {
  room.lobbyTimer = setInterval(() => {
    const now = Date.now();
    if (now >= room.lobbyEndTime) {
      clearInterval(room.lobbyTimer);
      room.lobbyTimer = null;
      startGame(room);
    } else {
      broadcastLobbyUpdate(room);
    }
  }, 1000);
}

function startGame(room) {
  if (!room) return;
  room.phase = "playing";
  room.round = 0;
  room.sequence = [];

  const cfg = difficultyConfig[room.difficulty] || difficultyConfig.easy;
  room.onTime = cfg.onTime;
  room.offTime = cfg.offTime;

  // ⏱ start multiplayer game timer
  room.gameStartTime = Date.now();

  room.players.forEach((p) => {
    p.alive = true;
    p.roundsSurvived = 0;
    p.inputIndex = 0;
    p.finishedRound = false;
  });

  io.to(room.id).emit("gameStart", {
    difficulty: room.difficulty,
    difficultyLabel: room.difficultyLabel
  });

  // Wait for 3-2-1 countdown + a small buffer
  setTimeout(() => {
    startNextRound(room);
  }, 3700);
}

function startNextRound(room) {
  if (!room) return;

  room.round += 1;
  const nextColor = COLORS[Math.floor(Math.random() * COLORS.length)];
  room.sequence.push(nextColor);

  room.players.forEach((p) => {
    if (p.alive) {
      p.inputIndex = 0;
      p.finishedRound = false;
    } else {
      p.finishedRound = true;
    }
  });

  io.to(room.id).emit("roundStart", {
    round: room.round,
    sequenceLength: room.sequence.length
  });

  io.to(room.id).emit("playSequence", {
    sequence: room.sequence,
    onTime: room.onTime,
    offTime: room.offTime
  });

  const totalTime = room.sequence.length * (room.onTime + room.offTime);
  setTimeout(() => {
    io.to(room.id).emit("startInputPhase");
  }, totalTime + 80);
}

function computeRoundSummary(room) {
  return room.players.map((p) => ({
    id: p.id,
    name: p.name,
    alive: p.alive,
    roundsSurvived: p.roundsSurvived
  }));
}

function checkEndOfRound(room) {
  if (!room) return;

  const allFinished = room.players.every((p) => p.finishedRound);
  if (!allFinished) return;

  const summary = computeRoundSummary(room);
  io.to(room.id).emit("roundSummary", { summary });

  const alivePlayers = room.players.filter((p) => p.alive);
  if (alivePlayers.length === 0) {
    endGame(room);
  } else if (alivePlayers.length === 1) {
    const winner = alivePlayers[0];
    if (winner.roundsSurvived < room.round) {
      winner.roundsSurvived = room.round;
    }
    endGame(room);
  } else {
    setTimeout(() => {
      startNextRound(room);
    }, 1000);
  }
}

function endGame(room) {
  if (!room) return;

  const leaderboard = [...room.players].sort(
    (a, b) => b.roundsSurvived - a.roundsSurvived
  );

  // ⏱ compute total multiplayer game time
  const now = Date.now();
  const gameDurationSeconds = room.gameStartTime
    ? Math.max(0, (now - room.gameStartTime) / 1000)
    : null;

  io.to(room.id).emit("gameOver", {
    leaderboard: leaderboard.map((p) => ({
      id: p.id,
      name: p.name,
      roundsSurvived: p.roundsSurvived,
      timeSeconds: gameDurationSeconds
    }))
  });

  setTimeout(() => {
    if (room.lobbyTimer) clearInterval(room.lobbyTimer);
    delete rooms[room.id];
  }, 1000);
}

// ----- Socket.IO handlers -----

io.on("connection", (socket) => {
  console.log(`Client connected: ${socket.id}`);

  socket.data.roomId = null;

  socket.on("checkActiveLobby", () => {
    const lobby = getActiveLobby();
    if (!lobby) {
      socket.emit("lobbyStatus", { hasActiveLobby: false });
      return;
    }

    const now = Date.now();
    const timeLeft = Math.max(
      0,
      Math.round((lobby.lobbyEndTime - now) / 1000)
    );

    socket.emit("lobbyStatus", {
      hasActiveLobby: true,
      difficulty: lobby.difficulty,
      difficultyLabel: lobby.difficultyLabel,
      timeLeft
    });
  });

  socket.on("createLobby", ({ name, difficulty }) => {
    const existing = getActiveLobby();
    if (existing) {
      socket.emit(
        "errorMessage",
        "A lobby is already active. Join instead of creating a new one."
      );
      return;
    }

    const cfg = difficultyConfig[difficulty] || difficultyConfig.easy;
    const roomId = generateRoomId();

    const room = {
      id: roomId,
      hostId: socket.id,
      difficulty,
      difficultyLabel: cfg.label,
      phase: "lobby",
      lobbyEndTime: Date.now() + 30000,
      lobbyTimer: null,
      players: [],
      round: 0,
      sequence: [],
      onTime: cfg.onTime,
      offTime: cfg.offTime,
      gameStartTime: null
    };

    rooms[roomId] = room;

    const player = {
      id: socket.id,
      name: name || "Host",
      alive: true,
      roundsSurvived: 0,
      inputIndex: 0,
      finishedRound: false
    };
    room.players.push(player);

    socket.join(roomId);
    socket.data.roomId = roomId;

    socket.emit("lobbyCreated", {
      roomId,
      difficulty,
      difficultyLabel: room.difficultyLabel
    });

    broadcastLobbyUpdate(room);
    startLobbyCountdown(room);
  });

  socket.on("joinLobby", ({ name }) => {
    const lobby = getActiveLobby();
    if (!lobby) {
      socket.emit(
        "errorMessage",
        "No active lobby to join. Ask someone to host a new game."
      );
      return;
    }

    const alreadyInRoom = lobby.players.some((p) => p.id === socket.id);
    if (alreadyInRoom) {
      socket.emit("errorMessage", "You are already in this lobby.");
      return;
    }

    const player = {
      id: socket.id,
      name: name || "Player",
      alive: true,
      roundsSurvived: 0,
      inputIndex: 0,
      finishedRound: false
    };

    lobby.players.push(player);
    socket.join(lobby.id);
    socket.data.roomId = lobby.id;

    socket.emit("joinedLobby", {
      roomId: lobby.id,
      difficulty: lobby.difficulty,
      difficultyLabel: lobby.difficultyLabel
    });

    broadcastLobbyUpdate(lobby);
  });

  socket.on("playerInput", ({ color }) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = rooms[roomId];
    if (!room || room.phase !== "playing") return;

    const player = room.players.find((p) => p.id === socket.id);
    if (!player || !player.alive || player.finishedRound) return;

    const expectedColor = room.sequence[player.inputIndex];
    if (!expectedColor) return;

    if (color !== expectedColor) {
      // Wrong: eliminate only this player
      player.alive = false;
      player.roundsSurvived = room.round;
      player.finishedRound = true;

      io.to(roomId).emit("playerEliminated", {
        name: player.name,
        roundsSurvived: player.roundsSurvived
      });

      io.to(socket.id).emit("inputResult", {
        success: false,
        message: "Wrong! You're out."
      });

      checkEndOfRound(room);
      return;
    }

    // Correct input
    player.inputIndex += 1;

    if (player.inputIndex === room.sequence.length) {
      player.roundsSurvived = room.round;
      player.finishedRound = true;

      io.to(socket.id).emit("inputResult", {
        success: true,
        message: "Nice! You completed the pattern."
      });

      checkEndOfRound(room);
    } else {
      io.to(socket.id).emit("inputResult", {
        success: true,
        message: "Good so far… keep going!"
      });
    }
  });

  // Player voluntarily gives up
  socket.on("giveUp", () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = rooms[roomId];
    if (!room || room.phase !== "playing") return;

    const player = room.players.find((p) => p.id === socket.id);
    if (!player || !player.alive || player.finishedRound) return;

    player.alive = false;
    player.roundsSurvived = room.round || 1;
    player.finishedRound = true;

    io.to(roomId).emit("playerEliminated", {
      name: player.name,
      roundsSurvived: player.roundsSurvived
    });

    io.to(socket.id).emit("inputResult", {
      success: false,
      message: "You gave up."
    });

    checkEndOfRound(room);
  });

  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = rooms[roomId];
    if (!room) return;

    const index = room.players.findIndex((p) => p.id === socket.id);
    if (index === -1) return;

    const [player] = room.players.splice(index, 1);

    if (room.phase === "lobby") {
      if (room.players.length === 0) {
        if (room.lobbyTimer) clearInterval(room.lobbyTimer);
        delete rooms[roomId];
      } else {
        broadcastLobbyUpdate(room);
      }
    } else if (room.phase === "playing") {
      player.alive = false;
      player.finishedRound = true;
      checkEndOfRound(room);
    }
  });
});

// ----- Start server -----
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Simon game server listening on http://localhost:${PORT}`);
});
