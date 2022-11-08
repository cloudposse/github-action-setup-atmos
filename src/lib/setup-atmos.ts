import os from "os";

import core from "@actions/core";
import { downloadAtmos, getDownloadUrl } from "./download";

// arch in [arm, x32, x64...] (https://nodejs.org/api/os.html#os_os_arch)
// return value in [amd64, 386, arm]
const mapArch = (arch: string): any => {
  const mappings: { [key: string]: string } = {
    x32: "386",
    x64: "amd64",
  };
  return mappings[arch] || arch;
};

// // os in [darwin, linux, win32...] (https://nodejs.org/api/os.html#os_os_platform)
// // return value in [darwin, linux, windows]
const mapOS = (os: string) => {
  const mappings: { [key: string]: string } = {
    win32: "windows",
  };
  return mappings[os] || os;
};

const downloadCLI = async (
  version: string,
  os: string,
  arch: string,
  path?: string
): Promise<string> => {
  const url = getDownloadUrl(version, os, arch);
  core.debug(`Downloading Atmos CLI from ${url}`);

  const cliPath = await downloadAtmos(version, os, arch, path);
  return cliPath;
};

// async function installWrapper(pathToCLI) {
//   let source, target;

//   // If we're on Windows, then the executable ends with .exe
//   const exeSuffix = os.platform().startsWith("win") ? ".exe" : "";

//   // Rename terraform(.exe) to terraform-bin(.exe)
//   try {
//     source = [pathToCLI, `terraform${exeSuffix}`].join(path.sep);
//     target = [pathToCLI, `terraform-bin${exeSuffix}`].join(path.sep);
//     core.debug(`Moving ${source} to ${target}.`);
//     await io.mv(source, target);
//   } catch (e) {
//     core.error(`Unable to move ${source} to ${target}.`);
//     throw e;
//   }

//   // Install our wrapper as terraform
//   try {
//     source = path.resolve(
//       [__dirname, "..", "wrapper", "dist", "index.js"].join(path.sep)
//     );
//     target = [pathToCLI, "terraform"].join(path.sep);
//     core.debug(`Copying ${source} to ${target}.`);
//     await io.cp(source, target);
//   } catch (e) {
//     core.error(`Unable to copy ${source} to ${target}.`);
//     throw e;
//   }

//   // Export a new environment variable, so our wrapper can locate the binary
//   core.exportVariable("TERRAFORM_CLI_PATH", pathToCLI);
// }

export const run = async () => {
  try {
    // Gather GitHub Actions inputs
    const version = core.getInput("atmos_version");
    //const wrapper = core.getInput("atmos_wrapper") === "true";
    const installPath = core.getInput("atmos_path") || undefined;

    // Gather OS details
    const osPlatform = os.platform();
    const osArch = os.arch();

    core.debug(`Downloading atmos version ${version}: ${osPlatform} ${osArch}`);
    const cliPath = await downloadCLI(version, osPlatform, osArch, installPath);
    if (!cliPath) {
      throw new Error(
        `Error occurred downloading version ${version} for ${osPlatform} and ${osArch}`
      );
    }

    // Install our wrapper
    // if (wrapper) {
    //   await installWrapper(pathToCLI);
    // }

    // Add to path
    core.addPath(cliPath);

    core.setOutput("version", version);
    core.setOutput("path", cliPath);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    core.error(error);
  }
};

