import Foundation
import SwiftUI
import ARKit

@MainActor
final class TelemetryOrchestrator: ObservableObject {
    @Published private(set) var isRunning = false
    @Published private(set) var latestLiveJSON = "{}"
    @Published private(set) var lastUploadStatus = "Idle"
    @Published private(set) var latestFaceSample: ARFaceTelemetrySample?
    @Published private(set) var latestMotionSample: MotionTelemetrySample?
    @Published private(set) var latestVocalSample: VocalProsodyTelemetrySample?
    @Published private(set) var latestTouchSample: TouchTelemetrySample?
    @Published private(set) var latestEnvironmentSample: SensoryEnvironmentTelemetrySample?
    @Published private(set) var telemetryUptimeSec: TimeInterval = 0

    private let faceManager = FacialTelemetryManager()
    private let motionManager = MotionTelemetryManager()
    private let audioManager = AudioTelemetryManager()
    private let sensoryManager = SensoryEnvironmentManager()

    private var buffer: TelemetryBuffer?

    // latest values for live readout
    private var latestFace: ARFaceTelemetrySample?
    private var latestMotion: MotionTelemetrySample?
    private var latestVocal: VocalProsodyTelemetrySample?
    private var latestTouch: TouchTelemetrySample?
    private var latestEnvironment: SensoryEnvironmentTelemetrySample?
    private var telemetryStartTime: Date?
    private var uptimeTask: Task<Void, Never>?

    func start(baseURL: URL) {
        guard !isRunning else { return }
        let endpoint = baseURL.appendingPathComponent("api/telemetry/batch")
        buffer = TelemetryBuffer(endpointURL: endpoint) { [weak self] success, message in
            Task { @MainActor in
                self?.lastUploadStatus = success ? "OK: \(message)" : "ERR: \(message)"
            }
        }
        Task { await buffer?.start() }

        faceManager.start { [weak self] sample in
            guard let self else { return }
            Task { [weak self] in await self?.buffer?.append(face: sample) }
            Task { @MainActor in
                self.latestFace = sample
                self.latestFaceSample = sample
                self.updateLiveJSON()
            }
        }

        motionManager.start { [weak self] sample in
            guard let self else { return }
            Task { [weak self] in await self?.buffer?.append(motion: sample) }
            Task { @MainActor in
                self.latestMotion = sample
                self.latestMotionSample = sample
                self.updateLiveJSON()
            }
        }

        do {
            try audioManager.start { [weak self] sample in
                guard let self else { return }
                Task { [weak self] in await self?.buffer?.append(vocal: sample) }
                Task { @MainActor [weak self] in
                    self?.sensoryManager.emitAmbientNoiseDb(sample.averagePowerDb)
                }
                Task { @MainActor in
                    self.latestVocal = sample
                    self.latestVocalSample = sample
                    self.updateLiveJSON()
                }
            }
        } catch {
            lastUploadStatus = "ERR: Audio telemetry failed to start: \(error.localizedDescription)"
        }

        sensoryManager.start { [weak self] sample in
            guard let self else { return }
            Task { [weak self] in await self?.buffer?.append(environment: sample) }
            Task { @MainActor in
                self.latestEnvironment = sample
                self.latestEnvironmentSample = sample
                self.updateLiveJSON()
            }
        }

        telemetryStartTime = Date()
        telemetryUptimeSec = 0
        uptimeTask?.cancel()
        uptimeTask = Task { [weak self] in
            while !(Task.isCancelled) {
                try? await Task.sleep(nanoseconds: 250_000_000)
                await MainActor.run {
                    guard let self, let start = self.telemetryStartTime else { return }
                    self.telemetryUptimeSec = Date().timeIntervalSince(start)
                }
            }
        }
        isRunning = true
    }

    func stop() {
        guard isRunning else { return }
        faceManager.stop()
        motionManager.stop()
        audioManager.stop()
        sensoryManager.stop()
        Task { await buffer?.stop() }
        buffer = nil
        uptimeTask?.cancel()
        uptimeTask = nil
        telemetryStartTime = nil
        telemetryUptimeSec = 0
        isRunning = false
    }

    func ingestTouch(_ sample: TouchTelemetrySample) {
        guard isRunning else { return }
        Task { [weak self] in await self?.buffer?.append(touch: sample) }
        latestTouch = sample
        latestTouchSample = sample
        updateLiveJSON()
    }

    var tremorIndex: Double {
        guard let m = latestMotionSample else { return 0 }
        let x = m.userAccelerationX
        let y = m.userAccelerationY
        let z = m.userAccelerationZ
        return sqrt(x * x + y * y + z * z)
    }

    var monitoringUptimeText: String {
        let total = Int(telemetryUptimeSec.rounded(.down))
        let h = total / 3600
        let m = (total % 3600) / 60
        let s = total % 60
        return String(format: "%02d:%02d:%02d", h, m, s)
    }

    var faceSessionForPreview: ARSession {
        faceManager.arSession
    }

    private func updateLiveJSON() {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        var root: [String: Any] = [
            "timestamp": ISO8601DateFormatter().string(from: Date()),
            "running": isRunning,
            "upload_status": lastUploadStatus,
        ]
        if let face = latestFace, let obj = toJSONObject(face, encoder: encoder) { root["face"] = obj }
        if let motion = latestMotion, let obj = toJSONObject(motion, encoder: encoder) { root["motion"] = obj }
        if let vocal = latestVocal, let obj = toJSONObject(vocal, encoder: encoder) { root["vocal"] = obj }
        if let touch = latestTouch, let obj = toJSONObject(touch, encoder: encoder) { root["touch"] = obj }
        if let env = latestEnvironment, let obj = toJSONObject(env, encoder: encoder) { root["environment"] = obj }

        if let data = try? JSONSerialization.data(withJSONObject: root, options: [.prettyPrinted, .sortedKeys]),
           let text = String(data: data, encoding: .utf8) {
            latestLiveJSON = text
            print("[Ember][Telemetry][Live]\n\(text)")
            NSLog("[Ember][Telemetry][Live] %@", text)
        }
    }

    private func toJSONObject<T: Encodable>(_ value: T, encoder: JSONEncoder) -> [String: Any]? {
        guard let data = try? encoder.encode(value),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        return obj
    }
}
