/**
 * Acts as a listener for @actions/exec, by capturing STDOUT and STDERR streams, and exposes them via the contents
 * property.
 */
export class OutputListener {
  private _buff: Buffer[];

  constructor() {
    this._buff = [];
  }

  get listener() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const classThis = this;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const listen = function listen(data: any) {
      classThis._buff.push(data);
    };
    return listen.bind(this);
  }

  get contents() {
    return this._buff.map((chunk) => chunk.toString()).join("");
  }
}
