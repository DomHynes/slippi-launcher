/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { broadcastErrorOccurred, dolphinStatusChanged, slippiStatusChanged } from "@broadcast/ipc";
import { loadProgressUpdated } from "@replays/ipc";
import { settingsUpdated } from "@settings/ipc";
import { checkValidIso } from "common/ipc";
import throttle from "lodash/throttle";
import React from "react";

import { useConsole } from "@/store/console";
import { useReplays } from "@/store/replays";

import { useIsoVerification } from "./useIsoVerification";
import { useSettings } from "./useSettings";

export const useAppListeners = () => {
  const setSlippiConnectionStatus = useConsole((store) => store.setSlippiConnectionStatus);
  const throttledSetSlippiStatus = throttle(setSlippiConnectionStatus, 50);
  slippiStatusChanged.renderer!.useEvent(async ({ status }) => {
    throttledSetSlippiStatus(status);
  }, []);

  const setDolphinConnectionStatus = useConsole((store) => store.setDolphinConnectionStatus);
  const throttledSetDolphinStatus = throttle(setDolphinConnectionStatus, 50);
  dolphinStatusChanged.renderer!.useEvent(async ({ status }) => {
    throttledSetDolphinStatus(status);
  }, []);

  const setBroadcastError = useConsole((store) => store.setBroadcastError);
  broadcastErrorOccurred.renderer!.useEvent(async ({ errorMessage }) => {
    setBroadcastError(errorMessage);
  }, []);

  const updateProgress = useReplays((store) => store.updateProgress);
  const throttledUpdateProgress = throttle(updateProgress, 50);
  loadProgressUpdated.renderer!.useEvent(async (progress) => {
    throttledUpdateProgress(progress);
  }, []);

  const updateSettings = useSettings((store) => store.updateSettings);
  settingsUpdated.renderer!.useEvent(async (newSettings) => {
    updateSettings(newSettings);
  }, []);

  // Automatically run ISO verification whenever the isoPath changes
  const isoPath = useSettings((store) => store.settings.isoPath);
  const setIsValidating = useIsoVerification((store) => store.setIsValidating);
  const setIsValid = useIsoVerification((store) => store.setIsValid);
  React.useEffect(() => {
    if (!isoPath) {
      setIsValid(null);
      setIsValidating(false);
      return;
    }

    // Start iso validation
    setIsValidating(true);
    checkValidIso
      .renderer!.trigger({ path: isoPath })
      .then((isoCheckResult) => {
        if (!isoCheckResult.result) {
          console.warn(`Error checking iso validation: ${isoPath}`, isoCheckResult.errors);
          return;
        }

        if (isoCheckResult.result.path !== isoPath) {
          // The ISO path changed before verification completed
          // so just do nothing.
          return;
        }

        setIsValid(isoCheckResult.result.valid);
      })
      .finally(() => {
        setIsValidating(false);
      });
  }, [isoPath]);
};
