import AVFoundation
import Foundation
import UserNotifications

/// Lightweight background-capable listener that tracks a rolling anomaly
/// score over the microphone and exposes two hooks for the rest of the app:
///
/// 1. `onScoreUpdate` — fired ~2x/second with the latest 0…1 anomaly score.
///    The home screen mirrors this into a live progress bar.
/// 2. `onSpeechDetected` — fired (with a cooldown) when the score crosses
///    `threshold`. Hands back a snapshot of the most recent few seconds of
///    16 kHz mono PCM16-LE audio so callers can compute biometrics and
///    persist a passive incident upstream (e.g. Convex).
///
/// Once the host app's Info.plist declares `UIBackgroundModes: audio`, this
/// manager keeps running while the app is backgrounded or the screen is
/// locked. It also re-arms itself after audio session interruptions (phone
/// calls, route changes) so a single `start()` is enough for a long session.
final class AudioTripwireManager {
    private let engine = AVAudioEngine()
    private let queue = DispatchQueue(label: "com.ember.tripwire.audio", qos: .utility)
    private var timer: DispatchSourceTimer?
    private var latestRMS: Double = 0
    private var latestPeak: Double = 0
    private var latestAnomalyScore: Double = 0
    private var running = false
    private var lastNotificationAt: Date?
    private var lastSpeechEventAt: Date?
    private var converter: AVAudioConverter?
    private var targetFormat: AVAudioFormat?
    private var ringBuffer: [Int16] = []
    private let ringQueue = DispatchQueue(label: "com.ember.tripwire.ring", qos: .utility)
    private var notificationObservers: [NSObjectProtocol] = []

    /// Anomaly score (0…1) above which we consider the input "interesting"
    /// enough to fire a passive speech-detected event. Tuned conservatively
    /// — only sustained, clearly-elevated input (loud talking right next to
    /// the mic, distress vocalizations, etc.) should clear this bar. The
    /// bar / score in the UI keeps moving with quieter input; this only
    /// gates the upstream incident write.
    var threshold: Double = 0.78

    /// Min seconds between local notifications (when emitsLocalNotifications is on).
    var cooldownSec: TimeInterval = 600

    /// Min seconds between two `onSpeechDetected` invocations. Bumped to
    /// 5 minutes so a single noisy moment can't flood the dashboard with
    /// dozens of "Cactus VAD" rows.
    var speechEventCooldownSec: TimeInterval = 300

    /// Number of consecutive timer ticks (each ~250 ms) that must score
    /// above `threshold` before we fire `onSpeechDetected`. At 250 ms /
    /// tick, 8 ticks ≈ 2 s of sustained signal — long enough to filter
    /// out claps, door slams, and the occasional cough but short enough
    /// to catch real distress vocalizations.
    var sustainedTicksRequired: Int = 8

    /// Internal counter tracking how many ticks in a row have been over
    /// `threshold`. Reset whenever we drop below.
    private var sustainedTickCount: Int = 0

    /// Rolling buffer length kept in memory for biometric extraction.
    var ringBufferSeconds: Double = 4.0

    /// Sample rate we convert mic input down to before buffering / scoring.
    let sampleRate: Double = 16_000

    var emitsLocalNotifications = false

    var onScoreUpdate: (@Sendable (Double) -> Void)?

    /// Fires when the rolling anomaly score crosses `threshold` (subject to
    /// `speechEventCooldownSec`). The `Data` payload is a snapshot of the
    /// most recent ~`ringBufferSeconds` of 16 kHz mono PCM16-LE samples.
    var onSpeechDetected: (@Sendable (Data) -> Void)?

    var isRunning: Bool { running }

    func start() async throws {
        guard !running else { return }

        let micOK = await requestMicPermission()
        guard micOK else {
            throw NSError(domain: "EmberTripwire", code: 1, userInfo: [NSLocalizedDescriptionKey: "Microphone permission denied"])
        }
        // Notification permission is best-effort; passive monitoring should
        // still run even if the user has denied alerts.
        _ = try? await requestNotificationPermission()

        try configureSession()
        try installTapAndStart()
        installInterruptionObservers()
        startTripwireTimer()
        running = true
    }

    func stop() {
        guard running else { return }
        timer?.cancel()
        timer = nil
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        ringQueue.sync { ringBuffer.removeAll(keepingCapacity: false) }
        removeInterruptionObservers()
        sustainedTickCount = 0
        latestAnomalyScore = 0
        running = false
    }

    // MARK: - Audio plumbing

    private func configureSession() throws {
        let session = AVAudioSession.sharedInstance()
        // `.measurement` keeps AGC / noise suppression off so our score
        // reflects the actual acoustic environment. `.mixWithOthers` makes
        // sure we don't kill background music when monitoring kicks in.
        try session.setCategory(
            .playAndRecord,
            mode: .measurement,
            options: [.defaultToSpeaker, .allowBluetoothHFP, .mixWithOthers]
        )
        try session.setPreferredSampleRate(sampleRate)
        try session.setPreferredIOBufferDuration(0.05)
        try session.setActive(true, options: [])
    }

