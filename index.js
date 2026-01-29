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

    // 🔹 MESSAGE (E2EE SAFE)
socket.on("user-message", (encryptedMsg) => {
    if (!socket.chatID || !chats[socket.chatID]) return;

    io.to(socket.chatID).emit("message", {
        user: socket.username,
        encrypted: encryptedMsg,
        time: new Date().toLocaleTimeString()
    });
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
socket.on("message", async (data) => {
   const div = document.createElement("div");
   div.innerText = decryptedText;
   messages.appendChild(div);

   setTimeout(() => {
     div.remove();
   }, 30000);
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
