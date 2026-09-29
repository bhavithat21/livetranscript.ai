import Foundation
import ScreenCaptureKit
import CoreMedia
import AppKit
import CoreImage

// LiveTranscript macOS system-audio helper.
//
// Captures the system output mix (what's playing — e.g. the Zoom desktop app)
// and writes raw mono Float32 little-endian PCM to stdout with NO header. The
// Rust parent (src-tauri/src/macos_capture.rs) converts to 16-bit PCM and
// forwards it over the Tauri IPC channel to the web UI's ASR pipeline.
//
// macOS 14+: use the system content picker for session-scoped audio access.
// macOS 13: use the legacy Screen Recording grant.
// Audio mode discards video frames, even when a display is selected.
//
// Protocol with the Rust parent (stderr, line-oriented):
//   "RATE <hz>"  — PCM sample rate, printed before READY (tap runs at the
//                  output device's native rate, not always 48k).
//   "READY"      — capture is live; PCM follows on stdout.
// Anything else on stderr is diagnostics. A failed start exits nonzero with no
// READY, so the parent reports the failure and keeps the interview open.
//
// Both engines are PASSIVE taps of the output mixer — they never seize the mic
// or the output device, so Zoom keeps working and there's no echo/feedback.
// When Rust closes the read end of our stdout, the default SIGPIPE terminates
// us — that's the clean stop path for both engines.

private let err = FileHandle.standardError
// Diagnostics go to stderr (parent forwards to its console) AND to a file, so we
// can debug Finder-launched apps where nothing captures the parent's stderr.
private let diagLog: FileHandle? = {
    let directory = NSHomeDirectory() + "/Library/Logs/LiveTranscript"
    try? FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    let path = directory + "/native-audio.log"
    if let size = (try? FileManager.default.attributesOfItem(atPath: path)[.size]) as? UInt64, size > 262144 {
        try? FileManager.default.removeItem(atPath: path + ".previous")
        try? FileManager.default.moveItem(atPath: path, toPath: path + ".previous")
    }
    if !FileManager.default.fileExists(atPath: path) {
        FileManager.default.createFile(atPath: path, contents: nil, attributes: [.posixPermissions: 0o600])
    }
    let h = FileHandle(forWritingAtPath: path)
    h?.seekToEndOfFile()
    return h
}()
private func diag(_ s: String) {
    err.write((s + "\n").data(using: .utf8)!)
    diagLog?.write("[\(Date())] \(s)\n".data(using: .utf8)!)
}

private func diagFailure(_ error: Error, stage: String) {
    let value = error as NSError
    let domain = ["com.apple.ScreenCaptureKit.SCStreamErrorDomain", "NSOSStatusErrorDomain", "NSCocoaErrorDomain"].contains(value.domain) ? value.domain : "other"
    diag("AUDIO_FAILURE stage=\(stage) domain=\(domain) code=\(value.code)")
}

struct CaptureError: Error, CustomStringConvertible {
    let description: String
    init(_ d: String) { description = d }
}

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

        try await start(filter: filter)
    }

    func start(filter: SCContentFilter, signalReady: Bool = true) async throws {
        if let current = stream { try await current.updateContentFilter(filter); return }
        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.sampleRate = 48_000
        config.channelCount = 1              // SCK downmixes to mono for us
        config.excludesCurrentProcessAudio = true
        config.width = 2; config.height = 2  // minimal video; no video handler attached

        let stream = SCStream(filter: filter, configuration: config, delegate: self)
        try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: DispatchQueue(label: "audio.discard-video"))
        try stream.addStreamOutput(self, type: .audio,
                                   sampleHandlerQueue: DispatchQueue(label: "audio.pcm"))
        try await stream.startCapture()
        self.stream = stream
        // Readiness sentinel: capture is live. A denied Screen-Recording
        // permission throws above (no READY) → the parent reports the failure.
        if signalReady { diag("RATE 48000"); diag("READY") }
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
        diagFailure(error, stage: "stream-stopped")
        exit(1)
    }
}

// The picker authorizes the selected content directly; do not enumerate all
// displays after a tap timeout and unexpectedly ask for a broader TCC grant.
@available(macOS 14.0, *)
final class AudioPickerCapturer: NSObject, SCContentSharingPickerObserver {
    private let capture = AudioCapturer()
    private var selected = false
    func start() {
        let picker = SCContentSharingPicker.shared
        var configuration = SCContentSharingPickerConfiguration()
        configuration.allowedPickerModes = [.singleDisplay, .singleApplication]
        configuration.excludedBundleIDs = ["ai.livetranscript.desktop"]
        picker.maximumStreamCount = 2
        picker.defaultConfiguration = configuration
        picker.add(self)
        picker.isActive = true
        diag("AUDIO_STAGE picker-requested capacity=2")
        picker.present()
    }
    func contentSharingPicker(_ picker: SCContentSharingPicker, didCancelFor stream: SCStream?) {
        if !selected { diag("Audio selection cancelled. The interview can continue without audio."); exit(1) }
    }
    func contentSharingPickerStartDidFailWithError(_ error: Error) {
        diagFailure(error, stage: "audio-picker"); exit(1)
    }
    func contentSharingPicker(_ picker: SCContentSharingPicker, didUpdateWith filter: SCContentFilter, for stream: SCStream?) {
        selected = true
        Task {
            do {
                diag("AUDIO_STAGE selection-received")
                try await capture.start(filter: filter, signalReady: false)
                // Both helpers are attributed to the same parent picker ID.
                // Retaining audio's picker registration routes later screen
                // selections to this process instead of the visual helper.
                await MainActor.run {
                    picker.remove(self)
                    picker.isActive = false
                }
                diag("AUDIO_STAGE picker-released")
                diag("RATE 48000")
                diag("READY")
            }
            catch { diagFailure(error, stage: "audio-start"); exit(1) }
        }
    }
}

