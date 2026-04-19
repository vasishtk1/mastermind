import Foundation

struct ARFaceTelemetrySample: Codable, Sendable {
    var timestampUptimeSec: TimeInterval
    var blendShapes: [String: Double]
    var headPitch: Double
    var headYaw: Double
    var headRoll: Double
}

struct MotionTelemetrySample: Codable, Sendable {
    var timestampUptimeSec: TimeInterval
    var attitudePitch: Double
    var attitudeRoll: Double
    var attitudeYaw: Double
    var rotationRateX: Double
    var rotationRateY: Double
    var rotationRateZ: Double
    var gravityX: Double
    var gravityY: Double
    var gravityZ: Double
    var userAccelerationX: Double
    var userAccelerationY: Double
    var userAccelerationZ: Double
    var magneticFieldX: Double
    var magneticFieldY: Double
    var magneticFieldZ: Double
    var magneticFieldAccuracy: String
}

struct VocalProsodyTelemetrySample: Codable, Sendable {
    var timestampUptimeSec: TimeInterval
    var sampleRateHz: Double
    var fundamentalFrequencyHz: Double
    var jitterApprox: Double
    var shimmerApprox: Double
    var mfcc1to13: [Double]
    var spectralCentroid: Double
    var spectralRolloff: Double
    var spectralFlux: Double
    var zeroCrossingRate: Double
    var rmsEnergy: Double
    var averagePowerDb: Double
    var peakPowerDb: Double
}

struct TouchTelemetrySample: Codable, Sendable {
    var timestampUptimeSec: TimeInterval
    var phase: String
    var x: Double
    var y: Double
    var majorRadius: Double
    var majorRadiusTolerance: Double
    var force: Double
    var tapCount: Int
    var interTapIntervalSec: Double?
    var swipeVelocityPointsPerSec: Double?
}

struct SensoryEnvironmentTelemetrySample: Codable, Sendable {
    var timestampUptimeSec: TimeInterval
    var brightness: Double
    var ambientNoiseDb: Double
}

struct TelemetryBatchPayload: Codable, Sendable {
    var emittedAtISO8601: String
    var faces: [ARFaceTelemetrySample]
    var motions: [MotionTelemetrySample]
    var vocals: [VocalProsodyTelemetrySample]
    var touches: [TouchTelemetrySample]
    var environments: [SensoryEnvironmentTelemetrySample]
}
