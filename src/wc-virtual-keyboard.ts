import { queryFromEvent } from "@tronicboy/lit-from-event";
import { observe } from "@tronicboy/lit-observe-directive";
import { classMap } from "lit/directives/class-map.js";
import { LitElement, css, html } from "lit";
import { customElement, query } from "lit/decorators.js";
import {
  Observable,
  OperatorFunction,
  Subject,
  combineLatest,
  distinctUntilChanged,
  filter,
  fromEvent,
  interval,
  map,
  merge,
  scan,
  shareReplay,
  skip,
  startWith,
  switchMap,
  take,
  takeUntil,
  withLatestFrom,
} from "rxjs";
import { MapSubject } from "./map-subject";

export const tagName = "wc-virtual-keyboard";

enum Action {
  Add = 1,
  Delete,
}

/**
 * An example element.
 */
@customElement(tagName)
export class MyElement extends LitElement {
  private teardown$ = new Subject<void>();
  private audCtx = new AudioContext();

  private masterGain = new GainNode(this.audCtx);
  @queryFromEvent("#volume", "input", { returnElementRef: true }) volumeChange$!: Observable<HTMLInputElement>;
  private volumeChangeNumber$ = this.volumeChange$.pipe(
    map((el) => el.value),
    map(Number)
  );
  private volumeSubject = new Subject<number>();
  private volume$ = merge(this.volumeChangeNumber$, this.volumeSubject).pipe(
    filter((volume) => volume >= 0 && volume <= 2),
    startWith(0.5),
    distinctUntilChanged(),
    shareReplay(1)
  );
  @queryFromEvent("#octave", "change", { returnElementRef: true }) octaveChange$!: Observable<HTMLInputElement>;
  private octaveChangeNumber$ = this.octaveChange$.pipe(
    map((el) => el.value),
    map(Number)
  );
  private octaveSubject = new Subject<number>();
  private octave$ = merge(this.octaveChangeNumber$, this.octaveSubject).pipe(
    filter((octave) => !isNaN(octave) && octave >= 0 && octave <= 7),
    startWith(3),
    shareReplay(1)
  );
  private keysToWatch = ["a", "s", "d", "f", "g", "h", "j", "k", "w", "e", "t", "y", "u"];
  private physicalKeydown$ = fromEvent<KeyboardEvent>(document, "keydown").pipe(
    takeUntil(this.teardown$),
    map(({ key }) => key)
  );
  private physicalKeyup$ = fromEvent<KeyboardEvent>(document, "keyup").pipe(
    takeUntil(this.teardown$),
    map(({ key }) => key)
  );
  private physicalKeysDown$ = merge(
    this.physicalKeydown$.pipe(
      filter((key) => this.keysToWatch.includes(key.toLowerCase())),
      map((key) => [Action.Add, key] as const)
    ),
    this.physicalKeyup$.pipe(map((key) => [Action.Delete, key] as const))
  ).pipe(
    distinctUntilChanged((a, b) => a[0] === b[0] && a[1] === b[1]),
    scan((acc, [action, key]) => {
      switch (action) {
        case Action.Delete:
          acc.delete(key);
          break;
        case Action.Add:
          acc.add(key);
          break;
      }
      return acc;
    }, new Set<string>())
  );
  private keyMappings = new Map([
    ["a", 4],
    ["w", 5],
    ["s", 6],
    ["e", 7],
    ["d", 8],
    ["f", 9],
    ["t", 10],
    ["g", 11],
    ["y", 12],
    ["h", 13],
    ["u", 14],
    ["j", 15],
    ["k", 16],
  ]);
  private physicalKeysDownMappedSet$ = this.physicalKeysDown$.pipe(
    withLatestFrom(this.octave$),
    map(([keys, octave]) => {
      const keysMappedToFreq = new Set<number>();
      keys.forEach((key) => {
        const pianoKeyNo = this.keyMappings.get(key);
        if (!pianoKeyNo) return;
        const keyNoAdjustedToOctave = octave * 12 + pianoKeyNo;
        keysMappedToFreq.add(this.getKeyFreq(keyNoAdjustedToOctave));
      });
      return keysMappedToFreq;
    })
  );
  private physicalKeysDownMapped$ = this.physicalKeysDown$.pipe(
    map((keys) => Array.from(keys.values()).map((key) => this.keyMappings.get(key)!)),
    withLatestFrom(this.octave$),
    map(([notes, octave]) => notes.map((note) => note + octave * 12)),
    map((notes) => notes.map((note) => this.getKeyFreq(note)))
  );
  private upDownKeydown$ = this.physicalKeydown$.pipe(
    filter((key): key is "ArrowUp" | "ArrowDown" => key === "ArrowUp" || key === "ArrowDown")
  );
  private lRKeydown$ = this.physicalKeydown$.pipe(
    filter((key): key is "ArrowLeft" | "ArrowRight" => key === "ArrowLeft" || key === "ArrowRight")
  );

