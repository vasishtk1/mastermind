/**
 * usePointerTelemetry
 *
 * Hooks into window-level Pointer Events API at 60–120 Hz.
 *
 * Captured per event:
 *   - timestamp (DOMHighResTimeStamp), clientX/Y
 *   - width / height (contact geometry)
 *   - pressure (0–1)
 *
 * Derived:
 *   - Inter-tap interval (time between consecutive pointerdown events)
 *   - Swipe velocity (distance / time between pointerdown → pointerup)
 *
 * Thread safety: event callbacks write to refs. React state is updated
 * at most every 200 ms with summary stats only, not per-event.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerFrame, PermissionState } from "../lib/telemetry-types";

const UI_THROTTLE_MS = 200;

export interface PointerTelemetryState {
  permission: PermissionState;
  tapCount: number;
  meanPressure: number;
  meanVelocityPxPerMs: number;
  meanInterTapMs: number;
  lastContactX: number;
  lastContactY: number;
}

const DEFAULT_STATE: PointerTelemetryState = {
  permission: "unknown",
  tapCount: 0,
  meanPressure: 0,
  meanVelocityPxPerMs: 0,
  meanInterTapMs: 0,
  lastContactX: 0,
  lastContactY: 0,
};

export function usePointerTelemetry(
  onFrame?: (frame: PointerFrame) => void,
): { state: PointerTelemetryState } {
  const [state, setState] = useState<PointerTelemetryState>(DEFAULT_STATE);

  // Hot-path accumulators — written per event, never cause re-renders
  const agg = useRef({
    tapCount: 0,
    pressureSum: 0,
    velocitySum: 0,
    velocityCount: 0,
    interTapSum: 0,
    interTapCount: 0,
    lastContactX: 0,
    lastContactY: 0,
  });

  // Active touch tracking
  const downMap = useRef<Map<number, { x: number; y: number; ts: number }>>(new Map());
  const lastDownTs = useRef<number>(0);
  const lastUiTs   = useRef<number>(0);

  const onPointerDown = useCallback(
    (evt: PointerEvent) => {
      const now = evt.timeStamp;
      const interTapMs = lastDownTs.current > 0 ? now - lastDownTs.current : 0;
      lastDownTs.current = now;

      downMap.current.set(evt.pointerId, { x: evt.clientX, y: evt.clientY, ts: now });

      agg.current.tapCount++;
      agg.current.pressureSum += evt.pressure;
      agg.current.lastContactX = evt.clientX;
      agg.current.lastContactY = evt.clientY;
      if (interTapMs > 0) {
        agg.current.interTapSum += interTapMs;
        agg.current.interTapCount++;
      }

      if (onFrame) {
        onFrame({
          ts: Date.now(),
          eventType: "down",
          x: evt.clientX,
          y: evt.clientY,
          contactWidth: evt.width,
          contactHeight: evt.height,
          pressure: evt.pressure,
          velocity: 0,
          interTapMs,
        });
      }

      throttleUiUpdate();
    },
    [onFrame],
  );

  const onPointerUp = useCallback(
    (evt: PointerEvent) => {
      const down = downMap.current.get(evt.pointerId);
      downMap.current.delete(evt.pointerId);

      let velocity = 0;
      if (down) {
        const dx = evt.clientX - down.x;
        const dy = evt.clientY - down.y;
        const dt = evt.timeStamp - down.ts;
        velocity = dt > 0 ? Math.sqrt(dx * dx + dy * dy) / dt : 0;
        if (velocity > 0) {
          agg.current.velocitySum += velocity;
          agg.current.velocityCount++;
        }
      }

      if (onFrame) {
        onFrame({
          ts: Date.now(),
          eventType: "up",
          x: evt.clientX,
          y: evt.clientY,
          contactWidth: evt.width,
          contactHeight: evt.height,
          pressure: evt.pressure,
          velocity,
          interTapMs: 0,
        });
      }

      throttleUiUpdate();
    },
    [onFrame],
  );

  const onPointerMove = useCallback(
    (evt: PointerEvent) => {
      // Only capture primary pointer moves when pressed
      if (!evt.isPrimary || evt.pressure === 0) return;

      if (onFrame) {
        onFrame({
          ts: Date.now(),
          eventType: "move",
          x: evt.clientX,
          y: evt.clientY,
          contactWidth: evt.width,
          contactHeight: evt.height,
          pressure: evt.pressure,
          velocity: 0,
          interTapMs: 0,
        });
      }
    },
    [onFrame],
  );

  const throttleUiUpdate = useCallback(() => {
    const now = performance.now();
    if (now - lastUiTs.current < UI_THROTTLE_MS) return;
    lastUiTs.current = now;
    const a = agg.current;
    setState({
      permission: "granted",
      tapCount: a.tapCount,
      meanPressure: a.tapCount > 0 ? a.pressureSum / a.tapCount : 0,
      meanVelocityPxPerMs: a.velocityCount > 0 ? a.velocitySum / a.velocityCount : 0,
      meanInterTapMs: a.interTapCount > 0 ? a.interTapSum / a.interTapCount : 0,
      lastContactX: a.lastContactX,
      lastContactY: a.lastContactY,
    });
  }, []);

  useEffect(() => {
    setState((s) => ({ ...s, permission: "granted" }));
    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("pointerup",   onPointerUp,   { passive: true });
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup",   onPointerUp);
      window.removeEventListener("pointermove", onPointerMove);
    };
  }, [onPointerDown, onPointerUp, onPointerMove]);

  return { state };
}
