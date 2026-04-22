import AVFoundation
import Foundation
import Vision

enum JournalTelemetryAnalyzer {
    struct FacialTelemetry: Sendable {
        var facialStressScore: Double
        var browFurrowScore: Double
        var jawTightnessScore: Double
    }

    static func extractPCM16kMono(from videoURL: URL) throws -> Data {
        let asset = AVURLAsset(url: videoURL)
        guard let track = asset.tracks(withMediaType: .audio).first else {
            return Data()
        }

        let reader = try AVAssetReader(asset: asset)
        let out = AVAssetReaderTrackOutput(
            track: track,
            outputSettings: [
                AVFormatIDKey: kAudioFormatLinearPCM,
                AVSampleRateKey: 16_000,
                AVNumberOfChannelsKey: 1,
                AVLinearPCMBitDepthKey: 16,
                AVLinearPCMIsFloatKey: false,
                AVLinearPCMIsBigEndianKey: false,
                AVLinearPCMIsNonInterleaved: false,
            ]
        )
        out.alwaysCopiesSampleData = false
        reader.add(out)
        reader.startReading()

        var data = Data()
        while let sample = out.copyNextSampleBuffer() {
            if let block = CMSampleBufferGetDataBuffer(sample) {
                let len = CMBlockBufferGetDataLength(block)
                var bytes = [UInt8](repeating: 0, count: len)
                CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: len, destination: &bytes)
                data.append(contentsOf: bytes)
            }
            CMSampleBufferInvalidate(sample)
        }
        return data
    }

    static func analyzeFacialStress(from videoURL: URL, samplesPerSecond: Double = 2.0) -> FacialTelemetry {
        let asset = AVURLAsset(url: videoURL)
        let duration = asset.duration.seconds
        guard duration > 0 else {
            return FacialTelemetry(facialStressScore: 0, browFurrowScore: 0, jawTightnessScore: 0)
        }

        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: 640, height: 640)

        var browVals: [Double] = []
        var jawVals: [Double] = []

        let step = max(0.2, 1.0 / samplesPerSecond)
        var t: Double = 0
        while t < duration {
            let time = CMTime(seconds: t, preferredTimescale: 600)
            if let cg = try? generator.copyCGImage(at: time, actualTime: nil) {
                let req = VNDetectFaceLandmarksRequest()
                let handler = VNImageRequestHandler(cgImage: cg, orientation: .up, options: [:])
                try? handler.perform([req])
                if let obs = req.results?.first as? VNFaceObservation,
                   let lm = obs.landmarks {
                    if let val = browFurrow(from: lm) { browVals.append(val) }
                    if let val = jawTightness(from: lm) { jawVals.append(val) }
                }
            }
            t += step
        }

        let brow = mean(browVals)
        let jaw = mean(jawVals)
        let stress = max(0, min(1, brow * 0.55 + jaw * 0.45))
        return FacialTelemetry(facialStressScore: stress, browFurrowScore: brow, jawTightnessScore: jaw)
    }

    private static func browFurrow(from lm: VNFaceLandmarks2D) -> Double? {
        guard let leftBrow = lm.leftEyebrow?.normalizedPoints,
              let rightBrow = lm.rightEyebrow?.normalizedPoints,
              let leftEye = lm.leftEye?.normalizedPoints,
              let rightEye = lm.rightEye?.normalizedPoints else { return nil }
        let lb = meanY(leftBrow)
        let rb = meanY(rightBrow)
        let le = meanY(leftEye)
        let re = meanY(rightEye)
        let leftGap = max(0, lb - le)
        let rightGap = max(0, rb - re)
        // Smaller eye-brow gap => more furrow. Convert to 0..1 roughly.
        let inv = 1.0 - min(1.0, ((leftGap + rightGap) / 2.0) * 4.0)
        return max(0, min(1, inv))
    }

    private static func jawTightness(from lm: VNFaceLandmarks2D) -> Double? {
        guard let lips = lm.innerLips?.normalizedPoints, lips.count > 5 else { return nil }
        let ys = lips.map(\.y)
        guard let minY = ys.min(), let maxY = ys.max() else { return nil }
        let openness = maxY - minY
        // Lower openness may indicate jaw clench/tension. Invert to tension score.
        let score = 1.0 - min(1.0, Double(openness) * 6.0)
        return max(0, min(1, score))
    }

    private static func mean(_ vals: [Double]) -> Double {
        guard !vals.isEmpty else { return 0 }
        return vals.reduce(0, +) / Double(vals.count)
    }

    private static func meanY(_ pts: [CGPoint]) -> Double {
        guard !pts.isEmpty else { return 0 }
        return Double(pts.reduce(CGFloat(0)) { $0 + $1.y } / CGFloat(pts.count))
    }
}
