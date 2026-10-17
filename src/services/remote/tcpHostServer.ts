import TcpSocket from 'react-native-tcp-socket';
import { serializeNDJSON, NDJSONParser } from './ndjsonFramer';
import {
  RUNMUSIC_TCP_PORT,
  type RemoteMessage,
  type PairInitMessage,
  type PairVerifyMessage,
  type PairSuccessMessage,
  type PairChallengeRequiredMessage,
  type PairFailureMessage,
} from './remoteTypes';

export interface PendingPairChallenge {
  clientDeviceId: string;
  clientDeviceName: string;
  pin: string;
  resolve: (approved: boolean) => void;
}

export type CommandHandler = (
  message: RemoteMessage,
  clientSocket: any,
  clientInfo: { deviceId: string; deviceName: string }
) => void;

export type TokenValidator = (token: string, clientDeviceId: string) => boolean;
export type TokenGenerator = (clientDeviceId: string, clientDeviceName: string) => string;

interface ConnectedClient {
  id: string;
  socket: any;
  parser: NDJSONParser;
  isAuthorized: boolean;
  clientDeviceId?: string;
  clientDeviceName?: string;
  activePin?: string;
}

class TCPHostServer {
  private server: any = null;
  private clients: Map<string, ConnectedClient> = new Map();
  private nextClientId = 1;

  private onCommandHandler: CommandHandler | null = null;
  private onPairChallengeHandler: ((challenge: PendingPairChallenge) => void) | null = null;
  private tokenValidator: TokenValidator | null = null;
  private tokenGenerator: TokenGenerator | null = null;
  private onClientAuthorizedHandler: ((clientSocket: any, clientInfo: { id: string; deviceId: string; deviceName: string }) => void) | null = null;
  private onClientDisconnectedHandler: ((clientId: string) => void) | null = null;

  public setHandlers(handlers: {
    onCommand: CommandHandler;
    onPairChallenge: (challenge: PendingPairChallenge) => void;
    validateToken: TokenValidator;
    generateToken: TokenGenerator;
    onClientAuthorized: (clientSocket: any, clientInfo: { id: string; deviceId: string; deviceName: string }) => void;
    onClientDisconnected?: (clientId: string) => void;
  }): void {
    this.onCommandHandler = handlers.onCommand;
    this.onPairChallengeHandler = handlers.onPairChallenge;
    this.tokenValidator = handlers.validateToken;
    this.tokenGenerator = handlers.generateToken;
    this.onClientAuthorizedHandler = handlers.onClientAuthorized;
    this.onClientDisconnectedHandler = handlers.onClientDisconnected || null;
  }

  public startServer(port = RUNMUSIC_TCP_PORT, onListening?: () => void): void {
    this.stopServer();

    try {
      this.server = TcpSocket.createServer((socket: any) => {
        const clientId = `tcp_${this.nextClientId++}`;
        const parser = new NDJSONParser();

        const clientData: ConnectedClient = {
          id: clientId,
          socket,
          parser,
          isAuthorized: false,
        };

        this.clients.set(clientId, clientData);

        socket.on('data', (chunk: any) => {
          parser.feed(chunk, (message: RemoteMessage) => {
            this.handleClientMessage(clientData, message);
          });
        });

        socket.on('error', (err: any) => {
          console.warn(`[TCPHostServer] Client ${clientId} socket error:`, err);
        });

        socket.on('close', () => {
          parser.reset();
          this.clients.delete(clientId);
          this.onClientDisconnectedHandler?.(clientId);
        });
      });

      this.server.on('error', (err: any) => {
        console.warn('[TCPHostServer] Server error:', err);
      });

      this.server.listen({ port, host: '0.0.0.0' }, () => {
        onListening?.();
      });
    } catch (err) {
      console.error('[TCPHostServer] Failed to start server:', err);
    }
  }

  private handleClientMessage(client: ConnectedClient, message: RemoteMessage): void {
    // 1. Handle Handshake if not yet authorized
    if (!client.isAuthorized) {
      if (message.type === 'PAIR_INIT') {
        this.handlePairInit(client, message);
        return;
      }

      if (message.type === 'PAIR_VERIFY') {
        this.handlePairVerify(client, message);
        return;
      }

      // Unauthorized client trying to send other commands
      const reject: PairFailureMessage = {
        type: 'PAIR_FAILURE',
        reason: 'UNAUTHORIZED',
      };
      this.sendToClient(client.socket, reject);
      return;
    }

    // 2. Client is authorized - dispatch command
    if (this.onCommandHandler) {
      this.onCommandHandler(message, client.socket, {
        deviceId: client.clientDeviceId || 'unknown',
        deviceName: client.clientDeviceName || 'Remote Client',
      });
    }
  }