  private mouseKeydown$ = new Subject<number>();
  private keyup$ = new Subject<number>();
  private mouseleave$ = new Subject<number>();
  private mouseleaveKeyboard$ = new Subject<void>();
  private mousemove$ = new Subject<number>();
  private currentmouseKeydown$ = this.mouseKeydown$.pipe(
    switchMap((hz) =>
      this.mousemove$.pipe(
        startWith(hz),
        takeUntil(this.keyup$),
        takeUntil(this.mouseleaveKeyboard$),
        distinctUntilChanged()
      )
    )
  );
  private stop$ = merge(this.keyup$, this.mouseleave$);
  private mouseKeysDownSet$ = merge(
    this.currentmouseKeydown$.pipe(map<number, [Action, number]>((hz) => [Action.Add, hz])),
    this.stop$.pipe(map<number, [Action, number]>((hz) => [Action.Delete, hz]))
  ).pipe(this.scanActiveKeys());
  private mergedKeysDown$ = combineLatest([this.physicalKeysDownMappedSet$, this.mouseKeysDownSet$]).pipe(
    map(([keyboard, mouse]) => new Set([...keyboard, ...mouse]))
  );
  private activeNotes = new MapSubject<number, { osc: OscillatorNode; gain: GainNode }>();
  @queryFromEvent("#distort", "input", { returnElementRef: true }) distortChange$!: Observable<HTMLInputElement>;
  private distortOn$ = this.distortChange$.pipe(
    map((el) => el.checked),
    startWith(false),
    takeUntil(this.teardown$),
    shareReplay(1)
  );
  private distortion = this.audCtx.createWaveShaper();
  private analyser = this.audCtx.createAnalyser();
  private byteTimeDomainData$ = this.activeNotes.value$.pipe(
    skip(1),
    switchMap((notes) => (notes.size ? interval(10) : interval(10).pipe(take(50)))),
    map(() => {
      const bufferLength = this.analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      this.analyser.getByteTimeDomainData(dataArray);
      return dataArray;
    })
  );
  @query("canvas") canvas!: HTMLCanvasElement;
  private canvasWorker = new Worker(new URL("./visualizer-worker.ts", import.meta.url), { type: "module" });

