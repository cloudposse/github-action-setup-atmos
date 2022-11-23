import { sep } from "path";
import { isWindows } from "./system";

export const getAtmosWrappedBinaryName = (): string => getAtmosBinaryName(true);

export const getAtmosBinaryName = (wrapped = false): string => {
  const baseName = wrapped ? "atmos-bin" : "atmos";
  return isWindows() ? `${baseName}.exe` : `${baseName}`;
};

export const getAtmosWrappedPath = () =>
  [process.env.ATMOS_CLI_PATH, getAtmosWrappedBinaryName()].join(sep);

