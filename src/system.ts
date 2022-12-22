import { platform } from "os";

const isWindowsPlatform = (platform: string) => platform.startsWith("win");

const normalizePlatform = (platform: string): string => {
  // want 'darwin', 'freebsd', 'linux', 'windows'
  return isWindowsPlatform(platform) ? "windows" : platform;
};

export const isWindows = (): boolean => isWindowsPlatform(platform());
export const getPlatform = (): string => normalizePlatform(platform());

export const getArch = (arch: string): string => {
  // 'arm', 'arm64', 'ia32', 'mips', 'mipsel', 'ppc', 'ppc64', 's390', 's390x', 'x32', and 'x64'.
  switch (arch) {
    case "x64":
      return "amd64";
    case "x32":
      return "386";
    case "arm":
      return "armv6l";
  }
  return arch;
};

