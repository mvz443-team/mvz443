import React, { createContext, useContext, ReactNode } from "react";
import { useCreation } from "ahooks";
import Dexie, { Table } from "dexie";
import { hydrateGoodsItem } from "../types/goods";

// 定义数据模型
interface Plant {
    pid: number;
    level: number;
}

interface Zombie {
    mid: number;
}

interface Item {
    id: number;
    count: number;
    nameKey?: string;
    iconKey?: string;
    descriptionKey?: string;
}

interface SerializedItem {
    id: number;
    count: number;
    type?: number;
    nameKey?: string;
    iconKey?: string;
    descriptionKey?: string;
}

export type LevelStatus = "locked" | "unlocked" | "pass";

export interface LevelProgress {
    levelId: number;
    chapterId: number;
    status: LevelStatus;
}

type SerializedLevelProgress = number | Partial<LevelProgress>;
type LevelProgressRef = Pick<LevelProgress, "levelId" | "chapterId">;

const LEVEL_STATUS_RANK: Record<LevelStatus, number> = {
    locked: 0,
    unlocked: 1,
    pass: 2,
};

export interface GameProgress {
    id?: number; // Dexie 会自动管理主键
    level: LevelProgress[];
    plants: Plant[];
    zombies: Zombie[];
    items: Map<number, Item>;
    slotNum: number;
    updatedAt: Date;
}

function isLevelStatus(value: unknown): value is LevelStatus {
    return value === "locked" || value === "unlocked" || value === "pass";
}

function levelProgressKey(chapterId: number, levelId: number): string {
    return `${chapterId}:${levelId}`;
}

function parseSerializedLevelProgress(item: SerializedLevelProgress): LevelProgress | null {
    if (typeof item === "number") {
        return {
            levelId: item,
            chapterId: 1,
            status: "unlocked",
        };
    }

    const levelId = Number(item.levelId);
    const chapterId = Number(item.chapterId ?? 1);
    if (!Number.isInteger(levelId) || !Number.isInteger(chapterId)) {
        return null;
    }

    return {
        levelId,
        chapterId,
        status: isLevelStatus(item.status) ? item.status : "unlocked",
    };
}

function mergeLevelProgress(progressMap: Map<string, LevelProgress>, nextProgress: LevelProgress): void {
    const key = levelProgressKey(nextProgress.chapterId, nextProgress.levelId);
    const currentProgress = progressMap.get(key);
    if (!currentProgress || LEVEL_STATUS_RANK[nextProgress.status] > LEVEL_STATUS_RANK[currentProgress.status]) {
        progressMap.set(key, nextProgress);
    }
}

function normalizeLevelProgress(levelData: unknown, completedLevelData?: unknown): LevelProgress[] {
    const progressMap = new Map<string, LevelProgress>();

    if (Array.isArray(levelData)) {
        for (const item of levelData as SerializedLevelProgress[]) {
            const progress = parseSerializedLevelProgress(item);
            if (progress) {
                mergeLevelProgress(progressMap, progress);
            }
        }
    }

    if (Array.isArray(completedLevelData)) {
        for (const item of completedLevelData as SerializedLevelProgress[]) {
            const progress = parseSerializedLevelProgress(item);
            if (progress) {
                mergeLevelProgress(progressMap, {
                    ...progress,
                    status: "pass",
                });
            }
        }
    }

    return Array.from(progressMap.values()).sort((a, b) => a.chapterId - b.chapterId || a.levelId - b.levelId);
}

// 序列化 GameProgress 为可存储的格式
function serializeGameProgress(gameProgress: GameProgress): any {
    return {
        level: gameProgress.level.map(({ chapterId, levelId, status }) => ({
            chapterId,
            levelId,
            status,
        })),
        plants: gameProgress.plants,
        zombies: gameProgress.zombies,
        items: Array.from(gameProgress.items.entries()).map(([key, value]) => ({
            id: key,
            count: value.count
        })),
        slotNum: gameProgress.slotNum,
        updatedAt: gameProgress.updatedAt
    };
}

