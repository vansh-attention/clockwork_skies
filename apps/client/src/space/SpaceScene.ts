export class Resources {
  private readonly values = new Set<{ dispose(): void }>();

  own<R extends { dispose(): void }>(value: R): R {
    this.values.add(value);
    return value;
  }

  get size(): number { return this.values.size; }

  dispose(): void {
    for (const value of this.values) value.dispose();
    this.values.clear();
  }
}
