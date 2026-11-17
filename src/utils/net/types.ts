// net 层共享类型：拆分后的各模块通过接口协作，避免相互 import 形成环。

export interface OnlineStageProvider {
  getStage(): number;
  isOnline(): boolean;
  isRoomSession(): boolean;
}

export type OnlineStatusSnapshot = {
  reconnecting: boolean;
  reconnectAttempt: number;
  latencyMs: number | null;
};
