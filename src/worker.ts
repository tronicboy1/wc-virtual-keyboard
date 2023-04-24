/// <reference lib="webworker" />
import { fromEvent } from "rxjs";

console.log("worker start");

const message$ = fromEvent<MessageEvent>(self, "message");

message$.subscribe((message) => {
  console.log("WW: ", message);
  self.postMessage(`Message received: ${message.data}`);
});
