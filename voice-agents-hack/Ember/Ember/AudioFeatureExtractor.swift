import Accelerate
import Foundation

struct AudioMetrics: Codable, Sendable {
    var sampleRateHz: Double
    var durationSec: Double
    var fundamentalFrequencyHz: Double
    var jitterApprox: Double
    var shimmerApprox: Double
    var rms: Double
    var spectralFlux: Double
    var mfccDeviation: Double
    var mfcc1to13: [Double]
    var pitchEscalation: Double
    var breathRate: Double
    var spectralCentroid: Double
    var spectralRolloff: Double
    var zcrDensity: Double
}

enum AudioFeatureExtractor {
    private static let defaultSampleRate: Double = 16_000

    static func compute(fromPCM16LE pcm: Data, sampleRate: Double = defaultSampleRate) -> AudioMetrics {
        let samples = pcm.withUnsafeBytes { raw -> [Float] in
            let s = raw.bindMemory(to: Int16.self)
            return s.map { Float($0) / Float(Int16.max) }
        }
        guard !samples.isEmpty else {
            return AudioMetrics(
                sampleRateHz: sampleRate,
                durationSec: 0,
                fundamentalFrequencyHz: 0,
                jitterApprox: 0,
                shimmerApprox: 0,
                rms: 0,
                spectralFlux: 0,
                mfccDeviation: 0,
                mfcc1to13: Array(repeating: 0, count: 13),
                pitchEscalation: 0,
                breathRate: 0,
                spectralCentroid: 0,
                spectralRolloff: 0,
                zcrDensity: 0
            )
        }

        let durationSec = Double(samples.count) / sampleRate
        let rms = rmsValue(samples)
        let zcr = zcrDensity(samples)
        let spectral = spectralMetrics(samples: samples, sampleRate: sampleRate)
        let f0 = fundamentalFrequency(samples: samples, sampleRate: sampleRate)
        let jitter = jitterApprox(samples: samples, sampleRate: sampleRate)
        let shimmer = shimmerApprox(samples: samples, sampleRate: sampleRate)
        let pitchEsc = pitchEscalation(samples: samples, sampleRate: sampleRate)
        let breathRate = breathRate(samples: samples, sampleRate: sampleRate)

        return AudioMetrics(
            sampleRateHz: sampleRate,
            durationSec: durationSec,
            fundamentalFrequencyHz: f0,
            jitterApprox: jitter,
            shimmerApprox: shimmer,
            rms: rms,
            spectralFlux: spectral.flux,
            mfccDeviation: spectral.mfccDeviation,
            mfcc1to13: spectral.mfccMean.map(Double.init),
            pitchEscalation: pitchEsc,
            breathRate: breathRate,
            spectralCentroid: spectral.centroid,
            spectralRolloff: spectral.rolloff,
            zcrDensity: zcr
        )
    }

