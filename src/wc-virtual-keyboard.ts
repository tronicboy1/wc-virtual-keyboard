import { queryFromEvent } from "@tronicboy/lit-from-event";
import { observe } from "@tronicboy/lit-observe-directive";
import { classMap } from "lit/directives/class-map.js";
import { LitElement, css, html } from "lit";
import { customElement } from "lit/decorators.js";
import {
  Observable,
  Subject,
  distinctUntilChanged,
  filter,
  fromEvent,
  map,
  merge,
  sampleTime,
  scan,
  shareReplay,
  startWith,
  switchMap,
  takeUntil,
  withLatestFrom,
} from "rxjs";

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

  private gain = new GainNode(this.audCtx);
  @queryFromEvent("#volume", "input", { returnElementRef: true }) volumeChange$!: Observable<HTMLInputElement>;
  private volume$ = this.volumeChange$.pipe(
    map((el) => el.value),
    map(Number),
    startWith(1),
    distinctUntilChanged(),
    shareReplay(1)
  );
  @queryFromEvent("#octave", "change", { returnElementRef: true }) octaveChange$!: Observable<HTMLInputElement>;
  private octave$ = this.octaveChange$.pipe(
    map((el) => el.value),
    map(Number),
    filter((octave) => !isNaN(octave)),
    startWith(0),
    shareReplay(1)
  );
  private keysToWatch = ["a", "s", "d", "f", "g", "h", "j", "k"];
  private physicalKeydown$ = fromEvent<KeyboardEvent>(document, "keydown").pipe(
    takeUntil(this.teardown$),
    map(({ key }) => key),
    filter((key) => this.keysToWatch.includes(key.toLowerCase()))
  );
  private physicalKeyup$ = fromEvent<KeyboardEvent>(document, "keyup").pipe(
    takeUntil(this.teardown$),
    map(({ key }) => key)
  );
  private physicalKeysDown$ = merge(
    this.physicalKeydown$.pipe(map((key) => [Action.Add, key] as const)),
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
    ["s", 6],
    ["d", 8],
    ["f", 9],
    ["g", 11],
    ["h", 13],
    ["j", 15],
    ["k", 16],
  ]);
  private physicalKeysDownMapped$ = this.physicalKeysDown$.pipe(
    map((keys) => Array.from(keys.values()).map((key) => this.keyMappings.get(key)!)),
    withLatestFrom(this.octave$),
    map(([notes, octave]) => notes.map((note) => note + octave * 13)),
    map((notes) => notes.map((note) => this.getKeyFreq(note)))
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
  private activeNotes = new Map<number, OscillatorNode>();

  constructor() {
    super();
    this.gain.connect(this.audCtx.destination);
    this.volume$.pipe(takeUntil(this.teardown$)).subscribe((volume) => {
      this.gain.gain.value = volume;
    });

    this.physicalKeysDownMapped$.subscribe((keysDown) => {
      keysDown.forEach((hz) => {
        if (this.activeNotes.has(hz)) return;
        this.startNote(hz);
      });
      this.activeNotes.forEach((node, hz) => {
        if (!keysDown.includes(hz)) {
          node.stop();
          this.activeNotes.delete(hz);
        }
      });
    });
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.currentmouseKeydown$.subscribe((hz) => {
      this.startNote(hz);
    });
    this.stop$.subscribe((hz) => {
      this.activeNotes.get(hz)?.stop();
      this.activeNotes.delete(hz);
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

  private startNote(hz: number) {
    const newOsc = this.audCtx.createOscillator();
    newOsc.connect(this.gain);
    newOsc.frequency.value = hz;
    newOsc.start();
    this.activeNotes.set(hz, newOsc);
  }

  render() {
    return html`
      <nav>
        <ul>
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
          <li>Freq: ${observe(this.currentmouseKeydown$)}</li>
          <li>
            <label for="octave">Octave</label>
            <input type="number" min="0" id="octave" value=${observe(this.octave$)} />
          </li>
        </ul>
      </nav>
      <ul class="keyboard" @mouseleave=${() => this.mouseleaveKeyboard$.next()}>
        ${observe(
          this.octave$.pipe(
            map((octave) => new Array(13).fill(0).map((_, i) => this.keys.get(octave * 12 + i + 4))),
            map((keys) => keys.filter((key): key is number => Boolean(key))),
            map((keys) => keys.map((hz, i) => [hz, this.notes[i]] as const)),
            map((keys) =>
              keys.map(
                ([hz, note]) => html`<li
                  class=${classMap({ blackkey: this.blackKeyFreqs.has(hz) })}
                  draggable
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
    }
    li {
      display: flex;
      flex-direction: column;
      margin-bottom: 1rem;
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
    }
    .keyboard li {
      height: 200px;
      padding: 0 1rem;
      display: inline-flex;
      justify-content: center;
      align-items: center;
      user-select: none;
      border: 1px solid black;
    }
    .keyboard .blackkey {
      background-color: black;
      color: white;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    [tagName]: MyElement;
  }
}