    private func installTapAndStart() throws {
        let input = engine.inputNode
        let inputFormat = input.outputFormat(forBus: 0)

        guard let target = AVAudioFormat(
            commonFormat: .pcmFormatInt16,
            sampleRate: sampleRate,
            channels: 1,
            interleaved: true
        ) else {
            throw NSError(domain: "EmberTripwire", code: 3, userInfo: [NSLocalizedDescriptionKey: "Cannot build target format"])
        }
        self.targetFormat = target
        self.converter = AVAudioConverter(from: inputFormat, to: target)

        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: inputFormat) { [weak self] buffer, _ in
            self?.handleTap(buffer)
        }

        engine.prepare()
        try engine.start()
    }

    private func handleTap(_ buffer: AVAudioPCMBuffer) {
        // Cheap RMS + peak on the raw float samples (no resample) so the
        // score is responsive even before the converter has produced
        // output. Peak lets transient events (claps, shouts) trip the
        // detector on the very next timer tick instead of waiting for the
        // RMS window to catch up.
        let mono = Self.extractMono(buffer: buffer)
        if !mono.isEmpty {
            self.latestRMS = Self.rms(mono)
            self.latestPeak = Self.peak(mono)
        }

        guard let converter, let target = targetFormat else { return }
        // Estimate output frame capacity assuming downsample.
        let ratio = target.sampleRate / buffer.format.sampleRate
        let outCapacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio + 32)
        guard let outBuf = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: outCapacity) else { return }

        var supplied = false
        var convertError: NSError?
        let status = converter.convert(to: outBuf, error: &convertError) { _, statusPtr in
            if supplied {
                statusPtr.pointee = .noDataNow
                return nil
            }
            supplied = true
            statusPtr.pointee = .haveData
            return buffer
        }
        guard status != .error, convertError == nil, outBuf.frameLength > 0,
              let int16Ptr = outBuf.int16ChannelData?[0] else { return }

        let count = Int(outBuf.frameLength)
        let samples = Array(UnsafeBufferPointer(start: int16Ptr, count: count))
        appendToRing(samples)
    }

    private func appendToRing(_ samples: [Int16]) {
        ringQueue.sync {
            ringBuffer.append(contentsOf: samples)
            let cap = Int(sampleRate * ringBufferSeconds)
            if ringBuffer.count > cap {
                ringBuffer.removeFirst(ringBuffer.count - cap)
            }
        }
    }

    /// Returns a snapshot of the ring buffer as 16-bit little-endian PCM.
    private func snapshotRing() -> Data {
        ringQueue.sync {
            guard !ringBuffer.isEmpty else { return Data() }
            return ringBuffer.withUnsafeBufferPointer { Data(buffer: $0) }
        }
    }

    // MARK: - Scoring loop

    private func startTripwireTimer() {
        timer?.cancel()
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + .milliseconds(250), repeating: .milliseconds(250))
        timer.setEventHandler { [weak self] in
            guard let self else { return }
            // Weighted combination of short-window peak and RMS, both
            // normalised into 0…1. Peak dominates for transients; RMS
            // keeps the score elevated while speech is ongoing. No
            // random jitter — the bar reflects what the mic actually
            // hears.
            //
            // Multipliers tuned so normal conversational RMS lands
            // around 0.30–0.50 (visible on the bar but well below
            // `threshold`), while sustained loud speech / distress
            // vocalisations push past 0.78. This keeps the bar
            // expressive without firing an incident on every cough.
            let rmsScore = min(1, self.latestRMS * 8.0)
            let peakScore = min(1, self.latestPeak * 1.5)
            let score = min(1, max(0, rmsScore * 0.65 + peakScore * 0.35))
            self.latestAnomalyScore = score
            self.onScoreUpdate?(score)

            if score >= self.threshold {
                self.sustainedTickCount += 1
            } else {
                self.sustainedTickCount = 0
                return
            }
            // Require N consecutive over-threshold ticks before we
            // commit to a passive incident. Filters transient noise.
            guard self.sustainedTickCount >= self.sustainedTicksRequired else { return }
            // Reset so the next incident also needs to re-prove
            // sustained signal (instead of every subsequent tick
            // continuing to fire while audio stays loud).
            self.sustainedTickCount = 0

            if self.emitsLocalNotifications {
                self.maybeSendEscalationNotification()
            }
            self.maybeFireSpeechEvent()
        }
        self.timer = timer
        timer.resume()
    }

    private func maybeFireSpeechEvent() {
        let now = Date()
        if let last = lastSpeechEventAt, now.timeIntervalSince(last) < speechEventCooldownSec {
            return
        }
        lastSpeechEventAt = now
        let snapshot = snapshotRing()
        guard !snapshot.isEmpty else { return }
        onSpeechDetected?(snapshot)
    }

    private func maybeSendEscalationNotification() {
        let now = Date()
        if let last = lastNotificationAt, now.timeIntervalSince(last) < cooldownSec {
            return
        }
        lastNotificationAt = now

        let content = UNMutableNotificationContent()
        content.title = "Ember check-in"
        content.body = "Ember detected elevated stress. Tap to check in."
        content.sound = .default
        content.userInfo = [
            "ember_route": "active_assessment",
            "anomaly_score": latestAnomalyScore,
        ]

        let request = UNNotificationRequest(
            identifier: "ember.tripwire.\(Int(now.timeIntervalSince1970))",
            content: content,
            trigger: nil
        )
        UNUserNotificationCenter.current().add(request)
    }

    // MARK: - Interruption resilience

    private func installInterruptionObservers() {
        removeInterruptionObservers()
        let center = NotificationCenter.default
        let interruption = center.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main
        ) { [weak self] note in
            self?.handleInterruption(note)
        }
        let routeChange = center.addObserver(
            forName: AVAudioSession.routeChangeNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main
        ) { [weak self] _ in
            self?.handleRouteChange()
        }
        notificationObservers = [interruption, routeChange]
    }

    private func removeInterruptionObservers() {
        for token in notificationObservers {
            NotificationCenter.default.removeObserver(token)
        }
        notificationObservers.removeAll()
    }

    private func handleInterruption(_ note: Notification) {
        guard
            let userInfo = note.userInfo,
            let typeRaw = userInfo[AVAudioSessionInterruptionTypeKey] as? UInt,
            let type = AVAudioSession.InterruptionType(rawValue: typeRaw)
        else { return }
        switch type {
        case .began:
            // System paused capture (e.g. phone call). Tear down so we can
            // cleanly restart on `.ended` rather than fighting the engine.
            engine.pause()
        case .ended:
            do {
                try AVAudioSession.sharedInstance().setActive(true)
                if !engine.isRunning {
                    try engine.start()
                }
            } catch {
                print("[Ember][Tripwire] resume after interruption failed: \(error.localizedDescription)")
            }
        @unknown default:
            break
        }
    }

    private func handleRouteChange() {
        // The mic route changed (e.g. AirPods plugged in / removed). The
        // engine sometimes silently goes idle here; nudge it back on.
        guard running, !engine.isRunning else { return }
        do {
            try engine.start()
        } catch {
            print("[Ember][Tripwire] route-change restart failed: \(error.localizedDescription)")
        }
    }

    // MARK: - Permissions

    private func requestMicPermission() async -> Bool {
        if #available(iOS 17.0, *) {
            return await AVAudioApplication.requestRecordPermission()
        }
        return await withCheckedContinuation { continuation in
            AVAudioSession.sharedInstance().requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
    }

    private func requestNotificationPermission() async throws -> Bool {
        try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])
    }

    // MARK: - Helpers

    private static func extractMono(buffer: AVAudioPCMBuffer) -> [Float] {
        let frames = Int(buffer.frameLength)
        guard frames > 0, let channels = buffer.floatChannelData else { return [] }
        let channelCount = Int(buffer.format.channelCount)
        if channelCount == 1 {
            return Array(UnsafeBufferPointer(start: channels[0], count: frames))
        }
        var mono = [Float](repeating: 0, count: frames)
        let inv = 1.0 / Float(channelCount)
        for i in 0..<frames {
            var sum: Float = 0
            for c in 0..<channelCount { sum += channels[c][i] }
            mono[i] = sum * inv
        }
        return mono
    }

    private static func rms(_ samples: [Float]) -> Double {
        guard !samples.isEmpty else { return 0 }
        let ms = samples.reduce(0.0) { $0 + Double($1 * $1) } / Double(samples.count)
        return sqrt(max(0, ms))
    }

    private static func peak(_ samples: [Float]) -> Double {
        guard !samples.isEmpty else { return 0 }
        var maxAbs: Float = 0
        for s in samples {
            let a = abs(s)
            if a > maxAbs { maxAbs = a }
        }
        return Double(maxAbs)
    }
}

