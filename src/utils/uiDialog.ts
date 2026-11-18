// 前端级对话框服务：替代散落各处的 window.alert / window.confirm。
// UI 层通过 subscribeDialog 注册一个渲染器（GlobalDialogHost），业务层只调用 showAlert / showConfirm。

export type DialogKind = "alert" | "confirm";

export interface DialogRequest {
    id: number;
    kind: DialogKind;
    message: string;
    title?: string;
    confirmText?: string;
    cancelText?: string;
    /** 只有 alert 会传 void；confirm 返回 true/false */
    settle: (value: boolean) => void;
}

type DialogListener = (request: DialogRequest | null) => void;

const listeners = new Set<DialogListener>();
let nextId = 1;

/** 注册对话框渲染器；返回取消订阅函数。同时只会存在一个对话框。 */
export function subscribeDialog(listener: DialogListener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function present(request: Omit<DialogRequest, "id" | "settle">): Promise<boolean> {
    return new Promise((resolve) => {
        const full: DialogRequest = {
            ...request,
            id: nextId++,
            settle: (value: boolean) => {
                for (const listener of listeners) {
                    listener(null);
                }
                resolve(value);
            },
        };
        if (listeners.size === 0) {
            // 没有 UI 渲染器时降级为浏览器原生提示，避免 Promise 永久挂起。
            const fallback = request.kind === "confirm"
                ? window.confirm(request.message)
                : window.alert(request.message);
            resolve(Boolean(fallback));
            return;
        }
        for (const listener of listeners) {
            listener(full);
        }
    });
}

export function showConfirm(message: string, options: Partial<Omit<DialogRequest, "id" | "kind" | "message" | "settle">> = {}): Promise<boolean> {
    return present({ ...options, kind: "confirm", message });
}

export function showAlert(message: string, options: Partial<Omit<DialogRequest, "id" | "kind" | "message" | "settle">> = {}): Promise<void> {
    return present({ ...options, kind: "alert", message }).then(() => undefined);
}
