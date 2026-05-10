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

let customerSocket: Socket | null = null;

export function getCustomerSocket() {
  if (!customerSocket) {
    customerSocket = io(resolveSocketUrl(), {
      autoConnect: false,
      transports: ["websocket"],
      withCredentials: true,
    });
  }

  return customerSocket;
}

export function connectCustomerSocket(customerId: string) {
  const socket = getCustomerSocket();

  if (!socket.connected) {
    socket.connect();
  }

  socket.emit("customer:join", customerId);
  return socket;
}

export function disconnectCustomerSocket() {
  if (customerSocket?.connected) {
    customerSocket.disconnect();
  }
}
