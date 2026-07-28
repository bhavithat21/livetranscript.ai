import Foundation
import ScreenCaptureKit
import CoreMedia
import CoreAudio

// LiveTranscript macOS system-audio helper.
//
// Captures the system output mix (what's playing — e.g. the Zoom desktop app)
// and writes raw mono Float32 little-endian PCM to stdout with NO header. The
// Rust parent (src-tauri/src/macos_capture.rs) converts to 16-bit PCM and
// forwards it over the Tauri IPC channel to the web UI's ASR pipeline.
//
// Two engines, best-first:
//  1. CoreAudio process tap (macOS 15+): AudioHardwareCreateProcessTap on a
//     mono global tap. Uses the "System Audio Recording Only" TCC permission —
//     granted ONCE, never periodically re-confirmed (unlike Screen Recording),
//     and shows no purple screen-recording indicator.
//  2. ScreenCaptureKit (macOS 13/14, or tap failure): the previous engine.
//     Needs the Screen Recording grant, which macOS 15+ re-confirms after
//     reboots/updates — the recurring dialog this rewrite eliminates.
//
// Protocol with the Rust parent (stderr, line-oriented):
//   "RATE <hz>"  — PCM sample rate, printed before READY (tap runs at the
//                  output device's native rate, not always 48k).
//   "READY"      — capture is live; PCM follows on stdout.
// Anything else on stderr is diagnostics. A failed start exits nonzero with no
// READY, so the parent falls back instead of silently recording nothing.
//
// Both engines are PASSIVE taps of the output mixer — they never seize the mic
// or the output device, so Zoom keeps working and there's no echo/feedback.
// When Rust closes the read end of our stdout, the default SIGPIPE terminates
// us — that's the clean stop path for both engines.

private let err = FileHandle.standardError
// Diagnostics go to stderr (parent forwards to its console) AND to a file, so we
// can debug Finder-launched apps where nothing captures the parent's stderr.
private let diagLog: FileHandle? = {
    let path = "/tmp/livetranscript-audio.log"
    if !FileManager.default.fileExists(atPath: path) {
        FileManager.default.createFile(atPath: path, contents: nil)
    }
    let h = FileHandle(forWritingAtPath: path)
    h?.seekToEndOfFile()
    return h
}()
private func diag(_ s: String) {
    err.write((s + "\n").data(using: .utf8)!)
    diagLog?.write("[\(Date())] \(s)\n".data(using: .utf8)!)
}

struct CaptureError: Error, CustomStringConvertible {
    let description: String
    init(_ d: String) { description = d }
}

// MARK: - Engine 1: CoreAudio process tap (macOS 15+)

// Writes mono f32 LE to stdout from a global process tap routed through a
// private aggregate device. Kill-driven teardown (SIGPIPE), so no explicit
// destroy calls — process death releases the private tap + aggregate.
@available(macOS 15.0, *)
final class ProcessTapCapturer {
    private var ioProcID: AudioDeviceIOProcID?
    private var aggregateID = AudioObjectID(kAudioObjectUnknown)
    private let out = FileHandle.standardOutput
    // A tap created without effective permission (TCC attribution quirks when
    // spawned from an app bundle) fails SILENTLY: everything returns noErr but
    // the IOProc never fires. Verify liveness instead of trusting return codes.
    private let firstFrame = DispatchSemaphore(value: 0)
    private var sawFrame = false

    // True once the IOProc delivered at least one buffer within `timeout`.
    func waitForFirstFrame(timeout: TimeInterval) -> Bool {
        return firstFrame.wait(timeout: .now() + timeout) == .success
    }

    func teardown() {
        if let procID = ioProcID, aggregateID != kAudioObjectUnknown {
            AudioDeviceStop(aggregateID, procID)
            AudioDeviceDestroyIOProcID(aggregateID, procID)
            AudioHardwareDestroyAggregateDevice(aggregateID)
        }
    }