  constructor() {
    super();
    this.distortion.curve = this.makeDistortionCurve(4000);
    this.distortion.oversample = "4x";
    this.masterGain.connect(this.audCtx.destination);
    this.masterGain.connect(this.analyser);
    this.analyser.fftSize = 2 ** 12;
    this.upDownKeydown$
      .pipe(withLatestFrom(this.octave$))
      .subscribe(([arrow, octave]) => this.octaveSubject.next(arrow === "ArrowUp" ? octave + 1 : octave - 1));
    this.lRKeydown$
      .pipe(withLatestFrom(this.volume$))
      .subscribe(([arrow, volume]) => this.volumeSubject.next(arrow === "ArrowLeft" ? volume - 0.1 : volume + 0.1));
    this.updateComplete.then(() => {
      const offscreen = this.canvas.transferControlToOffscreen();
      this.canvasWorker.postMessage(offscreen, [offscreen]);
    });
    this.byteTimeDomainData$
      .pipe(takeUntil(this.teardown$))
      .subscribe((dataArray) => this.canvasWorker.postMessage(dataArray, [dataArray.buffer]));
    this.mergedKeysDown$.subscribe(console.log);
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.volume$.pipe(takeUntil(this.teardown$)).subscribe((volume) => {
      this.masterGain.gain.value = volume;
    });
    this.currentmouseKeydown$
      .pipe(withLatestFrom(this.distortOn$))
      .subscribe(([hz, distort]) => this.startNote(hz, distort));
    this.stop$.subscribe((hz) => this.stopNote(hz));
    this.physicalKeysDownMapped$.pipe(withLatestFrom(this.distortOn$)).subscribe(([keysDown, distort]) => {
      keysDown.forEach((hz) => {
        if (this.activeNotes.has(hz)) return;
        this.startNote(hz, distort);
      });
      this.activeNotes.forEach((_, hz) => {
        if (!keysDown.includes(hz)) {
          this.stopNote(hz);
        }
      });
    });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.teardown$.next();
  }
  private sampleRate = 44100;

  private keyCount = 88;
  private readonly keys = new Map(new Array(this.keyCount).fill(0).map((_, i) => [i + 1, this.getKeyFreq(i + 1)]));
  private readonly blackKeyFreqs = this.getUnnaturalFreqs();
  private readonly notes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B", "C"];
  private getKeyFreq(n: number): number {
    return 2 ** ((n - 49) / 12) * 440;
  }
  private getUnnaturalFreqs(): Set<number> {
    const freqs = new Set<number>();
    freqs.add(this.getKeyFreq(2));
    let currentNoteInOctave = 1;
    let prevBlackCountWasTwo = false;
    let blackCount = 0;
    let prevWasWhite = false;
    let nextIsExtraWhite = false;
    for (let index = 4; index <= this.keyCount; index++) {
      if (prevWasWhite && !nextIsExtraWhite) {
        freqs.add(this.getKeyFreq(index));
        prevWasWhite = false;
        blackCount += 1;
      } else {
        prevWasWhite = true;
      }

      if ((blackCount === 2 && !prevBlackCountWasTwo) || blackCount === 3) {
        if (prevBlackCountWasTwo) {
          prevBlackCountWasTwo = false;
        } else {
          prevBlackCountWasTwo = true;
        }
        blackCount = 0;
        index += 1;
        currentNoteInOctave += 1;
      }

      if (currentNoteInOctave === 13) {
        currentNoteInOctave = 1;
        prevBlackCountWasTwo = false;
        prevWasWhite = true;
        blackCount = 0;
      }
      currentNoteInOctave += 1;
    }
    return freqs;
  }

  private startNote(hz: number, distortion?: boolean) {
    if (this.activeNotes.has(hz)) return;
    const osc = this.audCtx.createOscillator();
    const gain = this.audCtx.createGain();
    gain.gain.linearRampToValueAtTime(0.6, this.audCtx.currentTime + 0.1);
    if (distortion) {
      osc.connect(this.distortion).connect(gain).connect(this.masterGain);
    } else {
      osc.connect(gain).connect(this.masterGain);
    }
    osc.frequency.value = hz;
    osc.start();
    this.activeNotes.set(hz, { osc, gain });
  }

  private stopNote(hz: number) {
    if (!this.activeNotes.has(hz)) return;
    const { osc, gain } = this.activeNotes.get(hz)!;
    const stopTime = this.audCtx.currentTime + 0.3;
    gain.gain.linearRampToValueAtTime(0, stopTime);
    osc.stop(stopTime);
    this.activeNotes.delete(hz);
  }

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

