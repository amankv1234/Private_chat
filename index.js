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

        if (chat.users.length >= 2) {
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

    // 🔹 MESSAGE
    socket.on("user-message", (msg) => {
        if (!socket.chatID || !chats[socket.chatID]) return;

        io.to(socket.chatID).emit("message", {
            user: socket.username,
            text: msg,
            time: new Date().toLocaleTimeString()
        });
    });

    // 🔹 DISCONNECT
    socket.on("disconnect", () => {
        const chatID = socket.chatID;
        if (!chatID || !chats[chatID]) return;

        chats[chatID].users =
            chats[chatID].users.filter(id => id !== socket.id);

        io.to(chatID).emit("info", `${socket.username} left`);

        if (chats[chatID].users.length === 0) {
            delete chats[chatID];
        }
    });
});

server.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
