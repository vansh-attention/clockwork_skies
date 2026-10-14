export const metrics = {
  rooms: 0,
  ticks: 0,
  tickDurationTotalMs: 0,
  tickDurationMaxMs: 0,
  joins: 0,
  disconnects: 0,
  matchesCompleted: 0,
  botsCreated: 0,
};

export function metricsText() {
  const mean = metrics.ticks ? metrics.tickDurationTotalMs / metrics.ticks : 0;
  return [
    `clockwork_rooms ${metrics.rooms}`,
    `clockwork_ticks_total ${metrics.ticks}`,
    `clockwork_tick_duration_mean_ms ${mean.toFixed(3)}`,
    `clockwork_tick_duration_max_ms ${metrics.tickDurationMaxMs.toFixed(3)}`,
    `clockwork_joins_total ${metrics.joins}`,
    `clockwork_disconnects_total ${metrics.disconnects}`,
    `clockwork_matches_completed_total ${metrics.matchesCompleted}`,
    `clockwork_bots_created_total ${metrics.botsCreated}`,
  ].join("\n") + "\n";
}
