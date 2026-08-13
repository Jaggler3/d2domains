"use client";

import { useEffect, useSyncExternalStore } from "react";

const taglines = [
  "find your corner of the web.",
  "claim your square on the internet.",
  "own your piece of the net.",
  "every great idea needs a home.",
  "pick your pixel, stake your name.",
  "the name you want shouldn't be taken.",
  "your spot on the web is waiting.",
];

const randomTagline = taglines[Math.floor(Math.random() * taglines.length)];

const subscribe = () => () => {};

export function RandomTagline({
  anchorRef,
  showInlineCursor = true,
  onAnchorReady,
}: {
  anchorRef?: React.Ref<HTMLSpanElement>;
  showInlineCursor?: boolean;
  onAnchorReady?: () => void;
}) {
  const tagline = useSyncExternalStore(
    subscribe,
    () => randomTagline,
    () => "",
  );

  useEffect(() => {
    if (tagline) onAnchorReady?.();
  }, [tagline, onAnchorReady]);

  return (
    <h1 className="text-balance px-4 text-center font-pixel text-lg leading-relaxed text-foreground sm:text-2xl">
      {tagline || "\u00a0"}
      {showInlineCursor ? (
        <span className="ml-1 animate-blink text-primary">▍</span>
      ) : (
        <span ref={anchorRef} aria-hidden className="inline-block w-0">
          &nbsp;
        </span>
      )}
    </h1>
  );
}