// 反序列化存储的数据为 GameProgress
function deserializeGameProgress(data: any): GameProgress {
    return {
        id: data.id,
        level: normalizeLevelProgress(data.level, data.completedLevel),
        plants: data.plants,
        zombies: data.zombies,
        items: new Map(data.items.map((item: SerializedItem) => {
            const id = item.type ?? item.id;
            return [id, hydrateGoodsItem({
                id,
                count: item.count,
                nameKey: item.nameKey,
                iconKey: item.iconKey,
                descriptionKey: item.descriptionKey
            })] as const;
        })),
        slotNum: data.slotNum,
        updatedAt: new Date(data.updatedAt)
    };
}

// 定义 Dexie 数据库
class GameDatabase extends Dexie {
    gameProgress!: Table<any>;

    constructor() {
        super("MVZ443");
        this.version(1).stores({
            gameProgress: "++id, updatedAt"
        });
    }
}

// 存档管理器类
class SaveManager {
    private db: GameDatabase;

    constructor() {
        this.db = new GameDatabase();
    }

    // 保存游戏进度
    async saveGameProgress(gameProgress: GameProgress): Promise<void> {
        try {
            const serializedData = serializeGameProgress({
                ...gameProgress,
                updatedAt: new Date()
            });

            // 删除旧记录（如果存在）
            await this.db.gameProgress.clear();
            
            // 插入新记录
            await this.db.gameProgress.add(serializedData);
            
            console.log("游戏进度保存成功");
        } catch (error) {
            console.error("保存存档失败:", error);
            throw error;
        }
    }

    // 加载游戏进度
    async loadGameProgress(): Promise<GameProgress | undefined> {
        try {
            const data = await this.db.gameProgress.toArray();
            
            if (data.length === 0) {
                console.log("没有找到存档");
                return undefined;
            }

            // 获取最新的存档（按更新时间排序）
            const latestData = data.sort((a, b) => 
                new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
            )[0];

            return deserializeGameProgress(latestData);
        } catch (error) {
            console.error("读取存档失败:", error);
            throw error;
        }
    }

    // 导入存档
    async importSaveFromJson(jsonString: string): Promise<GameProgress | undefined> {
        try {
            const gameProgress = deserializeGameProgress(JSON.parse(jsonString));
            await this.saveGameProgress(gameProgress);
            return gameProgress;
        } catch (error) {
            console.error("导入存档失败:", error);
            throw error;
        }
    }

    // 导出存档
    async exportSave(): Promise<string> {
        try {
            const gameProgress = await this.loadGameProgress();
            if (!gameProgress) {
                throw new Error("没有找到存档");
            }
            
            const serializedData = serializeGameProgress(gameProgress);
            return JSON.stringify(serializedData, null, 2);
        } catch (error) {
            console.error("导出存档失败:", error);
            throw error;
        }
    }

    // 删除存档
    async deleteSave(): Promise<void> {
        try {
            await this.db.gameProgress.clear();
            console.log("存档删除成功");
        } catch (error) {
            console.error("删除存档失败:", error);
            throw error;
        }
    }

    // 获取存档信息
    async getSaveInfo(): Promise<{ count: number; lastUpdated?: Date }> {
        try {
            const data = await this.db.gameProgress.toArray();
            const lastUpdated = data.length > 0 
                ? new Date(Math.max(...data.map(d => new Date(d.updatedAt).getTime())))
                : undefined;
            
            return {
                count: data.length,
                lastUpdated
            };
        } catch (error) {
            console.error("获取存档信息失败:", error);
            throw error;
        }
    }
}

// 游戏管理器类
export class GameManager {
    private saveManager: SaveManager;
    private _currentProgress: GameProgress;
    private _isInitialized: boolean = false;

    constructor() {
        this.saveManager = new SaveManager();
        this._currentProgress = this.getDefaultProgress();
        this.initializeProgress();
    }

    // 获取默认进度
    private getDefaultProgress(): GameProgress {
        return {
            level: [
                {
                    chapterId: 1,
                    levelId: 1,
                    status: "unlocked",
                }
            ],
            plants: [
                { pid: 1, level: 1 }, 
                { pid: 2, level: 1 }, 
                { pid: 3, level: 1 }, 
                { pid: 4, level: 1 },
                { pid: 18, level: 1 }
            ],
            zombies: [],
            items: new Map<number, Item>(),
            slotNum: 6,
            updatedAt: new Date()
        };
    }