    static func prettyJSON(_ metrics: AudioMetrics) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        if let data = try? encoder.encode(metrics), let s = String(data: data, encoding: .utf8) {
            return s
        }
        return "{}"
    }

    private static func rmsValue(_ x: [Float]) -> Double {
        var squares = [Float](repeating: 0, count: x.count)
        vDSP_vsq(x, 1, &squares, 1, vDSP_Length(x.count))
        var meanSquare: Float = 0
        vDSP_meanv(squares, 1, &meanSquare, vDSP_Length(squares.count))
        return Double(sqrt(max(0, meanSquare)))
    }

    private static func zcrDensity(_ x: [Float]) -> Double {
        guard x.count > 1 else { return 0 }
        var crossings = 0
        for i in 1..<x.count {
            if (x[i - 1] >= 0 && x[i] < 0) || (x[i - 1] < 0 && x[i] >= 0) {
                crossings += 1
            }
        }
        return Double(crossings) / Double(x.count - 1)
    }

    private static func spectralMetrics(samples: [Float], sampleRate: Double) -> (flux: Double, centroid: Double, rolloff: Double, mfccDeviation: Double, mfccMean: [Float]) {
        let frameLen = 400
        let hop = 160
        let nfft = 512
        guard samples.count >= frameLen else { return (0, 0, 0, 0, Array(repeating: 0, count: 13)) }

        var window = [Float](repeating: 0, count: frameLen)
        vDSP_hann_window(&window, vDSP_Length(frameLen), Int32(vDSP_HANN_NORM))

        let log2n = vDSP_Length(log2(Float(nfft)))
        guard let fft = vDSP.FFT(log2n: log2n, radix: .radix2, ofType: DSPSplitComplex.self) else {
            return (0, 0, 0, 0, Array(repeating: 0, count: 13))
        }

        let melBank = melFilterBank(sampleRate: sampleRate, nfft: nfft, melBins: 26)
        var mfccFrames = [[Float]]()
        var lastSpectrum: [Float]?
        var fluxTotal: Float = 0
        var centroidTotal: Float = 0
        var rolloffTotal: Float = 0
        var frames = 0

        var real = [Float](repeating: 0, count: nfft / 2)
        var imag = [Float](repeating: 0, count: nfft / 2)
        var mags = [Float](repeating: 0, count: nfft / 2)
        var input = [Float](repeating: 0, count: nfft)

        var start = 0
        while start + frameLen <= samples.count {
            frames += 1
            input.withUnsafeMutableBufferPointer { ptr in
                ptr.initialize(repeating: 0)
            }
            for i in 0..<frameLen {
                input[i] = samples[start + i] * window[i]
            }

            real.withUnsafeMutableBufferPointer { rPtr in
                imag.withUnsafeMutableBufferPointer { iPtr in
                    var split = DSPSplitComplex(realp: rPtr.baseAddress!, imagp: iPtr.baseAddress!)
                    input.withUnsafeBufferPointer { inPtr in
                        inPtr.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: nfft / 2) { complexPtr in
                            vDSP_ctoz(complexPtr, 2, &split, 1, vDSP_Length(nfft / 2))
                        }
                    }
                    fft.forward(input: split, output: &split)
                    vDSP_zvabs(&split, 1, &mags, 1, vDSP_Length(nfft / 2))
                }
            }

            let eps: Float = 1e-7
            var magSum: Float = 0
            vDSP_sve(mags, 1, &magSum, vDSP_Length(mags.count))
            if magSum > eps {
                var centroid: Float = 0
                for i in 0..<mags.count {
                    let freq = Float(sampleRate) * Float(i) / Float(nfft)
                    centroid += freq * mags[i]
                }
                centroidTotal += centroid / magSum

                var cumulative: Float = 0
                let target: Float = magSum * 0.85
                var rolloffBin = 0
                for b in 0..<mags.count {
                    cumulative += mags[b]
                    if cumulative >= target {
                        rolloffBin = b
                        break
                    }
                }
                rolloffTotal += Float(sampleRate) * Float(rolloffBin) / Float(nfft)
            }

            if let prev = lastSpectrum {
                var diff = [Float](repeating: 0, count: mags.count)
                vDSP_vsub(prev, 1, mags, 1, &diff, 1, vDSP_Length(mags.count))
                var sq = [Float](repeating: 0, count: mags.count)
                vDSP_vsq(diff, 1, &sq, 1, vDSP_Length(mags.count))
                var sumSq: Float = 0
                vDSP_sve(sq, 1, &sumSq, vDSP_Length(sq.count))
                fluxTotal += sqrt(max(0, sumSq)) / Float(mags.count)
            }
            lastSpectrum = mags

            let mfcc = computeMFCC(magnitude: mags, melBank: melBank, numCoeffs: 13)
            mfccFrames.append(mfcc)
            start += hop
        }

        let centroid = frames > 0 ? Double(centroidTotal / Float(frames)) : 0
        let flux = frames > 1 ? Double(fluxTotal / Float(frames - 1)) : 0
        let rolloff = frames > 0 ? Double(rolloffTotal / Float(frames)) : 0
        let mfccDeviation = mfccStdDevMean(mfccFrames)
        let mfccMean = mfccMean(mfccFrames)
        return (flux, centroid, rolloff, mfccDeviation, mfccMean)
    }

    private static func computeMFCC(magnitude: [Float], melBank: [[Float]], numCoeffs: Int) -> [Float] {
        var mel = [Float](repeating: 0, count: melBank.count)
        for i in 0..<melBank.count {
            var dot: Float = 0
            vDSP_dotpr(magnitude, 1, melBank[i], 1, &dot, vDSP_Length(magnitude.count))
            mel[i] = logf(max(dot, 1e-7))
        }

        var out = [Float](repeating: 0, count: numCoeffs)
        let m = Float(mel.count)
        for k in 0..<numCoeffs {
            var s: Float = 0
            for n in 0..<mel.count {
                s += mel[n] * cosf(Float.pi * Float(k) * (Float(n) + 0.5) / m)
            }
            out[k] = s
        }
        return out
    }

    private static func mfccStdDevMean(_ frames: [[Float]]) -> Double {
        guard let dim = frames.first?.count, frames.count > 1 else { return 0 }
        var means = [Double](repeating: 0, count: dim)
        for f in frames {
            for i in 0..<dim { means[i] += Double(f[i]) }
        }
        for i in 0..<dim { means[i] /= Double(frames.count) }

        var variances = [Double](repeating: 0, count: dim)
        for f in frames {
            for i in 0..<dim {
                let d = Double(f[i]) - means[i]
                variances[i] += d * d
            }
        }
        for i in 0..<dim { variances[i] /= Double(max(1, frames.count - 1)) }
        let avgStd = variances.map { sqrt(max(0, $0)) }.reduce(0, +) / Double(dim)
        return avgStd
    }

    private static func mfccMean(_ frames: [[Float]]) -> [Float] {
        guard let dim = frames.first?.count else { return Array(repeating: 0, count: 13) }
        var out = [Float](repeating: 0, count: dim)
        guard !frames.isEmpty else { return out }
        for f in frames {
            for i in 0..<dim { out[i] += f[i] }
        }
        for i in 0..<dim { out[i] /= Float(frames.count) }
        return out
    }

    private static func melFilterBank(sampleRate: Double, nfft: Int, melBins: Int) -> [[Float]] {
        let nyquist = sampleRate / 2
        let fMin = 50.0
        let fMax = min(nyquist, 7600.0)
        let toMel: (Double) -> Double = { 2595 * log10(1 + $0 / 700) }
        let toHz: (Double) -> Double = { 700 * (pow(10, $0 / 2595) - 1) }

        let melMin = toMel(fMin)
        let melMax = toMel(fMax)
        let points = (0..<(melBins + 2)).map { i -> Double in
            let m = melMin + (melMax - melMin) * Double(i) / Double(melBins + 1)
            return toHz(m)
        }
        let bins = points.map { Int(floor((Double(nfft) + 1) * $0 / sampleRate)) }
        let specBins = nfft / 2

        var bank = Array(repeating: Array(repeating: Float(0), count: specBins), count: melBins)
        if melBins <= 0 { return bank }
        for m in 0..<melBins {
            let l = max(0, min(specBins - 1, bins[m]))
            let c = max(0, min(specBins - 1, bins[m + 1]))
            let r = max(0, min(specBins - 1, bins[m + 2]))
            if c > l {
                for k in l..<c {
                    bank[m][k] = Float(k - l) / Float(c - l)
                }
            }
            if r > c {
                for k in c..<r {
                    bank[m][k] = Float(r - k) / Float(r - c)
                }
            }
        }
        return bank
    }

    private static func pitchEscalation(samples: [Float], sampleRate: Double) -> Double {
        let frameLen = 400
        let hop = 160
        guard samples.count >= frameLen else { return 0 }

        let minLag = Int(sampleRate / 500.0)
        let maxLag = Int(sampleRate / 50.0)

        var pitches = [Double]()
        var start = 0
        while start + frameLen <= samples.count {
            let frame = Array(samples[start..<(start + frameLen)])
            let pitch = estimatePitchHz(frame: frame, sampleRate: sampleRate, minLag: minLag, maxLag: maxLag)
            if pitch > 0 { pitches.append(pitch) }
            start += hop
        }
        guard pitches.count > 4 else { return 0 }

        let dt = Double(hop) / sampleRate
        var sx = 0.0, sy = 0.0, sxx = 0.0, sxy = 0.0
        for i in pitches.indices {
            let x = Double(i) * dt
            let y = pitches[i]
            sx += x
            sy += y
            sxx += x * x
            sxy += x * y
        }
        let n = Double(pitches.count)
        let denom = n * sxx - sx * sx
        guard abs(denom) > 1e-9 else { return 0 }
        let slope = (n * sxy - sx * sy) / denom
        return max(0, slope)
    }

    private static func fundamentalFrequency(samples: [Float], sampleRate: Double) -> Double {
        let frameLen = 400
        let hop = 160
        guard samples.count >= frameLen else { return 0 }
        let minLag = Int(sampleRate / 500.0)
        let maxLag = Int(sampleRate / 50.0)
        var voiced = [Double]()
        var start = 0
        while start + frameLen <= samples.count {
            let frame = Array(samples[start..<(start + frameLen)])
            let hz = estimatePitchHz(frame: frame, sampleRate: sampleRate, minLag: minLag, maxLag: maxLag)
            if hz > 0 { voiced.append(hz) }
            start += hop
        }
        guard !voiced.isEmpty else { return 0 }
        voiced.sort()
        return voiced[voiced.count / 2]
    }

    private static func jitterApprox(samples: [Float], sampleRate: Double) -> Double {
        let f0 = fundamentalFrequency(samples: samples, sampleRate: sampleRate)
        guard f0 > 1 else { return 0 }
        let period = 1.0 / f0
        let frameLen = max(40, Int(sampleRate * period * 1.5))
        let hop = max(20, Int(sampleRate * period))
        guard samples.count > frameLen else { return 0 }
        var periods = [Double]()
        var start = 0
        while start + frameLen <= samples.count {
            let frame = Array(samples[start..<(start + frameLen)])
            let minLag = Int(sampleRate / 500.0)
            let maxLag = Int(sampleRate / 50.0)
            let hz = estimatePitchHz(frame: frame, sampleRate: sampleRate, minLag: minLag, maxLag: maxLag)
            if hz > 0 { periods.append(1.0 / hz) }
            start += hop
        }
        guard periods.count > 2 else { return 0 }
        let mean = periods.reduce(0, +) / Double(periods.count)
        guard mean > 1e-9 else { return 0 }
        var accum = 0.0
        for i in 1..<periods.count { accum += abs(periods[i] - periods[i - 1]) }
        return (accum / Double(periods.count - 1)) / mean
    }

    private static func shimmerApprox(samples: [Float], sampleRate: Double) -> Double {
        let f0 = fundamentalFrequency(samples: samples, sampleRate: sampleRate)
        guard f0 > 1 else { return 0 }
        let periodSamples = max(1, Int(sampleRate / f0))
        guard samples.count >= periodSamples * 3 else { return 0 }
        var amps = [Double]()
        var i = 0
        while i + periodSamples <= samples.count {
            let peak = samples[i..<(i + periodSamples)].map { abs($0) }.max() ?? 0
            amps.append(Double(peak))
            i += periodSamples
        }
        guard amps.count > 2 else { return 0 }
        let mean = amps.reduce(0, +) / Double(amps.count)
        guard mean > 1e-9 else { return 0 }
        var accum = 0.0
        for j in 1..<amps.count { accum += abs(amps[j] - amps[j - 1]) }
        return (accum / Double(amps.count - 1)) / mean
    }

    private static func estimatePitchHz(frame: [Float], sampleRate: Double, minLag: Int, maxLag: Int) -> Double {
        let energy = frame.reduce(0.0) { $0 + Double($1 * $1) }
        guard energy > 1e-6 else { return 0 }

        var bestLag = 0
        var bestCorr = -Double.infinity
        let upperLag = min(maxLag, frame.count - 2)
        if upperLag <= minLag { return 0 }

        for lag in minLag...upperLag {
            var corr = 0.0
            var normA = 0.0
            var normB = 0.0
            let limit = frame.count - lag
            for i in 0..<limit {
                let a = Double(frame[i])
                let b = Double(frame[i + lag])
                corr += a * b
                normA += a * a
                normB += b * b
            }
            let denom = sqrt(normA * normB) + 1e-9
            let c = corr / denom
            if c > bestCorr {
                bestCorr = c
                bestLag = lag
            }
        }
        guard bestCorr > 0.25, bestLag > 0 else { return 0 }
        return sampleRate / Double(bestLag)
    }

    private static func breathRate(samples: [Float], sampleRate: Double) -> Double {
        let durationSec = Double(samples.count) / sampleRate
        guard durationSec >= 2.0 else { return 0 }
        let frameSec = 0.2
        let hopSec = 0.1
        let frameLen = max(1, Int(frameSec * sampleRate))
        let hop = max(1, Int(hopSec * sampleRate))
        guard samples.count >= frameLen else { return 0 }

        var envelope = [Double]()
        var idx = 0
        while idx + frameLen <= samples.count {
            let frame = samples[idx..<(idx + frameLen)]
            let e = sqrt(frame.reduce(0.0) { $0 + Double($1 * $1) } / Double(frameLen))
            envelope.append(e)
            idx += hop
        }
        guard envelope.count >= 3 else { return 0 }

        let mean = envelope.reduce(0, +) / Double(envelope.count)
        let std = sqrt(envelope.reduce(0) { $0 + pow($1 - mean, 2) } / Double(envelope.count))
        let threshold = mean + 0.3 * std
        let minGapFrames = max(1, Int(0.8 / hopSec))
        var peaks = 0
        var lastPeak = -minGapFrames

        for i in 1..<(envelope.count - 1) {
            if envelope[i] > threshold && envelope[i] > envelope[i - 1] && envelope[i] >= envelope[i + 1] {
                if i - lastPeak >= minGapFrames {
                    peaks += 1
                    lastPeak = i
                }
            }
        }

        return Double(peaks) * 60.0 / durationSec
    }
}
