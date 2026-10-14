import { stepAircraft, type AircraftState, type InputCommand } from "@clockwork/shared";

export class LocalPredictor {
  private predicted: AircraftState | null = null;
  private pending: InputCommand[] = [];

  push(input: InputCommand) {
    this.pending.push(input);
    if (this.pending.length > 120) this.pending.shift();
    if (this.predicted) stepAircraft(this.predicted, input, 1 / 30);
  }

  reconcile(authoritative: AircraftState) {
    this.pending = this.pending.filter((input) => input.sequence > authoritative.lastInputSequence);
    // Never replay on top of a prediction that already contains these commands.
    this.predicted = structuredClone(authoritative);
    for (const input of this.pending) stepAircraft(this.predicted, input, 1 / 30);
  }

  reset() { this.predicted = null; this.pending = []; }
  get value() { return this.predicted; }
}
