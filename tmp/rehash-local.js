import fs from 'node:fs';
import { HashWriter, fnv1a32, SIMULATION_STATE_VERSION } from '../src/game/core/SimulationState.ts';
function hashWithLocal(state){
  const writer = new HashWriter();
  writer.u32(SIMULATION_STATE_VERSION);
  writer.f64(state.seed);
  writer.f64(state.frameId);
  writer.value(state.values);
  writer.value(state.localValues);
  writer.value(state.timers);
  writer.value(state.prngs);
  writer.value(state.entities);
  writer.value(state.physics);
  return fnv1a32(writer.toBytes());
}
const files = process.argv.slice(2);
for (const f of files) {
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const frame of [210, 215, 220]) {
    const entry = j.frames.find(x => x.data?.phase === 'end' && x.data.frameId === frame && x.data.state);
    if (!entry) continue;
    const state = entry.data.state;
    console.log(j.meta.myId, frame, 'logged', entry.data.h32, 'withLocal', hashWithLocal(state));
  }
}