    // Returns the tap's sample rate. Throws if the tap can't be created — the
    // first call on a fresh install triggers the "System Audio Recording Only"
    // permission prompt (attributed to the parent app); a denial surfaces here
    // as an error and the caller falls back to ScreenCaptureKit.
    func start() throws -> Double {
        // Mono mixdown of ALL processes' output. No exclusions: this helper
        // emits no audio itself, and the parent webview plays nothing during
        // capture, so self-capture feedback isn't a real path here.
        let desc = CATapDescription(monoGlobalTapButExcludeProcesses: [])
        desc.isPrivate = true // invisible to other audio apps
        desc.muteBehavior = .unmuted // the user keeps hearing their audio

        var tap = AudioObjectID(kAudioObjectUnknown)
        var status = AudioHardwareCreateProcessTap(desc, &tap)
        guard status == noErr, tap != kAudioObjectUnknown else {
            throw CaptureError("tap create failed (\(status)) — permission denied?")
        }

        // The tap's stream format: mono f32 at the output device's native rate.
        var fmt = AudioStreamBasicDescription()
        var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        var addr = AudioObjectPropertyAddress(
            mSelector: kAudioTapPropertyFormat,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        status = AudioObjectGetPropertyData(tap, &addr, 0, nil, &size, &fmt)
        guard status == noErr, fmt.mSampleRate > 0 else {
            throw CaptureError("tap format read failed (\(status))")
        }

        // Private aggregate device wrapping just the tap; its IOProc is how we
        // pull samples out.
        let aggDesc: [String: Any] = [
            kAudioAggregateDeviceNameKey as String: "LiveTranscript Tap",
            kAudioAggregateDeviceUIDKey as String: UUID().uuidString,
            kAudioAggregateDeviceIsPrivateKey as String: true,
            kAudioAggregateDeviceTapAutoStartKey as String: true,
            kAudioAggregateDeviceTapListKey as String: [
                [kAudioSubTapUIDKey as String: desc.uuid.uuidString]
            ],
        ]
        status = AudioHardwareCreateAggregateDevice(aggDesc as CFDictionary, &aggregateID)
        guard status == noErr else {
            throw CaptureError("aggregate device create failed (\(status))")
        }

        status = AudioDeviceCreateIOProcIDWithBlock(&ioProcID, aggregateID, nil) {
            [out, firstFrame] _, inInputData, _, _, _ in
            // Liveness signal for waitForFirstFrame (main gates READY on this).
            if !self.sawFrame {
                self.sawFrame = true
                firstFrame.signal()
            }
            // ponytail: stdout write on the audio callback thread — same pattern
            // as the SCK engine's sample-handler queue; a stalled pipe just
            // back-pressures capture, and the parent reads continuously.
            let buffers = UnsafeMutableAudioBufferListPointer(
                UnsafeMutablePointer(mutating: inInputData))
            guard let buf = buffers.first, let data = buf.mData, buf.mDataByteSize > 0 else {
                return
            }
            let ch = Int(buf.mNumberChannels)
            if ch <= 1 {
                out.write(Data(bytes: data, count: Int(buf.mDataByteSize)))
            } else {
                // Defensive: the mono tap descriptor should already give 1ch,
                // but downmix interleaved frames if the format ever differs.
                let total = Int(buf.mDataByteSize) / 4
                let frames = total / ch
                let src = data.assumingMemoryBound(to: Float32.self)
                var mono = [Float32](repeating: 0, count: frames)
                for i in 0..<frames {
                    var s: Float32 = 0
                    for c in 0..<ch { s += src[i * ch + c] }
                    mono[i] = s / Float32(ch)
                }
                mono.withUnsafeBytes { out.write(Data($0)) }
            }
        }
        guard status == noErr, let procID = ioProcID else {
            throw CaptureError("IOProc create failed (\(status))")
        }
        status = AudioDeviceStart(aggregateID, procID)
        guard status == noErr else {
            throw CaptureError("device start failed (\(status))")
        }
        return fmt.mSampleRate
    }
}

// MARK: - Engine 2: ScreenCaptureKit fallback (macOS 13/14)

@available(macOS 13.0, *)
final class AudioCapturer: NSObject, SCStreamOutput, SCStreamDelegate {
    private var stream: SCStream?
    private let out = FileHandle.standardOutput

