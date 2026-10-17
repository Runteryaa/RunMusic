/**
 * Connecto & RunMusic Unified Relay Proxy
 * 
 * Cleanly separates endpoints inside a single script:
 * 
 * 1. Minecraft Proxy Endpoint (Default / root with ?host=...&port=...):
 *    Original Connecto Minecraft TCP socket tunnel, completely unchanged.
 * 
 * 2. RunMusic Remote Relay Endpoint (/runmusic):
 *    Dedicated WebSocket room relay for RunMusic internet remote between any devices.
 * 
 * GitHub: https://github.com/Runteryaa/Connecto!
 */

const http = require('http');
const net = require('net');
const WebSocket = require('ws');

const PORT = process.env.PORT || 10000;

// =========================================================================
// RUNMUSIC ROOM RELAY STATE & HELPERS
// =========================================================================
const runMusicRooms = new Map();
let nextClientId = 1;

// =========================================================================
// HTTP SERVER (Health check & routing)
// =========================================================================
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // RunMusic status endpoint
  if (url.pathname === '/runmusic') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        status: 'ok',
        service: 'RunMusic Relay',
        activeRooms: runMusicRooms.size,
        uptimeSeconds: Math.floor(process.uptime()),
      })
    );
    return;
  }

  // Original Connecto response (completely unchanged)
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Connecto Relay Proxy: https://github.com/Runteryaa/Connecto!');
});

// =========================================================================
// WEBSOCKET SERVER
// =========================================================================
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const isRunMusicEndpoint = url.pathname === '/runmusic' || url.pathname.startsWith('/runmusic');
  const targetHost = url.searchParams.get('host');

  // -----------------------------------------------------------------------
  // ENDPOINT 1: RUNMUSIC REMOTE RELAY (/runmusic)
  // -----------------------------------------------------------------------
  if (isRunMusicEndpoint || (url.searchParams.has('room') && !targetHost)) {
    handleRunMusicConnection(ws, url.searchParams.get('room'));
    return;
  }

  // -----------------------------------------------------------------------
  // ENDPOINT 2: CONNECTO MINECRAFT TCP PROXY (Original logic unchanged)
  // -----------------------------------------------------------------------
  const targetPort = parseInt(url.searchParams.get('port') || '25565', 10);

  if (!targetHost) {
    console.warn('[Connecto-Relay] Connection rejected: Missing "host" parameter.');
    ws.close(1008, 'Target host parameter missing');
    return;
  }

  console.log(`[Connecto-Relay] Incoming connection -> Tunneling to ${targetHost}:${targetPort}`);

  // Create raw TCP socket to the target Minecraft server
  const tcpSocket = net.connect(targetPort, targetHost, () => {
    console.log(`[Connecto-Relay] ✓ TCP Connected to target ${targetHost}:${targetPort}`);
  });

  // Forward WebSocket binary data to Minecraft TCP server
  ws.on('message', (message, isBinary) => {
    if (tcpSocket.writable) {
      tcpSocket.write(message);
    }
  });

  // Forward Minecraft TCP data back to WebSocket client
  tcpSocket.on('data', (data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data, { binary: true });
    }
  });

  // Error & Close handling
  ws.on('close', () => {
    console.log(`[Connecto-Relay] Client WebSocket closed for ${targetHost}:${targetPort}`);
    tcpSocket.destroy();
  });

  ws.on('error', (err) => {
    console.error(`[Connecto-Relay] WS Error (${targetHost}): ${err.message}`);
    tcpSocket.destroy();
  });

  tcpSocket.on('close', () => {
    console.log(`[Connecto-Relay] Target TCP closed for ${targetHost}:${targetPort}`);
    ws.close();
  });

  tcpSocket.on('error', (err) => {
    console.error(`[Connecto-Relay] TCP Error (${targetHost}): ${err.message}`);
    ws.close();
  });
});

