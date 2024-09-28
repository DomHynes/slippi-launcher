/* eslint-disable jest/expect-expect */
import "./test/wsMocks";

process.env.SLIPPI_WS_SERVER = "ws://test-server";
import { BroadcastManager } from "@broadcast/broadcast_manager";
import { type StartBroadcastConfig, BroadcastEvent } from "@broadcast/types";
import type { SlpRawEventPayload } from "@slippi/slippi-js";
import {
  type Connection,
  ConnectionEvent,
  ConsoleCommunication,
  DolphinConnection,
  DolphinMessageType,
  Ports,
  SlpParser,
  SlpParserEvent,
  SlpStream,
  SlpStreamEvent,
  SlpStreamMode,
} from "@slippi/slippi-js";
import { open } from "fs/promises";
import path from "path";
import { client as WSClient, connection as WSConnection } from "websocket";

import { Broadcast } from "./broadcast";
import {
  flush,
  initializeBroadcast,
  initializeConnections,
  mockSendEvent,
  mockStartGame,
  waitForEvent,
} from "./test/utils";

const mockConfig = (config: Partial<StartBroadcastConfig> = {}): StartBroadcastConfig => ({
  ip: "test",
  port: 123,
  viewerId: "test",
  authToken: "test",
  name: "test-name",

  ...config,
});

const _getBroadcast = (
  connection: Connection,
  url: string = "ws://test",
  config: Partial<StartBroadcastConfig> = {},
) => {
  return new Broadcast(connection, url, mockConfig(config));
};

const broadcastId = "test-broadcast";

const stopBroadcast = (broadcast: BroadcastManager | Broadcast) => {
  if (broadcast instanceof Broadcast) {
    broadcast.close();
    return;
  }
  broadcast.stop();
};

