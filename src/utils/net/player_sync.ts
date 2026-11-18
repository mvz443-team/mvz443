// 加载进度同步的纯逻辑：无 Phaser / React 依赖，便于单元测试。

export interface PlayerSyncInfo {
    playerId: number;
    progress: number;
    name: string;
    loaded: boolean;
}

/** 服务端下发的 1..100 整数进度；非法值收敛到 0..100，并向下取整。 */
export function clampLoadProgress(value: unknown): number {
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric)) {
        return 0;
    }
    return Math.max(0, Math.min(100, Math.floor(numeric)));
}

/** 单调推进：乱序/回退的上报不能让进度倒退。 */
export function advanceLoadProgress(current: number, reported: unknown): number {
    return Math.max(current, clampLoadProgress(reported));
}

/** 是否全员加载完成（至少一人，且所有人 progress>=100）。 */
export function allPlayersLoaded(players: readonly PlayerSyncInfo[]): boolean {
    return players.length > 0 && players.every((player) => player.loaded || player.progress >= 100);
}

/** 按 playerId 排序，保证各客户端显示的玩家顺序一致。 */
export function sortPlayers(players: readonly PlayerSyncInfo[]): PlayerSyncInfo[] {
    return [...players].sort((a, b) => a.playerId - b.playerId);
}

/** 把 protobuf 的 PlayerSyncProgress[] 归一化为 UI 使用的结构。 */
export function normalizeSyncPlayers(
    raw: readonly { playerId?: number; progress?: number; name?: string; loaded?: boolean }[] | undefined,
): PlayerSyncInfo[] {
    if (!raw) {
        return [];
    }
    return sortPlayers(raw.map((entry) => {
        const progress = clampLoadProgress(entry.progress);
        return {
            playerId: Number(entry.playerId ?? 0),
            progress,
            name: entry.name || `player${entry.playerId ?? 0}`,
            loaded: Boolean(entry.loaded) || progress >= 100,
        };
    }));
}

/** 合并新的同步快照：保留本地单调进度，避免乱序 roomSync 让 UI 回退。 */
export function mergeSyncPlayers(previous: readonly PlayerSyncInfo[], incoming: readonly PlayerSyncInfo[]): PlayerSyncInfo[] {
    const byId = new Map<number, PlayerSyncInfo>();
    for (const player of previous) {
        byId.set(player.playerId, { ...player });
    }
    for (const player of incoming) {
        const old = byId.get(player.playerId);
        const progress = advanceLoadProgress(old?.progress ?? 0, player.progress);
        byId.set(player.playerId, {
            playerId: player.playerId,
            progress,
            name: player.name || old?.name || `player${player.playerId}`,
            loaded: player.loaded || old?.loaded || progress >= 100,
        });
    }
    return sortPlayers([...byId.values()]);
}
