import React, { useEffect, useRef } from 'react';
import { useUIStore } from '../../store/uiStore';

/**
 * Renders the confirm()/prompt() replacements queued on uiStore
 * (confirmDialog / promptDialog) - see the doc comment on those fields for
 * why native window.confirm/prompt can't be used (WebView2 doesn't support
 * them in the packaged desktop app). Mount once, near the app's other
 * modals; it renders nothing when no dialog is open.
 */
export const ConfirmPromptModal: React.FC = () => {
  const confirmDialog = useUIStore((s) => s.confirmDialog);
  const promptDialog = useUIStore((s) => s.promptDialog);
  const resolveConfirm = useUIStore((s) => s.resolveConfirm);
  const resolvePrompt = useUIStore((s) => s.resolvePrompt);

  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = React.useState('');

  useEffect(() => {
    if (promptDialog) {
      setValue(promptDialog.defaultValue);
      // Match native prompt()'s behaviour: text pre-filled and selected so
      // typing immediately replaces it.
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [promptDialog]);

  if (!confirmDialog && !promptDialog) return null;

  const overlayStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
  };

  const boxStyle: React.CSSProperties = {
    minWidth: 300,
    maxWidth: 420,
    padding: 16,
  };

  if (confirmDialog) {
    const { message, confirmLabel } = confirmDialog;
    return (
      <div style={overlayStyle} onClick={() => resolveConfirm(false)}>
        <div className="context-menu" style={boxStyle} onClick={(e) => e.stopPropagation()}>
          <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5, marginBottom: 14 }}>{message}</div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn-sm" onClick={() => resolveConfirm(false)}>
              Cancel
            </button>
            <button className="btn-primary" style={{ padding: '4px 14px' }} onClick={() => resolveConfirm(true)}>
              {confirmLabel ?? 'OK'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const { message } = promptDialog!;
  const submit = () => resolvePrompt(value.trim() ? value : null);

  return (
    <div style={overlayStyle} onClick={() => resolvePrompt(null)}>
      <div className="context-menu" style={boxStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.5, marginBottom: 8 }}>{message}</div>
        <input
          ref={inputRef}
          className="field-input"
          style={{ width: '100%', boxSizing: 'border-box', marginBottom: 14 }}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') resolvePrompt(null);
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn-sm" onClick={() => resolvePrompt(null)}>
            Cancel
          </button>
          <button className="btn-primary" style={{ padding: '4px 14px' }} onClick={submit}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
};
