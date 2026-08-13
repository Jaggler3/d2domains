export interface CaretAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

let caretCtx: CanvasRenderingContext2D | null = null;

function getCtx() {
  if (!caretCtx) {
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return null;
    caretCtx = ctx;
  }
  return caretCtx;
}

export function measureCaretIn(input: HTMLInputElement): CaretAnchor | null {
  const cs = getComputedStyle(input);
  const fontSize = parseFloat(cs.fontSize) || 16;
  const rect = input.getBoundingClientRect();
  const sel = input.selectionStart ?? 0;
  const text = (input.value ?? "").slice(0, sel);

  const ctx = getCtx();
  let textWidth = 0;
  if (ctx && text) {
    ctx.font = `${cs.fontWeight} ${fontSize}px ${cs.fontFamily}`;
    textWidth = ctx.measureText(text).width;
  }

  const height = Math.round(rect.height * 0.72);
  return {
    x: rect.left + (parseFloat(cs.paddingLeft) || 0) + textWidth,
    y: rect.top + Math.round((rect.height - height) / 2),
    width: Math.round(fontSize * 0.6),
    height,
  };
}