// =========================================================================
// RUNMUSIC CONNECTION HANDLER
// =========================================================================
function handleRunMusicConnection(ws, initialRoomCode) {
  ws.isRunMusic = true;
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  let userRole = null; // 'host' | 'client'
  let userRoomCode = initialRoomCode ? initialRoomCode.trim().toUpperCase() : null;
  let userClientId = null;

  ws.on('message', (raw) => {
    try {
      ws.isAlive = true;
      const msg = JSON.parse(raw.toString());

      if (msg.type === 'PING') {
        ws.isAlive = true;
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'PONG' }));
        }
        return;
      }

      if (msg.type === 'PONG') {
        ws.isAlive = true;
        return;
      }

      if (msg.type === 'JOIN_ROOM') {
        const { roomCode, role, deviceId, deviceName } = msg;
        if (!roomCode || typeof roomCode !== 'string') {
          ws.send(JSON.stringify({ type: 'ROOM_ERROR', error: 'Geçersiz oda kodu.' }));
          return;
        }

        const normalizedCode = roomCode.trim().toUpperCase();
        userRole = role;
        userRoomCode = normalizedCode;

        if (role === 'host') {
          const existing = runMusicRooms.get(normalizedCode);
          if (existing) {
            // Clear any pending room cleanup timer from temporary disconnection
            if (existing.cleanupTimer) {
              clearTimeout(existing.cleanupTimer);
              existing.cleanupTimer = null;
            }

            if (existing.host?.ws && existing.host.ws !== ws && existing.host.ws.readyState === WebSocket.OPEN) {
              existing.host.ws.send(
                JSON.stringify({ type: 'ROOM_ERROR', error: 'Oda başka bir cihaz tarafından devralındı.' })
              );
              existing.host.ws.close();
            }

            existing.host = { ws, deviceId, deviceName };
            existing.hostOffline = false;

            ws.send(JSON.stringify({ type: 'ROOM_HOSTED', roomCode: normalizedCode }));
            console.log(`[RunMusic] Host re-attached to existing room: ${normalizedCode} (${deviceName || deviceId})`);

            // Notify existing connected clients that host is back online
            const reconnectedMsg = JSON.stringify({ type: 'HOST_RECONNECTED' });
            for (const [cId, client] of existing.clients.entries()) {
              if (client.ws.readyState === WebSocket.OPEN) {
                client.ws.send(reconnectedMsg);
                // Also tell the reconnected host about this connected client
                ws.send(
                  JSON.stringify({
                    type: 'CLIENT_CONNECTED',
                    clientId: cId,
                    deviceId: client.deviceId,
                    deviceName: client.deviceName,
                  })
                );
              } else {
                existing.clients.delete(cId);
              }
            }
            return;
          }

          runMusicRooms.set(normalizedCode, {
            host: { ws, deviceId, deviceName },
            clients: new Map(),
            hostOffline: false,
            cleanupTimer: null,
          });

          ws.send(JSON.stringify({ type: 'ROOM_HOSTED', roomCode: normalizedCode }));
          console.log(`[RunMusic] Host registered new room: ${normalizedCode} (${deviceName || deviceId})`);
          return;
        }

        if (role === 'client') {
          const room = runMusicRooms.get(normalizedCode);
          if (!room || (!room.host && !room.hostOffline)) {
            console.warn(`[RunMusic] Client rejected for room "${normalizedCode}": Room not found or host gone. Active rooms: [${Array.from(runMusicRooms.keys()).join(', ')}]`);
            ws.send(JSON.stringify({ type: 'ROOM_ERROR', error: 'Oda bulunamadı veya Host şu an çevrimdışı.' }));
            return;
          }

          userClientId = `client_${nextClientId++}`;
          room.clients.set(userClientId, { ws, deviceId, deviceName });

          ws.send(
            JSON.stringify({
              type: 'ROOM_JOINED',
              roomCode: normalizedCode,
              hostName: room.host?.deviceName || 'RunMusic Host',
              clientId: userClientId,
              hostOffline: !!room.hostOffline,
            })
          );

          if (room.host && room.host.ws.readyState === WebSocket.OPEN) {
            room.host.ws.send(
              JSON.stringify({
                type: 'CLIENT_CONNECTED',
                clientId: userClientId,
                deviceId,
                deviceName,
              })
            );
          }
          console.log(`[RunMusic] Client ${userClientId} joined room: ${normalizedCode} (${deviceName || deviceId})`);
          return;
        }
      }

      // Forward application messages between Host and Clients
      if (msg.type === 'RELAY_MESSAGE') {
        if (!userRoomCode) return;
        const room = runMusicRooms.get(userRoomCode);
        if (!room) return;

        if (userRole === 'host') {
          if (msg.targetClientId) {
            const target = room.clients.get(msg.targetClientId);
            if (target && target.ws.readyState === WebSocket.OPEN) {
              target.ws.send(JSON.stringify({ type: 'RELAY_MESSAGE', payload: msg.payload }));
            }
          } else {
            const payloadStr = JSON.stringify({ type: 'RELAY_MESSAGE', payload: msg.payload });
            for (const client of room.clients.values()) {
              if (client.ws.readyState === WebSocket.OPEN) {
                client.ws.send(payloadStr);
              }
            }
          }
        } else if (userRole === 'client') {
          if (room.host && room.host.ws.readyState === WebSocket.OPEN) {
            room.host.ws.send(
              JSON.stringify({
                type: 'RELAY_MESSAGE',
                clientId: userClientId,
                payload: msg.payload,
              })
            );
          }
        }
        return;
      }

      // Host kicks a client
      if (msg.type === 'KICK_CLIENT' && userRole === 'host') {
        const room = runMusicRooms.get(userRoomCode);
        if (room && msg.targetClientId) {
          const client = room.clients.get(msg.targetClientId);
          if (client) {
            client.ws.send(JSON.stringify({ type: 'ROOM_ERROR', error: 'Host tarafından bağlantınız kesildi.' }));
            client.ws.close();
            room.clients.delete(msg.targetClientId);
            console.log(`[RunMusic] Host kicked client ${msg.targetClientId} from room: ${userRoomCode}`);
          }
        }
      }
    } catch (err) {
      console.warn('[RunMusic] Error processing message:', err);
    }
  });

  ws.on('close', () => {
    if (!userRoomCode) return;
    const room = runMusicRooms.get(userRoomCode);
    if (!room) return;

    if (userRole === 'host') {
      console.log(`[RunMusic] Host temporarily disconnected from room: ${userRoomCode}. Starting 60s grace period.`);
      room.hostOffline = true;

      // Notify clients that host is temporarily reconnecting
      const offlineMsg = JSON.stringify({ type: 'HOST_TEMPORARILY_OFFLINE' });
      for (const client of room.clients.values()) {
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(offlineMsg);
        }
      }

      // Clear any prior timer
      if (room.cleanupTimer) clearTimeout(room.cleanupTimer);

      // Start 60-second grace period before destroying room
      room.cleanupTimer = setTimeout(() => {
        if (room.hostOffline) {
          console.log(`[RunMusic] Grace period expired for room: ${userRoomCode}. Closing room.`);
          const closeMsg = JSON.stringify({ type: 'ROOM_CLOSED', error: 'Host odadan ayrıldı.' });
          for (const client of room.clients.values()) {
            if (client.ws.readyState === WebSocket.OPEN) {
              client.ws.send(closeMsg);
              client.ws.close();
            }
          }
          runMusicRooms.delete(userRoomCode);
        }
      }, 60000);
    } else if (userRole === 'client' && userClientId) {
      console.log(`[RunMusic] Client ${userClientId} left room: ${userRoomCode}`);
      room.clients.delete(userClientId);
      if (room.host && room.host.ws.readyState === WebSocket.OPEN) {
        room.host.ws.send(
          JSON.stringify({
            type: 'CLIENT_DISCONNECTED',
            clientId: userClientId,
          })
        );
      }
    }
  });
}

// Keep-alive heartbeat (every 25s for mobile carrier firewall traversal, only for RunMusic)
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isRunMusic) return;
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 25000);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

server.listen(PORT, () => {
  console.log(`[Connecto & RunMusic Relay] Server running on port ${PORT}`);
});
