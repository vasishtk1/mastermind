/**
 * useDeviceMotion
 *
 * Listens to DeviceMotion + DeviceOrientation events at the browser's native
 * rate (~60 Hz on iOS/Android, ~100 Hz on some Android).
 *
 * iOS 13+ requires an explicit user gesture to call
 * `DeviceMotionEvent.requestPermission()`. We expose a `requestPermission()`
 * function that must be called from a click handler.
 *
 * Performance: event handlers write to a ref, never calling setState directly.
 * React state is updated at most every 100 ms.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { MotionFrame, PermissionState } from "../lib/telemetry-types";

interface DeviceMotionEventWithPermission extends DeviceMotionEvent {
  // iOS static method (not in standard TS types)
}

interface DeviceMotionEventConstructorWithPermission {
  new (type: string, eventInitDict?: DeviceMotionEventInit): DeviceMotionEvent;
  requestPermission?: () => Promise<"granted" | "denied">;
}

const UI_THROTTLE_MS = 100;

// Derive tremor magnitude from accel-without-gravity magnitude std dev
// over a short sliding window (8 samples ≈ 133 ms at 60 Hz)
const TREMOR_WINDOW = 8;

export interface DeviceMotionState {
  permission: PermissionState;
  /** true on desktop where DeviceMotion is unavailable */
  unavailable: boolean;
  orientationAlpha: number;
  orientationBeta: number;
  orientationGamma: number;
  accelX: number;
  accelY: number;
  accelZ: number;
  tremorMagnitude: number; // std-dev of |accel| over the tremor window
}

const DEFAULT_STATE: DeviceMotionState = {
  permission: "unknown",
  unavailable: false,
  orientationAlpha: 0,
  orientationBeta: 0,
  orientationGamma: 0,
  accelX: 0,
  accelY: 0,
  accelZ: 0,
  tremorMagnitude: 0,
};

export function useDeviceMotion(
  onFrame?: (frame: MotionFrame) => void,
): {
  state: DeviceMotionState;
  requestPermission: () => Promise<void>;
} {
  const [state, setState] = useState<DeviceMotionState>(DEFAULT_STATE);

  // Hot-path refs (never trigger React re-renders)
  const live = useRef({
    alpha: 0, beta: 0, gamma: 0,
    rateAlpha: 0, rateBeta: 0, rateGamma: 0,
    ax: 0, ay: 0, az: 0,
    agx: 0, agy: 0, agz: 0,
  });

  const tremorBuf = useRef<number[]>([]);
  const lastUiTs  = useRef<number>(0);

  // Whether we've confirmed real data arrives (used to detect desktop no-op)
  const hasRealData = useRef(false);

  const attachListeners = useCallback(() => {
    const handleOrientation = (evt: DeviceOrientationEvent) => {
      live.current.alpha  = evt.alpha  ?? 0;
      live.current.beta   = evt.beta   ?? 0;
      live.current.gamma  = evt.gamma  ?? 0;
    };

    const handleMotion = (evt: DeviceMotionEvent) => {
      const a  = evt.acceleration;
      const ag = evt.accelerationIncludingGravity;
      const r  = evt.rotationRate;

      // Desktop Chrome fires the event but all fields are null — detect once
      if (!hasRealData.current) {
        if (a?.x == null && a?.y == null && a?.z == null) {
          setState((s) => ({ ...s, unavailable: true, permission: "unavailable" }));
          return;
        }
        hasRealData.current = true;
      }

      live.current.rateAlpha = r?.alpha ?? 0;
      live.current.rateBeta  = r?.beta  ?? 0;
      live.current.rateGamma = r?.gamma ?? 0;
      live.current.ax  = a?.x  ?? 0;
      live.current.ay  = a?.y  ?? 0;
      live.current.az  = a?.z  ?? 0;
      live.current.agx = ag?.x ?? 0;
      live.current.agy = ag?.y ?? 0;
      live.current.agz = ag?.z ?? 0;

      // Tremor window
      const mag = Math.sqrt(
        (a?.x ?? 0) ** 2 + (a?.y ?? 0) ** 2 + (a?.z ?? 0) ** 2
      );
      const buf = tremorBuf.current;
      buf.push(mag);
      if (buf.length > TREMOR_WINDOW) buf.shift();

      // Dispatch to TelemetryWorker
      if (onFrame) {
        onFrame({
          ts: Date.now(),
          orientationAlpha:  live.current.alpha,
          orientationBeta:   live.current.beta,
          orientationGamma:  live.current.gamma,
          rotationRateAlpha: live.current.rateAlpha,
          rotationRateBeta:  live.current.rateBeta,
          rotationRateGamma: live.current.rateGamma,
          accelX:  live.current.ax,
          accelY:  live.current.ay,
          accelZ:  live.current.az,
          accelGravityX: live.current.agx,
          accelGravityY: live.current.agy,
          accelGravityZ: live.current.agz,
        });
      }

      // Rate-limited React state update
      const now = performance.now();
      if (now - lastUiTs.current >= UI_THROTTLE_MS) {
        lastUiTs.current = now;
        // Compute tremor: pstdev of magnitude buffer
        const n = buf.length;
        let mu = 0;
        for (const v of buf) mu += v;
        mu /= n;
        let variance = 0;
        for (const v of buf) variance += (v - mu) ** 2;
        const tremor = Math.sqrt(variance / n);

        setState({
          permission: "granted",
          unavailable: false,
          orientationAlpha: live.current.alpha,
          orientationBeta:  live.current.beta,
          orientationGamma: live.current.gamma,
          accelX: live.current.ax,
          accelY: live.current.ay,
          accelZ: live.current.az,
          tremorMagnitude: tremor,
        });
      }
    };

    window.addEventListener("deviceorientation", handleOrientation, { passive: true });
    window.addEventListener("devicemotion", handleMotion, { passive: true });

    return () => {
      window.removeEventListener("deviceorientation", handleOrientation);
      window.removeEventListener("devicemotion", handleMotion);
    };
  }, [onFrame]);

  const requestPermission = useCallback(async () => {
    // Check for iOS 13+ permission API
    const MotionEvt =
      DeviceMotionEvent as unknown as DeviceMotionEventConstructorWithPermission;

    if (typeof MotionEvt.requestPermission === "function") {
      try {
        const result = await MotionEvt.requestPermission();
        if (result === "granted") {
          setState((s) => ({ ...s, permission: "granted" }));
          attachListeners();
        } else {
          setState((s) => ({ ...s, permission: "denied" }));
        }
      } catch {
        setState((s) => ({ ...s, permission: "denied" }));
      }
    } else if ("DeviceMotionEvent" in window) {
      // Non-iOS browser — permission not required, just attach
      setState((s) => ({ ...s, permission: "granted" }));
      attachListeners();
    } else {
      setState((s) => ({ ...s, unavailable: true, permission: "unavailable" }));
    }
  }, [attachListeners]);

  // Auto-attach on desktop (no permission required)
  useEffect(() => {
    const MotionEvt =
      DeviceMotionEvent as unknown as DeviceMotionEventConstructorWithPermission;

    if (typeof MotionEvt.requestPermission !== "function") {
      if ("DeviceMotionEvent" in window) {
        const cleanup = attachListeners();
        setState((s) => ({ ...s, permission: "granted" }));
        return cleanup;
      } else {
        setState((s) => ({ ...s, unavailable: true, permission: "unavailable" }));
      }
    }
  }, [attachListeners]);

  return { state, requestPermission };
}
