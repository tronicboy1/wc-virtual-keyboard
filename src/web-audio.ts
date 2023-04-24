import { LitElement, css, html } from "lit";
import { customElement, query } from "lit/decorators.js";
import {
  Observable,
  Subject,
  distinctUntilChanged,
  filter,
  fromEvent,
  map,
  mergeMap,
  sampleTime,
  shareReplay,
  startWith,
  switchMap,
  takeUntil,
  withLatestFrom,
} from "rxjs";
import { observe } from "@tronicboy/lit-observe-directive";
import { queryFromEvent } from "@tronicboy/lit-from-event";

/**
 * An example element.
 */
@customElement("web-audio")
export class MyElement extends LitElement {
  private worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  private workerMessage$ = fromEvent<MessageEvent>(this.worker, "message");
  private teardown$ = new Subject<void>();
  private context = new AudioContext();
  private gainNode = this.context.createGain();
  private panner = new StereoPannerNode(this.context, { pan: 0 });
  private distortion = this.context.createWaveShaper();
  private state$ = fromEvent(this.context, "statechange").pipe(
    map(() => this.context.state),
    startWith(this.context.state),
    takeUntil(this.teardown$)
  );
  private playing$ = this.state$.pipe(map((state) => state === "running"));
  @query("#player") player!: HTMLAudioElement;
  @query("#river") riverEl!: HTMLAudioElement;
  @query("#play-button") playButton!: HTMLButtonElement;
  @queryFromEvent("#river", "play") play$!: Observable<Event>;
  @queryFromEvent("#river", "pause") pause$!: Observable<Event>;
  @queryFromEvent("#file", "change", { returnElementRef: true }) file$!: Observable<HTMLInputElement>;
  private audioSource$ = this.file$.pipe(
    filter((el) => !!el.files?.length),
    map((el) => el.files![0]),
    mergeMap((file) => file.arrayBuffer()),
    mergeMap((arrayBuffer) => this.context.decodeAudioData(arrayBuffer)),
    map((buffer) => new AudioBufferSourceNode(this.context, { buffer, loop: true })),
    shareReplay(1)
  );
  private loaded$ = this.audioSource$.pipe(
    map(() => true),
    startWith(false)
  );
  @queryFromEvent("#play-button", "click") playClick$!: Observable<Event>;
  @queryFromEvent("#volume", "input", { returnElementRef: true }) volumeChange$!: Observable<HTMLInputElement>;
  private volume$ = this.volumeChange$.pipe(
    map((el) => el.value),
    map(Number),
    startWith(1),
    distinctUntilChanged(),
    takeUntil(this.teardown$),
    shareReplay(1)
  );
  @queryFromEvent("#panner", "input", { returnElementRef: true }) panChange$!: Observable<HTMLInputElement>;
  private pan$ = this.panChange$.pipe(
    map((el) => el.value),
    map(Number),
    startWith(0),
    distinctUntilChanged(),
    takeUntil(this.teardown$),
    shareReplay(1)
  );
  @queryFromEvent("#distort", "input", { returnElementRef: true }) distortChange$!: Observable<HTMLInputElement>;
  private distortOn$ = this.distortChange$.pipe(
    map((el) => el.checked),
    startWith(false),
    takeUntil(this.teardown$)
  );

  constructor() {
    super();
    this.context.audioWorklet.addModule(new URL("./audio-processor.worker.ts", import.meta.url));
    this.workerMessage$.subscribe((message) => console.log("message from ww: ", message));
    this.worker.postMessage("hello from mt");
    this.volume$.subscribe((volume) => {
      this.gainNode.gain.value = volume;
    });

    this.audioSource$.subscribe((audioBuffer) => {
      //const myAudioProcessor = new AudioWorkletNode(this.context, "my-audio-processor");
      audioBuffer
        .connect(this.gainNode)
        .connect(this.panner)
        .connect(this.distortion)
        //.connect(myAudioProcessor)
        .connect(this.context.destination);
      audioBuffer.start();
    });

    this.pan$.subscribe((pan) => (this.panner.pan.value = pan));

    this.audioSource$
      .pipe(
        switchMap(() => this.playClick$),
        withLatestFrom(this.state$)
      )
      .subscribe(([_, state]) => {
        if (state === "suspended") {
          this.context.resume();
        } else {
          this.context.suspend();
        }
      });

    this.distortOn$.subscribe((on) => {
      this.distortion.curve = on ? this.makeDistortionCurve(4000) : null;
    });
    this.distortion.oversample = "4x";
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.teardown$.next();
  }
  private sampleRate = 44100;

