/**
 * Use to generate event observables in a LitElement
 *
 * @example
 * @queryFromEvent("audio#river", "play") play$!: Observable<Event>;
 */
export declare function queryFromEvent<T extends HTMLElement = HTMLElement>(selector: string, event: string, options: {
    returnElementRef: true;
}): any;
export declare function queryFromEvent<T extends Event = Event>(selector: string, event: string, options: {
    returnElementRef: false;
}): any;
export declare function queryFromEvent<T extends Event = Event>(selector: string, event: string): any;
