import { type NewStartBroadcastConfig, type SlippiBroadcastPayloadEvent, BroadcastEvent } from "@broadcast/types";
import type { Connection, SlpRawEventPayload } from "@slippi/slippi-js";
import {
  Command,
  ConnectionEvent,
  ConnectionStatus,
  ConsoleConnection,
  DolphinConnection,
  DolphinMessageType,
  SlpParser,
  SlpStream,
  SlpStreamEvent,
  SlpStreamMode,
} from "@slippi/slippi-js";
import EventEmitter, { once } from "events";
import { createWriteStream } from "fs";
import Queue from "p-queue";
import retry from "p-retry";
import type { connection as WebSocketConnection, Message } from "websocket";
import { client as WebSocketClient } from "websocket";
import { assign, createActor, setup } from "xstate";

import { Preconditions } from "./preconditions";

const waitForWSMessage = <T extends SlippiWSMessage>(connection: WebSocketConnection, messageName: string) => {
  return new Promise<T>((resolve, reject) => {
    setTimeout(() => {
      reject(`timed out waiting for event ${messageName}`);
    }, 5000);

    const handler = (data: Message) => {
      const message = parseSlippiMessage(data);

      if (message.type === messageName) {
        // @ts-expect-error need a type guard here
        resolve(message);
        connection.off("message", handler);
      }
    };

    connection.on("message", handler);
  });
};

const getSlippiWSConnection = async (
  url: string,
  authToken: string,
  extraHeaders?: { [key: string]: string },
): Promise<WebSocketConnection> => {
  const client = new WebSocketClient({ disableNagleAlgorithm: true });

  const headers = {
    "api-version": 2,
    authorization: `Bearer ${authToken}`,
    ...extraHeaders,
  };

  // race connection success with failure for a promise that either resolve with a connection
  // or rejects with a connection error
  const [futureConnection] = await Promise.race<[WebSocketConnection]>([
    once(client, "connect"),
    new Promise<any>((_resolve, reject) => client.once("connectFailed", reject)),
  ]);

  client.connect(url, "broadcast-protocol", undefined, headers);

  return futureConnection;
};

// TODO: type this
type RemoteBroadcast = any;

type SlippiWSCommand =
  | {
    type: "get-broadcasts";
  }
  | {
    type: "start-broadcast";
    name: string;
    broadcastId: string | null;
  };

type SlippiGetBroadcastsResponse = {
  type: "get-broadcasts-resp";
  broadcasts: RemoteBroadcast[];
};

type SlippiStartBroadcastResponse = {
  type: "start-broadcast-resp";
  recoveryGameCursor?: string;
  broadcastId?: string;
};

export type SlippiWSMessage = SlippiGetBroadcastsResponse | SlippiStartBroadcastResponse;

const command = (cmd: SlippiWSCommand) => {
  return JSON.stringify(cmd);
};

// use zod here
const parseSlippiMessage = (message: Message): SlippiWSMessage => {
  if (message.type !== "utf8") {
    throw new Error("Message not UTF8");
  }

  return JSON.parse(message.utf8Data) as unknown as SlippiWSMessage;
};

type BroadcastStateEvents =
  | { type: "CONNECTION_ERROR"; error: Error }
  | { type: "INITIATE_CONNECTION" }
  | { type: "SUCCESSFUL_CONNECTION" }
  | { type: "BROADCAST_STARTED"; broadcastId: string }
  | { type: "DISCONNECT" }
  | { type: "CLOSE" };

// will need reconnecting state

const broadcastState = setup({
  types: {
    context: {} as { error?: Error; broadcastId?: string },
    events: {} as BroadcastStateEvents,
  },
}).createMachine({
  initial: "DISCONNECTED",

  context: {},

  states: {
    DISCONNECTED: {
      on: {
        INITIATE_CONNECTION: "CONNECTING",
      },
    },
    CONNECTING: {
      on: {
        SUCCESSFUL_CONNECTION: "CONNECTED",
        CONNECTION_ERROR: {
          target: "ERROR",
          actions: assign(({ event }) => ({
            error: event.error,
          })),
        },
      },
    },
    CONNECTED: {
      on: {
        BROADCAST_STARTED: {
          target: "BROADCASTING",
          actions: assign(({ event }) => ({
            broadcastId: event.broadcastId,
          })),
        },
        DISCONNECT: "CLOSED",
        CONNECTION_ERROR: {
          target: "ERROR",
          actions: assign(({ event }) => ({
            error: event.error,
          })),
        },
      },
    },
    BROADCASTING: {
      on: {
        CLOSE: "CLOSED",

        CONNECTION_ERROR: {
          target: "ERROR",
          actions: assign(({ event }) => ({
            error: event.error,
          })),
        },
      },
    },
    ERROR: {
      type: "final",
    },
    CLOSED: {
      type: "final",
    },
  },
});