extension AudioTripwireManager {
    /// Pushes a synthetic PCM16-LE buffer through the normal detection
    /// path. Used by the "Send test signal" button on the home screen so
    /// a clinician demo never depends on an actually-loud environment.
    func fireTestDetection() {
        guard let cb = onSpeechDetected else { return }
        let data = Self.syntheticSpeechBurstData(sampleRate: sampleRate, seconds: 2.0)
        lastSpeechEventAt = Date()
        cb(data)
    }

    /// 2‑second amplitude-modulated sine burst roughly resembling a vowel
    /// at ~220 Hz. Loud enough that the downstream biometric extractor
    /// produces non-zero pitch / jitter values. Exposed statically so
    /// callers can drive `handlePassiveDetection` directly even when the
    /// live listener isn't running.
    static func syntheticSpeechBurstData(sampleRate: Double, seconds: Double) -> Data {
        let count = Int(sampleRate * seconds)
        var samples = [Int16](repeating: 0, count: count)
        let f0 = 220.0
        let amp: Double = 18_000
        for i in 0..<count {
            let t = Double(i) / sampleRate
            let env = 0.5 + 0.5 * sin(2 * .pi * 0.8 * t) // gentle tremor
            let s = sin(2 * .pi * f0 * t) * amp * env
            samples[i] = Int16(max(-32_767, min(32_767, s)))
        }
        return samples.withUnsafeBufferPointer { Data(buffer: $0) }
    }
}