    func start() async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(
            false, onScreenWindowsOnly: false)
        guard let display = content.displays.first else {
            diag("no display")
            exit(1)
        }
        // Exclude our own app so we never capture our own output (no feedback).
        let myPID = ProcessInfo.processInfo.processIdentifier
        let myApp = content.applications.first { $0.processID == myPID }
        let filter = SCContentFilter(
            display: display,
            excludingApplications: myApp.map { [$0] } ?? [],
            exceptingWindows: [])

        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.sampleRate = 48_000
        config.channelCount = 1              // SCK downmixes to mono for us
        config.excludesCurrentProcessAudio = true
        config.width = 2; config.height = 2  // minimal video; no video handler attached

        let stream = SCStream(filter: filter, configuration: config, delegate: self)
        try stream.addStreamOutput(self, type: .audio,
                                   sampleHandlerQueue: DispatchQueue(label: "audio.pcm"))
        try await stream.startCapture()
        self.stream = stream
        // Readiness sentinel: capture is live. A denied Screen-Recording
        // permission throws above (no READY) → the parent falls back.
        diag("RATE 48000")
        diag("READY")
    }

    func stream(_ stream: SCStream,
                didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
                of type: SCStreamOutputType) {
        guard type == .audio, sampleBuffer.isValid else { return }
        var blockBuffer: CMBlockBuffer?
        var abl = AudioBufferList()
        let status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer,
            bufferListSizeNeededOut: nil,
            bufferListOut: &abl,
            bufferListSize: MemoryLayout<AudioBufferList>.size,
            blockBufferAllocator: nil,
            blockBufferMemoryAllocator: nil,
            flags: kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment,
            blockBufferOut: &blockBuffer)
        guard status == noErr else { return }
        let list = UnsafeMutableAudioBufferListPointer(&abl)
        guard let buf = list.first, let data = buf.mData, buf.mDataByteSize > 0 else { return }
        out.write(Data(bytes: data, count: Int(buf.mDataByteSize)))
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        diag("stopped: \(error)")
        exit(1)
    }
}

// MARK: - Main: tap first, SCK fallback

guard #available(macOS 13.0, *) else {
    diag("requires macOS 13+")
    exit(1)
}

// Keep the active engine alive for the process lifetime (dispatchMain never
// returns; teardown is process death via SIGPIPE when the parent closes stdout).
var keepAlive: AnyObject?

var tapStarted = false
if #available(macOS 15.0, *) {
    // Gate at 15.0 (API exists at 14.2) because 15 is where the automatic
    // "System Audio Recording Only" permission prompt on tap creation is
    // reliable; on 14.x SCK's prompt story is the battle-tested one.
    do {
        let tapCapturer = ProcessTapCapturer()
        let rate = try tapCapturer.start()
        // Every call above can return noErr yet deliver nothing (silent TCC
        // denial when spawned from an app bundle). The IOProc fires continuously
        // once truly live — even for silence — so a missing first frame within
        // 3s means the tap is dead: tear it down and use SCK instead.
        if tapCapturer.waitForFirstFrame(timeout: 3.0) {
            keepAlive = tapCapturer
            diag("ENGINE tap")
            diag("RATE \(Int(rate))")
            diag("READY")
            tapStarted = true
        } else {
            tapCapturer.teardown()
            diag("tap started but delivered no frames in 3s — falling back to ScreenCaptureKit")
        }
    } catch {
        diag("tap failed: \(error) — falling back to ScreenCaptureKit")
    }
}

if !tapStarted {
    let capturer = AudioCapturer()
    keepAlive = capturer
    Task {
        do { try await capturer.start() }
        catch {
            diag("start failed: \(error)")
            exit(1)
        }
    }
}

dispatchMain()  // keep alive; both engines deliver on their own queues
