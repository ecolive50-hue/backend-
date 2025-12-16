const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

/* =========================
   MongoDB Connect
========================= */
mongoose
  .connect(process.env.MONGO_URI || "mongodb://127.0.0.1:27017/liveapp")
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.log("❌ Mongo error", err));

/* =========================
   MEMORY STORE
========================= */
// roomId => room data
const rooms = {};
// userId => coin
const userCoins = {};
// roomId => leaderboard {userId: coin}
const leaderboards = {};

/* =========================
   SOCKET.IO
========================= */
io.on("connection", (socket) => {
  console.log("🔌 User connected:", socket.id);

  /* JOIN ROOM */
  socket.on("join-room", ({ roomId, userId }) => {
    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = {
        seats: Array(8).fill(null),
        locked: Array(8).fill(false),
        mutedUsers: [],
      };
    }

    if (!leaderboards[roomId]) {
      leaderboards[roomId] = {};
    }

    if (!userCoins[userId]) {
      userCoins[userId] = 1000; // 🎁 default coin
    }

    io.to(roomId).emit("room-state", rooms[roomId]);
    io.to(roomId).emit("leaderboard-update", leaderboards[roomId]);
  });

  /* =========================
     SEAT SYSTEM
  ========================= */
  socket.on("take-seat", ({ roomId, seatIndex, userId }) => {
    const room = rooms[roomId];
    if (!room || room.locked[seatIndex]) return;

    room.seats = room.seats.map((u) => (u === userId ? null : u));
    room.seats[seatIndex] = userId;

    io.to(roomId).emit("room-state", room);
  });

  socket.on("leave-seat", ({ roomId, userId }) => {
    const room = rooms[roomId];
    if (!room) return;

    room.seats = room.seats.map((u) => (u === userId ? null : u));
    io.to(roomId).emit("room-state", room);
  });

  socket.on("lock-seat", ({ roomId, seatIndex }) => {
    const room = rooms[roomId];
    if (!room) return;

    room.locked[seatIndex] = !room.locked[seatIndex];
    io.to(roomId).emit("room-state", room);
  });

  /* =========================
     HOST CONTROL
  ========================= */
  socket.on("kick-user", ({ roomId, userId }) => {
    const room = rooms[roomId];
    if (!room) return;

    room.seats = room.seats.map((u) => (u === userId ? null : u));
    io.to(roomId).emit("room-state", room);
  });

  socket.on("mute-user", ({ roomId, userId }) => {
    const room = rooms[roomId];
    if (!room) return;

    if (!room.mutedUsers.includes(userId)) {
      room.mutedUsers.push(userId);
    }

    io.to(roomId).emit("user-muted", { userId });
  });

  socket.on("unmute-user", ({ roomId, userId }) => {
    const room = rooms[roomId];
    if (!room) return;

    room.mutedUsers = room.mutedUsers.filter((u) => u !== userId);
    io.to(roomId).emit("user-unmuted", { userId });
  });

  /* =========================
     🎁 GIFT SYSTEM
  ========================= */
  socket.on("send-gift", ({ roomId, from, to, giftId, price }) => {
    if (!userCoins[from] || userCoins[from] < price) return;

    // coin cut
    userCoins[from] -= price;

    // leaderboard add
    if (!leaderboards[roomId][to]) {
      leaderboards[roomId][to] = 0;
    }
    leaderboards[roomId][to] += price;

    io.to(roomId).emit("gift-received", {
      from,
      to,
      giftId,
      price,
    });

    io.to(roomId).emit("coin-update", {
      userId: from,
      balance: userCoins[from],
    });

    io.to(roomId).emit(
      "leaderboard-update",
      leaderboards[roomId]
    );
  });

  socket.on("disconnect", () => {
    console.log("❌ User disconnected:", socket.id);
  });
});

/* =========================
   TEST ROUTE
========================= */
app.get("/", (req, res) => {
  res.send("🚀 Live voice backend running");
});

/* =========================
   SERVER START
========================= */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log(`✅ Server running on port ${PORT}`)
);