import { Subject, map, startWith } from "rxjs";

export class MapSubject<T, U> extends Map<T, U> {
  private changeSubject = new Subject<void>();
  readonly value$ = this.changeSubject.pipe(
    map(() => this),
    startWith(this)
  );

  override set(key: T, value: U): this {
    super.set(key, value);
    this.changeSubject.next();
    return this;
  }

  override delete(key: T): boolean {
    const result = super.delete(key);
    if (result) {
      this.changeSubject.next();
    }
    return result;
  }
}