  private scanActiveKeys<T extends string | number>(): OperatorFunction<[Action, T], Set<T>> {
    return (source) =>
      source.pipe(
        distinctUntilChanged((a, b) => a[0] === b[0] && a[1] === b[1]),
        scan((acc, [action, key]) => {
          switch (action) {
            case Action.Delete:
              acc.delete(key);
              break;
            case Action.Add:
              acc.add(key);
              break;
          }
          return acc;
        }, new Set<T>()),
        distinctUntilChanged((a, b) => b.size === 0)
      );
  }

  render() {
    return html`
      <nav class="controls">
        <ul>
          <li>
            <label for="volume">Volume: ${observe(this.volume$.pipe(map((vol) => vol.toFixed(1))))}</label>
            <input type="range" id="volume" min="0" max="2" value="1" step="0.01" value=${observe(this.volume$)} />
          </li>
          <li>
            Freq:
            <small
              >${observe(
                this.activeNotes.value$.pipe(map((notes) => (notes.size === 1 ? notes.keys().next().value : "")))
              )}</small
            >
          </li>
          <li>
            <label for="octave">Octave</label>
            <input type="number" min="0" max="7" id="octave" value=${observe(this.octave$)} />
          </li>
          <li>
            <label for="distort">Distort</label>
            <input type="checkbox" id="distort" name="distort" .checked=${observe(this.distortOn$)} />
          </li>
        </ul>
      </nav>
      <canvas height="600" width="1200"></canvas>
      <ul class="keyboard" @mouseleave=${() => this.mouseleaveKeyboard$.next()}>
        ${observe(
          this.octave$.pipe(
            map((octave) => new Array(13).fill(0).map((_, i) => this.keys.get(octave * 12 + i + 4))),
            map((keys) => keys.filter((key): key is number => Boolean(key))),
            map((keys) => keys.map((hz, i) => [hz, this.notes[i]] as const)),
            map((keys) =>
              keys.map(
                ([hz, note]) => html`<li
                  class=${observe(
                    this.activeNotes.value$.pipe(
                      map((notes) => classMap({ blackkey: this.blackKeyFreqs.has(hz), pressed: notes.has(hz) }))
                    )
                  )}
                  @mousedown=${() => this.mouseKeydown$.next(hz)}
                  @mouseup=${() => this.keyup$.next(hz)}
                  @mousemove=${() => this.mousemove$.next(hz)}
                  @mouseleave=${() => this.mouseleave$.next(hz)}
                >
                  ${note}
                </li>`
              )
            )
          )
        )}
      </ul>
    `;
  }

  static styles = css`
    * {
      box-sizing: border-box;
    }
    :host {
      margin: 0 auto;
      text-align: center;
      display: flex;
      flex-direction: column;
      justify-content: center;
      width: 600px;
      height: 580px;
    }
    li {
      display: flex;
      flex-direction: column;
      margin-bottom: 1rem;
      align-items: center;
    }
    ul {
      list-style-type: none;
      margin: 0;
      padding: 0;
    }
    .keyboard {
      display: flex;
      flex-direction: row;
      margin: 0;
      user-select: none;
    }
    .keyboard li {
      height: 200px;
      flex: 1;
      display: inline-flex;
      justify-content: center;
      align-items: center;
      user-select: none;
      -webkit-user-select: none;
      border: 1px solid grey;
      border-radius: 0 0 4px 4px;
    }
    .keyboard .blackkey {
      background-color: black;
      color: white;
      border-color: black;
    }
    .keyboard .pressed {
      background-color: grey;
    }

    .controls {
      margin-bottom: 0.5rem;
    }
    .controls ul {
      display: flex;
      flex-direction: row;
      width: 100%;
    }

    .controls li {
      margin: 0 1rem;
    }
    .controls li:first-child {
      margin-left: 0;
    }
    .controls li:last-child {
      margin-right: 0;
    }
    .controls small {
      width: 44px;
      overflow: hidden;
    }
    .controls input[type="number"] {
      width: 40px;
    }
    label {
      user-select: none;
    }
    canvas {
      border: solid 1px grey;
      border-radius: 4px 4px 0 0;
      border-bottom: none;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    [tagName]: MyElement;
  }
}