  private handlePairInit(client: ConnectedClient, msg: PairInitMessage): void {
    client.clientDeviceId = msg.clientDeviceId;
    client.clientDeviceName = msg.clientDeviceName;

    // Check if client has a pre-existing trusted token
    if (msg.token && this.tokenValidator && this.tokenValidator(msg.token, msg.clientDeviceId)) {
      this.authorizeClient(client, msg.token);
      return;
    }

    // Otherwise, generate 4-digit PIN for challenge
    const pin = Math.floor(1000 + Math.random() * 9000).toString();
    client.activePin = pin;

    // Send challenge required to client
    const challengeMsg: PairChallengeRequiredMessage = {
      type: 'PAIR_CHALLENGE_REQUIRED',
    };
    this.sendToClient(client.socket, challengeMsg);

    // Prompt user on Host UI
    if (this.onPairChallengeHandler) {
      this.onPairChallengeHandler({
        clientDeviceId: msg.clientDeviceId,
        clientDeviceName: msg.clientDeviceName,
        pin,
        resolve: (approved) => {
          if (!approved) {
            client.activePin = undefined;
            const fail: PairFailureMessage = {
              type: 'PAIR_FAILURE',
              reason: 'REJECTED',
            };
            this.sendToClient(client.socket, fail);
          }
        },
      });
    }
  }

  private handlePairVerify(client: ConnectedClient, msg: PairVerifyMessage): void {
    if (client.activePin && msg.pin === client.activePin) {
      client.activePin = undefined;
      const token = this.tokenGenerator
        ? this.tokenGenerator(client.clientDeviceId || 'unknown', client.clientDeviceName || 'client')
        : `token_${Date.now()}`;
      this.authorizeClient(client, token);
    } else {
      const fail: PairFailureMessage = {
        type: 'PAIR_FAILURE',
        reason: 'INVALID_PIN',
      };
      this.sendToClient(client.socket, fail);
    }
  }

  private authorizeClient(client: ConnectedClient, token: string): void {
    client.isAuthorized = true;
    client.activePin = undefined;

    const successMsg: PairSuccessMessage = {
      type: 'PAIR_SUCCESS',
      token,
    };
    this.sendToClient(client.socket, successMsg);

    // Notify listener
    if (this.onClientAuthorizedHandler) {
      this.onClientAuthorizedHandler(client.socket, {
        id: client.id,
        deviceId: client.clientDeviceId || 'unknown',
        deviceName: client.clientDeviceName || 'Remote Client',
      });
    }
  }

  public disconnectClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      try {
        const reject: PairFailureMessage = {
          type: 'PAIR_FAILURE',
          reason: 'DISCONNECTED_BY_HOST',
        };
        this.sendToClient(client.socket, reject);
        client.socket.removeAllListeners?.();
        client.socket.destroy();
      } catch {
        // ignore
      }
      this.clients.delete(clientId);
      this.onClientDisconnectedHandler?.(clientId);
    }
  }

  /**
   * Send NDJSON message to a specific client socket
   */
  public sendToClient(socket: any, message: RemoteMessage): void {
    if (!socket) return;
    try {
      const data = serializeNDJSON(message);
      socket.write(data, 'utf8');
    } catch (err) {
      console.warn('[TCPHostServer] Error writing to client socket:', err);
    }
  }

  /**
   * Broadcast NDJSON message to ALL authorized clients
   */
  public broadcast(message: RemoteMessage): void {
    const data = serializeNDJSON(message);
    for (const client of this.clients.values()) {
      if (client.isAuthorized && client.socket) {
        try {
          client.socket.write(data, 'utf8');
        } catch (err) {
          console.warn(`[TCPHostServer] Broadcast error to ${client.id}:`, err);
        }
      }
    }
  }

  public getConnectedClientsCount(): number {
    let count = 0;
    for (const c of this.clients.values()) {
      if (c.isAuthorized) count++;
    }
    return count;
  }

  public stopServer(): void {
    for (const client of this.clients.values()) {
      try {
        client.socket.removeAllListeners?.();
        client.socket.destroy();
      } catch {
        // ignore
      }
    }
    this.clients.clear();

    if (this.server) {
      try {
        this.server.removeAllListeners?.();
        this.server.close();
      } catch {
        // ignore
      }
      this.server = null;
    }
  }
}

export const tcpHostServer = new TCPHostServer();
