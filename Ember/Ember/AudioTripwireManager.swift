import AVFoundation
import Foundation
import UserNotifications

/// Lightweight background-capable listener that triggers a local check-in notification
/// when a simple anomaly score breaches a threshold.
final class AudioTripwireManager {
    private let engine = AVAudioEngine()
    private let queue = DispatchQueue(label: "com.ember.tripwire.audio", qos: .utility)
    private var timer: DispatchSourceTimer?
    private var latestRMS: Double = 0
    private var latestAnomalyScore: Double = 0
    private var isRunning = false
    private var lastNotificationAt: Date?

    var threshold: Double = 0.82
    var cooldownSec: TimeInterval = 120
    var onScoreUpdate: (@Sendable (Double) -> Void)?

    func start() async throws {
        guard !isRunning else { return }

        let micOK = await requestMicPermission()
        guard micOK else {
            throw NSError(domain: "EmberTripwire", code: 1, userInfo: [NSLocalizedDescriptionKey: "Microphone permission denied"])
        }
        let notifOK = try await requestNotificationPermission()
        guard notifOK else {
            throw NSError(domain: "EmberTripwire", code: 2, userInfo: [NSLocalizedDescriptionKey: "Notification permission denied"])
        }

        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .measurement, options: [.defaultToSpeaker, .allowBluetoothHFP])
        try session.setPreferredSampleRate(16_000)
        try session.setActive(true)

        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            guard let self else { return }
            let mono = Self.extractMono(buffer: buffer)
            guard !mono.isEmpty else { return }
            self.latestRMS = Self.rms(mono)
        }

        engine.prepare()
        try engine.start()
        startTripwireTimer()
        isRunning = true
    }

    func stop() {
        guard isRunning else { return }
        timer?.cancel()
        timer = nil
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        isRunning = false
    }

    private func startTripwireTimer() {
        timer?.cancel()
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + .milliseconds(500), repeating: .milliseconds(500))
        timer.setEventHandler { [weak self] in
            guard let self else { return }
            let variance = Double.random(in: 0...0.4)
            let score = min(1, max(0, self.latestRMS * 6.5 + variance))
            self.latestAnomalyScore = score
            self.onScoreUpdate?(score)
            guard score >= self.threshold else { return }
            self.maybeSendEscalationNotification()
        }
        self.timer = timer
        timer.resume()
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
}
