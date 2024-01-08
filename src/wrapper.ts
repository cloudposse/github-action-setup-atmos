import * as core from "@actions/core";
import { exec } from "@actions/exec";
import * as io from "@actions/io";

import { getAtmosWrappedPath } from "./atmos-bin";
import { OutputListener } from "./output-listener";

const pathToCLI = getAtmosWrappedPath();

const guardAtmosInstalled = async () => {
  // Setting check to `true` will cause `which` to throw if atmos isn't found
  return io.which(pathToCLI, true);
};

(async () => {
  try {
    core.info("path: " + pathToCLI);
    // This will fail if Atmos isn't found, which is what we want
    await guardAtmosInstalled();

    // Create listeners to receive output (in memory) as well
    const stdout = new OutputListener();
    const stderr = new OutputListener();
    const listeners = {
      stdout: stdout.listener,
      stderr: stderr.listener
    };

    // Execute atmos and capture output
    const args = process.argv.slice(2);
    const options = {
      listeners,
<<<<<<< HEAD
      ignoreReturnCode: true,
      silent: true, // avoid printing command in stdout: https://github.com/actions/toolkit/issues/649
||||||| b3349c9
      ignoreReturnCode: true,
=======
      ignoreReturnCode: true
>>>>>>> main
    };

    const exitCode = await exec(pathToCLI, args, options);
    core.debug(`atmos exited with code ${exitCode}.`);
    core.debug(`stdout: ${stdout.contents}`);
    core.debug(`stderr: ${stderr.contents}`);
    core.debug(`exitcode: ${exitCode}`);

    // Pass-through stdout/err as `exec` won't anymore because we are passing `silent: true` option
    process.stdout.write(stdout.contents);
    process.stderr.write(stderr.contents);

    // Set outputs, result, exitcode, and stderr
    core.setOutput("stdout", stdout.contents);
    core.setOutput("stderr", stderr.contents);
    core.setOutput("exitcode", exitCode.toString(10));

    if (exitCode === 0 || exitCode === 2) {
      // A exitCode of 0 is considered a success
      // An exitCode of 2 may be returned when the '-detailed-exitcode' option is passed to atmos terraform plan. This denotes
      // Success with non-empty diff (changes present).
      return;
    }

    // A non-zero exitCode is considered an error
    core.setFailed(`atmos exited with code ${exitCode}.`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    core.setFailed(err);
  }
})();