describe(`Broadcast`, () => {
  [
    {
      type: "BroadcastManager",
      getBroadcast: () => new BroadcastManager(),
      getConnection: (): Connection => new DolphinConnection(),
    },
    {
      type: "New Broadcast",
      getBroadcast: _getBroadcast,
      getConnection: (): Connection => new DolphinConnection(),
      newBroadcast: true,
    },
  ].forEach(({ type, getBroadcast, getConnection, newBroadcast }) => {
    let slippiConnection = getConnection();
    let broadcast = getBroadcast(slippiConnection, undefined, { mode: "dolphin" });
    const wsClient = jest.mocked(new WSClient());
    const wsConnection = jest.mocked(new WSConnection());

    beforeEach(() => {
      slippiConnection = getConnection();
      broadcast = getBroadcast(slippiConnection, undefined, { mode: "dolphin" });

      wsConnection.send.mockClear();
    });

    afterEach(async () => {
      stopBroadcast(broadcast);
      await flush();
      await flush();
      await flush();
    });

    if (newBroadcast) {
      it("will retry if a send fails", async () => {
        await initializeConnections({
          broadcast,
          connection: slippiConnection,
          wsClient,
          wsConnection,
        });

        await initializeBroadcast({
          wsConnection,
          broadcastId,
        });

        wsConnection.send.mockClear();

        mockStartGame({ connection: slippiConnection });
        await flush();

        const messages = [
          JSON.stringify({ type: "send-event", broadcastId: "test-broadcast", event: { type: "start_game" } }),
          mockSendEvent(broadcastId, "1"),
          mockSendEvent(broadcastId, "2"),
        ];

        messages.forEach((value, index) => {
          expect(wsConnection.send.mock.calls[index][0]).toEqual(value);
        });

        await flush();
        await flush();

        expect(wsConnection.send).toBeCalledTimes(3);
        //@ts-expect-error mocking
        expect(JSON.parse(wsConnection.send.mock.calls[0][0]).event).toEqual({ type: "start_game" });
        //@ts-expect-error mocking
        expect(JSON.parse(wsConnection.send.mock.calls[1][0]).event).toEqual({ type: "game_event", payload: "1" });
        //@ts-expect-error mocking
        expect(JSON.parse(wsConnection.send.mock.calls[2][0]).event).toEqual({ type: "game_event", payload: "2" });

        wsConnection.send.mockClear();

        wsConnection.send.mockImplementationOnce((_data, cb) => cb(new Error("Failed to fetch")));

        slippiConnection.emit(ConnectionEvent.MESSAGE, { type: "game_event", payload: "3" });
        slippiConnection.emit(ConnectionEvent.MESSAGE, { type: "game_event", payload: "4" });
        await flush();
        await flush();

        expect(wsConnection.send).toBeCalledTimes(3);
        //@ts-expect-error mocking
        expect(JSON.parse(wsConnection.send.mock.calls[0][0]).event).toEqual({ type: "game_event", payload: "3" });
        //@ts-expect-error mocking
        expect(JSON.parse(wsConnection.send.mock.calls[1][0]).event).toEqual({ type: "game_event", payload: "4" });
        //@ts-expect-error mocking
        expect(JSON.parse(wsConnection.send.mock.calls[2][0]).event).toEqual({ type: "game_event", payload: "3" });
      });
    }

    it("successfully connects", async () => {
      const futureConnectEvent = waitForEvent(broadcast, "connected");

      await initializeConnections({
        broadcast,
        connection: slippiConnection,
        wsClient,
        wsConnection,
      });

      expect(await futureConnectEvent).toEqual({
        event: "connected",
      });
    });

    it("handles connection error", async () => {
      const futureErrorEvent = waitForEvent(broadcast, BroadcastEvent.ERROR);

      await initializeConnections({
        broadcast,
        connection: slippiConnection,
        wsClient,
        wsConnection,
      });

      await initializeBroadcast({
        wsConnection,
        broadcastId,
      });

      const connectionError = new Error("mock connection error");

      wsConnection.emit("error", connectionError);

      expect(await futureErrorEvent).toEqual({
        data: connectionError,
        event: BroadcastEvent.ERROR,
      });
    });

    it("starts broadcast when it receives broadcast response", async () => {
      await initializeConnections({
        broadcast,
        connection: slippiConnection,
        wsClient,
        wsConnection,
      });

      await initializeBroadcast({
        wsConnection,
        broadcastId,
      });
      await flush();

      slippiConnection.emit(ConnectionEvent.MESSAGE, { type: "start_game", payload: "dummy" });
      await flush();

      //@ts-expect-error mocking
      expect(wsConnection.send.mock.lastCall[0]).toBe(
        JSON.stringify({
          type: "send-event",
          broadcastId,
          event: {
            type: "start_game",
            payload: "dummy",
          },
        }),
      );
    });

    it("e2e - dolphin", async () => {
      wsConnection.send.mockClear();

      await initializeConnections({
        broadcast,
        connection: slippiConnection,
        wsClient,
        wsConnection,
      });

      await initializeBroadcast({
        wsConnection,
        broadcastId,
      });
      await flush();

      expect(wsConnection.send.mock.calls[0][0]).toEqual(JSON.stringify({ type: "get-broadcasts" }));
      expect(wsConnection.send.mock.calls[1][0]).toEqual(
        JSON.stringify({ type: "start-broadcast", name: "test-name", broadcastId: null }),
      );
      await flush();

      wsConnection.send.mockClear();
      mockStartGame({ connection: slippiConnection });
      await flush();

      const messages = [
        JSON.stringify({ type: "send-event", broadcastId: "test-broadcast", event: { type: "start_game" } }),
        mockSendEvent(broadcastId, "1"),
        mockSendEvent(broadcastId, "2"),
      ];

      messages.forEach((value, index) => {
        expect(wsConnection.send.mock.calls[index][0]).toEqual(value);
      });
    });

    it.skip("successfully handles slpstream", async () => {
      const slippiConnection = getConnection();

      const testFile = "./test/test.slp";
      const slippiStream = new SlpStream({
        mode: SlpStreamMode.MANUAL,
      });
      const parser = new SlpParser();
      let count = 0;

      slippiStream.on(SlpStreamEvent.COMMAND, (data: SlpRawEventPayload) => {
        parser.handleCommand(data.command, data.payload);
        // console.log({ slippiStream: data.payload.toString("base64") });

        count++;
        if (count == 10) {
          throw new Error(count);
        }
      });

      parser.on(SlpParserEvent.FRAME, (data) => {
        console.log({ slpParser: data });
      });

      const file = await open(path.resolve(__dirname, testFile), "r");

      const fileStream = file.createReadStream();

      fileStream.pipe(slippiStream);

      await new Promise((resolve) => setTimeout(resolve, 10000));
    });

    it.skip("successfully handles dolphinconnection", async () => {
      const dolphinConnection = new DolphinConnection();

      let count = 0;

      const comms = new ConsoleCommunication();

      dolphinConnection.on(ConnectionEvent.ERROR, (error) => {
        console.log({ error });
      });

      dolphinConnection.on(ConnectionEvent.STATUS_CHANGE, (status: number) => {
        console.log(`Dolphin status change: ${status}`);
        console.log(status);
      });

      dolphinConnection.on(ConnectionEvent.DATA, (data) => {
        comms.receive(data);

        const messages = comms.getMessages();

        console.log(messages[0]);
        console.log(messages);

        if (!data.payload) {
          return;
        }

        if (
          data.type !== DolphinMessageType.GAME_EVENT &&
          data.type !== DolphinMessageType.START_GAME &&
          data.type !== DolphinMessageType.END_GAME
        ) {
          return;
        }

        count++;
        if (count == 10) {
          throw new Error(String(count));
        }
      });

      await dolphinConnection.connect("127.0.0.1", Ports.DEFAULT);

      await new Promise((resolve) => setTimeout(resolve, 1200000));
    });
  });
});