  private makeDistortionCurve(amount: number) {
    const curve = new Float32Array(this.sampleRate);
    const deg = Math.PI / 180;

    // sigmoid curve
    // https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/createWaveShaper#examples
    for (let i = 0; i < this.sampleRate; i++) {
      const x = (i * 2) / this.sampleRate - 1;
      curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
    }
    return curve;
  }

  render() {
    return html`
      <audio id="player"></audio>
      <h1>Controls</h1>
      <nav>
        <ul>
          <li>
            <label for="file">Input</label>
            <input id="file" type="file" accept="audio/mp3">
          </li>
          ${observe(
            this.loaded$.pipe(
              map((loaded) =>
                loaded
                  ? html`<li>
                      <button data-playing=${observe(this.playing$)} id="play-button" type="button">
                        ${observe(this.playing$.pipe(map((playing) => (playing ? "Pause" : "Play"))))}
                      </button>
                    </li>`
                  : ""
              )
            )
          )}
          <li>
            <label for="volume">Volume: ${observe(this.volume$)}</label>
            <input
              type="range"
              id="volume"
              min="0"
              max="2"
              value="1"
              step="0.01"
              value=${observe(this.volume$.pipe(sampleTime(500)))}
            />
          </li>
          <li>
            <label for="panner"
              >Pan:
              ${observe(
                this.pan$.pipe(
                  map(Math.abs),
                  map((pan) => pan * 100),
                  map(Math.floor)
                )
              )}%
              ${observe(this.pan$.pipe(map((pan) => (pan > 0 ? "Right" : pan < 0 ? "Left" : "Center"))))}</label
            >
            <input type="range" id="panner" min="-1" max="1" value="0" step="0.01" />
          </li>
          <li>
            <lable for="distortion">Distort</label>
            <input type="checkbox" id="distort" >
          </li>
        </ul>
      </nav>
    `;
  }

  static styles = css`
    li {
      display: flex;
      flex-direction: column;
      margin-bottom: 1rem;
    }
    :host {
      max-width: 1280px;
      margin: 0 auto;
      padding: 2rem;
      text-align: center;
    }

    .logo {
      height: 6em;
      padding: 1.5em;
      will-change: filter;
      transition: filter 300ms;
    }
    .logo:hover {
      filter: drop-shadow(0 0 2em #646cffaa);
    }
    .logo.lit:hover {
      filter: drop-shadow(0 0 2em #325cffaa);
    }

    .card {
      padding: 2em;
    }

    .read-the-docs {
      color: #888;
    }

    h1 {
      font-size: 3.2em;
      line-height: 1.1;
    }

    a {
      font-weight: 500;
      color: #646cff;
      text-decoration: inherit;
    }
    a:hover {
      color: #535bf2;
    }

    button {
      border-radius: 8px;
      border: 1px solid transparent;
      padding: 0.6em 1.2em;
      font-size: 1em;
      font-weight: 500;
      font-family: inherit;
      background-color: #1a1a1a;
      cursor: pointer;
      transition: border-color 0.25s;
    }
    button:hover {
      border-color: #646cff;
    }
    button:focus,
    button:focus-visible {
      outline: 4px auto -webkit-focus-ring-color;
    }

    @media (prefers-color-scheme: light) {
      a:hover {
        color: #747bff;
      }
      button {
        background-color: #f9f9f9;
      }
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "web-audio": MyElement;
  }
}