    // 初始化进度（异步）
    private async initializeProgress(): Promise<void> {
        try {
            const savedProgress = await this.saveManager.loadGameProgress();
            if (savedProgress) {
                this._currentProgress = savedProgress;
                if (this.ensureInitialPlants(savedProgress)) {
                    await this.saveManager.saveGameProgress(savedProgress);
                }
                console.log("成功加载存档");
            } else {
                // 如果没有存档，保存默认进度
                console.log("没有找到存档，创建默认存档");
                await this.saveManager.saveGameProgress(this._currentProgress);
            }
            this._isInitialized = true;
        } catch (error) {
            console.error('初始化失败:', error);
            // 即使失败也要标记为已初始化，避免无限重试
            this._isInitialized = true;
        }
    }

    // 新版本新增的初始植物需要补进旧存档，否则老玩家看不到这张卡。
    private ensureInitialPlants(progress: GameProgress): boolean {
        if (!Array.isArray(progress.plants)) {
            progress.plants = [];
        }
        if (progress.plants.some((plant) => plant.pid === 18)) {
            return false;
        }
        progress.plants.push({ pid: 18, level: 1 });
        return true;
    }

    // 等待初始化完成
    private async waitForInitialization(): Promise<void> {
        if (!this._isInitialized) {
            await new Promise<void>((resolve) => {
                const checkInit = () => {
                    if (this._isInitialized) {
                        resolve();
                    } else {
                        setTimeout(checkInit, 10);
                    }
                };
                checkInit();
            });
        }
    }

    // 获取当前进度
    get currentProgress(): GameProgress {
        return this._currentProgress;
    }

    getUnlockedLevels(): LevelProgress[] {
        return this._currentProgress.level.filter((level) => level.status !== "locked");
    }

    isLevelUnlocked(levelId: number, chapterId: number = 1): boolean {
        const progress = this.getLevelProgress(levelId, chapterId);
        return !!progress && progress.status !== "locked";
    }

    isLevelPassed(levelId: number, chapterId: number = 1): boolean {
        return this.getLevelProgress(levelId, chapterId)?.status === "pass";
    }

    // 记录遇到的植物
    recordPlantEncounter(pid: number): void {
        const existingPlant = this._currentProgress.plants.find((p) => p.pid === pid);
        if (!existingPlant) {
            this._currentProgress.plants.push({ pid, level: 1 });
        }
    }

    // 记录遇到的僵尸
    recordZombieEncounter(mid: number): void {
        const existingZombie = this._currentProgress.zombies.find((z) => z.mid === mid);
        if (!existingZombie) {
            this._currentProgress.zombies.push({ mid });
        }
    }

    // 设置植物的等级
    setPlantLevel(pid: number, level: number): void {
        const plant = this._currentProgress.plants.find((p) => p.pid === pid);
        if (plant && level > plant.level) {
            plant.level = level;
        }
    }

    // 更新物品数量
    updateItemCount(itemOrId: number | Omit<Item, "count">, count: number): void {
        const id = typeof itemOrId === "number" ? itemOrId : itemOrId.id;
        const itemKeys = typeof itemOrId === "number" ? {} : {
            nameKey: itemOrId.nameKey,
            iconKey: itemOrId.iconKey,
            descriptionKey: itemOrId.descriptionKey
        };
        const oldItem = this._currentProgress.items.get(id) || { id, count: 0 };
        this._currentProgress.items.set(id, hydrateGoodsItem({
            ...oldItem,
            ...itemKeys,
            id,
            count: oldItem.count + count
        }));
    }

    private getLevelProgress(levelId: number, chapterId: number): LevelProgress | undefined {
        return this._currentProgress.level.find((level) => level.levelId === levelId && level.chapterId === chapterId);
    }

