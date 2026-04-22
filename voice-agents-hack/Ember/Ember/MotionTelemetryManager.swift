import CoreMotion
import Foundation
import QuartzCore

final class MotionTelemetryManager {
    private let motion = CMMotionManager()
    private let queue = OperationQueue()
    private var onSample: (@Sendable (MotionTelemetrySample) -> Void)?

    init() {
        queue.name = "com.ember.telemetry.motion"
        queue.maxConcurrentOperationCount = 1
        queue.qualityOfService = .userInitiated
    }

    func start(onSample: @escaping @Sendable (MotionTelemetrySample) -> Void) {
        guard motion.isDeviceMotionAvailable else { return }
        self.onSample = onSample
        motion.deviceMotionUpdateInterval = 1.0 / 100.0
        motion.startDeviceMotionUpdates(using: .xArbitraryCorrectedZVertical, to: queue) { [weak self] value, _ in
            guard let self, let dm = value else { return }
            let sample = MotionTelemetrySample(
                timestampUptimeSec: CACurrentMediaTime(),
                attitudePitch: dm.attitude.pitch,
                attitudeRoll: dm.attitude.roll,
                attitudeYaw: dm.attitude.yaw,
                rotationRateX: dm.rotationRate.x,
                rotationRateY: dm.rotationRate.y,
                rotationRateZ: dm.rotationRate.z,
                gravityX: dm.gravity.x,
                gravityY: dm.gravity.y,
                gravityZ: dm.gravity.z,
                userAccelerationX: dm.userAcceleration.x,
                userAccelerationY: dm.userAcceleration.y,
                userAccelerationZ: dm.userAcceleration.z,
                magneticFieldX: dm.magneticField.field.x,
                magneticFieldY: dm.magneticField.field.y,
                magneticFieldZ: dm.magneticField.field.z,
                magneticFieldAccuracy: Self.accuracyName(dm.magneticField.accuracy)
            )
            self.onSample?(sample)
        }
    }

    func stop() {
        motion.stopDeviceMotionUpdates()
        onSample = nil
    }

    private static func accuracyName(_ accuracy: CMMagneticFieldCalibrationAccuracy) -> String {
        switch accuracy {
        case .uncalibrated: return "uncalibrated"
        case .low: return "low"
        case .medium: return "medium"
        case .high: return "high"
        @unknown default: return "unknown"
        }
    }
}
