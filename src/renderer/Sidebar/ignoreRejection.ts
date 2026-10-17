/** Action failures are recorded in the store's lastError and rendered in the banner. */
export function ignoreRejection(promise: Promise<unknown>): void {
  void promise.catch((): void => undefined)
}