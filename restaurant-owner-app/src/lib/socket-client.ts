import { io, type Socket } from "socket.io-client";

import { getSocketBaseUrl } from "@/src/config/api";

let ownerSocket: Socket | null = null;

export function getOwnerSocket() {
  if (!ownerSocket) {
    ownerSocket = io(getSocketBaseUrl(), {
      autoConnect: false,
      transports: ["websocket"],
    });
  }

  return ownerSocket;
}

export function connectOwnerSocket(ownerId: string, accessToken: string) {
  const socket = getOwnerSocket();
  socket.auth = { token: accessToken };

  if (!socket.connected) {
    socket.connect();
  }

  socket.emit("owner:join", ownerId);
  return socket;
}

export function disconnectOwnerSocket() {
  if (ownerSocket?.connected) {
    ownerSocket.disconnect();
  }
}
