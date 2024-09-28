// NOTE: This module cannot use electron-log, since it for some reason
// fails to obtain the paths required for file transport to work
// when in Node worker context.

import { Broadcast } from "@common/broadcast";
import type { Connection } from "@slippi/slippi-js";
import { ConnectionEvent, ConnectionStatus, ConsoleConnection, DolphinConnection } from "@slippi/slippi-js";
import type { ModuleMethods } from "threads/dist/types/master";
import { Observable, Subject } from "threads/observable";
import { expose } from "threads/worker";

import type { StartBroadcastConfig } from "./types";
import { BroadcastEvent } from "./types";

interface Methods {
  dispose: () => Promise<void>;
  startBroadcast(config: StartBroadcastConfig): Promise<void>;
  stopBroadcast(): Promise<void>;
  getLogObservable(): Observable<string>;
  getErrorObservable(): Observable<Error | string>;
  getSlippiStatusObservable(): Observable<{ status: ConnectionStatus }>;
  getDolphinStatusObservable(): Observable<{ status: ConnectionStatus }>;
  getReconnectObservable(): Observable<{ config: StartBroadcastConfig }>;
}

export type WorkerSpec = ModuleMethods & Methods;

// const broadcastManager = new BroadcastManager();

const logSubject = new Subject<string>();
const errorSubject = new Subject<Error | string>();
const slippiStatusSubject = new Subject<{ status: ConnectionStatus }>();
const dolphinStatusSubject = new Subject<{ status: ConnectionStatus }>();
const reconnectSubject = new Subject<{ config: StartBroadcastConfig }>();

let broadcast: Broadcast | null = null;

const methods: WorkerSpec = {
  async dispose(): Promise<void> {
    // Clean up worker
    logSubject.complete();
    errorSubject.complete();
    slippiStatusSubject.complete();
    dolphinStatusSubject.complete();
    reconnectSubject.complete();

    broadcast?.close();
  },
  async startBroadcast(config: StartBroadcastConfig): Promise<void> {
    let connection: Connection;

    if (config.mode === "console") {
      connection = new ConsoleConnection();
    } else {
      connection = new DolphinConnection();
    }

    // const output = new createWriteStream(resolve("/c/Users/domin", "output.json"), { encoding: "utf-8" });

    const timeout = 5000;

    await new Promise<void>((resolve, reject) => {
      // Set up the timeout
      const timer = setTimeout(() => {
        connection.removeListener(ConnectionEvent.STATUS_CHANGE, connectionChangeHandler);
        reject(new Error(`${config.mode || "dolphin"} connection request timed out after ${timeout}ms`));
      }, timeout);

      const connectionChangeHandler = (status: number) => {
        switch (status) {
          case ConnectionStatus.CONNECTED: {
            // Stop listening to the event
            connection.removeListener(ConnectionEvent.STATUS_CHANGE, connectionChangeHandler);

            clearTimeout(timer);
            resolve();
            return;
          }
          case ConnectionStatus.DISCONNECTED: {
            // Stop listening to the event
            connection.removeListener(ConnectionEvent.STATUS_CHANGE, connectionChangeHandler);

            clearTimeout(timer);
            reject(new Error(`Broadcast manager failed to connect to ${config.mode || "dolphin"}`));
            return;
          }
        }
      };

      // Set up the listeners
      connection.on(ConnectionEvent.STATUS_CHANGE, connectionChangeHandler);

      // Actually initiate the connection
      connection.connect(config.ip, config.port);
    });

    broadcast = new Broadcast(connection, process.env.SLIPPI_WS_SERVER, {
      authToken: config.authToken,
      viewerId: config.viewerId,
      name: config.name,
    });

    broadcast.on(BroadcastEvent.LOG, (msg: string) => {
      logSubject.next(msg);
    });
    broadcast.on(BroadcastEvent.ERROR, (err: Error | string) => {
      errorSubject.next(err);
    });
    broadcast.on(BroadcastEvent.SLIPPI_STATUS_CHANGE, (status: ConnectionStatus) => {
      slippiStatusSubject.next({ status });
    });
    broadcast.on(BroadcastEvent.DOLPHIN_STATUS_CHANGE, (status: ConnectionStatus) => {
      dolphinStatusSubject.next({ status });
    });
    broadcast.on(BroadcastEvent.RECONNECT, (config: StartBroadcastConfig) => {
      reconnectSubject.next({ config });
    });

    broadcast.start();
  },
  async stopBroadcast(): Promise<void> {
    broadcast?.close();

    broadcast = null;
  },
  getLogObservable(): Observable<string> {
    return Observable.from(logSubject);
  },
  getErrorObservable(): Observable<Error | string> {
    return Observable.from(errorSubject);
  },
  getSlippiStatusObservable(): Observable<{ status: ConnectionStatus }> {
    return Observable.from(slippiStatusSubject);
  },
  getDolphinStatusObservable(): Observable<{ status: ConnectionStatus }> {
    return Observable.from(dolphinStatusSubject);
  },
  getReconnectObservable(): Observable<{ config: StartBroadcastConfig }> {
    return Observable.from(reconnectSubject);
  },
};

expose(methods);
