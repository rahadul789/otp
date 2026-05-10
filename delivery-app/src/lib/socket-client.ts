import { io, type Socket } from "socket.io-client";

const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ??
  "http://localhost:5000/api/v1";

function resolveSocketUrl() {
  if (API_BASE_URL.includes("/api/v1")) {
    return API_BASE_URL.replace(/\/api\/v1\/?$/, "");
  }

  return API_BASE_URL;
}

let riderSocket: Socket | null = null;

export function getRiderSocket() {
  if (!riderSocket) {
    riderSocket = io(resolveSocketUrl(), {
      autoConnect: false,
      transports: ["websocket"],
      withCredentials: true,
    });
  }

  return riderSocket;
}

export function connectRiderSocket(riderId: string) {
  const socket = getRiderSocket();

  if (!socket.connected) {
    socket.connect();
  }

  socket.emit("rider:join", riderId);
  return socket;
}

export function disconnectRiderSocket() {
  if (riderSocket?.connected) {
    riderSocket.disconnect();
  }
}
