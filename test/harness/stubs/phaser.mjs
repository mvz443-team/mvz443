class EventEmitter {
  constructor() {
    this.listeners = new Map();
  }
  on(name, fn) {
    const list = this.listeners.get(name) ?? [];
    list.push(fn);
    this.listeners.set(name, list);
    return this;
  }
  once(name, fn) {
    const wrap = (...args) => {
      this.off(name, wrap);
      fn(...args);
    };
    return this.on(name, wrap);
  }
  off(name, fn) {
    const list = this.listeners.get(name);
    if (!list) return this;
    this.listeners.set(name, list.filter((item) => item !== fn));
    return this;
  }
  emit(name, ...args) {
    for (const fn of [...(this.listeners.get(name) ?? [])]) fn(...args);
    return true;
  }
  removeAllListeners(name) {
    if (name === undefined) this.listeners.clear();
    else this.listeners.delete(name);
    return this;
  }
}

class StubScene {}

const NativeMath = globalThis.Math;

const Phaser = {
  Scene: StubScene,
  AUTO: 0,
  Game: class {},
  Events: { EventEmitter },
  Math: {
    Clamp: (value, min, max) => NativeMath.max(min, NativeMath.min(max, value)),
    Between: (min, max) => min + NativeMath.floor(NativeMath.random() * (max - min + 1)),
  },
  GameObjects: {
    Sprite: class {},
    Image: class {},
    Text: class {},
    Group: class {},
    Zone: class {},
    Rectangle: class {},
  },
  Tweens: { Tween: class {} },
  Time: { TimerEvent: class {} },
  Display: { Color: { GetColor: () => 0xffffff } },
  BlendModes: { NORMAL: 0 },
  Scale: { FIT: 0 },
};

export default Phaser;
export const Scene = StubScene;
export const AUTO = 0;
export const Game = Phaser.Game;
export const Events = Phaser.Events;
export const Math = Phaser.Math;
export const GameObjects = Phaser.GameObjects;
export const Tweens = Phaser.Tweens;
export const Display = Phaser.Display;
