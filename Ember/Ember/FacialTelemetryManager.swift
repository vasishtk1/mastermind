import ARKit
import Foundation
import QuartzCore
import simd

final class FacialTelemetryManager: NSObject, ARSessionDelegate {
    private let session = ARSession()
    private let queue = DispatchQueue(label: "com.ember.telemetry.face", qos: .userInitiated)
    private var onSample: (@Sendable (ARFaceTelemetrySample) -> Void)?
    var arSession: ARSession { session }

    func start(onSample: @escaping @Sendable (ARFaceTelemetrySample) -> Void) {
        guard ARFaceTrackingConfiguration.isSupported else { return }
        self.onSample = onSample
        session.delegate = self
        session.delegateQueue = queue
        let configuration = ARFaceTrackingConfiguration()
        configuration.isLightEstimationEnabled = true
        session.run(configuration, options: [.resetTracking, .removeExistingAnchors])
    }

    func stop() {
        session.pause()
        session.delegate = nil
        onSample = nil
    }

    func session(_ session: ARSession, didUpdate anchors: [ARAnchor]) {
        guard let face = anchors.compactMap({ $0 as? ARFaceAnchor }).first else { return }
        var blendValues = [String: Double](minimumCapacity: Self.blendShapeLocations.count)
        for (name, location) in Self.blendShapeLocations {
            let value = (face.blendShapes[location]?.doubleValue) ?? 0
            blendValues[name] = value
        }

        let euler = Self.eulerAnglesFromTransform(face.transform)
        let sample = ARFaceTelemetrySample(
            timestampUptimeSec: CACurrentMediaTime(),
            blendShapes: blendValues,
            headPitch: euler.pitch,
            headYaw: euler.yaw,
            headRoll: euler.roll
        )
        onSample?(sample)
    }

    private static func eulerAnglesFromTransform(_ t: simd_float4x4) -> (pitch: Double, yaw: Double, roll: Double) {
        let m = t
        let pitch = atan2(-Double(m.columns.2.y), sqrt(Double(m.columns.2.x * m.columns.2.x + m.columns.2.z * m.columns.2.z)))
        let yaw = atan2(Double(m.columns.2.x), Double(m.columns.2.z))
        let roll = atan2(Double(m.columns.0.y), Double(m.columns.1.y))
        return (pitch, yaw, roll)
    }

    private static let blendShapeLocations: [String: ARFaceAnchor.BlendShapeLocation] = [
        // Eyes & Brows
        "eyeBlinkLeft": .eyeBlinkLeft,
        "eyeBlinkRight": .eyeBlinkRight,
        "eyeLookDownLeft": .eyeLookDownLeft,
        "eyeLookDownRight": .eyeLookDownRight,
        "eyeLookInLeft": .eyeLookInLeft,
        "eyeLookInRight": .eyeLookInRight,
        "eyeLookOutLeft": .eyeLookOutLeft,
        "eyeLookOutRight": .eyeLookOutRight,
        "eyeLookUpLeft": .eyeLookUpLeft,
        "eyeLookUpRight": .eyeLookUpRight,
        "eyeSquintLeft": .eyeSquintLeft,
        "eyeSquintRight": .eyeSquintRight,
        "eyeWideLeft": .eyeWideLeft,
        "eyeWideRight": .eyeWideRight,
        "browDownLeft": .browDownLeft,
        "browDownRight": .browDownRight,
        "browInnerUp": .browInnerUp,
        "browOuterUpLeft": .browOuterUpLeft,
        "browOuterUpRight": .browOuterUpRight,
        // Mouth & Jaw
        "jawForward": .jawForward,
        "jawLeft": .jawLeft,
        "jawRight": .jawRight,
        "jawOpen": .jawOpen,
        "mouthClose": .mouthClose,
        "mouthFunnel": .mouthFunnel,
        "mouthPucker": .mouthPucker,
        "mouthLeft": .mouthLeft,
        "mouthRight": .mouthRight,
        "mouthSmileLeft": .mouthSmileLeft,
        "mouthSmileRight": .mouthSmileRight,
        "mouthFrownLeft": .mouthFrownLeft,
        "mouthFrownRight": .mouthFrownRight,
        "mouthDimpleLeft": .mouthDimpleLeft,
        "mouthDimpleRight": .mouthDimpleRight,
        "mouthStretchLeft": .mouthStretchLeft,
        "mouthStretchRight": .mouthStretchRight,
        "mouthRollLower": .mouthRollLower,
        "mouthRollUpper": .mouthRollUpper,
        "mouthShrugLower": .mouthShrugLower,
        "mouthShrugUpper": .mouthShrugUpper,
        "mouthPressLeft": .mouthPressLeft,
        "mouthPressRight": .mouthPressRight,
        "mouthLowerDownLeft": .mouthLowerDownLeft,
        "mouthLowerDownRight": .mouthLowerDownRight,
        "mouthUpperUpLeft": .mouthUpperUpLeft,
        "mouthUpperUpRight": .mouthUpperUpRight,
        // Cheeks & Nose
        "cheekPuff": .cheekPuff,
        "cheekSquintLeft": .cheekSquintLeft,
        "cheekSquintRight": .cheekSquintRight,
        "noseSneerLeft": .noseSneerLeft,
        "noseSneerRight": .noseSneerRight,
    ]
}
