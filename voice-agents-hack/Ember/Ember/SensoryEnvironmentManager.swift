import Foundation
import QuartzCore
import UIKit

final class SensoryEnvironmentManager {
    private let queue = DispatchQueue(label: "com.ember.telemetry.environment", qos: .utility)
    private var timer: DispatchSourceTimer?
    private var latestBrightness: Double = 0.5
    private var onSample: (@Sendable (SensoryEnvironmentTelemetrySample) -> Void)?

    func start(onSample: @escaping @Sendable (SensoryEnvironmentTelemetrySample) -> Void) {
        self.onSample = onSample
        stop()

        timer = DispatchSource.makeTimerSource(queue: queue)
        timer?.schedule(deadline: .now(), repeating: .milliseconds(250))
        timer?.setEventHandler { [weak self] in
            guard let self else { return }
            Task { @MainActor in
                self.latestBrightness = Double(UIScreen.main.brightness)
            }
            let sample = SensoryEnvironmentTelemetrySample(
                timestampUptimeSec: CACurrentMediaTime(),
                brightness: self.latestBrightness,
                ambientNoiseDb: -120
            )
            self.onSample?(sample)
        }
        timer?.resume()
    }

    func stop() {
        timer?.cancel()
        timer = nil
    }

    func emitAmbientNoiseDb(_ noiseDb: Double) {
        let sample = SensoryEnvironmentTelemetrySample(
            timestampUptimeSec: CACurrentMediaTime(),
            brightness: latestBrightness,
            ambientNoiseDb: noiseDb
        )
        onSample?(sample)
    }
}
