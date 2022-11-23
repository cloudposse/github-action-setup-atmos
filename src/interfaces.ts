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
}

export interface IAtmosVersionInfo {
  downloadUrl: string;
  resolvedVersion: string;
  fileName: string;
}
