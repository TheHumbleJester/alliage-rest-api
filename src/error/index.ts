export class HttpError<C extends number, P> extends Error {
  constructor(public code: C, public payload: P) {
    super(`HTTP Error: ${code}`);
  }

  getData() {
    return {
      code: this.code,
      payload: this.payload
    }
  }
}

export function createHttpError<C extends number, P>(code: C, payload: P) {
  return new HttpError<C, P>(code, payload)
}