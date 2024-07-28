import type { StartBroadcastConfig } from "@broadcast/types";
import { type Connection, ConnectionEvent } from "@slippi/slippi-js";
import EventEmitter from "events";
import { client as WSClient, connection as WSConnection } from "websocket";

import type { SlippiWSMessage } from "./broadcast";
import { Broadcast } from "./broadcast";

jest.mock("websocket", () => {
  const mockClient = new EventEmitter();
  // @ts-expect-error mocking
  mockClient.connect = jest.fn();
  // @ts-expect-error mocking
  mockClient.close = jest.fn();

  const mockConnection = new EventEmitter();
  // @ts-expect-error mocking
  mockConnection.close = jest.fn();
  // @ts-expect-error mocking
  mockConnection.send = jest.fn((_data, cb) => cb && cb());

  return {
    client: jest.fn().mockImplementation(() => mockClient),
    connection: jest.fn().mockImplementation(() => mockConnection),
  };
});

const waitForEvent = (emitter: EventEmitter, eventName: string) => {
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

const getBroadcast = (
  connection: Connection,
  url: string = "ws://test",
  config: Partial<StartBroadcastConfig> = {},
) => {
  return new Broadcast(connection, url, {
    ip: "test",
    port: 123,
    viewerId: "test",
    authToken: "test",

    ...config,
  });
};

const mockWSMessage = <TMessage extends SlippiWSMessage>(data: TMessage) => {
  return {
    type: "utf8",
    utf8Data: JSON.stringify(data),
  };
};

const getMockConnection = () => {
  // @ts-expect-error mocking
  return new WSConnection();
};

const getMockSlippiConnection = (): Connection => {
  const mock = new EventEmitter();

  return mock as unknown as Connection;
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Broadcast", () => {
  let slippiConnection = getMockSlippiConnection();

  let broadcast = getBroadcast(slippiConnection);
  let wsClient = jest.mocked(new WSClient());
  let wsConnection = jest.mocked(getMockConnection());

  beforeAll(() => {});

  beforeEach(() => {
    slippiConnection = getMockSlippiConnection();
    broadcast = getBroadcast(slippiConnection);
    wsClient = jest.mocked(new WSClient());
    wsConnection = jest.mocked(getMockConnection());
  });

  afterEach(() => {
    broadcast.close();
  });

  it("successfully connects", async () => {
    const futureConnectEvent = waitForEvent(broadcast, "connected");

    broadcast.start();

    wsClient.emit("connect", wsConnection);

    expect(await futureConnectEvent).toEqual({
      event: "connected",
    });
  });

  it("handles connection error", async () => {
    const futureErrorEvent = waitForEvent(broadcast, "error");

    broadcast.start();

    const connectionError = new Error("mock connection error");

    wsClient.emit("connectFailed", new Error("mock connection error"));

    expect(await futureErrorEvent).toEqual({
      data: connectionError,
      event: "error",
    });
  });

  it("starts broadcast when it receives broadcast response", async () => {
    const testBroadcastId = "test-broadcast";
    broadcast.start();

    wsClient.emit("connect", wsConnection);
    await flush();

    // should assert the broadcast class emits the broadcast req
    wsConnection.emit("message", mockWSMessage({ type: "get-broadcasts-resp", broadcasts: [] }));
    await flush();

    wsConnection.emit("message", mockWSMessage({ type: "start-broadcast-resp", broadcastId: testBroadcastId }));
    await flush();

    slippiConnection.emit(ConnectionEvent.MESSAGE, { type: "start_game", payload: "dummy" });
    await flush();

    //@ts-expect-error mocking
    expect(wsConnection.send.mock.lastCall[0]).toBe(
      JSON.stringify({
        type: "send-event",
        broadcastId: testBroadcastId,
        event: {
          type: "start_game",
          payload: "dummy",
        },
      }),
    );
  });

  it("will retry if a send fails", async () => {
    const testBroadcastId = "test-broadcast";
    broadcast.start();

    wsClient.emit("connect", wsConnection);
    await flush();

    // should assert the broadcast class emits the broadcast req
    wsConnection.emit("message", mockWSMessage({ type: "get-broadcasts-resp", broadcasts: [] }));
    await flush();

    wsConnection.emit("message", mockWSMessage({ type: "start-broadcast-resp", broadcastId: testBroadcastId }));
    await flush();

    wsConnection.send.mockClear();

    slippiConnection.emit(ConnectionEvent.MESSAGE, { type: "start_game" });
    slippiConnection.emit(ConnectionEvent.MESSAGE, { type: "game_event", payload: "1" });
    slippiConnection.emit(ConnectionEvent.MESSAGE, { type: "game_event", payload: "2" });
    await flush();

    expect(wsConnection.send).toBeCalledTimes(3);
    //@ts-expect-error mocking
    expect(JSON.parse(wsConnection.send.mock.calls[0][0]).event).toEqual({ type: "start_game" });
    //@ts-expect-error mocking
    expect(JSON.parse(wsConnection.send.mock.calls[1][0]).event).toEqual({ type: "game_event", payload: "1" });
    //@ts-expect-error mocking
    expect(JSON.parse(wsConnection.send.mock.calls[2][0]).event).toEqual({ type: "game_event", payload: "2" });

    wsConnection.send.mockClear();

    wsConnection.send.mockImplementationOnce((_data, cb) => cb?.(new Error("Failed to fetch")));

    slippiConnection.emit(ConnectionEvent.MESSAGE, { type: "game_event", payload: "3" });
    slippiConnection.emit(ConnectionEvent.MESSAGE, { type: "game_event", payload: "4" });
    await flush();
    await flush();

    expect(wsConnection.send).toBeCalledTimes(3);
    //@ts-expect-error mocking
    expect(JSON.parse(wsConnection.send.mock.calls[0][0]).event).toEqual({ type: "game_event", payload: "3" });
    //@ts-expect-error mocking
    expect(JSON.parse(wsConnection.send.mock.calls[1][0]).event).toEqual({ type: "game_event", payload: "3" });
    //@ts-expect-error mocking
    expect(JSON.parse(wsConnection.send.mock.calls[2][0]).event).toEqual({ type: "game_event", payload: "4" });
  });
});
