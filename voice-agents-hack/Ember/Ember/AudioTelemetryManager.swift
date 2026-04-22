import AVFoundation
import Accelerate
import Foundation
import QuartzCore

final class AudioTelemetryManager {
    private let engine = AVAudioEngine()
    private let processingQueue = DispatchQueue(label: "com.ember.telemetry.audio", qos: .userInitiated)
    private var onSample: (@Sendable (VocalProsodyTelemetrySample) -> Void)?
    private var previousSpectrum: [Float]?
    private var melBank: [[Float]] = []
    private var mfccPrev: [Float]?
    private var isRunning = false

    func start(onSample: @escaping @Sendable (VocalProsodyTelemetrySample) -> Void) throws {
        guard !isRunning else { return }
        self.onSample = onSample

        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .measurement, options: [.defaultToSpeaker, .allowBluetoothHFP])
        try session.setPreferredSampleRate(44_100)
        try session.setActive(true)

        let input = engine.inputNode
        let inFormat = input.outputFormat(forBus: 0)
        let sampleRate = inFormat.sampleRate
        let fftSize = 1024
        melBank = Self.melFilterBank(sampleRate: sampleRate, nfft: fftSize, melBins: 26)
        previousSpectrum = nil
        mfccPrev = nil

        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: AVAudioFrameCount(fftSize), format: inFormat) { [weak self] buffer, _ in
            guard let self else { return }
            let mono = Self.extractMonoFloatSamples(buffer: buffer)
            guard !mono.isEmpty else { return }

            // Offload all DSP off the realtime callback thread.
            self.processingQueue.async { [weak self] in
                guard let self else { return }
                let sample = Self.computeProsodySample(
                    mono: mono,
                    sampleRate: sampleRate,
                    previousSpectrum: &self.previousSpectrum,
                    melBank: self.melBank,
                    mfccPrev: &self.mfccPrev
                )
                self.onSample?(sample)
            }
        }

        engine.prepare()
        try engine.start()
        isRunning = true
    }

    func stop() {
        guard isRunning else { return }
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        isRunning = false
        onSample = nil
        previousSpectrum = nil
        mfccPrev = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }

    private static func extractMonoFloatSamples(buffer: AVAudioPCMBuffer) -> [Float] {
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

    private static func computeProsodySample(
        mono: [Float],
        sampleRate: Double,
        previousSpectrum: inout [Float]?,
        melBank: [[Float]],
        mfccPrev: inout [Float]?
    ) -> VocalProsodyTelemetrySample {
        let fftSize = 1024
        var frame = mono
        if frame.count < fftSize {
            frame.append(contentsOf: repeatElement(0, count: fftSize - frame.count))
        } else if frame.count > fftSize {
            frame = Array(frame.prefix(fftSize))
        }

        let spectrum = magnitudeSpectrum(frame: frame)
        let centroid = spectralCentroid(spectrum: spectrum, sampleRate: sampleRate, nfft: fftSize)
        let rolloff = spectralRolloff(spectrum: spectrum, sampleRate: sampleRate, nfft: fftSize, percentile: 0.85)
        let flux = spectralFlux(current: spectrum, previous: previousSpectrum)
        previousSpectrum = spectrum

        let f0 = fundamentalFrequency(frame: frame, sampleRate: sampleRate)
        let jitter = jitterApprox(frame: frame, sampleRate: sampleRate)
        let shimmer = shimmerApprox(frame: frame, sampleRate: sampleRate)
        let zcr = zeroCrossingRate(frame)
        let rms = rms(frame)
        let peak = frame.map { abs($0) }.max() ?? 0
        let avgDb = 20 * log10(max(1e-7, rms))
        let peakDb = 20 * log10(max(1e-7, Double(peak)))

        let mfcc = computeMFCC(spectrum: spectrum, melBank: melBank, coeffCount: 13)
        _ = mfccPrev
        mfccPrev = mfcc

        return VocalProsodyTelemetrySample(
            timestampUptimeSec: CACurrentMediaTime(),
            sampleRateHz: sampleRate,
            fundamentalFrequencyHz: f0,
            jitterApprox: jitter,
            shimmerApprox: shimmer,
            mfcc1to13: mfcc.map(Double.init),
            spectralCentroid: centroid,
            spectralRolloff: rolloff,
            spectralFlux: flux,
            zeroCrossingRate: zcr,
            rmsEnergy: rms,
            averagePowerDb: avgDb,
            peakPowerDb: peakDb
        )
    }

    private static func magnitudeSpectrum(frame: [Float]) -> [Float] {
        let n = frame.count
        let log2n = vDSP_Length(log2(Float(n)))
        guard let fft = vDSP.FFT(log2n: log2n, radix: .radix2, ofType: DSPSplitComplex.self) else {
            return [Float](repeating: 0, count: n / 2)
        }

        var window = [Float](repeating: 0, count: n)
        vDSP_hann_window(&window, vDSP_Length(n), Int32(vDSP_HANN_NORM))
        var windowed = [Float](repeating: 0, count: n)
        vDSP_vmul(frame, 1, window, 1, &windowed, 1, vDSP_Length(n))

        var real = [Float](repeating: 0, count: n / 2)
        var imag = [Float](repeating: 0, count: n / 2)
        var magnitudes = [Float](repeating: 0, count: n / 2)

        real.withUnsafeMutableBufferPointer { rPtr in
            imag.withUnsafeMutableBufferPointer { iPtr in
                var split = DSPSplitComplex(realp: rPtr.baseAddress!, imagp: iPtr.baseAddress!)
                windowed.withUnsafeBufferPointer { inPtr in
                    inPtr.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: n / 2) { complexPtr in
                        vDSP_ctoz(complexPtr, 2, &split, 1, vDSP_Length(n / 2))
                    }
                }
                fft.forward(input: split, output: &split)
                vDSP_zvabs(&split, 1, &magnitudes, 1, vDSP_Length(n / 2))
            }
        }
        return magnitudes
    }

    private static func spectralCentroid(spectrum: [Float], sampleRate: Double, nfft: Int) -> Double {
        var sumMag: Float = 0
        vDSP_sve(spectrum, 1, &sumMag, vDSP_Length(spectrum.count))
        guard sumMag > 1e-7 else { return 0 }
        var weighted: Double = 0
        for i in 0..<spectrum.count {
            let f = sampleRate * Double(i) / Double(nfft)
            weighted += f * Double(spectrum[i])
        }
        return weighted / Double(sumMag)
    }

    private static func spectralRolloff(spectrum: [Float], sampleRate: Double, nfft: Int, percentile: Float) -> Double {
        var total: Float = 0
        vDSP_sve(spectrum, 1, &total, vDSP_Length(spectrum.count))
        guard total > 1e-7 else { return 0 }
        let target = total * percentile
        var running: Float = 0
        for i in 0..<spectrum.count {
            running += spectrum[i]
            if running >= target {
                return sampleRate * Double(i) / Double(nfft)
            }
        }
        return sampleRate / 2
    }

    private static func spectralFlux(current: [Float], previous: [Float]?) -> Double {
        guard let previous, previous.count == current.count else { return 0 }
        var diff = [Float](repeating: 0, count: current.count)
        vDSP_vsub(previous, 1, current, 1, &diff, 1, vDSP_Length(current.count))
        var sq = [Float](repeating: 0, count: current.count)
        vDSP_vsq(diff, 1, &sq, 1, vDSP_Length(current.count))
        var sumSq: Float = 0
        vDSP_sve(sq, 1, &sumSq, vDSP_Length(sq.count))
        return Double(sqrt(max(0, sumSq)) / Float(current.count))
    }

    private static func fundamentalFrequency(frame: [Float], sampleRate: Double) -> Double {
        let minLag = Int(sampleRate / 500)
        let maxLag = Int(sampleRate / 50)
        guard frame.count > maxLag + 1 else { return 0 }
        var bestLag = 0
        var bestCorr = -Double.infinity
        for lag in minLag...maxLag {
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
            let c = corr / (sqrt(normA * normB) + 1e-9)
            if c > bestCorr {
                bestCorr = c
                bestLag = lag
            }
        }
        guard bestCorr > 0.25, bestLag > 0 else { return 0 }
        return sampleRate / Double(bestLag)
    }

    private static func jitterApprox(frame: [Float], sampleRate: Double) -> Double {
        let periods = voicedPeriods(frame: frame, sampleRate: sampleRate)
        guard periods.count > 2 else { return 0 }
        let mean = periods.reduce(0, +) / Double(periods.count)
        guard mean > 1e-9 else { return 0 }
        var accum = 0.0
        for i in 1..<periods.count {
            accum += abs(periods[i] - periods[i - 1])
        }
        return (accum / Double(periods.count - 1)) / mean
    }

    private static func shimmerApprox(frame: [Float], sampleRate: Double) -> Double {
        let windows = cycleAmplitudes(frame: frame, sampleRate: sampleRate)
        guard windows.count > 2 else { return 0 }
        let mean = windows.reduce(0, +) / Double(windows.count)
        guard mean > 1e-9 else { return 0 }
        var accum = 0.0
        for i in 1..<windows.count {
            accum += abs(windows[i] - windows[i - 1])
        }
        return (accum / Double(windows.count - 1)) / mean
    }

    private static func voicedPeriods(frame: [Float], sampleRate: Double) -> [Double] {
        let f0 = fundamentalFrequency(frame: frame, sampleRate: sampleRate)
        guard f0 > 1 else { return [] }
        let periodSamples = max(1, Int(sampleRate / f0))
        let hop = periodSamples
        var out = [Double]()
        var idx = 0
        while idx + periodSamples < frame.count {
            out.append(Double(periodSamples) / sampleRate)
            idx += hop
        }
        return out
    }

    private static func cycleAmplitudes(frame: [Float], sampleRate: Double) -> [Double] {
        let f0 = fundamentalFrequency(frame: frame, sampleRate: sampleRate)
        guard f0 > 1 else { return [] }
        let periodSamples = max(1, Int(sampleRate / f0))
        var out = [Double]()
        var idx = 0
        while idx + periodSamples <= frame.count {
            let slice = frame[idx..<(idx + periodSamples)]
            let peak = slice.map { abs($0) }.max() ?? 0
            out.append(Double(peak))
            idx += periodSamples
        }
        return out
    }

    private static func zeroCrossingRate(_ frame: [Float]) -> Double {
        guard frame.count > 1 else { return 0 }
        var c = 0
        for i in 1..<frame.count {
            if (frame[i - 1] >= 0 && frame[i] < 0) || (frame[i - 1] < 0 && frame[i] >= 0) {
                c += 1
            }
        }
        return Double(c) / Double(frame.count - 1)
    }

    private static func rms(_ frame: [Float]) -> Double {
        var sq = [Float](repeating: 0, count: frame.count)
        vDSP_vsq(frame, 1, &sq, 1, vDSP_Length(frame.count))
        var meanSq: Float = 0
        vDSP_meanv(sq, 1, &meanSq, vDSP_Length(frame.count))
        return Double(sqrt(max(0, meanSq)))
    }

    private static func computeMFCC(spectrum: [Float], melBank: [[Float]], coeffCount: Int) -> [Float] {
        guard !melBank.isEmpty else { return [Float](repeating: 0, count: coeffCount) }
        var mel = [Float](repeating: 0, count: melBank.count)
        for i in 0..<melBank.count {
            var dot: Float = 0
            vDSP_dotpr(spectrum, 1, melBank[i], 1, &dot, vDSP_Length(spectrum.count))
            mel[i] = logf(max(dot, 1e-7))
        }

        let m = Float(mel.count)
        var out = [Float](repeating: 0, count: coeffCount)
        for k in 0..<coeffCount {
            var s: Float = 0
            for n in 0..<mel.count {
                s += mel[n] * cosf(Float.pi * Float(k) * (Float(n) + 0.5) / m)
            }
            out[k] = s
        }
        return out
    }

    private static func melFilterBank(sampleRate: Double, nfft: Int, melBins: Int) -> [[Float]] {
        let nyquist = sampleRate / 2
        let fMin = 50.0
        let fMax = min(nyquist, 8000.0)
        let toMel: (Double) -> Double = { 2595 * log10(1 + $0 / 700) }
        let toHz: (Double) -> Double = { 700 * (pow(10, $0 / 2595) - 1) }
        let melMin = toMel(fMin)
        let melMax = toMel(fMax)
        let hzPoints = (0..<(melBins + 2)).map { i in
            toHz(melMin + (melMax - melMin) * Double(i) / Double(melBins + 1))
        }
        let bins = hzPoints.map { Int((Double(nfft) + 1) * $0 / sampleRate) }
        let specBins = nfft / 2
        var bank = Array(repeating: Array(repeating: Float(0), count: specBins), count: melBins)
        for m in 0..<melBins {
            let l = max(0, min(specBins - 1, bins[m]))
            let c = max(0, min(specBins - 1, bins[m + 1]))
            let r = max(0, min(specBins - 1, bins[m + 2]))
            if c > l {
                for k in l..<c { bank[m][k] = Float(k - l) / Float(c - l) }
            }
            if r > c {
                for k in c..<r { bank[m][k] = Float(r - k) / Float(r - c) }
            }
        }
        return bank
    }
}
