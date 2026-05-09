export const UIDepth = {
  inGame(order: number): number {
    return 1900000 + order * 1000;
  },

  unimportant(order: number): number {
    return 1000 + order;
  },

  threshold(): number {
    return this.inGame(0);
  },

  plantingPreview(): number {
    return this.inGame(-5);
  },

  debugWorld(): number {
    return this.inGame(-10);
  },

  debugHint(): number {
    return this.menuLayerBehind(10) + 1;
  },

  cursorTool(): number {
    return this.inGame(50);
  },

  waitingText(): number {
    return this.inGame(60);
  },

  debugFrameText(): number {
    return this.inGame(61);
  },

  chrome(): number {
    return this.inGame(80);
  },

  chromeLane(): number {
    return this.chrome() + 1;
  },

  chromeContainer(): number {
    return this.chrome() + 1;
  },

  chromeControl(): number {
    return this.chrome() + 2;
  },

  menu(): number {
    return 2000000;
  },

  menuLayerBehind(amount: number): number {
    return this.menu() - amount;
  },

  bossSkillAnnounce(): number {
    return this.menuLayerBehind(1);
  },

  broadcast(): number {
    return this.menu();
  },

  pauseMenu(): number {
    return 5000000;
  },
};
