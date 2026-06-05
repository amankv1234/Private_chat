/* ================================================================
   PRIVATE CHAT — script.js
   All messages are AES-GCM encrypted client-side.
   The server only relays ciphertext — it never sees plaintext.
   ================================================================ */

"use strict";

// ── Socket ──────────────────────────────────────────────────────
const socket = io();

// ── DOM References ───────────────────────────────────────────────
const loginScreen   = document.getElementById("loginScreen");
const chatScreen    = document.getElementById("chatScreen");

const nameInput     = document.getElementById("nameInput");
const chatIdInput   = document.getElementById("chatIdInput");
const joinIdGroup   = document.getElementById("joinIdGroup");
const createBtn     = document.getElementById("createBtn");
const joinToggleBtn = document.getElementById("joinToggleBtn");
const joinBtn       = document.getElementById("joinBtn");

const messages      = document.getElementById("messages");
const msgInput      = document.getElementById("msgInput");
const sendBtn       = document.getElementById("sendBtn");
const emojiBtn      = document.getElementById("emojiBtn");
const emojiPicker   = document.getElementById("emojiPicker");
const fileInput     = document.getElementById("fileInput");

const copyBtn       = document.getElementById("copyBtn");
const themeBtn      = document.getElementById("themeBtn");
const leaveBtn      = document.getElementById("leaveBtn");
const headerRoomId  = document.getElementById("headerRoomId");
const roomStatus    = document.getElementById("roomStatus");
const sessionTimer  = document.getElementById("sessionTimer");

// ── State ────────────────────────────────────────────────────────
let username    = "";
let chatID      = "";
let secretKey   = null;
let typingTimer = null;
let sessionCountdown = 20 * 60; // 20 minutes in seconds
let sessionInterval  = null;
let isInJoinMode     = false;

// Unique ID generator for message read-receipt tracking
const genMsgId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

// ── Audio Notification (base64 beep) ─────────────────────────────
// A minimal, single-tone beep generated via the Web Audio API
function playNotification() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = ctx.createOscillator();
    const gain       = ctx.createGain();
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.frequency.value = 880;
    oscillator.type = "sine";
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.4);
  } catch (_) { /* silent fail if audio context is blocked */ }
}

// ── Toast helper ─────────────────────────────────────────────────
let toastEl = null;
function showToast(msg, duration = 2000) {
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.className = "toast";
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  setTimeout(() => toastEl.classList.remove("show"), duration);
}

// ================================================================
// ENCRYPTION  (AES-GCM 256-bit, key derived from chatID via SHA-256)
// ================================================================

async function generateKey(id) {
  const encoded     = new TextEncoder().encode(id);
  const keyMaterial = await crypto.subtle.digest("SHA-256", encoded);
  return crypto.subtle.importKey(
    "raw", keyMaterial,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encrypt(text) {
  const iv      = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(text);
  const cipher  = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, secretKey, encoded);
  return {
    iv:   Array.from(iv),
    data: Array.from(new Uint8Array(cipher)),
    type: "text"
  };
}

async function encryptBinary(arrayBuffer) {
  const iv     = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, secretKey, arrayBuffer);
  return {
    iv:   Array.from(iv),
    data: Array.from(new Uint8Array(cipher)),
    type: "image"
  };
}

async function decrypt(payload) {
  const iv       = new Uint8Array(payload.iv);
  const data     = new Uint8Array(payload.data);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, secretKey, data);
  if (payload.type === "image") return decrypted; // ArrayBuffer
  return new TextDecoder().decode(decrypted);
}

// ================================================================
// LOGIN / ROOM CREATION
// ================================================================

// Toggle between "Join Room" input and "Create Room" flow
joinToggleBtn.onclick = () => {
  isInJoinMode = !isInJoinMode;
  if (isInJoinMode) {
    joinIdGroup.style.display = "block";
    joinToggleBtn.classList.add("hidden");
    joinBtn.classList.remove("hidden");
    chatIdInput.focus();
  } else {
    joinIdGroup.style.display = "none";
    joinToggleBtn.classList.remove("hidden");
    joinBtn.classList.add("hidden");
  }
};

