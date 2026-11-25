export function emit(key: string, value: number, accept: (value: number) => boolean): boolean {
  console.log(`${key}=${value}`);
  if (!accept(value)) {
    console.error(`invariant failed: ${key}=${value}`);
    return false;
  }
  return true;
}
