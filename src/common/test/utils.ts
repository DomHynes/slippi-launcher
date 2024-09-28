import type { BroadcastManager } from "@broadcast/broadcast_manager";
import { BroadcastEvent } from "@broadcast/types";
import type { Broadcast, SlippiWSMessage } from "@common/broadcast";
import { type Connection, ConnectionEvent, ConnectionStatus } from "@slippi/slippi-js";
import EventEmitter from "events";
import { createReadStream } from "fs";
import type { Writable } from "stream";
import type { client as WSClient } from "websocket";
import { connection as WSConnection } from "websocket";

export const waitForEvent = (emitter: EventEmitter, eventName: string) => {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      reject(`timed out waiting for event ${eventName}`);
    }, 5000);

    const handler = (data: any) => {
      emitter.off(eventName, handler);
      resolve({ event: eventName, data });
    };

    emitter.on(eventName, handler);
  });
};

export const mockWSMessage = <TMessage extends SlippiWSMessage>(data: TMessage) => {
  return {
    type: "utf8",
    utf8Data: JSON.stringify(data),
  };
};

export const getMockConnection = () => {
  // @ts-expect-error mocking
  return jest.mock(new WSConnection());
};

export const getMockSlippiConnection = (): Connection => {
  const mock = new EventEmitter();

  // @ts-expect-error mocking
  mock.disconnect = jest.fn();

  return mock as unknown as Connection;
};

export const pipeFileContents = async (filename: string, destination: Writable, options?: any): Promise<void> => {
  return new Promise((resolve): void => {
    const readStream = createReadStream(filename);
    readStream.on("open", () => {
      readStream.pipe(destination, options);
    });
    readStream.on("close", () => {
      resolve();
    });
  });
};

export const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

export const mockSendEvent = (broadcastId: string, payload: any) =>
  JSON.stringify({
    type: "send-event",
    broadcastId,
    event: {
      type: "game_event",
      payload,
    },
  });

export const initializeConnections = async ({
  broadcast,
  connection,
  wsClient,
  wsConnection,
}: {
  broadcast: Broadcast | BroadcastManager;
  connection: Connection;
  wsClient: WSClient;
  wsConnection: WSConnection;
}) => {
  broadcast.on(BroadcastEvent.LOG, (data) => console.log(data));
  broadcast.on(BroadcastEvent.ERROR, (data) => console.error(data));
  broadcast.on(BroadcastEvent.DOLPHIN_STATUS_CHANGE, (data) => console.log(data));
  broadcast.on(BroadcastEvent.SLIPPI_STATUS_CHANGE, (data) => console.log(data));

  connection.getStatus.mockImplementationOnce(() => ConnectionStatus.CONNECTED);

  void broadcast.start({
    authToken: "test",
    ip: "1234",
    port: 1337,
    viewerId: "testViewerId",
    name: "test-name",
  });

  wsClient.emit("connect", wsConnection);
  await flush();

  connection.emit(ConnectionEvent.STATUS_CHANGE, ConnectionStatus.CONNECTED);
  await flush();
};

export const initializeBroadcast = async ({
  wsConnection,
  broadcastId,
}: {
  wsConnection: WSConnection;
  broadcastId: string;
}) => {
  wsConnection.emit("message", mockWSMessage({ type: "get-broadcasts-resp", broadcasts: [] }));
  await flush();

  wsConnection.emit("message", mockWSMessage({ type: "start-broadcast-resp", broadcastId: broadcastId }));

  await flush();
};

export const mockStartGame = ({ connection }: { connection: Connection }) => {
  connection.emit(ConnectionEvent.MESSAGE, { type: "start_game" });
  connection.emit(ConnectionEvent.MESSAGE, { type: "game_event", payload: "1" });
  connection.emit(ConnectionEvent.MESSAGE, { type: "game_event", payload: "2" });
};
