export type ChecksumValidationMode = "warn" | "enforce" | "skip";

export interface IAtmosVersionFile {
  name: string;
  // darwin, linux, windows
  os: string;
  arch: string;
  browser_download_url: string;
}

export interface IAtmosVersion {
  name: string;
  prerelease: boolean;
  assets: IAtmosVersionFile[];
  checksumsUrl?: string;
}

export interface IAtmosVersionInfo {
  downloadUrl: string;
  resolvedVersion: string;
  fileName: string;
  checksumsUrl?: string;
}