function getUsername() {
  const n = nameInput.value.trim();
  if (!n) { showToast("⚠️ Please enter your name"); nameInput.focus(); return null; }
  return n;
}

createBtn.onclick = () => {
  const n = getUsername();
  if (!n) return;
  username = n;
  socket.emit("create-chat", { name: username });
};

joinBtn.onclick = () => {
  const n = getUsername();
  if (!n) return;
  const id = chatIdInput.value.trim().toUpperCase();
  if (!id) { showToast("⚠️ Paste the Room ID"); chatIdInput.focus(); return; }
  username = n;
  socket.emit("join-chat", { chatID: id, name: username });
};

// Allow pressing Enter on name input to trigger create
nameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    if (isInJoinMode) joinBtn.click();
    else createBtn.click();
  }
});

chatIdInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinBtn.click();
});

// ================================================================
// SOCKET — ROOM EVENTS
// ================================================================

socket.on("chat-created", async (id) => {
  chatID    = id;
  secretKey = await generateKey(chatID);
  openChat();
  showToast(`Room ID: ${chatID} — share it!`, 5000);
});

socket.on("chat-joined", async (id) => {
  chatID    = id;
  secretKey = await generateKey(chatID);
  openChat();
});

socket.on("invalid-chat", () => {
  showToast("❌ Invalid or expired Room ID");
});

socket.on("info", (msg) => {
  appendInfo(msg);
  // Update connected user status
  if (msg.toLowerCase().includes("joined")) {
    setRoomStatus("connected");
  }
});

socket.on("chat-expired", () => {
  showToast("⏰ Chat session expired", 3000);
  setTimeout(() => location.reload(), 3000);
});

// ================================================================
// SOCKET — MESSAGES
// ================================================================

socket.on("message", async (data) => {
  // Decrypt the received payload
  let content;
  let isImage = false;
  try {
    const result = await decrypt(data.encrypted);
    if (data.encrypted.type === "image") {
      content = result; // ArrayBuffer
      isImage = true;
    } else {
      content = result; // string
    }
  } catch (err) {
    appendInfo("⚠️ Could not decrypt a message.");
    return;
  }

  const isSelf = data.user === username;

  // Play notification if message is from someone else and tab is hidden
  if (!isSelf && document.hidden) {
    playNotification();
  }

  // Emit read receipt immediately if tab is visible and message is from another user
  if (!isSelf && !document.hidden) {
    socket.emit("message-read", data.id);
  }

  const bubble = buildMessageBubble({ data, content, isImage, isSelf });
  messages.appendChild(bubble);
  scrollToBottom();

  // Auto-destruct: 30-second countdown then fade-out
  startDestructCountdown(bubble, 30, data.id);
});

socket.on("message-read-update", ({ msgId }) => {
  const receipt = document.querySelector(`[data-receipt="${msgId}"]`);
  if (receipt) {
    receipt.textContent = "✓✓";
    receipt.classList.add("read");
  }
});

// ================================================================
// SOCKET — TYPING
// ================================================================

socket.on("showTyping", (name) => {
  let indicator = document.getElementById("typingIndicator");
  if (!indicator) {
    indicator = document.createElement("div");
    indicator.id = "typingIndicator";
    indicator.className = "typing-indicator";
    indicator.innerHTML = `
      <span>${name} is typing</span>
      <div class="typing-dots">
        <span></span><span></span><span></span>
      </div>`;
    messages.appendChild(indicator);
    scrollToBottom();
  } else {
    indicator.querySelector("span").textContent = `${name} is typing`;
  }
});

socket.on("hideTyping", () => {
  const el = document.getElementById("typingIndicator");
  if (el) el.remove();
});

// ================================================================
// MESSAGE BUILDING
// ================================================================

