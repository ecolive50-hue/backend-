
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
require("dotenv").config();

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.use(express.json());

/* ===============================
   MongoDB Connect
================================ */
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.log("❌ Mongo error", err));

/* ===============================
   Schemas
================================ */
const UserSchema = new mongoose.Schema({
  userId: String,
  name: String,
  coins: { type: Number, default: 1000 },
});

const GiftLogSchema = new mongoose.Schema({
  roomId: String,
  senderId: String,
  receiverId: String,
  giftName: String,
  price: Number,
});

const User = mongoose.model("User", UserSchema);
const GiftLog = mongoose.model("GiftLog", GiftLogSchema);

/* ===============================
   In-Memory Room Data
================================ */
const rooms = {}; 
/*
rooms = {
 roomId: {
   hostId,
   seats: [userId|null x8],
   leaderboard: { userId: coins }
 }
}
*/

/* ===============================
   Socket Logic
================================ */
io.on("connection", (socket) => {
  console.log("🔗 User connected:", socket.id);

  /* Join Room */
  socket.on("join-room", async ({ roomId, userId, name }) => {
    socket.join(roomId);

    if (!rooms[roomId]) {
      rooms[roomId] = {
        hostId: userId,
        seats: Array(8).fill(null),
        leaderboard: {},
      };
    }

    let user = await User.findOne({ userId });
    if (!user) {
      user = await User.create({ userId, name });
    }

    io.to(roomId).emit("room-update", rooms[roomId]);
  });

  /* Take Seat */
  socket.on("take-seat", ({ roomId, seatIndex, userId }) => {
    if (!rooms[roomId]) return;

    rooms[roomId].seats[seatIndex] = userId;
    io.to(roomId).emit("seat-update", rooms[roomId].seats);
  });

  /* Leave Seat */
  socket.on("leave-seat", ({ roomId, seatIndex }) => {
    if (!rooms[roomId]) return;

    rooms[roomId].seats[seatIndex] = null;
    io.to(roomId).emit("seat-update", rooms[roomId].seats);
  });

  /* Mute */
  socket.on("mute-user", ({ roomId, userId }) => {
    io.to(roomId).emit("user-muted", { userId });
  });

  /* Unmute */
  socket.on("unmute-user", ({ roomId, userId }) => {
    io.to(roomId).emit("user-unmuted", { userId });
  });

  /* Send Gift */
  socket.on(
    "send-gift",
    async ({ roomId, senderId, receiverId, giftName, price }) => {
      const sender = await User.findOne({ userId: senderId });
      if (!sender || sender.coins < price) return;

      sender.coins -= price;
      await sender.save();

      await GiftLog.create({
        roomId,
        senderId,
        receiverId,
        giftName,
        price,
      });

      if (!rooms[roomId].leaderboard[receiverId]) {
        rooms[roomId].leaderboard[receiverId] = 0;
      }
      rooms[roomId].leaderboard[receiverId] += price;

      io.to(roomId).emit("gift-received", {
        senderId,
        receiverId,
        giftName,
        price,
      });

      io.to(roomId).emit(
        "leaderboard-update",
        rooms[roomId].leaderboard
      );

      socket.emit("coin-update", sender.coins);
    }
  );

  socket.on("disconnect", () => {
    console.log("❌ User disconnected:", socket.id);
  });
});

/* ===============================
   Test Route
================================ */
app.get("/", (req, res) => {
  res.send("✅ SONIYA LIVE Backend Running");
});

/* ===============================
   Start Server
================================ */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log(`🚀 Server running on port ${PORT}`)
);
