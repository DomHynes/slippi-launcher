import CircularProgress from "@material-ui/core/CircularProgress";
import { createStyles, makeStyles, Theme } from "@material-ui/core/styles";
import Typography from "@material-ui/core/Typography";
import CheckCircleIcon from "@material-ui/icons/CheckCircle";
import ErrorIcon from "@material-ui/icons/Error";
import React from "react";

import { PathInput } from "@/components/PathInput";
import { useIsoVerification } from "@/lib/hooks/useIsoVerification";
import { useIsoPath, useRootSlpPath, useSpectateSlpPath } from "@/lib/hooks/useSettings";

import { SettingItem } from "./SettingItem";

const useStyles = makeStyles((theme: Theme) =>
  createStyles({
    validation: {
      display: "flex",
      alignItems: "center",
      marginRight: 10,
    },
    invalid: {
      color: theme.palette.error.main,
    },
    valid: {
      color: theme.palette.success.main,
    },
    validationText: {
      marginRight: 5,
      fontWeight: 500,
    },
  }),
);

export const MeleeOptions: React.FC = () => {
  const verifying = useIsoVerification((state) => state.isValidating);
  const isValidIso = useIsoVerification((state) => state.isValid);
  const [isoPath, setIsoPath] = useIsoPath();
  const [replayDir, setReplayDir] = useRootSlpPath();
  const [spectateDir, setSpectateDir] = useSpectateSlpPath();
  const classes = useStyles();

  return (
    <div>
      <Typography variant="h5">Melee Options</Typography>
      <SettingItem name="Melee ISO File" description="The path to an NTSC Melee 1.02 ISO.">
        <PathInput
          value={isoPath !== null ? isoPath : ""}
          onSelect={setIsoPath}
          placeholder="No file set"
          disabled={verifying}
          endAdornment={
            <div className={`${classes.validation} ${verifying ? "" : classes[isValidIso ? "valid" : "invalid"]}`}>
              <span className={classes.validationText}>
                {verifying ? "Verifying..." : isValidIso ? "Valid" : "Invalid"}
              </span>
              {verifying ? (
                <CircularProgress size={25} color="inherit" />
              ) : isValidIso ? (
                <CheckCircleIcon />
              ) : (
                <ErrorIcon />
              )}
            </div>
          }
        />
      </SettingItem>
      <SettingItem name="Replay Root Directory" description="The folder where your SLP files are stored.">
        <PathInput
          value={replayDir}
          onSelect={setReplayDir}
          options={{
            properties: ["openDirectory"],
          }}
          placeholder="No folder set"
        />
      </SettingItem>
      <SettingItem name="Spectator SLP Directory" description="The folder where spectated SLP files are stored.">
        <PathInput
          value={spectateDir}
          onSelect={setSpectateDir}
          options={{
            properties: ["openDirectory"],
          }}
          placeholder="No folder set"
        />
      </SettingItem>
    </div>
  );
};
