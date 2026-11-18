import { useEffect, useState } from 'react';
import { useLocaleMessages } from '../hooks/useLocaleMessages';
import { DialogRequest, subscribeDialog } from '../utils/uiDialog';

/** 全局对话框渲染器：App 挂载一次，所有 showAlert/showConfirm 都在这里呈现。 */
export default function GlobalDialogHost() {
    const [request, setRequest] = useState<DialogRequest | null>(null);
    const { translate } = useLocaleMessages();

    useEffect(() => subscribeDialog(setRequest), []);

    useEffect(() => {
        if (!request) {
            return;
        }
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                request.settle(false);
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [request]);

    if (!request) {
        return null;
    }

    const confirmLabel = request.confirmText || translate('common.confirm') || '确认';
    const cancelLabel = request.cancelText || translate('common.cancel') || '取消';

    return (
        <div style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.62)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
        }}>
            <div role="dialog" aria-modal="true" style={{
                minWidth: '300px',
                maxWidth: 'min(80vw, 520px)',
                padding: '22px 24px',
                background: 'linear-gradient(135deg, #242424, #1a1a1a)',
                border: '1px solid rgba(0, 204, 255, 0.45)',
                borderRadius: '8px',
                boxShadow: '0 12px 40px rgba(0, 0, 0, 0.6)',
                color: '#eee',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
            }}>
                {request.title && (
                    <div style={{ fontSize: '17px', fontWeight: 'bold', color: '#00ccff' }}>{request.title}</div>
                )}
                <div style={{ fontSize: '15px', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{request.message}</div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                    {request.kind === 'confirm' && (
                        <button
                            onClick={() => request.settle(false)}
                            style={{
                                padding: '8px 18px',
                                background: 'none',
                                border: '1px solid #666',
                                color: '#ddd',
                                borderRadius: '4px',
                                cursor: 'pointer',
                            }}
                        >
                            {cancelLabel}
                        </button>
                    )}
                    <button
                        autoFocus
                        onClick={() => request.settle(true)}
                        style={{
                            padding: '8px 18px',
                            background: 'linear-gradient(45deg, #4CAF50, #45a049)',
                            border: 'none',
                            color: '#fff',
                            borderRadius: '4px',
                            cursor: 'pointer',
                        }}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
