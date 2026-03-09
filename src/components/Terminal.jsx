import { useEffect, useRef, useState } from 'react';
import { on, send } from '../ws';

export function Terminal({ terminalId, fontSize = 12 }) {
  const containerRef = useRef(null);
  const xtermRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const dragCounter = useRef(0);

  useEffect(() => {
    const reset = () => { dragCounter.current = 0; setDragOver(false); };
    document.addEventListener('dragend', reset);
    document.addEventListener('drop', reset);
    return () => { document.removeEventListener('dragend', reset); document.removeEventListener('drop', reset); };
  }, []);

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

      const isAtBottom = { current: true };
      let replayDone = false;

      term.onScroll(() => {
        if (!replayDone) return;
        const { viewportY, baseY } = term.buffer.active;
        isAtBottom.current = viewportY >= baseY;
      });

      const unsub = on('terminal-output', (msg) => {
        if (msg.terminalId === terminalId) {
          term.write(msg.data);
          if (!replayDone) {
            term.scrollToBottom();
            replayDone = true;
          } else if (isAtBottom.current) {
            term.scrollToBottom();
          }
        }
      });

      term.onData(data => {
        isAtBottom.current = true;
        send({ type: 'terminal-input', terminalId, data });
      });
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

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      try {
        const buf = await file.arrayBuffer();
        const res = await fetch('/api/upload-temp', {
          method: 'POST',
          headers: { 'x-filename': file.name, 'content-type': 'application/octet-stream' },
          body: buf,
        });
        const { path: filePath } = await res.json();
        send({ type: 'terminal-input', terminalId, data: filePath });
      } catch {}
    }
  };

  return (
    <div
      style={{ height: '100%', width: '100%', background: '#0d1117', position: 'relative' }}
      onDragOver={e => e.preventDefault()}
      onDragEnter={() => { dragCounter.current++; setDragOver(true); }}
      onDragLeave={() => { dragCounter.current--; if (dragCounter.current === 0) setDragOver(false); }}
      onDrop={handleDrop}
    >
      {loading && (
        <div style={{ position: 'absolute', top: 8, left: 8, color: '#484f58', fontSize: 11, fontFamily: 'monospace', pointerEvents: 'none' }}>
          connecting...
        </div>
      )}
      {dragOver && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(59,130,246,0.15)', border: '2px dashed #3b82f6', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 10 }}>
          <span style={{ fontSize: 28, color: '#3b82f6' }}>↑</span>
        </div>
      )}
      <div ref={containerRef} style={{ height: '100%', width: '100%' }} />
    </div>
  );
}
