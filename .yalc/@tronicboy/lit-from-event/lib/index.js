import { from, fromEvent, map, switchMap } from "rxjs";
export function queryFromEvent(selector, event, options) {
    return (proto, name) => {
        const descriptor = {
            get() {
                return from(this.updateComplete).pipe(map(() => this.renderRoot.querySelector(selector)), switchMap((element) => {
                    if (!element)
                        throw ReferenceError("NoElementFound");
                    const operations = [];
                    if (options?.returnElementRef) {
                        operations.push(map(() => element));
                    }
                    return operations.reduce((ob, op) => ob.pipe(op), fromEvent(element, event));
                }));
            },
            enumerable: true,
            configurable: true,
        };
        return Object.defineProperty(proto, name, descriptor);
    };
}
