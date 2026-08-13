"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { RandomTagline } from "@/components/random-tagline";
import { DomainSearch } from "@/components/domain-search";
import { RetroCaret, type CaretAnchor } from "@/components/retro-caret";
import { measureCaretIn } from "@/lib/caret";

function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onStoreChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onStoreChange);
      return () => mq.removeEventListener("change", onStoreChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

const getInput = () =>
  document.getElementById("domain-search-input") as HTMLInputElement | null;

export function HeroSearch() {
  const finePointer = useMediaQuery("(pointer: fine)");
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const enabled = finePointer && !reducedMotion;

  const heroRef = useRef<HTMLDivElement>(null);
  const taglineAnchorRef = useRef<HTMLSpanElement>(null);

  const [focused, setFocused] = useState(false);
  const [hasResults, setHasResults] = useState(false);
  const [anchor, setAnchor] = useState<CaretAnchor | null>(null);
  const [caret, setCaret] = useState<CaretAnchor | null>(null);

  const focusedRef = useRef(false);
  const hasResultsRef = useRef(false);
  const prevRectRef = useRef<DOMRect | null>(null);

  const measureTagline = useCallback(() => {
    const el = taglineAnchorRef.current;
    const hero = heroRef.current;
    if (!el || !hero) return;
    const r = el.getBoundingClientRect();
    const heroRect = hero.getBoundingClientRect();
    const fontSize = parseFloat(getComputedStyle(el).fontSize) || 20;
    setAnchor({
      x: r.left - heroRect.left,
      y: r.top - heroRect.top,
      width: Math.round(fontSize * 0.6),
      height: r.height || Math.round(fontSize * 1.6),
    });
  }, []);

  const toRelative = useCallback((anchor: CaretAnchor) => {
    const heroRect = heroRef.current?.getBoundingClientRect();
    if (!heroRect) return anchor;
    return {
      x: anchor.x - heroRect.left,
      y: anchor.y - heroRect.top,
      width: anchor.width,
      height: anchor.height,
    };
  }, []);

  const measureCaret = useCallback((): CaretAnchor | null => {
    const input = getInput();
    if (!input) return null;
    const caret = measureCaretIn(input);
    return caret ? toRelative(caret) : null;
  }, [toRelative]);

  useEffect(() => {
    const onViewportChange = () => {
      measureTagline();
      if (focusedRef.current) setCaret(measureCaret());
    };
    window.addEventListener("resize", onViewportChange);
    document.fonts.ready.then(onViewportChange);
    return () => window.removeEventListener("resize", onViewportChange);
  }, [measureTagline, measureCaret]);

  const handleFocusChange = useCallback((focused: boolean) => {
    focusedRef.current = focused;
    setFocused(focused);
  }, []);

  const handleCaretChange = useCallback(
    (caret: CaretAnchor | null) => {
      setCaret(caret ? toRelative(caret) : null);
    },
    [toRelative],
  );

  const handleResultsChange = useCallback((has: boolean) => {
    if (has !== hasResultsRef.current) {
      prevRectRef.current = heroRef.current?.getBoundingClientRect() ?? null;
    }
    hasResultsRef.current = has;
    setHasResults(has);
  }, []);

  useEffect(() => {
    const hero = heroRef.current;
    const prev = prevRectRef.current;
    if (!hero || !prev || reducedMotion) return;
    prevRectRef.current = null;
    const to = hero.getBoundingClientRect();
    const delta = prev.top - to.top;
    if (Math.abs(delta) < 1) return;
    hero.animate(
      [
        { transform: `translateY(${delta}px)` },
        { transform: "translateY(0px)" },
      ],
      { duration: 300, easing: "ease-out" },
    ).onfinish = () => {
      if (focusedRef.current) setCaret(measureCaret());
    };
  }, [hasResults, measureCaret, reducedMotion]);

  const target = focused ? (caret ?? anchor) : anchor;

  return (
    <main className="relative flex flex-1 flex-col items-center justify-center gap-8 px-4 py-20">
      <div ref={heroRef} className="relative flex flex-col items-center gap-8">
        <RandomTagline
          anchorRef={enabled ? taglineAnchorRef : undefined}
          showInlineCursor={!enabled}
          onAnchorReady={enabled ? measureTagline : undefined}
        />
        <DomainSearch
          hideCaret={enabled && focused}
          onFocusChange={handleFocusChange}
          onCaretChange={handleCaretChange}
          onResultsChange={handleResultsChange}
        />
        <RetroCaret target={target} enabled={enabled} />
      </div>
    </main>
  );
}
