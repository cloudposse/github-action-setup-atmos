import * as core from "@actions/core";
import { exec } from "@actions/exec";
import * as io from "@actions/io";

import { runWrapper } from "../wrapper";

jest.mock("@actions/core");
jest.mock("@actions/exec");
jest.mock("@actions/io");

describe("wrapper", () => {
  const originalArgv = process.argv;
  const originalAtmosCliPath = process.env.ATMOS_CLI_PATH;

  beforeEach(() => {
    process.env.ATMOS_CLI_PATH = "/opt/atmos";
    process.argv = ["node", "atmos", "version"];
    jest.spyOn(process.stdout, "write").mockImplementation(() => true);
    jest.spyOn(process.stderr, "write").mockImplementation(() => true);
    jest.spyOn(io, "which").mockResolvedValue("/opt/atmos/atmos-bin");
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.env.ATMOS_CLI_PATH = originalAtmosCliPath;
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it("executes atmos-bin and exposes captured output", async () => {
    (exec as jest.Mock).mockImplementation(async (_tool, _args, options) => {
      options.listeners.stdout(Buffer.from("out"));
      options.listeners.stderr(Buffer.from("err"));
      return 0;
    });

    await runWrapper();

    expect(io.which).toHaveBeenCalledWith("/opt/atmos/atmos-bin", true);
    expect(exec).toHaveBeenCalledWith("/opt/atmos/atmos-bin", ["version"], {
      ignoreReturnCode: true,
      listeners: {
        stderr: expect.any(Function),
        stdout: expect.any(Function)
      },
      silent: true
    });
    expect(process.stdout.write).toHaveBeenCalledWith("out");
    expect(process.stderr.write).toHaveBeenCalledWith("err");
    expect(core.setOutput).toHaveBeenCalledWith("stdout", "out");
    expect(core.setOutput).toHaveBeenCalledWith("stderr", "err");
    expect(core.setOutput).toHaveBeenCalledWith("exitcode", "0");
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it("treats detailed-exitcode 2 as successful", async () => {
    (exec as jest.Mock).mockResolvedValue(2);

    await runWrapper();

    expect(core.setOutput).toHaveBeenCalledWith("exitcode", "2");
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it("fails for non-zero atmos exit codes other than 2", async () => {
    (exec as jest.Mock).mockResolvedValue(1);

    await runWrapper();

    expect(core.setFailed).toHaveBeenCalledWith("atmos exited with code 1.");
  });

  it("fails when atmos-bin cannot be found", async () => {
    const error = new Error("missing atmos-bin");
    jest.spyOn(io, "which").mockRejectedValue(error);

    await runWrapper();

    expect(core.setFailed).toHaveBeenCalledWith(error);
    expect(exec).not.toHaveBeenCalled();
  });
});
