const socket = io();

const login = document.getElementById("login");
const chat = document.getElementById("chat");

const nameInput = document.getElementById("name");
const chatIdInput = document.getElementById("chatIdInput");
const startBtn = document.getElementById("startBtn");

const messages = document.getElementById("messages");
const msgInput = document.getElementById("message");
const sendBtn = document.getElementById("sendBtn");

let username = "";
let chatID = "";

// 🔹 START
startBtn.onclick = () => {
    username = nameInput.value.trim();
    const joinID = chatIdInput.value.trim();

    if (!username) {
        alert("Enter name");
        return;
    }

    if (joinID) {
        socket.emit("join-chat", { chatID: joinID, name: username });
    } else {
        socket.emit("create-chat", { name: username });
    }
};

// 🔹 CREATE SUCCESS
socket.on("chat-created", (id) => {
    chatID = id;
    openChat();
    alert("Your Chat ID: " + id);
});

// 🔹 JOIN SUCCESS (🔥 MOST IMPORTANT)
socket.on("chat-joined", (id) => {
    chatID = id;
    openChat();
});

// 🔹 INVALID
socket.on("invalid-chat", () => {
    alert("❌ Invalid or expired Chat ID");
});

// 🔹 MESSAGE RECEIVE
socket.on("message", (data) => {
    const div = document.createElement("div");
    div.className = data.user === username ? "message self" : "message other";
    div.innerText = `${data.user}: ${data.text}`;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
});

// 🔹 INFO
socket.on("info", (msg) => {
    const div = document.createElement("div");
    div.className = "info";
    div.innerText = msg;
    messages.appendChild(div);
});

// 🔹 SEND
sendBtn.onclick = () => {
    const text = msgInput.value.trim();
    if (!text) return;
    socket.emit("user-message", text);
    msgInput.value = "";
};

function openChat() {
    login.style.display = "none";
    chat.classList.remove("hidden");
}