    private toLevelProgressRef(level: number | LevelProgressRef, chapterId: number = 1): LevelProgressRef {
        if (typeof level === "number") {
            return { chapterId, levelId: level };
        }
        return level;
    }

    private setLevelStatus(level: number | LevelProgressRef, status: LevelStatus, chapterId: number = 1): void {
        const levelRef = this.toLevelProgressRef(level, chapterId);
        const currentProgress = this.getLevelProgress(levelRef.levelId, levelRef.chapterId);
        if (currentProgress) {
            if (LEVEL_STATUS_RANK[status] > LEVEL_STATUS_RANK[currentProgress.status]) {
                currentProgress.status = status;
            }
            return;
        }

        this._currentProgress.level.push({
            ...levelRef,
            status,
        });
        this._currentProgress.level.sort((a, b) => a.chapterId - b.chapterId || a.levelId - b.levelId);
    }

    // 设置当前关卡进度
    setCurrentLevel(level: number | LevelProgressRef, chapterId: number = 1): void {
        this.setLevelStatus(level, "unlocked", chapterId);
    }

    // 设置关卡通关进度
    setCompletedLevel(level: number | LevelProgressRef, chapterId: number = 1): void {
        this.setLevelStatus(level, "pass", chapterId);
    }

    // 更新卡槽数量
    updateSlotNum(num: number): void {
        if (num > this._currentProgress.slotNum) {
            this._currentProgress.slotNum = num;
        }
    }

    // 保存当前游戏进度
    async saveProgress(): Promise<void> {
        try {
            await this.waitForInitialization();
            await this.saveManager.saveGameProgress(this._currentProgress);
        } catch (error) {
            console.error("保存进度失败:", error);
            throw error;
        }
    }

    // 加载游戏进度
    async loadProgress(): Promise<void> {
        try {
            await this.waitForInitialization();
            const gameProgress = await this.saveManager.loadGameProgress();
            if (gameProgress) {
                this._currentProgress = gameProgress;
                console.log("进度加载成功");
            } else {
                console.log("没有找到存档，使用默认进度");
                this._currentProgress = this.getDefaultProgress();
            }
        } catch (error) {
            console.error("加载进度失败:", error);
            this._currentProgress = this.getDefaultProgress();
        }
    }

    // 导入游戏存档
    async importSave(jsonString: string): Promise<void> {
        try {
            await this.waitForInitialization();
            const progress = await this.saveManager.importSaveFromJson(jsonString);
            if (progress) {
                this._currentProgress = progress;
            }
        } catch (error) {
            console.error("导入存档失败:", error);
            throw error;
        }
    }

    // 导出游戏存档
    async exportSave(): Promise<string> {
        try {
            await this.waitForInitialization();
            return await this.saveManager.exportSave();
        } catch (error) {
            console.error("导出存档失败:", error);
            throw error;
        }
    }

    // 删除存档
    async deleteSave(): Promise<void> {
        try {
            await this.waitForInitialization();
            await this.saveManager.deleteSave();
            this._currentProgress = this.getDefaultProgress();
        } catch (error) {
            console.error("删除存档失败:", error);
            throw error;
        }
    }

    // 获取存档信息
    async getSaveInfo(): Promise<{ count: number; lastUpdated?: Date }> {
        try {
            await this.waitForInitialization();
            return await this.saveManager.getSaveInfo();
        } catch (error) {
            console.error("获取存档信息失败:", error);
            throw error;
        }
    }

    // 重置为默认进度
    resetToDefault(): void {
        this._currentProgress = this.getDefaultProgress();
    }
}

// React Context
const GameContext = createContext<GameManager | undefined>(undefined);

interface Props {
    children: ReactNode;
}

export function SaveProvider(props: Props) {
    const { children } = props;
    
    // 使用 ahooks 的 useCreation 替代 useState
    const gameManager = useCreation(() => new GameManager(), []);

    return (
        <GameContext.Provider value={gameManager}>
            {children}
        </GameContext.Provider>
    );
}

// 自定义 hook
export const useSaveManager = (): GameManager => {
    const context = useContext(GameContext);
    if (!context) {
        throw new Error("useSaveManager must be used within a SaveProvider");
    }
    return context;
};
