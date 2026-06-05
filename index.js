const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 9000;
app.use(express.static(path.join(__dirname, "public")));

const chats = {}; 
// chatID : { users: [socketId1, socketId2], createdAt }

function generateID() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

io.on("connection", (socket) => {

    // 🔹 CREATE CHAT
    socket.on("create-chat", ({ name }) => {
        const chatID = generateID();

        chats[chatID] = {
            users: [socket.id],
            createdAt: Date.now()
        };

        socket.join(chatID);
        socket.chatID = chatID;
        socket.username = name;

        socket.emit("chat-created", chatID);

        // ⏱ expire after 20 min
        setTimeout(() => {
            if (chats[chatID]) {
                delete chats[chatID];
                io.to(chatID).emit("chat-expired");
            }
        }, 20 * 60 * 1000);
    });

    // 🔹 JOIN CHAT (100% SAFE)
    socket.on("join-chat", ({ chatID, name }) => {

        const chat = chats[chatID];

        if (!chat) {
            socket.emit("invalid-chat");
            return;
        }

        // ✅ join success
        chat.users.push(socket.id);

        socket.join(chatID);
        socket.chatID = chatID;
        socket.username = name;

        socket.emit("chat-joined", chatID);
        io.to(chatID).emit("info", `${name} joined the chat`);
    });

// 🔹 MESSAGE (E2EE SAFE)
socket.on("user-message", (payload) => {
    if (!socket.chatID || !chats[socket.chatID]) return;

    io.to(socket.chatID).emit("message", {
        id: payload.id, // Generate on client
        user: socket.username,
        encrypted: payload.encryptedMsg,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
});

// 🔹 READ RECEIPT
socket.on("message-read", (msgId) => {
    if (!socket.chatID) return;
    socket.to(socket.chatID).emit("message-read-update", { msgId, reader: socket.username });
});

// 🔹 TYPING
socket.on("typing", ({ chatID, name }) => {
    socket.to(chatID).emit("showTyping", name);
});

socket.on("stopTyping", ({ chatID }) => {
    socket.to(chatID).emit("hideTyping");
});
socket.on("user-away", (name) => {
  socket.to(socket.chatID).emit("info", `${name} switched tab 👀`);
});

socket.on("user-back", (name) => {
  socket.to(socket.chatID).emit("info", `${name} is back ✅`);
});



// 🔹 LEAVE CHAT (intentional leave button)
    socket.on("leave-chat", ({ chatID: id, name }) => {
        if (!id || !chats[id]) return;
        chats[id].users = chats[id].users.filter(uid => uid !== socket.id);
        socket.leave(id);
        socket.chatID   = null;
        socket.username = null;
        io.to(id).emit("info", `${name} left the room`);
        if (chats[id].users.length === 0) delete chats[id];
    });

    // 🔹 DISCONNECT (browser close / network drop)
    socket.on("disconnect", () => {
        const id = socket.chatID;
        if (!id || !chats[id]) return;

        chats[id].users = chats[id].users.filter(uid => uid !== socket.id);
        io.to(id).emit("info", `${socket.username} disconnected`);

        if (chats[id].users.length === 0) {
            delete chats[id];
        }
    });
});


server.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
