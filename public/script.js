const socket = io();

const login = document.getElementById("login");
const chat = document.getElementById("chat");

const nameInput = document.getElementById("name");
const chatIdInput = document.getElementById("chatIdInput");
const startBtn = document.getElementById("startBtn");

const messages = document.getElementById("messages");
const msgInput = document.getElementById("message");
const sendBtn = document.getElementById("sendBtn");
// ✅ Emoji Picker Setup
const emojiBtn = document.getElementById("emojiBtn");
const emojiPicker = document.getElementById("emojiPicker");
let chatID = "";
let secretKey = null;

// ✅ Generate Key from ChatID (same for both users)
async function generateKey(chatID) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.digest(
        "SHA-256",
        enc.encode(chatID)
    );

    return crypto.subtle.importKey(
        "raw",
        keyMaterial,
        { name: "AES-GCM" },
        false,
        ["encrypt", "decrypt"]
    );
}

// ✅ Encrypt Message
async function encryptMessage(text) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(text);

    const cipher = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        secretKey,
        encoded
    );

    return {
        iv: Array.from(iv),
        data: Array.from(new Uint8Array(cipher))
    };
}

// ✅ Decrypt Message
async function decryptMessage(payload) {
    const iv = new Uint8Array(payload.iv);
    const data = new Uint8Array(payload.data);

    const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        secretKey,
        data
    );

    return new TextDecoder().decode(decrypted);
}

// 🔹 START CHAT
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
socket.on("chat-created", async (id) => {
    chatID = id;
    secretKey = await generateKey(chatID);

    openChat();
    alert("Your Chat ID: " + id);
});

// 🔹 JOIN SUCCESS
socket.on("chat-joined", async (id) => {
    chatID = id;
    secretKey = await generateKey(chatID);

    openChat();
});

// 🔹 INVALID CHAT
socket.on("invalid-chat", () => {
    alert("❌ Invalid or expired Chat ID");
});

// 🔹 RECEIVE MESSAGE (Decrypt)
socket.on("message", async (data) => {

    const div = document.createElement("div");

    div.className =
        data.user === username ? "message self" : "message other";

    // ✅ Decrypt message
    const decryptedText = await decryptMessage(data.encrypted);

    div.innerText = `${data.user}: ${decryptedText}`;

    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;

    // ✅ Countdown Timer (30 sec)
    let seconds = 30;

    const countdown = setInterval(() => {
        seconds--;

        div.innerText = `${data.user}: ${decryptedText} (${seconds}s)`;

        if (seconds <= 0) {
            clearInterval(countdown);
        }
    }, 1000);

    // ✅ Auto Remove After 30 sec
    setTimeout(() => {
        div.style.opacity = "0";
        div.style.transition = "0.5s";

        setTimeout(() => {
            div.remove();
        }, 500);

    }, 30000);

});

// 🔹 INFO
socket.on("info", (msg) => {
    const div = document.createElement("div");
    div.className = "info";
    div.innerText = msg;
    messages.appendChild(div);
});

// ✅ SEND MESSAGE (Encrypt)
sendBtn.onclick = async () => {
    const text = msgInput.value.trim();
    if (!text) return;

    const encryptedPayload = await encryptMessage(text);

    socket.emit("user-message", encryptedPayload);

    msgInput.value = "";
};

// ✅ Typing Indicator System
let typingTimeout;

msgInput.addEventListener("input", () => {
    socket.emit("typing", { chatID, name: username });

    clearTimeout(typingTimeout);

    typingTimeout = setTimeout(() => {
        socket.emit("stopTyping", { chatID });
    }, 1000);
});

// 🔹 Show Typing
socket.on("showTyping", (name) => {
    let indicator = document.getElementById("typingIndicator");

    if (!indicator) {
        indicator = document.createElement("div");
        indicator.id = "typingIndicator";
        indicator.className = "typing";
        messages.appendChild(indicator);
    }

    indicator.innerText = `${name} is typing...`;
});

// 🔹 Stop Typing
socket.on("hideTyping", () => {
    const indicator = document.getElementById("typingIndicator");
    if (indicator) indicator.remove();
});

// 🔹 OPEN CHAT UI
function openChat() {
  login.style.display = "none";
  chat.classList.remove("hidden");
  startTimer();
}

let expiryTime = 20 * 60; // seconds
let timerInterval;

function startTimer() {
  const timerEl = document.getElementById("timer");

  timerInterval = setInterval(() => {
    let min = Math.floor(expiryTime / 60);
    let sec = expiryTime % 60;

    timerEl.innerText = `⏳ Expires in ${min}:${sec < 10 ? "0" : ""}${sec}`;

    expiryTime--;

    if (expiryTime <= 0) {
      clearInterval(timerInterval);
      alert("Chat expired!");
      location.reload();
    }
  }, 1000);
}
document.getElementById("copyBtn").onclick = () => {
  navigator.clipboard.writeText(chatID);
  alert("Chat ID Copied ✅");
};
emojiBtn.onclick = () => {
  msgInput.value += "😊";
  msgInput.focus();
};
// Toggle Picker Open/Close
emojiBtn.onclick = () => {
    emojiPicker.classList.toggle("hidden");
};

// Insert Emoji into Input
emojiPicker.addEventListener("emoji-click", (event) => {
    msgInput.value += event.detail.unicode;
    msgInput.focus();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    chat.style.filter = "blur(8px)";
    socket.emit("user-away", username);
  } else {
    chat.style.filter = "blur(0px)";
    socket.emit("user-back", username);
  }
});
document.addEventListener("contextmenu", e => e.preventDefault());
document.addEventListener("copy", e => e.preventDefault());
