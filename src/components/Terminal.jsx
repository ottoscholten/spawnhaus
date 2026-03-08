import { useEffect, useRef, useState } from 'react';
import { on, send } from '../ws';

export function Terminal({ terminalId, fontSize = 12 }) {
  const containerRef = useRef(null);
  const xtermRef = useRef(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!terminalId || !containerRef.current) return;

    let cancelled = false;

    async function init() {
      const [{ Terminal: XTerm }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ]);
      if (cancelled || !containerRef.current) return;

      const term = new XTerm({
        theme: {
          background: '#0d1117',
          foreground: '#c9d1d9',
          cursor: '#58a6ff',
          selectionBackground: '#264f78',
          black: '#484f58',
          brightBlack: '#6e7681',
        },
        fontFamily: '"JetBrains Mono", "Fira Code", ui-monospace, monospace',
        fontSize,
        lineHeight: 1.3,
        cursorBlink: true,
        scrollback: 1000,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(containerRef.current);

      setTimeout(() => {
        try { fitAddon.fit(); } catch {}
        setLoading(false);
      }, 50);

      send({ type: 'attach-terminal', terminalId });
      setTimeout(() => term.scrollToBottom(), 100);

      const unsub = on('terminal-output', (msg) => {
        if (msg.terminalId === terminalId) {
          term.write(msg.data);
          term.scrollToBottom();
        }
      });

      term.onData(data => send({ type: 'terminal-input', terminalId, data }));
      term.onResize(({ cols, rows }) => send({ type: 'terminal-resize', terminalId, cols, rows }));

      const ro = new ResizeObserver(() => {
        try { fitAddon.fit(); } catch {}
      });
      ro.observe(containerRef.current);

      xtermRef.current = {
        cleanup: () => {
          unsub();
          ro.disconnect();
          term.dispose();
        },
      };
    }

    init();

    return () => {
      cancelled = true;
      if (xtermRef.current?.cleanup) {
        xtermRef.current.cleanup();
        xtermRef.current = null;
      }
    };
  }, [terminalId]);

  return (
    <div style={{ height: '100%', width: '100%', background: '#0d1117', position: 'relative' }}>
      {loading && (
        <div style={{ position: 'absolute', top: 8, left: 8, color: '#484f58', fontSize: 11, fontFamily: 'monospace', pointerEvents: 'none' }}>
          connecting...
        </div>
      )}
      <div ref={containerRef} style={{ height: '100%', width: '100%' }} />
    </div>
  );
}
