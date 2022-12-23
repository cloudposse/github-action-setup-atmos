import os from "os";

import * as core from "@actions/core";

import * as installer from "./installer";

export const run = async () => {
  try {
    const versionSpec = core.getInput("atmos-version");
    core.info(`Setup atmos version spec ${versionSpec}`);

    const arch = core.getInput("architecture") || os.arch();
    const installWrapper = core.getInput("install-wrapper") === "true";

    const token = core.getInput("token");
    const auth = !token ? undefined : `token ${token}`;

    const { toolPath, info } = await installer.getAtmos(
      versionSpec,
      auth,
      arch,
      installWrapper
    );

    core.info(
      `Successfully set up Atmos version ${versionSpec} in ${toolPath}`
    );

    core.setOutput("atmos-version", info?.resolvedVersion);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    core.error(error);
  }
};
