import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.PROD
  ? window.location.origin
  : 'http://localhost:3001';

// In production behind Caddy, Socket.IO requests go to /plunder/socket.io/
// Caddy strips /plunder, so the server receives /socket.io/ as expected.
const SOCKET_PATH = import.meta.env.PROD
  ? '/plunder/socket.io'
  : '/socket.io';

export function useSocket() {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      path: SOCKET_PATH,
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      setReconnecting(false);
      setReconnectAttempt(0);
      console.log('Connected to server');
    });

    socket.on('disconnect', (reason) => {
      setConnected(false);
      console.log('Disconnected from server:', reason);
    });

    socket.io.on('reconnect_attempt', (attempt) => {
      setReconnecting(true);
      setReconnectAttempt(attempt);
    });
    socket.io.on('reconnect_failed', () => {
      setReconnecting(false);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const emit = useCallback((event, data) => {
    return new Promise((resolve) => {
      socketRef.current?.emit(event, data, (response) => {
        resolve(response);
      });
    });
  }, []);

  const on = useCallback((event, handler) => {
    socketRef.current?.on(event, handler);
    return () => socketRef.current?.off(event, handler);
  }, []);

  const off = useCallback((event, handler) => {
    socketRef.current?.off(event, handler);
  }, []);

  return { socket: socketRef.current, connected, reconnecting, reconnectAttempt, emit, on, off };
}
