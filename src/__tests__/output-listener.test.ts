import { OutputListener } from "../output-listener";

describe("output-listener", () => {
  it("receives and exposes data", () => {
    const listener = new OutputListener();
    const listen = listener.listener;
    listen(Buffer.from("foo"));
    listen(Buffer.from("bar"));
    listen(Buffer.from("baz"));
    listen(Buffer.from("bat"));

    expect(listener.contents).toEqual("foobarbazbat");
  });
});