function buildMessageBubble({ data, content, isImage, isSelf }) {
  const wrapper = document.createElement("div");
  wrapper.className = `message ${isSelf ? "self" : "other"}`;
  wrapper.dataset.msgId = data.id;

  let innerHtml = "";

  if (!isSelf) {
    innerHtml += `<span class="message-name">${escapeHtml(data.user)}</span>`;
  }

  if (isImage) {
    const blob  = new Blob([content], { type: "image/jpeg" });
    const url   = URL.createObjectURL(blob);
    innerHtml  += `<img class="message-image" src="${url}" alt="Shared image" loading="lazy" />`;
  } else {
    innerHtml += `<span class="message-text">${escapeHtml(content)}</span>`;
  }

  innerHtml += `
    <div class="message-footer">
      <span class="message-countdown" data-countdown="${data.id}">🔥 30s</span>
      <span class="message-time">${data.time}</span>
      ${isSelf ? `<span class="read-receipt" data-receipt="${data.id}">✓</span>` : ""}
    </div>`;

  wrapper.innerHTML = innerHtml;
  return wrapper;
}

function startDestructCountdown(bubble, totalSeconds, msgId) {
  let remaining = totalSeconds;
  const countdownEl = bubble.querySelector(`[data-countdown="${msgId}"]`);

  const tick = setInterval(() => {
    remaining--;
    if (countdownEl) {
      countdownEl.textContent = remaining <= 5
        ? `🔥 ${remaining}s`
        : `⏱ ${remaining}s`;
    }
    if (remaining <= 0) {
      clearInterval(tick);
      bubble.style.transition = "opacity 0.5s, transform 0.5s";
      bubble.style.opacity    = "0";
      bubble.style.transform  = "scale(0.95)";
      setTimeout(() => bubble.remove(), 500);
    }
  }, 1000);
}

function appendInfo(text) {
  const div = document.createElement("div");
  div.className = "info-msg";
  div.textContent = text;
  messages.appendChild(div);
  scrollToBottom();
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function scrollToBottom() {
  messages.scrollTop = messages.scrollHeight;
}

// ================================================================
// SEND MESSAGE
// ================================================================

async function sendMessage() {
  const text = msgInput.value.trim();
  if (!text || !secretKey) return;

  const id               = genMsgId();
  const encryptedPayload = await encrypt(text);

  socket.emit("user-message", { id, encryptedMsg: encryptedPayload });
  msgInput.value = "";
  emojiPicker.classList.add("hidden");
  msgInput.focus();
}

sendBtn.onclick = sendMessage;

msgInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Typing events
msgInput.addEventListener("input", () => {
  socket.emit("typing", { chatID, name: username });
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    socket.emit("stopTyping", { chatID });
  }, 1200);
});

// ================================================================
// FILE / IMAGE SHARING (Encrypted)
// ================================================================

fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file || !secretKey) return;

  const MAX_SIZE = 2 * 1024 * 1024; // 2MB
  if (file.size > MAX_SIZE) {
    showToast("❌ Image too large (max 2MB)");
    fileInput.value = "";
    return;
  }

  if (!file.type.startsWith("image/")) {
    showToast("❌ Only image files are supported");
    fileInput.value = "";
    return;
  }

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const id               = genMsgId();
      const encryptedPayload = await encryptBinary(e.target.result);
      socket.emit("user-message", { id, encryptedMsg: encryptedPayload });
      showToast("📎 Image sent (encrypted)");
    } catch (err) {
      showToast("❌ Failed to encrypt image");
    }
    fileInput.value = "";
  };
  reader.readAsArrayBuffer(file);
});

// ================================================================
// EMOJI PICKER
// ================================================================

emojiBtn.onclick = (e) => {
  e.stopPropagation();
  emojiPicker.classList.toggle("hidden");
};

emojiPicker.addEventListener("emoji-click", (event) => {
  msgInput.value += event.detail.unicode;
  msgInput.focus();
});

document.addEventListener("click", (e) => {
  if (!emojiPicker.contains(e.target) && e.target !== emojiBtn) {
    emojiPicker.classList.add("hidden");
  }
});

