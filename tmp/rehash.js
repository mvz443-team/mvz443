import fs from 'node:fs';
import { hashSimulationState } from '../src/game/core/SimulationState.ts';
const files = process.argv.slice(2);
for (const f of files) {
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const frame of [210, 215, 220]) {
    const entry = j.frames.find(x => x.data?.phase === 'end' && x.data.frameId === frame && x.data.state);
    if (!entry) { console.log(f, frame, 'no state'); continue; }
    const state = entry.data.state;
    const h = hashSimulationState(state);
    console.log(j.meta.myId, frame, 'logged', entry.data.h32, 'computed', h.h32, 'match', entry.data.h32 === h.h32);
  }
}