/**
 * when provided a slippi connection (file/console/dolphin),
 * sets up the ws connection and manages broadcast
 * should probably break this out into seperate slippiws class + broadcast class
 */
class Broadcast extends EventEmitter {
  private state = createActor(broadcastState).start();

  private wsConnection?: WebSocketConnection;
  private config: Required<NewStartBroadcastConfig>;

  private sendEventQueue = new Queue({ concurrency: 5 });

  constructor(private slippiConnection: Connection, private slippiWsURL: string, config: NewStartBroadcastConfig) {
    Preconditions.checkExists(slippiWsURL, "slippiWsURL must be provided");
    super();

    this.config = {
      name: "Netplay",
      ...config,
    };

    this.state.subscribe(({ value, context }) => {
      // console.log("new state", { value, context });
      this.emit(BroadcastEvent.LOG, `new state: ${JSON.stringify({ value, context })}`);

      switch (value) {
        case "CONNECTING": {
          void this.initaliseWS();
          break;
        }
        case "CONNECTED": {
          this.emit("connected");
          void this.initialiseSlippi();
          break;
        }
        case "BROADCASTING": {
          Preconditions.checkExists(context.broadcastId, "Must have broadcast id in context");

          this.setUpConnectionListeners(context.broadcastId);
          break;
        }
        case "ERROR": {
          this.emit(BroadcastEvent.ERROR, context.error);
          this.cleanup();
          break;
        }
      }
    });
  }

  private async initaliseWS() {
    try {
      await this.setupSlippiWS();

      this.state.send({
        type: "SUCCESSFUL_CONNECTION",
      });
    } catch (e) {
      const error = e as unknown as Error;
      this.state.send({ type: "CONNECTION_ERROR", error });
    }
  }

  private async initialiseSlippi() {
    try {
      const _broadcasts = await this.getBroadcasts();
      const broadcast = await this.startBroadcast();

      Preconditions.checkExists(broadcast.broadcastId, "Must have broadcast ID");
      this.state.send({
        type: "BROADCAST_STARTED",
        broadcastId: broadcast.broadcastId,
      });
    } catch (e) {
      const error = e as unknown as Error;
      // TODO: delineate network level error from application level error if possible
      this.state.send({ type: "CONNECTION_ERROR", error });
    }
  }

  private async getBroadcasts() {
    Preconditions.checkExists(this.wsConnection, "Cannot wait for message without connection");

    const futureGetBroadcastsResponse = waitForWSMessage<SlippiGetBroadcastsResponse>(
      this.wsConnection,
      "get-broadcasts-resp",
    );

    this.sendWSMessage({ type: "get-broadcasts" });

    return await futureGetBroadcastsResponse;
  }

  private async startBroadcast() {
    Preconditions.checkExists(this.wsConnection, "Cannot wait for message without connection");

    //need to handle previous broadcast

    const futureStartBroadcastResponse = waitForWSMessage<SlippiStartBroadcastResponse>(
      this.wsConnection,
      "start-broadcast-resp",
    );

    this.sendWSMessage({
      type: "start-broadcast",
      name: this.config.name,
      broadcastId: null,
    });

    const broadcast = await futureStartBroadcastResponse;
    //handle recoveryGameCursor
    //handle existing broadcastId - reconnect logic
    return broadcast;
  }

  private async sendItem(broadcastId: string, event: SlippiBroadcastPayloadEvent) {
    const message = {
      type: "send-event",
      broadcastId: broadcastId,
      event: event,
    };

    await new Promise<void>((resolve, reject) => {
      // gotta find a way to get rid of needing preconditions here
      Preconditions.checkExists(this.wsConnection, "Cannot queue item without wsConnection");

      this.wsConnection.send(JSON.stringify(message), (err) => {
        if (err) {
          return reject(err);
        }
        return resolve();
      });
    });
  }

  private sendWSMessage(cmd: SlippiWSCommand) {
    Preconditions.checkExists(this.wsConnection, "Cannot send message without wsConnection");
    this.wsConnection.send(command(cmd));
  }

  private cleanup() {
    this.wsConnection?.close();
    this.state.stop();
    this.removeAllListeners();
    this.sendEventQueue.pause();
    this.sendEventQueue.clear();
  }

  private addIncomingEvent(broadcastId: string, event: SlippiBroadcastPayloadEvent) {
    void this.sendEventQueue.add(() =>
      retry(() => this.sendItem(broadcastId, event), {
        //@ts-expect-error incomplete types on package
        minTimeout: 0,
      }),
    );
  }

