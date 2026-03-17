import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.PROD
  ? window.location.origin
  : 'http://localhost:3001';

export function useSocket() {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    socketRef.current = socket;
    window.__socket = socket; // temp debug - remove before commit

    socket.on('connect', () => {
      setConnected(true);
      console.log('Connected to server');
    });

    socket.on('disconnect', () => {
      setConnected(false);
      console.log('Disconnected from server');
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

  return { socket: socketRef.current, connected, emit, on, off };
}
