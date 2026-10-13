export class DataEnvelope<T> {
  constructor(public data: T) {}
}
export function data<T>(value: T): DataEnvelope<T> {
  return new DataEnvelope(value);
}
