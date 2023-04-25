/// <reference lib="webworker" />

import { filter, first, fromEvent, map, shareReplay, withLatestFrom } from "rxjs";

const message$ = fromEvent<MessageEvent>(self, "message");
const data$ = message$.pipe(map(({ data }) => data));
const canvas$ = data$.pipe(
  filter((data): data is OffscreenCanvas => data instanceof OffscreenCanvas),
  shareReplay(1)
);
const ctx$ = canvas$.pipe(
  map((canvas) => ({ context: canvas.getContext("2d")!, h: canvas.height, w: canvas.width })),
  shareReplay(1)
);
const dataArray$ = data$.pipe(filter((d): d is Uint8Array => d instanceof Uint8Array));

ctx$.pipe(first()).subscribe(({ context, w, h }) => {
  context.fillStyle = "rgb(200, 200, 200)";
  context.fillRect(0, 0, w, h);
});

dataArray$.pipe(withLatestFrom(ctx$)).subscribe(([dataArray, { context, w, h }]) => {
  // https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Visualizations_with_Web_Audio_API
  const bufferLength = dataArray.length;
  context.fillStyle = "rgb(200, 200, 200)";
  context.fillRect(0, 0, w, h);
  context.lineWidth = 2;
  context.strokeStyle = "rgb(0, 0, 0)";
  context.beginPath();
  const sliceWidth = w / bufferLength;
  let x = 0;
  for (let i = 0; i < bufferLength; i++) {
    const v = dataArray[i] / 128.0;
    const y = v * (h / 2);
    if (i === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
    x += sliceWidth;
  }
  context.lineTo(w, h / 2);
  context.stroke();
});