// System-selected, session-scoped screen capture. No display enumeration or TCC
// preflight is used in this mode; the OS picker supplies the authorized filter.
@available(macOS 14.0, *)
final class ScreenPickerCapturer: NSObject, SCContentSharingPickerObserver, SCStreamOutput, SCStreamDelegate {
    private var stream: SCStream?
    private let context = CIContext()
    private var deliveredFirstFrame = false
    private let queue = DispatchQueue(label: "ai.livetranscript.screen-frames")
    func start() {
        let picker = SCContentSharingPicker.shared
        var configuration = SCContentSharingPickerConfiguration()
        configuration.allowedPickerModes = [.singleWindow, .singleDisplay]
        configuration.excludedBundleIDs = ["ai.livetranscript.desktop"]
        // Control Center attributes both helpers to the parent application.
        // Its default limit of one counts the system-audio fallback SCStream,
        // so a running interview otherwise silently suppresses this picker.
        picker.maximumStreamCount = 2
        picker.defaultConfiguration = configuration
        picker.add(self)
        picker.isActive = true
        diag("SCREEN_STAGE picker-requested capacity=2")
        picker.present()
    }
    func contentSharingPicker(_ picker: SCContentSharingPicker, didCancelFor stream: SCStream?) {
        if self.stream == nil { diag("Screen selection cancelled."); exit(1) }
    }
    func contentSharingPickerStartDidFailWithError(_ error: Error) {
        diagFailure(error, stage: "screen-picker"); exit(1)
    }
    func contentSharingPicker(_ picker: SCContentSharingPicker, didUpdateWith filter: SCContentFilter, for stream: SCStream?) {
        Task {
            do {
                if let current = self.stream { try await current.updateContentFilter(filter); return }
                diag("SCREEN_STAGE selection-received")
                let config = SCStreamConfiguration()
                let size = filter.contentRect.size
                let scale = min(1, 2400 / max(1, max(size.width, size.height)))
                config.width = max(2, Int(size.width * scale))
                config.height = max(2, Int(size.height * scale))
                config.minimumFrameInterval = CMTime(value: 1, timescale: 2)
                config.queueDepth = 3
                config.showsCursor = false
                config.capturesAudio = false
                let capture = SCStream(filter: filter, configuration: config, delegate: self)
                self.stream = capture
                try capture.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
                try await capture.startCapture()
                await MainActor.run {
                    picker.remove(self)
                    picker.isActive = false
                }
                diag("SCREEN_STAGE picker-released")
                diag("SCREEN_STAGE capture-started")
            } catch { self.contentSharingPickerStartDidFailWithError(error) }
        }
    }
    func stream(_ stream: SCStream, didOutputSampleBuffer sample: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, sample.isValid,
              let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              let status = attachments.first?[.status] as? Int, status == SCFrameStatus.complete.rawValue,
              let buffer = CMSampleBufferGetImageBuffer(sample) else { return }
        autoreleasepool {
            let image = CIImage(cvPixelBuffer: buffer)
            guard let jpeg = context.jpegRepresentation(of: image, colorSpace: CGColorSpaceCreateDeviceRGB(), options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.8]),
                  jpeg.count <= 4_400_000 else { return }
            if !deliveredFirstFrame {
                deliveredFirstFrame = true
                diag("SCREEN_STAGE first-frame-delivered")
            }
            var length = UInt32(jpeg.count).littleEndian
            var packet = withUnsafeBytes(of: &length) { Data($0) }
            packet.append(jpeg)
            FileHandle.standardOutput.write(packet)
        }
    }
    func stream(_ stream: SCStream, didStopWithError error: Error) {
        FileHandle.standardError.write(Data("Screen sharing ended: \(error.localizedDescription)\n".utf8)); exit(1)
    }
}

if CommandLine.arguments.contains("--screen") {
    guard #available(macOS 14.0, *) else { exit(2) }
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let capture = ScreenPickerCapturer()
    let parent = getppid()
    let parentWatch = DispatchSource.makeTimerSource(queue: .main)
    parentWatch.schedule(deadline: .now() + 1, repeating: 1)
    parentWatch.setEventHandler { if getppid() != parent { exit(0) } }
    parentWatch.resume()
    DispatchQueue.main.async { capture.start() }
    withExtendedLifetime((capture, parentWatch)) { app.run() }
    exit(0)
}

// Audio uses the same system selection flow as screen-only on modern macOS.
if #available(macOS 14.0, *) {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let capture = AudioPickerCapturer()
    DispatchQueue.main.async { capture.start() }
    withExtendedLifetime(capture) { app.run() }
    exit(0)
}

guard #available(macOS 13.0, *) else { diag("requires macOS 13+"); exit(1) }
let capturer = AudioCapturer()
Task {
    do { try await capturer.start() }
    catch { diagFailure(error, stage: "audio-start"); exit(1) }
}
dispatchMain()