// ================================================================
// HEADER CONTROLS
// ================================================================

copyBtn.onclick = () => {
  if (!chatID) return;
  navigator.clipboard.writeText(chatID)
    .then(() => showToast("✅ Room ID copied!"))
    .catch(() => showToast("Could not copy: " + chatID));
};

themeBtn.onclick = () => {
  const isLight = document.body.classList.toggle("light-mode");
  themeBtn.textContent = isLight ? "☀️" : "🌙";
  localStorage.setItem("pchat-theme", isLight ? "light" : "dark");
};

leaveBtn.onclick = () => {
  if (!confirm("Leave this chat room?")) return;
  socket.emit("leave-chat", { chatID, name: username });
  resetToLogin();
};

// ================================================================
// ROOM STATUS
// ================================================================

function setRoomStatus(status) {
  if (status === "connected") {
    roomStatus.textContent = "🟢 Connected";
    roomStatus.className   = "room-status connected";
  } else {
    roomStatus.textContent = "⏳ Waiting for someone...";
    roomStatus.className   = "room-status waiting";
  }
}

// ================================================================
// SESSION TIMER
// ================================================================

function startSessionTimer() {
  sessionCountdown = 20 * 60;
  const update = () => {
    const m = Math.floor(sessionCountdown / 60);
    const s = sessionCountdown % 60;
    sessionTimer.textContent = `⏳ ${m}:${s < 10 ? "0" : ""}${s}`;
    sessionCountdown--;
    if (sessionCountdown < 0) {
      clearInterval(sessionInterval);
      showToast("⏰ Session expired", 3000);
      setTimeout(() => location.reload(), 3000);
    }
  };
  update();
  sessionInterval = setInterval(update, 1000);
}

// ================================================================
// SCREEN TRANSITIONS
// ================================================================

function openChat() {
  loginScreen.classList.add("hidden");
  chatScreen.classList.remove("hidden");
  headerRoomId.textContent = chatID;
  setRoomStatus("waiting");
  startSessionTimer();
  msgInput.focus();
}

function resetToLogin() {
  // Clean up state
  if (sessionInterval) clearInterval(sessionInterval);
  sessionCountdown = 20 * 60;
  chatID    = "";
  secretKey = null;
  username  = "";

  // Clear messages
  messages.innerHTML = "";

  // Reset join mode UI
  isInJoinMode = false;
  joinIdGroup.style.display = "none";
  joinToggleBtn.classList.remove("hidden");
  joinBtn.classList.add("hidden");
  chatIdInput.value = "";
  nameInput.value   = "";

  // Flip screens
  chatScreen.classList.add("hidden");
  loginScreen.classList.remove("hidden");
  nameInput.focus();
}

// ================================================================
// TAB VISIBILITY (Privacy blur + read receipts)
// ================================================================

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    document.querySelector(".chat-wrapper") &&
      (document.querySelector(".chat-wrapper").style.filter = "blur(8px)");
    if (username && chatID) socket.emit("user-away", username);
  } else {
    document.querySelector(".chat-wrapper") &&
      (document.querySelector(".chat-wrapper").style.filter = "none");
    if (username && chatID) {
      socket.emit("user-back", username);
      // Mark all visible messages as read
      document.querySelectorAll(".message.other[data-msg-id]").forEach((el) => {
        socket.emit("message-read", el.dataset.msgId);
      });
    }
  }
});

// ================================================================
// PRIVACY — disable right-click / copy on the whole chat screen
// ================================================================

chatScreen.addEventListener("contextmenu", (e) => e.preventDefault());
chatScreen.addEventListener("copy",         (e) => e.preventDefault());

// ================================================================
// THEME — restore on load
// ================================================================

(function restoreTheme() {
  const saved = localStorage.getItem("pchat-theme");
  if (saved === "light") {
    document.body.classList.add("light-mode");
    if (themeBtn) themeBtn.textContent = "☀️";
  }
})();