  /**
   * setUpConnectionListeners
   *
   * sets up the logic we need to handle incoming events from console and dolphin connections
   * the console connection needs a lot of extra work to collect events and massage them into
   * what the websocket broadcast api expects
   * @param broadcastId {string}
   */
  private setUpConnectionListeners(broadcastId: string) {
    let nextCursor: number | null = null;

    if (this.config.mode === "console") {
      const slippiStream = new SlpStream({
        mode: SlpStreamMode.MANUAL,
      });

      let ready = false;
      let cursor = 0;
      const fsStream = createWriteStream("console_output.txt");

      let payloads: Buffer[] = [];

      slippiStream.on(SlpStreamEvent.RAW, (data: SlpRawEventPayload) => {
        this.emit(BroadcastEvent.LOG, `new raw: ${JSON.stringify(data)}`);

        // 0x35, 0x36, 0x3c, 0x39, 0x10,
        // by default we bundle all events in a single game frame to send in one websocket message
        // all incoming events hit the queue, then if a received message was one of these, we send the queue as one bundle
        const EVENTS_TO_SEND = [
          Command.MESSAGE_SIZES,
          Command.GAME_START,
          Command.FRAME_BOOKEND,
          Command.GAME_END,
          Command.SPLIT_MESSAGE,
        ];

        const sendEvent = (event: SlippiBroadcastPayloadEvent) => {
          this.emit(BroadcastEvent.LOG, `new outbound event: ${JSON.stringify(event)}`);
          fsStream.write(JSON.stringify(event) + "\n");

          this.addIncomingEvent(broadcastId, event);
        };

        // can't get started until we receive message_sizes - should be first message for a game
        // once we receive this we're ready to start collecting events + inject a START_GAME event at position 0
        if (data.command === Command.MESSAGE_SIZES) {
          ready = true;
          sendEvent({
            cursor: cursor,
            next_cursor: cursor + 1,
            type: DolphinMessageType.START_GAME,
          });

          cursor++;
        }

        const event: SlippiBroadcastPayloadEvent = {
          cursor: cursor,
          next_cursor: cursor + 1,
          type: DolphinMessageType.GAME_EVENT,
        };

        if (data.command === Command.GAME_END) {
          event.type = DolphinMessageType.END_GAME;
        }

        // don't send any events if we haven't received message_sizes yet
        if (!ready) {
          return;
        }

        // queue up whatever event this is to the current list of payloads
        payloads.push(data.payload);

        // only flush payload list for certain events
        if (!EVENTS_TO_SEND.includes(data.command)) {
          return;
        }

        event.payload = Buffer.concat(payloads).toString("base64");

        payloads = [];

        cursor++;

        sendEvent(event);
      });

      this.slippiConnection.on(ConnectionEvent.DATA, (event) => {
        this.emit(BroadcastEvent.LOG, `new DATA: ${JSON.stringify(event)}`);
        slippiStream.write(Buffer.from(event));
      });
    }

    if (this.config.mode === "dolphin") {
      const fsStream = createWriteStream("dolphin_output.txt");

      //TODO: type out slippi event emitters
      this.slippiConnection.on(ConnectionEvent.MESSAGE, (event: SlippiBroadcastPayloadEvent) => {
        this.emit(BroadcastEvent.LOG, `new message: ${JSON.stringify(event)}`);

        switch (event.type) {
          case "start_game":
          case "game_event":
          case "end_game":
            if (event.type === "game_event" && !event.payload) {
              // Don't send empty payload game_event
              break;
            }

            if (event.nextCursor) {
              nextCursor = event.nextCursor;
            }

            fsStream.write(JSON.stringify(event) + "\n");

            this.addIncomingEvent(broadcastId, event);
        }
      });
    }

    // if console/dolphin disconnects, send END_GAME to boot any spectating clients back to waiting
    this.slippiConnection.on(ConnectionEvent.STATUS_CHANGE, (status: number) => {
      // this should probably also wrap up the broadcast once all events are flushed
      if (status === ConnectionStatus.DISCONNECTED) {
        this.addIncomingEvent(broadcastId, {
          type: DolphinMessageType.END_GAME,
          cursor: nextCursor,
          nextCursor: nextCursor,
          payload: "",
        });
      }
    });
  }

  private async setupSlippiWS() {
    this.wsConnection = await getSlippiWSConnection(this.slippiWsURL, this.config.authToken, {
      target: this.config.viewerId,
    });

    this.wsConnection.on("error", (error) => {
      this.state.send({ type: "CONNECTION_ERROR", error });
    });
  }

  public start() {
    this.state.send({
      type: "INITIATE_CONNECTION",
    });
  }

  public close() {
    this.cleanup();
  }
}

export { Broadcast };
