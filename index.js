const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 5 * 1024 * 1024 // 5MB to support encrypted image payloads
});
const PORT = process.env.PORT || 9000;
app.use(express.static(path.join(__dirname, "public")));

const chats = {};
// chatID : { users: [socketId1, socketId2], createdAt }

function generateID() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

io.on("connection", (socket) => {
    console.log("🔌 New connection:", socket.id);

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
        console.log(`✅ Room created: ${chatID} by ${name}`);

        // ⏱ expire after 20 min
        setTimeout(() => {
            if (chats[chatID]) {
                delete chats[chatID];
                io.to(chatID).emit("chat-expired");
                console.log(`⏰ Room expired: ${chatID}`);
            }
        }, 20 * 60 * 1000);
    });

    // 🔹 JOIN CHAT
    socket.on("join-chat", ({ chatID, name }) => {
        console.log(`🔑 Join attempt: room=${chatID}, user=${name}`);
        console.log(`   Active rooms:`, Object.keys(chats));

        const chat = chats[chatID];

        if (!chat) {
            console.log(`   ❌ Room not found: ${chatID}`);
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
        console.log(`   ✅ Joined successfully. Users in room: ${chat.users.length}`);
    });

    // 🔹 MESSAGE (E2EE SAFE)
    socket.on("user-message", (payload) => {
        if (!socket.chatID || !chats[socket.chatID]) return;

        io.to(socket.chatID).emit("message", {
            id: payload.id,
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
        if (!chatID) return;
        socket.to(chatID).emit("showTyping", name);
    });

    socket.on("stopTyping", ({ chatID }) => {
        if (!chatID) return;
        socket.to(chatID).emit("hideTyping");
    });

    socket.on("user-away", (name) => {
        if (!socket.chatID) return;
        socket.to(socket.chatID).emit("info", `${name} switched tab 👀`);
    });

    socket.on("user-back", (name) => {
        if (!socket.chatID) return;
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
        console.log(`👋 ${name} left room ${id}`);
    });

    // 🔹 DISCONNECT (browser close / network drop)
    socket.on("disconnect", () => {
        const id = socket.chatID;
        if (!id || !chats[id]) return;

        chats[id].users = chats[id].users.filter(uid => uid !== socket.id);
        io.to(id).emit("info", `${socket.username} disconnected`);
        console.log(`🔌 ${socket.username} disconnected from room ${id}`);

        if (chats[id].users.length === 0) {
            delete chats[id];
        }
    });
});


server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
